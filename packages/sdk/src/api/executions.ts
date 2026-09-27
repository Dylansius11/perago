import { z } from "zod";

import { MAX_SESSION_ENTITY_ID } from "../account/modular-account.js";
import { addressSchema, hashSchema } from "../domain/primitives.js";
import { signedMandateDocumentSchema } from "../eip712.js";
import { reasonCodeSchema } from "../reason-codes.js";
import { signatureSchema } from "./auth.js";

/**
 * The internal contract between the API, which owns the durable queue and the
 * verified chain projection, and the executor worker, which owns the executor
 * key. The worker never writes status: it records transactions it is about to
 * broadcast and asks the API to re-read the chain.
 */

export const executionStatusSchema = z.enum([
  "QUEUED",
  "LEASED",
  "AUTHORIZING",
  "AUTHORIZED",
  "EXECUTING",
  "VERIFYING",
  "SETTLING",
  "REFUNDING",
  "RETRY_WAIT",
  "TERMINAL",
  "REJECTED",
]);

export type ExecutionStatus = z.infer<typeof executionStatusSchema>;

/** The mandate projection as confirmed at the chain's `finalized` block. */
export const mandateProjectionStatusSchema = z.enum([
  "SIGNED",
  "AUTHORIZED",
  "EXECUTING",
  "SUCCEEDED",
  "FAILED",
  "REVOKED",
  "EXPIRED",
]);

export type MandateProjectionStatus = z.infer<
  typeof mandateProjectionStatusSchema
>;

/** Every transaction the executor key may send, each to one fixed function. */
export const executionTransactionKindSchema = z.enum([
  "AUTHORIZE",
  "BEGIN",
  "PERFORM",
  "FINALIZE_EXPIRED",
  "FINALIZE_STALLED",
  "SETTLE",
  "REJECT_JOB",
  "CLAIM_REFUND",
]);

export type ExecutionTransactionKind = z.infer<
  typeof executionTransactionKindSchema
>;

export const workerIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9._:-]{1,128}$/u, "expected an opaque worker id");

/** A signed EIP-1559/legacy transaction; bounded so a row cannot grow unbounded. */
export const rawTransactionSchema = z
  .string()
  .regex(
    /^0x(?:[0-9a-fA-F]{2}){1,32768}$/u,
    "expected signed transaction bytes",
  )
  .transform((value) => value.toLowerCase() as `0x${string}`);

const hexBytesSchema = z
  .string()
  .regex(/^0x(?:[0-9a-fA-F]{2})*$/u, "expected hex bytes")
  .transform((value) => value.toLowerCase() as `0x${string}`);

/**
 * The one transaction in flight. Its hash was persisted before broadcast, so a
 * restart can always find, rebroadcast, or retire exactly these bytes.
 */
export const pendingTransactionSchema = z
  .strictObject({
    kind: executionTransactionKindSchema,
    transactionHash: hashSchema,
    rawTransaction: rawTransactionSchema,
    userOperationHash: hashSchema.nullable(),
  })
  .refine(
    (pending) =>
      (pending.kind === "PERFORM") === (pending.userOperationHash !== null),
    "only a PERFORM transaction carries a UserOperation",
  );

export type PendingTransaction = z.infer<typeof pendingTransactionSchema>;

export const executionJobSchema = z.strictObject({
  executionId: z.uuid(),
  mandateHash: hashSchema,
  status: executionStatusSchema,
  mandateStatus: mandateProjectionStatusSchema,
  document: signedMandateDocumentSchema,
  rootSignature: signatureSchema,
  action: hexBytesSchema,
  session: z.strictObject({
    entityId: z.number().int().min(1).max(MAX_SESSION_ENTITY_ID),
    signer: addressSchema,
  }),
  pending: pendingTransactionSchema.nullable(),
  transactions: z.strictObject({
    authorize: hashSchema.nullable(),
    begin: hashSchema.nullable(),
    userOperation: hashSchema.nullable(),
    perform: hashSchema.nullable(),
    finalize: hashSchema.nullable(),
  }),
  lastError: z
    .strictObject({
      code: reasonCodeSchema,
      detail: z.string().max(200).nullable(),
    })
    .nullable(),
  leaseExpiresAt: z.iso.datetime({ offset: true }).nullable(),
});

export type ExecutionJob = z.infer<typeof executionJobSchema>;

export const executionJobResponseSchema = z.strictObject({
  job: executionJobSchema,
});

export const leaseExecutionResponseSchema = z.strictObject({
  job: executionJobSchema.nullable(),
});

export const workerRequestSchema = z.strictObject({ workerId: workerIdSchema });

export const recordPendingTransactionRequestSchema = z.strictObject({
  workerId: workerIdSchema,
  kind: executionTransactionKindSchema,
  rawTransaction: rawTransactionSchema,
  userOperationHash: hashSchema.nullable(),
});

export type RecordPendingTransactionRequest = z.infer<
  typeof recordPendingTransactionRequestSchema
>;

export const retireReplacedTransactionRequestSchema = z.strictObject({
  workerId: workerIdSchema,
  transactionHash: hashSchema,
});

/** Only a precondition the chain may still satisfy can defer a job. */
export const deferralCodeSchema = z.enum([
  "APPROVAL_MISSING",
  "INPUT_BALANCE_SHORT",
  "CHAIN_UNAVAILABLE",
  "COMMERCE_JOB_INVALID",
]);

export const deferExecutionRequestSchema = z.strictObject({
  workerId: workerIdSchema,
  code: deferralCodeSchema,
  retryAfterSeconds: z.number().int().min(1).max(3600),
});

export type DeferExecutionRequest = z.infer<typeof deferExecutionRequestSchema>;
