import { z } from "zod";

import {
  adapterIdSchema,
  addressSchema,
  bpsStringSchema,
  hashSchema,
  positiveUint256StringSchema,
  uint24StringSchema,
  uint48StringSchema,
  uint256StringSchema,
} from "./primitives.js";

/**
 * A `CompiledPlan` is the deterministic, policy-passing action a user may go
 * on to simulate. It holds only values known before a quote: the exact spend,
 * the pinned route, the slippage ceiling, the recipient, and the requested
 * lifetime. Quote-derived `minAmountOut`/`minPositionOut` and the chain-time
 * `deadline` belong to the simulation, which commits them into `actionHash`;
 * re-quoting therefore never mutates the plan or its hash.
 */
const swapPlanSchema = z
  .strictObject({
    kind: z.literal("SWAP"),
    adapterId: adapterIdSchema,
    inputToken: addressSchema,
    inputAmount: positiveUint256StringSchema,
    outputToken: addressSchema,
    poolFee: uint24StringSchema,
    maxSlippageBps: bpsStringSchema,
    recipient: addressSchema,
  })
  .refine(
    (plan) => plan.inputToken !== plan.outputToken,
    "a swap needs two different tokens",
  );

const stakePlanSchema = z.strictObject({
  kind: z.literal("STAKE"),
  adapterId: adapterIdSchema,
  inputToken: addressSchema,
  inputAmount: positiveUint256StringSchema,
  maxSlippageBps: bpsStringSchema,
  recipient: addressSchema,
});

export const compiledPlanSchema = z.strictObject({
  schemaVersion: z.literal("1"),
  chainId: uint256StringSchema,
  account: addressSchema,
  policyHash: hashSchema,
  intentHash: hashSchema,
  lifetimeSeconds: uint48StringSchema,
  action: z.discriminatedUnion("kind", [swapPlanSchema, stakePlanSchema]),
});

export type SwapPlan = z.infer<typeof swapPlanSchema>;
export type StakePlan = z.infer<typeof stakePlanSchema>;
export type CompiledPlan = z.infer<typeof compiledPlanSchema>;
