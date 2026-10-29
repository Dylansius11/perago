import {
  type Address,
  encodeFunctionData,
  erc20Abi,
  type Hex,
  parseAbi,
} from "viem";

import {
  type AccountCall,
  encodeAccountExecute,
  encodeAccountExecuteBatch,
} from "./modular-account.js";

export type WithdrawalLeg =
  | { kind: "NATIVE"; amount: bigint }
  | { kind: "TOKEN"; token: Address; amount: bigint }
  | { kind: "UNWRAP"; wbnb: Address; amount: bigint };

const withdrawAbi = parseAbi(["function withdraw(uint256 amount)"]);

/** Root-owner calls only: no arbitrary recipient or session authority. */
export function withdrawalCalls(input: {
  owner: Address;
  legs: readonly WithdrawalLeg[];
}): AccountCall[] {
  if (input.legs.length === 0) {
    throw new RangeError("a withdrawal must contain at least one leg");
  }

  const unwraps: AccountCall[] = [];
  const transfers: AccountCall[] = [];
  const tokens = new Set<string>();
  let native: AccountCall | undefined;
  for (const leg of input.legs) {
    if (leg.amount <= 0n) {
      throw new RangeError("withdrawal amounts must be greater than zero");
    }
    if (leg.kind === "NATIVE") {
      if (native) {
        throw new RangeError("a withdrawal may contain at most one native leg");
      }
      native = { target: input.owner, value: leg.amount, data: "0x" };
      continue;
    }

    const token = leg.kind === "UNWRAP" ? leg.wbnb : leg.token;
    const key = token.toLowerCase();
    if (tokens.has(key)) {
      throw new RangeError("a token may appear at most once in a withdrawal");
    }
    tokens.add(key);
    if (leg.kind === "UNWRAP") {
      unwraps.push(
        {
          target: token,
          value: 0n,
          data: encodeFunctionData({
            abi: withdrawAbi,
            functionName: "withdraw",
            args: [leg.amount],
          }),
        },
        { target: input.owner, value: leg.amount, data: "0x" },
      );
    } else {
      transfers.push({
        target: token,
        value: 0n,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "transfer",
          args: [input.owner, leg.amount],
        }),
      });
    }
  }

  return native
    ? [...unwraps, ...transfers, native]
    : [...unwraps, ...transfers];
}

/** Encodes one owner-signed atomic withdrawal from the smart account. */
export function encodeOwnerWithdrawal(input: {
  owner: Address;
  legs: readonly WithdrawalLeg[];
}): Hex {
  const calls = withdrawalCalls(input);
  const [call] = calls;
  return calls.length === 1 && call
    ? encodeAccountExecute(call)
    : encodeAccountExecuteBatch(calls);
}
