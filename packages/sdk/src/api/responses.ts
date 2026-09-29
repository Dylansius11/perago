import { z } from "zod";

import { accountPolicySchema } from "../account/account-policy.js";
import { compiledPlanSchema } from "../domain/compiled-plan.js";
import { policyDecisionSchema } from "../domain/policy-decision.js";
import {
  addressSchema,
  hashSchema,
  uint256StringSchema,
} from "../domain/primitives.js";
import { simulationResultSchema } from "../domain/simulation-result.js";
import { taskMandateSchema } from "../domain/task-mandate.js";
import { mandateDomainSchema } from "../eip712.js";

/*
 * Response bodies of the existing write routes, so a client parses exactly
 * what the API returns instead of trusting a cast. Error bodies keep the
 * shared `{ error: { code, message, detail? } }` shape and are not modeled
 * here.
 */

const hexSchema = z
  .string()
  .regex(/^0x([0-9a-fA-F]{2})*$/u, "expected even-length 0x hex")
  .transform((value) => value as `0x${string}`);

/** `POST /auth/challenges` */
export const walletChallengeResponseSchema = z.strictObject({
  challengeId: z.uuid(),
  expiresAt: z.iso.datetime(),
  message: z.string().min(1),
});

/** `POST /policies` */
export const walletPolicyCreatedSchema = z.strictObject({
  policyId: z.uuid(),
  policyHash: hashSchema,
  status: z.literal("DRAFT"),
});

/** `POST /policies/:id/activation/prepare` and `/revocation/prepare` */
export const policyTransitionPreparedSchema = z.object({
  accountPolicy: accountPolicySchema,
  allowances: z.array(
    z.strictObject({ amount: uint256StringSchema, token: addressSchema }),
  ),
  permissionCallData: hexSchema,
  permissionHash: hashSchema,
});

/** `PUT /policies/:id/activation` and `/revocation` */
export const policyTransitionConfirmedSchema = z.strictObject({
  status: z.enum(["PENDING", "ACTIVE", "REVOKED"]),
});

/** `POST /tasks` when the plan compiled (pass or policy fail). */
export const taskCompiledSchema = z.strictObject({
  compilerVersion: z.string().nullable(),
  decision: policyDecisionSchema.nullable(),
  decisionHash: hashSchema.nullable(),
  intentHash: hashSchema,
  plan: compiledPlanSchema.nullable(),
  planHash: hashSchema.nullable(),
  status: z.string().min(1),
  taskId: z.uuid(),
});

/** `POST /tasks/:id/simulations` */
export const simulationCreatedSchema = z.strictObject({
  result: simulationResultSchema,
  sequence: z.number().int().positive(),
  simulationHash: hashSchema,
  simulationId: z.uuid(),
  status: z.enum(["PASSED", "REVERTED"]),
  taskStatus: z.string().min(1),
});

/** `POST /tasks/:id/mandate/prepare` */
export const mandatePreparedSchema = z.strictObject({
  domain: mandateDomainSchema,
  mandate: taskMandateSchema,
  mandateHash: hashSchema,
  simulation: simulationResultSchema,
  simulationHash: hashSchema,
  simulationId: z.uuid(),
  taskStatus: z.literal("READY_TO_SIGN"),
});

/** `POST /tasks/:id/mandate` */
export const mandateAcceptedSchema = z.strictObject({
  executionStatus: z.string().min(1),
  mandateHash: hashSchema,
  status: z.string().min(1),
  taskStatus: z.literal("SIGNED"),
});

export type WalletChallengeResponse = z.infer<
  typeof walletChallengeResponseSchema
>;
export type PolicyTransitionPrepared = z.infer<
  typeof policyTransitionPreparedSchema
>;
export type TaskCompiled = z.infer<typeof taskCompiledSchema>;
export type MandatePrepared = z.infer<typeof mandatePreparedSchema>;
