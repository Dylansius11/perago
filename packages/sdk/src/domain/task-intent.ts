import { z } from "zod";

import {
  addressSchema,
  uint48StringSchema,
  uint256StringSchema,
} from "./primitives.js";

export const taskIntentSchema = z.strictObject({
  schemaVersion: z.literal("1"),
  account: addressSchema,
  chainId: uint256StringSchema,
  recipient: addressSchema,
  goal: z.string().trim().min(1).max(4_000),
  requestedExpirySeconds: uint48StringSchema,
});

export type TaskIntent = z.infer<typeof taskIntentSchema>;
