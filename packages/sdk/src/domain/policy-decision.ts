import { z } from "zod";

import { reasonCodeSchema } from "../reason-codes.js";
import { hashSchema } from "./primitives.js";

/**
 * Every rule is evaluated for every compiled candidate, in this fixed order,
 * so a decision is always a complete rule-by-rule matrix (PRD-F-005).
 */
export const POLICY_RULES = [
  "CHAIN",
  "ACCOUNT",
  "SERVICE",
  "PROTOCOL",
  "ROUTE",
  "PROTECTED_ASSET",
  "ACTIVE_ASSET",
  "INPUT_AMOUNT",
  "PER_TASK_CAP",
  "DAILY_CAP",
  "SLIPPAGE",
  "RECIPIENT",
  "LIFETIME",
] as const;

export type PolicyRule = (typeof POLICY_RULES)[number];

const ruleResultSchema = z
  .strictObject({
    rule: z.enum(POLICY_RULES),
    outcome: z.enum(["PASS", "FAIL"]),
    reasonCode: reasonCodeSchema.nullable(),
    limit: z.string().max(400),
    observed: z.string().max(400),
  })
  .refine(
    (result) => (result.outcome === "PASS") === (result.reasonCode === null),
    "a failing rule needs a reason code and a passing rule has none",
  );

export const policyDecisionSchema = z
  .strictObject({
    schemaVersion: z.literal("1"),
    compilerVersion: z.string().min(1).max(64),
    policyHash: hashSchema,
    intentHash: hashSchema,
    outcome: z.enum(["PASS", "FAIL"]),
    rules: z.array(ruleResultSchema),
  })
  .superRefine((decision, context) => {
    const order = decision.rules.map((result) => result.rule);
    if (order.join() !== POLICY_RULES.join()) {
      context.addIssue({
        code: "custom",
        message: "a decision must report every policy rule once, in order",
      });
    }
    const passed = decision.rules.every((result) => result.outcome === "PASS");
    if ((decision.outcome === "PASS") !== passed) {
      context.addIssue({
        code: "custom",
        message: "a decision passes only when every rule passes",
      });
    }
  });

export type PolicyRuleResult = z.infer<typeof ruleResultSchema>;
export type PolicyDecision = z.infer<typeof policyDecisionSchema>;
