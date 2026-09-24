import { keccak256, size } from "viem";
import { describe, expect, it } from "vitest";

import {
  CAKE_POOL_ID,
  encodeStakeAction,
  encodeSwapAction,
  hashStakePostcondition,
  hashSwapPostcondition,
} from "../src/index.js";

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

  it("encodes a stake to six words and the Solidity action hash", () => {
    expect(CAKE_POOL_ID).toBe(
      "0xa6902dcdf9185809eb31d8d3711eb92e531124d8e8c028c19962dca62ad2a905",
    );
    const action = encodeStakeAction({
      asset: swap.tokenIn,
      amount: "1000000000000000000",
      minPositionOut: "987654321",
      recipient: swap.recipient,
      deadline: "2000000000",
      poolId: CAKE_POOL_ID,
    });
    expect(size(action)).toBe(6 * 32);
    expect(keccak256(action)).toBe(
      "0xd8b8bf3ecb40fbfcdfda786b96c42a422b648c70b66a6b113107be6a1fc3331a",
    );
    expect(
      hashStakePostcondition(swap.recipient, CAKE_POOL_ID, "987654321"),
    ).toBe(
      "0xa57569c7d1be4a062fc50f256032ef11d84965e2d274094e6042b285f4261d49",
    );
  });
});
