import { z } from "zod";

import {
  addressSchema,
  hashSchema,
  uint256StringSchema,
} from "./primitives.js";

export const executionReceiptSchema = z.strictObject({
  schemaVersion: z.literal("1"),
  status: z.enum(["SUCCEEDED", "FAILED", "REVOKED", "EXPIRED"]),
  chainId: uint256StringSchema,
  account: addressSchema,
  mandateHash: hashSchema,
  policyHash: hashSchema,
  intentHash: hashSchema,
  planHash: hashSchema,
  simulationHash: hashSchema,
  verificationHash: hashSchema,
  nonce: uint256StringSchema,
  authorityConsumed: z.literal(true),
  transactionHash: hashSchema,
  userOperationHash: hashSchema.optional(),
  blockNumber: uint256StringSchema,
  terminalReasonCode: z
    .string()
    .regex(/^[A-Z0-9_]+$/u, "expected an uppercase reason code"),
});

export type ExecutionReceipt = z.infer<typeof executionReceiptSchema>;
