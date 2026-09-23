import { keccak256, size } from "viem";
import { describe, expect, it } from "vitest";

import { encodeSwapAction, hashSwapPostcondition } from "../src/index.js";

// Same fixture and constants as packages/contracts/test/ActionFixtures.t.sol.
const swap = {
  tokenIn: "0x5555555555555555555555555555555555555555",
  tokenOut: "0x6666666666666666666666666666666666666666",
  poolFee: "500",
  amountIn: "50000000000000000",
  minAmountOut: "123456789",
  recipient: "0x1111111111111111111111111111111111111111",
  deadline: "2000000000",
} as const;

describe("closed action cross-stack fixture", () => {
  it("encodes a swap to seven words and the Solidity action hash", () => {
    const action = encodeSwapAction(swap);
    expect(size(action)).toBe(7 * 32);
    expect(keccak256(action)).toBe(
      "0xb314f7ad556ecb09babd714727205aad08c0410153a8c1ca2222d663a3daa4ed",
    );
  });

  it("commits the swap postcondition exactly as SwapVerifier does", () => {
    expect(
      hashSwapPostcondition(swap.recipient, swap.tokenOut, swap.minAmountOut),
    ).toBe(
      "0x8e9bdd42262669bfe9f6d5176565192fd6aa6f866badcd2b2e57eb2a888bcb93",
    );
  });

  it("rejects an action no adapter could decode", () => {
    expect(() => encodeSwapAction({ ...swap, poolFee: "16777216" })).toThrow();
    expect(() => encodeSwapAction({ ...swap, minAmountOut: "0" })).toThrow();
    expect(() => encodeSwapAction({ ...swap, path: "0x" })).toThrow();
  });
});
