import {
  type Address,
  type CompiledPlan,
  compiledPlanSchema,
  type Hash,
  hashCompiledPlan,
  hashPolicyDecision,
  type PolicyDecision,
  type ProtocolCatalog,
  planCandidateSchema,
  policyDecisionSchema,
  type TaskIntent,
  type WalletPolicy,
} from "@perago/sdk";

import { normalizeCandidate } from "./normalize.js";
import { intersectPolicy } from "./policy-intersection.js";

/** Bump whenever normalization, intersection, or plan construction changes. */
export const COMPILER_VERSION = "perago-compiler/1";

export type CompileInput = {
  catalog: ProtocolCatalog;
  /** Untrusted planner output, exactly as returned by the provider. */
  candidate: unknown;
  /** Input reserved or spent per token in the trailing 24 hours. */
  dailySpent: ReadonlyMap<Address, bigint>;
  intent: TaskIntent;
  intentHash: Hash;
  policy: WalletPolicy;
  policyHash: Hash;
};

export type CompileOutcome =
  | { status: "PLANNING_FAILED"; reasonCode: "PLANNER_OUTPUT_INVALID" }
  | {
      status: "NEEDS_CLARIFICATION";
      reasonCode: "INTENT_NEEDS_CLARIFICATION";
      question: string;
    }
  | {
      status: "REJECTED_POLICY";
      decision: PolicyDecision;
      decisionHash: Hash;
    }
  | {
      status: "READY_TO_SIMULATE";
      decision: PolicyDecision;
      decisionHash: Hash;
      plan: CompiledPlan;
      planHash: Hash;
    };

/**
 * Deterministic compiler: strict parse, normalize, intersect with the Wallet
 * Policy, then build the plan from policy and catalog values only. The model
 * contributes a kind, catalog names, and requested numbers; it never supplies
 * an address, route fee, calldata, or anything the policy did not allow.
 */
export function compileCandidate(input: CompileInput): CompileOutcome {
  const parsed = planCandidateSchema.safeParse(input.candidate);
  if (!parsed.success) {
    return { status: "PLANNING_FAILED", reasonCode: "PLANNER_OUTPUT_INVALID" };
  }
  const candidate = parsed.data.action;
  if (candidate.kind === "CLARIFY") {
    return {
      status: "NEEDS_CLARIFICATION",
      reasonCode: "INTENT_NEEDS_CLARIFICATION",
      question: candidate.question,
    };
  }
  const action = normalizeCandidate(candidate, input.catalog);
  if (!action) {
    return { status: "PLANNING_FAILED", reasonCode: "PLANNER_OUTPUT_INVALID" };
  }

  const intersection = intersectPolicy({
    action,
    catalogChainId: input.catalog.chainId,
    dailySpent: input.dailySpent.get(action.inputToken) ?? 0n,
    intent: input.intent,
    policy: input.policy,
  });
  const passed = intersection.rules.every((rule) => rule.outcome === "PASS");
  const decision = policyDecisionSchema.parse({
    schemaVersion: "1",
    compilerVersion: COMPILER_VERSION,
    policyHash: input.policyHash,
    intentHash: input.intentHash,
    outcome: passed ? "PASS" : "FAIL",
    rules: intersection.rules,
  });
  const decisionHash = hashPolicyDecision(decision);
  if (!passed) {
    return { status: "REJECTED_POLICY", decision, decisionHash };
  }

  const shared = {
    adapterId: action.adapter.id,
    inputToken: action.inputToken,
    inputAmount: String(action.inputAmount),
    maxSlippageBps: intersection.maxSlippageBps,
    recipient: input.policy.account,
  };
  const plan = compiledPlanSchema.parse({
    schemaVersion: "1",
    chainId: input.policy.chainId,
    account: input.policy.account,
    policyHash: input.policyHash,
    intentHash: input.intentHash,
    lifetimeSeconds: input.intent.requestedExpirySeconds,
    action:
      action.kind === "SWAP"
        ? {
            kind: "SWAP",
            ...shared,
            outputToken: action.outputToken,
            poolFee: intersection.poolFee,
          }
        : { kind: "STAKE", ...shared },
  });
  return {
    status: "READY_TO_SIMULATE",
    decision,
    decisionHash,
    plan,
    planHash: hashCompiledPlan(plan),
  };
}
