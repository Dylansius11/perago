import { z } from "zod";

import { mandateSessionPermissionSchema } from "../account/account-policy.js";
import { compiledPlanSchema } from "../domain/compiled-plan.js";
import { policyDecisionSchema } from "../domain/policy-decision.js";
import {
  addressSchema,
  hashSchema,
  selectorSchema,
  uint48StringSchema,
  uint64StringSchema,
  uint256StringSchema,
} from "../domain/primitives.js";
import { simulationResultSchema } from "../domain/simulation-result.js";
import { taskMandateSchema } from "../domain/task-mandate.js";
import { walletPolicySchema } from "../domain/wallet-policy.js";

const isoDateTimeSchema = z.iso.datetime();

export const publicConfigSchema = z.strictObject({
  chainId: z.literal("97"),
  venue: z.enum(["fork", "testnet"]),
  deploymentLabel: z.string().min(1),
  mandateExecutor: addressSchema,
  performSelector: selectorSchema,
  executionWindowSeconds: uint48StringSchema,
  sessionSigner: addressSchema,
  quoteTtlSeconds: z.number().int().positive(),
  tokens: z.array(
    z.strictObject({
      symbol: z.string().min(1),
      address: addressSchema,
      decimals: z.number().int().nonnegative(),
    }),
  ),
  adapters: z.array(
    z.strictObject({
      id: z.string().min(1),
      kind: z.enum(["SWAP", "STAKE"]),
      protocol: z.string().min(1),
      adapter: addressSchema,
    }),
  ),
  explorer: z
    .strictObject({ transaction: z.string().url(), address: z.string().url() })
    .nullable(),
  faucet: z.strictObject({ enabled: z.boolean() }),
});

export const walletSessionViewSchema = z.strictObject({
  account: addressSchema,
  rootOwner: addressSchema,
  chainId: z.literal("97"),
  ownerEpoch: uint64StringSchema,
  walletId: z.uuid(),
  expiresAt: isoDateTimeSchema,
});

export const policyViewSchema = z.strictObject({
  policyId: z.uuid(),
  version: uint256StringSchema,
  status: z.enum(["DRAFT", "ACTIVATING", "ACTIVE", "SUPERSEDED", "REVOKED"]),
  policyHash: hashSchema,
  policy: walletPolicySchema,
  permission: mandateSessionPermissionSchema.nullable(),
  validUntil: uint48StringSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const policyListResponseSchema = z.strictObject({
  policies: z.array(policyViewSchema),
});

export const taskSummarySchema = z.strictObject({
  taskId: z.uuid(),
  status: z.string().min(1),
  goal: z.string(),
  createdAt: isoDateTimeSchema,
  kind: z.enum(["SWAP", "STAKE"]).nullable(),
  mandateHash: hashSchema.nullable(),
  mandateStatus: z.string().min(1).nullable(),
  executionStatus: z.string().min(1).nullable(),
});

export const taskListResponseSchema = z.strictObject({
  tasks: z.array(taskSummarySchema),
});

const taskSimulationViewSchema = z.strictObject({
  simulationId: z.uuid(),
  sequence: z.number().int().positive(),
  status: z.enum(["PASSED", "REVERTED", "STALE"]),
  simulationHash: hashSchema,
  result: simulationResultSchema,
  createdAt: isoDateTimeSchema,
});

const taskMandateViewSchema = z.strictObject({
  mandateHash: hashSchema,
  mandate: taskMandateSchema,
  status: z.string().min(1),
  createdAt: isoDateTimeSchema,
});

const taskExecutionViewSchema = z.strictObject({
  status: z.string().min(1),
  lastErrorCode: z.string().min(1).nullable(),
  lastErrorDetail: z.string().nullable(),
  submissionAttempts: z.number().int().nonnegative(),
  transactions: z.strictObject({
    authorize: hashSchema.nullable(),
    begin: hashSchema.nullable(),
    userOperation: hashSchema.nullable(),
    execution: hashSchema.nullable(),
  }),
  updatedAt: isoDateTimeSchema,
});

const taskReceiptViewSchema = z.strictObject({
  status: z.enum(["SUCCEEDED", "FAILED", "REVOKED", "EXPIRED"]),
  terminalReasonCode: z.string().min(1),
});

export const taskDetailSchema = z.strictObject({
  taskId: z.uuid(),
  status: z.string().min(1),
  goal: z.string(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  intentHash: hashSchema,
  planHash: hashSchema.nullable(),
  plan: compiledPlanSchema.nullable(),
  decision: policyDecisionSchema.nullable(),
  decisionHash: hashSchema.nullable(),
  simulation: taskSimulationViewSchema.nullable(),
  mandate: taskMandateViewSchema.nullable(),
  execution: taskExecutionViewSchema.nullable(),
  receipt: taskReceiptViewSchema.nullable(),
});

export type PublicConfig = z.infer<typeof publicConfigSchema>;
export type WalletSessionView = z.infer<typeof walletSessionViewSchema>;
export type PolicyView = z.infer<typeof policyViewSchema>;
export type TaskSummary = z.infer<typeof taskSummarySchema>;
export type TaskDetail = z.infer<typeof taskDetailSchema>;
