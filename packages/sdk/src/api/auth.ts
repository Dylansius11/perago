import { z } from "zod";

import {
  addressSchema,
  uint256StringSchema,
} from "../domain/primitives.js";

export const signatureSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{130}$/u, "expected a 65-byte signature")
  .transform((value) => value.toLowerCase() as `0x${string}`);

export const walletChallengeRequestSchema = z.strictObject({
  account: addressSchema,
  chainId: uint256StringSchema,
  rootOwner: addressSchema,
});

export const walletChallengeVerificationSchema = z.strictObject({
  challengeId: z.uuid(),
  signature: signatureSchema,
});

export const walletSessionSchema = z.strictObject({
  account: addressSchema,
  chainId: uint256StringSchema,
  expiresAt: z.iso.datetime(),
  rootOwner: addressSchema,
  token: z.string().min(43).max(128),
  walletId: z.uuid(),
});

export type WalletChallengeRequest = z.infer<
  typeof walletChallengeRequestSchema
>;
export type WalletChallengeVerification = z.infer<
  typeof walletChallengeVerificationSchema
>;
export type WalletSession = z.infer<typeof walletSessionSchema>;
