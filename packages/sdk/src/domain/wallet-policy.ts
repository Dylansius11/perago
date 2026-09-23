import { z } from "zod";

import {
  adapterIdSchema,
  addressSchema,
  bpsStringSchema,
  hasDuplicates,
  serviceSchema,
  uint48StringSchema,
  uint64StringSchema,
  uint256StringSchema,
} from "./primitives.js";

const assetLimitSchema = z.strictObject({
  token: addressSchema,
  maxInputPerTask: uint256StringSchema,
  rollingDailyCap: uint256StringSchema,
});

export const walletPolicySchema = z
  .strictObject({
    schemaVersion: z.literal("1"),
    account: addressSchema,
    chainId: uint256StringSchema,
    version: uint64StringSchema,
    protectedAssets: z.array(addressSchema).superRefine((assets, context) => {
      if (hasDuplicates(assets)) {
        context.addIssue({
          code: "custom",
          message: "protected assets must be unique",
        });
      }
    }),
    activeAssets: z
      .array(assetLimitSchema)
      .min(1)
      .superRefine((assets, context) => {
        if (hasDuplicates(assets.map((asset) => asset.token))) {
          context.addIssue({
            code: "custom",
            message: "active assets must be unique",
          });
        }
      }),
    services: z
      .array(serviceSchema)
      .min(1)
      .superRefine((services, context) => {
        if (hasDuplicates(services)) {
          context.addIssue({
            code: "custom",
            message: "services must be unique",
          });
        }
      }),
    approvedAdapterIds: z
      .array(adapterIdSchema)
      .min(1)
      .superRefine((identifiers, context) => {
        if (hasDuplicates(identifiers)) {
          context.addIssue({
            code: "custom",
            message: "approved adapters must be unique",
          });
        }
      }),
    maxSlippageBps: bpsStringSchema,
    allowedRecipients: z.literal("SELF"),
    maxTaskLifetimeSeconds: uint48StringSchema,
  })
  .superRefine((policy, context) => {
    const protectedAssets = new Set(policy.protectedAssets);
    if (policy.activeAssets.some((asset) => protectedAssets.has(asset.token))) {
      context.addIssue({
        code: "custom",
        message: "an asset cannot be both protected and active",
      });
    }
  });

export type WalletPolicy = z.infer<typeof walletPolicySchema>;
