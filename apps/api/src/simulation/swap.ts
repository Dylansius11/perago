import type { Address, SwapAction, SwapPlan } from "@perago/sdk";
import { type PublicClient, parseAbi } from "viem";

import { isTransportError } from "./user-operation.js";

const BPS = 10_000n;

const quoterAbi = parseAbi([
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)",
]);

/**
 * The signed minimum: the estimate less the plan's slippage bound, rounded
 * down so the minimum never exceeds what the bound allows.
 */
export function minimumAfterSlippage(
  estimate: bigint,
  maxSlippageBps: string,
): bigint {
  const slippage = BigInt(maxSlippageBps);
  if (estimate < 0n || slippage < 0n || slippage > BPS) {
    throw new RangeError("estimate and slippage must be in range");
  }
  return (estimate * (BPS - slippage)) / BPS;
}

/** PancakeSwap V3 QuoterV2 output for the plan's exact input at one block. */
export async function quoteSwap(input: {
  blockNumber: bigint;
  client: PublicClient;
  plan: SwapPlan;
  quoter: Address;
}): Promise<{ amountOut: bigint } | { failure: string }> {
  const { blockNumber, client, plan, quoter } = input;
  try {
    const { result } = await client.simulateContract({
      abi: quoterAbi,
      address: quoter,
      args: [
        {
          amountIn: BigInt(plan.inputAmount),
          fee: Number(plan.poolFee),
          sqrtPriceLimitX96: 0n,
          tokenIn: plan.inputToken,
          tokenOut: plan.outputToken,
        },
      ],
      blockNumber,
      functionName: "quoteExactInputSingle",
    });
    return { amountOut: result[0] };
  } catch (error) {
    if (isTransportError(error)) throw error;
    return { failure: "QuoterV2 reverted for the exact input" };
  }
}

export function swapAction(
  plan: SwapPlan,
  minAmountOut: bigint,
  deadline: bigint,
): SwapAction {
  return {
    tokenIn: plan.inputToken,
    tokenOut: plan.outputToken,
    poolFee: plan.poolFee,
    amountIn: plan.inputAmount,
    minAmountOut: minAmountOut.toString(),
    recipient: plan.recipient,
    deadline: deadline.toString(),
  };
}
