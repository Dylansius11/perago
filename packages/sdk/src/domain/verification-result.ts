import { z } from "zod";

import {
  addressSchema,
  hashSchema,
  uint256StringSchema,
} from "./primitives.js";

export const verificationResultSchema = z.strictObject({
  schemaVersion: z.literal("1"),
  status: z.enum(["PASSED", "FAILED", "ERROR"]),
  reasonCode: z
    .string()
    .regex(/^[A-Z0-9_]+$/u, "expected an uppercase reason code"),
  verifierId: hashSchema,
  evidenceHash: hashSchema,
  chainId: uint256StringSchema,
  transactionHash: hashSchema,
  blockNumber: uint256StringSchema,
  inputSpent: uint256StringSchema,
  outputAmount: uint256StringSchema,
  recipient: addressSchema,
});

export type VerificationResult = z.infer<typeof verificationResultSchema>;
