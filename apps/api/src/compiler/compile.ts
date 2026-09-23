import {
  type Address,
  type CompiledPlan,
  compiledPlanSchema,
  type Hash,
  hashCompiledPlan,
  hashPolicyDecision,
  type PolicyDecision,
  type PolicyRuleResult,
  type ProtocolCatalog,
  planCandidateSchema,
  policyDecisionSchema,
  type TaskIntent,
  type WalletPolicy,
} from "@perago/sdk";
import { formatUnits } from "viem";

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

/**
 * Re-runs every Wallet Policy rule for an already compiled plan, with the
 * spend reserved since compilation. Signing calls this so a mandate signed
 * later cannot overrun the rolling daily cap that other mandates consumed.
 * Returns the failing rules; empty means the plan still passes.
 */
export function recheckCompiledPlan(input: {
  catalog: ProtocolCatalog;
  dailySpent: ReadonlyMap<Address, bigint>;
  intent: Omit<TaskIntent, "goal">;
  plan: CompiledPlan;
  policy: WalletPolicy;
}): PolicyRuleResult[] {
  const { catalog, plan } = input;
  const adapter = catalog.adapters.find(
    (entry) => entry.id === plan.action.adapterId,
  );
  const token = catalog.tokens.find(
    (entry) => entry.address === plan.action.inputToken,
  );
  if (!adapter || !token) {
    throw new Error("compiled plan no longer matches the catalog");
  }
  const amount = BigInt(plan.action.inputAmount);
  const { rules } = intersectPolicy({
    action: {
      adapter,
      inputAmount: amount,
      inputDecimals: token.decimals,
      inputToken: plan.action.inputToken,
      kind: plan.action.kind,
      maxSlippageBps: Number(plan.action.maxSlippageBps),
      outputToken: plan.action.kind === "SWAP" ? plan.action.outputToken : null,
      recipient: plan.action.recipient,
      requestedAmount: formatUnits(amount, token.decimals),
    },
    catalogChainId: catalog.chainId,
    dailySpent: input.dailySpent.get(plan.action.inputToken) ?? 0n,
    intent: input.intent,
    policy: input.policy,
  });
  return rules.filter((rule) => rule.outcome === "FAIL");
}
