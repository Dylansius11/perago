import {
  encodeAccountExecute,
  encodeAccountExecuteBatch,
  encodeInstallMandateSession,
  encodeSetAccountPolicy,
  encodeUninstallMandateSession,
  type MandateSessionPermission,
  type UserOperationRequest,
} from "@perago/sdk";
import { encodeFunctionData, type Hex } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import { ReasonError } from "../errors.js";
import {
  assertSponsorableCall,
  BundlerError,
  createAlchemyBundlerRpc,
  createSponsorship,
} from "./sponsorship.js";

const account: Hex = "0x17fcce2b0c0cc44c4f88c6c09b6364a766ee7944";
const mandateExecutor: Hex = "0x1111111111111111111111111111111111111111";
const token: Hex = "0x2222222222222222222222222222222222222222";
const cake: Hex = "0x3333333333333333333333333333333333333333";
const wbnb: Hex = "0x4444444444444444444444444444444444444444";
const stranger: Hex = "0x5555555555555555555555555555555555555555";
const hash = `0x${"ab".repeat(32)}` as Hex;
const rootSignature = `0x${"cd".repeat(65)}` as Hex;

const scope = {
  account,
  mandateExecutor,
  tokens: [token, cake],
  wbnb,
} as const;

const approveAbi = [
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
] as const;

const depositAbi = [
  {
    type: "function",
    name: "deposit",
    inputs: [],
    outputs: [],
    stateMutability: "payable",
  },
] as const;

const approveData = (spender: Hex, amount: bigint): Hex =>
  encodeFunctionData({
    abi: approveAbi,
    args: [spender, amount],
    functionName: "approve",
  });

const depositData = (): Hex =>
  encodeFunctionData({ abi: depositAbi, functionName: "deposit" });

const execute = (target: Hex, value: bigint, data: Hex): Hex =>
  encodeAccountExecute({ data, target, value });

const permission: MandateSessionPermission = {
  account,
  entityId: 1,
  nativeSpendLimit: 0n,
  selectors: ["0xabcdef01"],
  sessionSigner: stranger,
  target: mandateExecutor,
  validAfter: 0,
  validUntil: 2_000_000_000,
};

const policyCall = encodeSetAccountPolicy(
  {
    account,
    chainId: "97",
    ownerEpoch: "1",
    permissionHash: hash,
    policyHash: hash,
    rootOwner: stranger,
    validUntil: "2000000000",
  },
  rootSignature,
);

const revokeCall = encodeFunctionData({
  abi: [
    {
      type: "function",
      name: "revoke",
      inputs: [{ name: "mandateHash", type: "bytes32" }],
      outputs: [],
      stateMutability: "nonpayable",
    },
  ] as const,
  args: [hash],
  functionName: "revoke",
});

const approvalOperation = (): Hex =>
  execute(token, 0n, approveData(mandateExecutor, 1_000n));

const refusalCode = (action: () => unknown): string => {
  try {
    action();
  } catch (error) {
    if (error instanceof ReasonError) return error.code;
    throw error;
  }
  throw new Error("expected a sponsorship refusal");
};

const operation = (
  overrides: Partial<UserOperationRequest> = {},
): UserOperationRequest => ({
  callData: approvalOperation(),
  callGasLimit: "0x30d40",
  maxFeePerGas: "0x0",
  maxPriorityFeePerGas: "0x0",
  nonce: "0x1",
  preVerificationGas: "0x5208",
  sender: account,
  signature: `0x${"aa".repeat(83)}`,
  verificationGasLimit: "0x186a0",
  ...overrides,
});

type Call = { method: string; params: unknown[] };

