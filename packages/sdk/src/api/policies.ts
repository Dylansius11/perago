import { z } from "zod";

import { mandateSessionPermissionSchema } from "../account/account-policy.js";
import {
  hashSchema,
  uint48StringSchema,
  uint64StringSchema,
} from "../domain/primitives.js";
import { walletPolicySchema } from "../domain/wallet-policy.js";
import { signatureSchema } from "./auth.js";

export const createWalletPolicyRequestSchema = z.strictObject({
  policy: walletPolicySchema,
});

export const preparePolicyTransitionRequestSchema = z.strictObject({
  ownerEpoch: uint64StringSchema,
  permission: mandateSessionPermissionSchema,
  validUntil: uint48StringSchema,
});

export const confirmPolicyActivationRequestSchema =
  preparePolicyTransitionRequestSchema.extend({
    permissionTransactionHash: hashSchema,
    permissionUserOperationHash: hashSchema,
    rootSignature: signatureSchema,
    transactionHash: hashSchema,
    userOperationHash: hashSchema,
  });

export const preparePolicyRevocationRequestSchema = z.strictObject({
  validUntil: uint48StringSchema,
});

export const confirmPolicyRevocationRequestSchema =
  preparePolicyRevocationRequestSchema.extend({
    permissionTransactionHash: hashSchema,
    permissionUserOperationHash: hashSchema,
    rootSignature: signatureSchema,
    transactionHash: hashSchema,
    userOperationHash: hashSchema,
  });

export type CreateWalletPolicyRequest = z.infer<
  typeof createWalletPolicyRequestSchema
>;
export type PreparePolicyTransitionRequest = z.infer<
  typeof preparePolicyTransitionRequestSchema
>;
export type ConfirmPolicyActivationRequest = z.infer<
  typeof confirmPolicyActivationRequestSchema
>;
export type PreparePolicyRevocationRequest = z.infer<
  typeof preparePolicyRevocationRequestSchema
>;
export type ConfirmPolicyRevocationRequest = z.infer<
  typeof confirmPolicyRevocationRequestSchema
>;
