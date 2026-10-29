import { decodeFunctionData, erc20Abi, parseAbi } from "viem";
import { describe, expect, it } from "vitest";

import {
  encodeAccountExecute,
  encodeAccountExecuteBatch,
  encodeOwnerWithdrawal,
  modularAccountAbi,
  type WithdrawalLeg,
  withdrawalCalls,
} from "../src/index.js";

const owner = "0x1111111111111111111111111111111111111111" as const;
const token = "0x2222222222222222222222222222222222222222" as const;
const wbnb = "0x3333333333333333333333333333333333333333" as const;
const withdrawAbi = parseAbi(["function withdraw(uint256 amount)"]);

// These fixtures catch misrouting, wrong values/selectors, and unsafe ordering.
describe("owner withdrawal calls", () => {
  it("sends native currency only to the owner with exactly empty data", () => {
    expect(
      withdrawalCalls({ owner, legs: [{ kind: "NATIVE", amount: 7n }] }),
    ).toEqual([{ target: owner, value: 7n, data: "0x" }]);
  });

  it("transfers tokens to the owner without native value", () => {
    const [call] = withdrawalCalls({
      owner,
      legs: [{ kind: "TOKEN", token, amount: 9n }],
    });
    if (!call) throw new Error("missing token withdrawal call");
    expect(call?.target).toBe(token);
    expect(call?.value).toBe(0n);
    expect(
      decodeFunctionData({ abi: erc20Abi, data: call.data }),
    ).toMatchObject({
      functionName: "transfer",
      args: [owner, 9n],
    });
  });

  it("unwraps before sending the exact unwrapped amount to the owner", () => {
    const calls = withdrawalCalls({
      owner,
      legs: [{ kind: "UNWRAP", wbnb, amount: 11n }],
    });
    expect(calls).toHaveLength(2);
    const [unwrap] = calls;
    if (!unwrap) throw new Error("missing unwrap call");
    expect(calls[0]).toMatchObject({ target: wbnb, value: 0n });
    expect(decodeFunctionData({ abi: withdrawAbi, data: unwrap.data })).toEqual(
      {
        functionName: "withdraw",
        args: [11n],
      },
    );
    expect(calls[1]).toEqual({ target: owner, value: 11n, data: "0x" });
  });

  it("orders unwrap pairs, token transfers, then pre-existing native funds regardless of input order", () => {
    const legs: readonly WithdrawalLeg[] = [
      { kind: "NATIVE", amount: 7n },
      { kind: "TOKEN", token, amount: 9n },
      { kind: "UNWRAP", wbnb, amount: 11n },
    ];
    const calls = withdrawalCalls({ owner, legs });
    expect(calls.map(({ target, value }) => ({ target, value }))).toEqual([
      { target: wbnb, value: 0n },
      { target: owner, value: 11n },
      { target: token, value: 0n },
      { target: owner, value: 7n },
    ]);
    expect(legs.map((leg) => leg.kind)).toEqual(["NATIVE", "TOKEN", "UNWRAP"]);
  });

  it("encodes a single native or token call through execute", () => {
    for (const leg of [
      { kind: "NATIVE", amount: 7n },
      { kind: "TOKEN", token, amount: 9n },
    ] as const) {
      const calls = withdrawalCalls({ owner, legs: [leg] });
      const [call] = calls;
      if (!call) throw new Error("missing withdrawal call");
      const encoded = encodeOwnerWithdrawal({ owner, legs: [leg] });
      expect(encoded).toBe(encodeAccountExecute(call));
      expect(
        decodeFunctionData({ abi: modularAccountAbi, data: encoded })
          .functionName,
      ).toBe("execute");
    }
  });

  it("encodes an unwrap or mixed withdrawal through executeBatch", () => {
    for (const legs of [
      [{ kind: "UNWRAP", wbnb, amount: 11n }],
      [
        { kind: "TOKEN", token, amount: 9n },
        { kind: "NATIVE", amount: 7n },
      ],
    ] as const) {
      const encoded = encodeOwnerWithdrawal({ owner, legs });
      expect(encoded).toBe(
        encodeAccountExecuteBatch(withdrawalCalls({ owner, legs })),
      );
      expect(
        decodeFunctionData({ abi: modularAccountAbi, data: encoded })
          .functionName,
      ).toBe("executeBatch");
    }
  });

  it.each([
    { label: "no legs", legs: [] },
    ...(["NATIVE", "TOKEN", "UNWRAP"] as const).flatMap((kind) =>
      [0n, -1n].map((amount) => ({
        label: `${kind} amount ${amount}`,
        legs: [{ kind, token, wbnb, amount }],
      })),
    ),
    {
      label: "two native legs",
      legs: [
        { kind: "NATIVE", amount: 1n },
        { kind: "NATIVE", amount: 2n },
      ],
    },
    {
      label: "duplicate token",
      legs: [
        { kind: "TOKEN", token, amount: 1n },
        { kind: "TOKEN", token, amount: 2n },
      ],
    },
    {
      label: "duplicate unwrap",
      legs: [
        { kind: "UNWRAP", wbnb, amount: 1n },
        { kind: "UNWRAP", wbnb, amount: 2n },
      ],
    },
    {
      label: "token also unwrapped",
      legs: [
        { kind: "TOKEN", token: wbnb, amount: 1n },
        { kind: "UNWRAP", wbnb, amount: 2n },
      ],
    },
    {
      label: "case-insensitive duplicate",
      legs: [
        {
          kind: "TOKEN",
          token: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
          amount: 1n,
        },
        {
          kind: "UNWRAP",
          wbnb: "0xABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD",
          amount: 2n,
        },
      ],
    },
  ] satisfies { label: string; legs: WithdrawalLeg[] }[])(
    "rejects $label with RangeError",
    ({ legs }) => {
      expect(() => withdrawalCalls({ owner, legs })).toThrow(RangeError);
      expect(() => encodeOwnerWithdrawal({ owner, legs })).toThrow(RangeError);
    },
  );
});
