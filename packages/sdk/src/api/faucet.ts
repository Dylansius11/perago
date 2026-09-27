import { z } from "zod";

import {
  addressSchema,
  hashSchema,
  uint256StringSchema,
} from "../domain/primitives.js";

export const faucetRefusalSchema = z.enum([
  "FAUCET_ALREADY_CLAIMED",
  "FAUCET_ACCOUNT_FUNDED",
  "FAUCET_BUDGET_EXHAUSTED",
  "FAUCET_RATE_LIMITED",
  "FAUCET_UNAVAILABLE",
]);
export type FaucetRefusal = z.infer<typeof faucetRefusalSchema>;

export const faucetClaimStatusSchema = z.enum([
  "PENDING",
  "BROADCAST",
  "CONFIRMED",
  "FAILED",
]);
export type FaucetClaimStatus = z.infer<typeof faucetClaimStatusSchema>;

export const faucetClaimSchema = z.strictObject({
  amountWei: uint256StringSchema,
  claimId: z.string().uuid(),
  createdAt: z.string().datetime(),
  status: faucetClaimStatusSchema,
  transactionHash: hashSchema.nullable(),
});
export type FaucetClaim = z.infer<typeof faucetClaimSchema>;

export const faucetStatusSchema = z.strictObject({
  accountBalanceWei: uint256StringSchema,
  amountWei: uint256StringSchema,
  budgetRemainingWei: uint256StringSchema,
  chainId: z.literal("97"),
  eligible: z.boolean(),
  enabled: z.literal(true),
  fundedThresholdWei: uint256StringSchema,
  lastClaim: faucetClaimSchema.nullable(),
  nextClaimAt: z.string().datetime().nullable(),
  reasonCode: faucetRefusalSchema.nullable(),
  recipient: addressSchema,
});
export type FaucetStatus = z.infer<typeof faucetStatusSchema>;

export const createFaucetClaimRequestSchema = z.strictObject({});
export type CreateFaucetClaimRequest = z.infer<
  typeof createFaucetClaimRequestSchema
>;

export const faucetClaimResponseSchema = z.strictObject({
  amountWei: uint256StringSchema,
  claimId: z.string().uuid(),
  recipient: addressSchema,
  status: faucetClaimStatusSchema,
  transactionHash: hashSchema,
});
export type FaucetClaimResponse = z.infer<typeof faucetClaimResponseSchema>;
