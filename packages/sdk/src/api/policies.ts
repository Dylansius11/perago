import { z } from "zod";

import { mandateSessionPermissionSchema } from "../account/account-policy.js";
import {
  hashSchema,
  uint48StringSchema,
  uint64StringSchema,
} from "../domain/primitives.js";
import { walletPolicySchema } from "../domain/wallet-policy.js";

export const createWalletPolicyRequestSchema = z.strictObject({
  policy: walletPolicySchema,
});

export const preparePolicyTransitionRequestSchema = z.strictObject({
  ownerEpoch: uint64StringSchema,
  permission: mandateSessionPermissionSchema,
  validUntil: uint48StringSchema,
});

export const confirmPolicyTransitionRequestSchema = z.strictObject({
  transactionHash: hashSchema,
  userOperationHash: hashSchema,
});

export type CreateWalletPolicyRequest = z.infer<
  typeof createWalletPolicyRequestSchema
>;
export type PreparePolicyTransitionRequest = z.infer<
  typeof preparePolicyTransitionRequestSchema
>;
export type ConfirmPolicyTransitionRequest = z.infer<
  typeof confirmPolicyTransitionRequestSchema
>;
