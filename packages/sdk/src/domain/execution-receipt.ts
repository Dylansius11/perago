import { z } from "zod";

import {
  addressSchema,
  hashSchema,
  uint256StringSchema,
} from "./primitives.js";

const reasonCodeSchema = z
  .string()
  .regex(/^[A-Z0-9_]+$/u, "expected an uppercase reason code");

export const executionReceiptSchema = z.strictObject({
  schemaVersion: z.literal("1"),
  status: z.enum(["SUCCEEDED", "FAILED", "REVOKED", "EXPIRED"]),
  chainId: uint256StringSchema,
  account: addressSchema,
  mandateExecutor: addressSchema,
  mandateHash: hashSchema,
  policyHash: hashSchema,
  intentHash: hashSchema,
  planHash: hashSchema,
  simulationHash: hashSchema,
  actionHash: hashSchema,
  postconditionHash: hashSchema,
  nonce: uint256StringSchema,
  authorityConsumed: z.literal(true),
  terminalReasonCode: reasonCodeSchema,
  terminalMessage: z.string().min(1),
  transactions: z.strictObject({
    authorize: hashSchema,
    begin: hashSchema.nullable(),
    userOperation: hashSchema.nullable(),
    execution: hashSchema.nullable(),
  }),
  authorization: z.strictObject({
    blockNumber: uint256StringSchema,
    blockHash: hashSchema,
  }),
  begin: z
    .strictObject({
      blockNumber: uint256StringSchema,
      blockHash: hashSchema,
    })
    .nullable(),
  terminal: z.strictObject({
    transactionHash: hashSchema,
    blockNumber: uint256StringSchema,
    blockHash: hashSchema,
    logIndex: z.number().int().nonnegative(),
  }),
  explorer: z.strictObject({
    authorization: z.url(),
    begin: z.url().nullable(),
    execution: z.url().nullable(),
    terminal: z.url(),
    block: z.url(),
  }),
  verification: z.strictObject({
    status: z.enum(["PASSED", "NOT_VERIFIED", "NOT_APPLICABLE"]),
    hash: hashSchema.nullable(),
    failureReasonHash: hashSchema.nullable(),
    reasonCode: reasonCodeSchema,
  }),
  settlement: z.discriminatedUnion("status", [
    z.strictObject({ status: z.literal("NOT_BOUND") }),
    z.strictObject({
      status: z.literal("PENDING"),
      commerceContract: addressSchema,
      jobId: uint256StringSchema,
    }),
    z.strictObject({
      status: z.literal("INELIGIBLE"),
      commerceContract: addressSchema,
      jobId: uint256StringSchema,
    }),
    z.strictObject({
      status: z.literal("UNPAID"),
      commerceContract: addressSchema,
      jobId: uint256StringSchema,
    }),
    z.strictObject({
      status: z.literal("CONFIRMED"),
      commerceContract: addressSchema,
      jobId: uint256StringSchema,
      transactionHash: hashSchema,
      blockNumber: uint256StringSchema,
      blockHash: hashSchema,
      evaluatorLogIndex: z.number().int().nonnegative(),
      completionLogIndex: z.number().int().nonnegative(),
      paymentLogIndex: z.number().int().nonnegative(),
      provider: addressSchema,
      paymentToken: addressSchema,
      amount: uint256StringSchema,
    }),
  ]),
});

export type ExecutionReceipt = z.infer<typeof executionReceiptSchema>;