function recordingRpc(answer: (call: Call) => unknown) {
  const calls: Call[] = [];
  return {
    calls,
    rpc: async (call: Call) => {
      calls.push(call);
      return answer(call);
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("sponsored call shapes", () => {
  it("allows the calls the console root-signs", () => {
    const allowed = [
      approvalOperation(),
      execute(wbnb, 1n, depositData()),
      execute(mandateExecutor, 0n, revokeCall),
      execute(account, 0n, encodeInstallMandateSession(permission)),
      execute(account, 0n, encodeUninstallMandateSession(permission)),
    ];
    for (const callData of allowed)
      expect(() => assertSponsorableCall({ ...scope, callData })).not.toThrow();
  });

  it("allows a policy transition batch and a revocation batch", () => {
    expect(() =>
      assertSponsorableCall({
        ...scope,
        callData: encodeAccountExecuteBatch([
          {
            data: encodeInstallMandateSession(permission),
            target: account,
            value: 0n,
          },
          { data: policyCall, target: mandateExecutor, value: 0n },
          { data: approveData(mandateExecutor, 5n), target: token, value: 0n },
        ]),
      }),
    ).not.toThrow();
    expect(() =>
      assertSponsorableCall({
        ...scope,
        callData: encodeAccountExecuteBatch([
          {
            data: encodeUninstallMandateSession(permission),
            target: account,
            value: 0n,
          },
          { data: policyCall, target: mandateExecutor, value: 0n },
          { data: approveData(mandateExecutor, 0n), target: token, value: 0n },
          { data: approveData(mandateExecutor, 0n), target: cake, value: 0n },
        ]),
      }),
    ).not.toThrow();
  });

  it("refuses a foreign target", () => {
    expect(
      refusalCode(() =>
        assertSponsorableCall({
          ...scope,
          callData: execute(
            stranger,
            0n,
            `0xa9059cbb${"0".repeat(128)}` as Hex,
          ),
        }),
      ),
    ).toBe("SPONSORSHIP_REFUSED");
  });

  it("refuses an approval that names another spender", () => {
    expect(
      refusalCode(() =>
        assertSponsorableCall({
          ...scope,
          callData: execute(token, 0n, approveData(stranger, 1_000n)),
        }),
      ),
    ).toBe("SPONSORSHIP_REFUSED");
  });

  it("refuses native value on a MandateExecutor call", () => {
    expect(
      refusalCode(() =>
        assertSponsorableCall({
          ...scope,
          callData: execute(mandateExecutor, 1n, revokeCall),
        }),
      ),
    ).toBe("SPONSORSHIP_REFUSED");
  });

  it("refuses an arbitrary account self-call", () => {
    expect(
      refusalCode(() =>
        assertSponsorableCall({
          ...scope,
          callData: execute(account, 0n, "0x4f1ef286" as Hex),
        }),
      ),
    ).toBe("SPONSORSHIP_REFUSED");
  });

  it("refuses a call that is not an account execution and a value-free deposit", () => {
    expect(
      refusalCode(() =>
        assertSponsorableCall({ ...scope, callData: revokeCall }),
      ),
    ).toBe("SPONSORSHIP_REFUSED");
    expect(
      refusalCode(() =>
        assertSponsorableCall({
          ...scope,
          callData: execute(wbnb, 0n, depositData()),
        }),
      ),
    ).toBe("SPONSORSHIP_REFUSED");
  });

  it("refuses calldata it cannot decode instead of failing as a server error", () => {
    for (const callData of [
      execute(token, 0n, "0x095ea7b3" as Hex),
      `0xb61d27f6${"00".repeat(8)}` as Hex,
      `0x34fcd5be${"00".repeat(8)}` as Hex,
    ])
      expect(
        refusalCode(() => assertSponsorableCall({ ...scope, callData })),
      ).toBe("SPONSORSHIP_REFUSED");
  });
});

describe("sponsored gas estimation", () => {
  it("estimates from the session account with zero fees and a dummy signature", async () => {
    const { calls, rpc } = recordingRpc(() => ({
      callGasLimit: "0x186a0",
      preVerificationGas: "0x5208",
      verificationGasLimit: "0x30d40",
    }));
    const service = createSponsorship(scope, rpc);
    expect(
      await service.estimate({
        account,
        callData: approvalOperation(),
        nonce: 7n,
      }),
    ).toEqual({
      callGasLimit: "0x1c138",
      preVerificationGas: "0x5e56",
      verificationGasLimit: "0x38270",
    });
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.method).toBe("eth_estimateUserOperationGas");
    expect(call?.params[1]).toBe("0x0000000071727De22E5E9d8BAf0edAc6f37da032");
    expect(call?.params[0]).toMatchObject({
      callData: approvalOperation(),
      maxFeePerGas: "0x0",
      maxPriorityFeePerGas: "0x0",
      nonce: "0x7",
      sender: account,
    });
    const [estimated] = call?.params ?? [];
    expect((estimated as { signature: string }).signature).toMatch(
      /^0xff00[0-9a-f]+$/u,
    );
  });

  it("refuses to estimate a call the sponsored path may not submit", async () => {
    const { calls, rpc } = recordingRpc(() => ({}));
    const service = createSponsorship(scope, rpc);
    const failure = await service
      .estimate({ account, callData: revokeCall, nonce: 1n })
      .catch((error: unknown) => error);
    expect((failure as ReasonError).code).toBe("SPONSORSHIP_REFUSED");
    expect(calls).toHaveLength(0);
  });

  it("maps a bundler refusal to SPONSORSHIP_UNAVAILABLE", async () => {
    const { rpc } = recordingRpc(() => {
      throw new BundlerError("policy does not allow this call");
    });
    const service = createSponsorship(scope, rpc);
    const failure = await service
      .estimate({ account, callData: approvalOperation(), nonce: 1n })
      .catch((error: unknown) => error);
    expect((failure as ReasonError).code).toBe("SPONSORSHIP_UNAVAILABLE");
  });

  it("treats an unreadable estimate as unavailable, so the owner can pay instead", async () => {
    const { rpc } = recordingRpc(() => ({ callGasLimit: "12" }));
    const service = createSponsorship(scope, rpc);
    const failure = await service
      .estimate({ account, callData: approvalOperation(), nonce: 1n })
      .catch((error: unknown) => error);
    expect((failure as ReasonError).code).toBe("SPONSORSHIP_UNAVAILABLE");
  });
});

describe("sponsored submission", () => {
  it("submits a zero-fee operation from the session account", async () => {
    const { calls, rpc } = recordingRpc(() => hash);
    const service = createSponsorship(scope, rpc);
    expect(
      await service.submit({ account, userOperation: operation() }),
    ).toEqual({ userOperationHash: hash });
    expect(calls[0]?.method).toBe("eth_sendUserOperation");
    expect(calls[0]?.params[0]).toMatchObject({ sender: account });
  });

  it("never invites an owner-paid resend when a sent operation's answer is unreadable", async () => {
    const { rpc } = recordingRpc(() => "accepted");
    const service = createSponsorship(scope, rpc);
    const failure = await service
      .submit({ account, userOperation: operation() })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(ReasonError);
    expect(failure).not.toBeInstanceOf(ZodError);
  });

  it("refuses a foreign sender, nonzero fees, and a forbidden call", async () => {
    const { calls, rpc } = recordingRpc(() => hash);
    const service = createSponsorship(scope, rpc);
    for (const bad of [
      operation({ sender: stranger }),
      operation({ maxFeePerGas: "0x1" }),
      operation({ maxPriorityFeePerGas: "0x1" }),
      operation({
        callData: execute(stranger, 0n, `0xa9059cbb${"0".repeat(128)}` as Hex),
      }),
    ]) {
      const failure = await service
        .submit({ account, userOperation: bad })
        .catch((error: unknown) => error);
      expect((failure as ReasonError).code).toBe("SPONSORSHIP_REFUSED");
    }
    expect(calls).toHaveLength(0);
  });

  it("maps an efficiency complaint to SPONSORSHIP_UNAVAILABLE", async () => {
    const { rpc } = recordingRpc(() => {
      throw new BundlerError(
        "Verification gas limit efficiency too low. Required: 0.5, Actual: 0.1",
      );
    });
    const service = createSponsorship(scope, rpc);
    const failure = await service
      .submit({ account, userOperation: operation() })
      .catch((error: unknown) => error);
    expect((failure as ReasonError).code).toBe("SPONSORSHIP_UNAVAILABLE");
    expect((failure as ReasonError).detail).toContain("efficiency too low");
  });

  it("stops sponsoring a wallet that exhausted its rolling hour", async () => {
    let now = 1_000_000;
    const { calls, rpc } = recordingRpc(() => hash);
    const service = createSponsorship(
      { ...scope, hourlySendLimit: 1, now: () => now },
      rpc,
    );
    await service.submit({ account, userOperation: operation() });
    const refused = await service
      .submit({ account, userOperation: operation() })
      .catch((error: unknown) => error);
    expect((refused as ReasonError).code).toBe("SPONSORSHIP_UNAVAILABLE");
    expect(calls).toHaveLength(1);
    now += 3_600_001;
    await service.submit({ account, userOperation: operation() });
    expect(calls).toHaveLength(2);
  });
});

describe("sponsored receipt", () => {
  it("reports PENDING until the bundler sees the operation included", async () => {
    const { calls, rpc } = recordingRpc(() => ({
      receipt: { transactionHash: hash },
      success: true,
    }));
    const service = createSponsorship(scope, rpc);
    expect(await service.status(hash)).toEqual({
      status: "INCLUDED",
      success: true,
      transactionHash: hash,
    });
    expect(calls[0]?.method).toBe("eth_getUserOperationReceipt");
    const pending = createSponsorship(scope, async () => null);
    expect(await pending.status(hash)).toEqual({ status: "PENDING" });
  });
});

describe("Alchemy bundler transport", () => {
  it("posts with the gas-manager policy header and unwraps the result", async () => {
    const requests: Array<{ url: string; body: unknown; headers: Headers }> =
      [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      requests.push({
        body: JSON.parse(String(init.body)) as unknown,
        headers: new Headers(init.headers),
        url,
      });
      return new Response(JSON.stringify({ id: 1, result: "0xbeef" }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    });
    const rpc = createAlchemyBundlerRpc({
      policyId: "policy-uuid",
      url: "https://bsc-testnet.g.alchemy.com/v2/secret-key",
    });
    expect(await rpc({ method: "eth_chainId", params: [] })).toBe("0xbeef");
    expect(requests).toEqual([
      {
        body: { id: 1, jsonrpc: "2.0", method: "eth_chainId", params: [] },
        headers: new Headers({
          "content-type": "application/json",
          "x-alchemy-policy-id": "policy-uuid",
        }),
        url: "https://bsc-testnet.g.alchemy.com/v2/secret-key",
      },
    ]);
  });

  it("never repeats the bundler key or policy id from an error payload", async () => {
    const url = "https://bsc-testnet.g.alchemy.com/v2/secret-key";
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({
            error: {
              code: -32500,
              message: `request to ${url} with policy-uuid was rejected: secret-key`,
            },
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        ),
    );
    const rpc = createAlchemyBundlerRpc({ policyId: "policy-uuid", url });
    const failure = await rpc({
      method: "eth_sendUserOperation",
      params: [],
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(BundlerError);
    const message = (failure as Error).message;
    expect(message).toContain("rejected");
    expect(message).not.toContain("secret-key");
    expect(message).not.toContain("policy-uuid");
    expect(message).not.toContain(url);
  });

  it("fails closed on a non-JSON body and an unreachable bundler", async () => {
    vi.stubGlobal(
      "fetch",
      async () => new Response("not json", { status: 200 }),
    );
    const rpc = createAlchemyBundlerRpc({
      policyId: "policy-uuid",
      url: "https://example.invalid",
    });
    await expect(rpc({ method: "eth_chainId", params: [] })).rejects.toThrow(
      BundlerError,
    );
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    await expect(rpc({ method: "eth_chainId", params: [] })).rejects.toThrow(
      BundlerError,
    );
  });
});
