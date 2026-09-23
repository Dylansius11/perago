import { z } from "zod";

import {
  addressSchema,
  hashSchema,
  uint48StringSchema,
  uint256StringSchema,
} from "./primitives.js";

/**
 * The signed `intentHash` commits to this document. `salt` is 32 random bytes
 * chosen by the API so the low-entropy goal text cannot be recovered from the
 * public onchain hash by guessing (ERD §9).
 */
export const taskIntentSchema = z.strictObject({
  schemaVersion: z.literal("1"),
  account: addressSchema,
  chainId: uint256StringSchema,
  recipient: addressSchema,
  goal: z.string().trim().min(1).max(4_000),
  requestedExpirySeconds: uint48StringSchema,
  salt: hashSchema,
});

export type TaskIntent = z.infer<typeof taskIntentSchema>;
