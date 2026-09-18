import { z } from "zod";

import {
  adapterIdSchema,
  addressSchema,
  hashSchema,
  uint24StringSchema,
  uint48StringSchema,
  uint256StringSchema,
} from "./primitives.js";

const swapActionSchema = z.strictObject({
  kind: z.literal("SWAP"),
  adapterId: adapterIdSchema,
  tokenIn: addressSchema,
  tokenOut: addressSchema,
  poolFee: uint24StringSchema,
  amountIn: uint256StringSchema,
  minAmountOut: uint256StringSchema,
  recipient: addressSchema,
  deadline: uint48StringSchema,
});

const stakeActionSchema = z.strictObject({
  kind: z.literal("STAKE"),
  adapterId: adapterIdSchema,
  asset: addressSchema,
  amount: uint256StringSchema,
  minPositionOut: uint256StringSchema,
  recipient: addressSchema,
  deadline: uint48StringSchema,
  poolId: hashSchema,
});

export const compiledPlanSchema = z.strictObject({
  schemaVersion: z.literal("1"),
  chainId: uint256StringSchema,
  policyHash: hashSchema,
  action: z.discriminatedUnion("kind", [swapActionSchema, stakeActionSchema]),
});

export type SwapAction = z.infer<typeof swapActionSchema>;
export type StakeAction = z.infer<typeof stakeActionSchema>;
export type CompiledPlan = z.infer<typeof compiledPlanSchema>;
