import { z } from "zod";

import { adapterIdSchema, addressSchema } from "./primitives.js";

/**
 * The only shape a language model may return. It is untrusted input: symbols
 * and human-readable amounts are resolved by the deterministic normalizer, and
 * every value is intersected with the Wallet Policy before it can become a
 * `CompiledPlan`. The model never supplies addresses of targets, calldata,
 * pool fees, quotes, deadlines, or minimum outputs.
 */
const tokenSymbolSchema = z.string().min(1).max(32);

/** A plain base-10 amount in token units, e.g. `0.05`. No sign or exponent. */
export const decimalAmountSchema = z
  .string()
  .max(160)
  .regex(
    /^(0|[1-9][0-9]*)(\.[0-9]+)?$/u,
    "expected a plain decimal token amount",
  );

const candidateSlippageSchema = z.int().min(0).max(10_000).nullable();

const swapCandidateSchema = z.strictObject({
  kind: z.literal("SWAP"),
  adapterId: adapterIdSchema,
  inputSymbol: tokenSymbolSchema,
  inputAmount: decimalAmountSchema,
  outputSymbol: tokenSymbolSchema,
  maxSlippageBps: candidateSlippageSchema,
  recipient: addressSchema.nullable(),
});

const stakeCandidateSchema = z.strictObject({
  kind: z.literal("STAKE"),
  adapterId: adapterIdSchema,
  inputSymbol: tokenSymbolSchema,
  inputAmount: decimalAmountSchema,
  maxSlippageBps: candidateSlippageSchema,
  recipient: addressSchema.nullable(),
});

const clarifyCandidateSchema = z.strictObject({
  kind: z.literal("CLARIFY"),
  question: z.string().trim().min(1).max(500),
});

export const planCandidateSchema = z.strictObject({
  action: z.discriminatedUnion("kind", [
    swapCandidateSchema,
    stakeCandidateSchema,
    clarifyCandidateSchema,
  ]),
});

export type PlanCandidate = z.infer<typeof planCandidateSchema>;
export type SwapCandidate = z.infer<typeof swapCandidateSchema>;
export type StakeCandidate = z.infer<typeof stakeCandidateSchema>;
