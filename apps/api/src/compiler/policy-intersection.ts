import type {
  PolicyRule,
  PolicyRuleResult,
  ReasonCode,
  TaskIntent,
  WalletPolicy,
} from "@perago/sdk";

import type { NormalizedAction } from "./normalize.js";

export type IntersectionInput = {
  action: NormalizedAction;
  catalogChainId: string;
  /** Input already reserved or spent for `action.inputToken` in the trailing 24 hours. */
  dailySpent: bigint;
  /** The goal text never decides a rule, so the intersection never sees it. */
  intent: Omit<TaskIntent, "goal">;
  policy: WalletPolicy;
};

export type IntersectionResult = {
  maxSlippageBps: string;
  poolFee: string | null;
  rules: PolicyRuleResult[];
};

function rule(
  name: PolicyRule,
  failure: ReasonCode | null,
  limit: string,
  observed: string,
): PolicyRuleResult {
  return {
    rule: name,
    outcome: failure === null ? "PASS" : "FAIL",
    reasonCode: failure,
    limit,
    observed,
  };
}

/**
 * Evaluates every Wallet Policy rule against the normalized candidate and
 * returns the complete matrix in `POLICY_RULES` order. No value is clamped:
 * a candidate broader than the policy fails the rule and keeps its own value
 * as evidence.
 */
export function intersectPolicy(input: IntersectionInput): IntersectionResult {
  const { action, dailySpent, intent, policy } = input;
  const amount = action.inputAmount;
  const assetLimit = policy.activeAssets.find(
    (asset) => asset.token === action.inputToken,
  );
  const route =
    action.adapter.kind === "SWAP"
      ? action.adapter.routes.find(
          (candidate) =>
            candidate.tokens.includes(action.inputToken) &&
            action.outputToken !== null &&
            action.outputToken !== action.inputToken &&
            candidate.tokens.includes(action.outputToken),
        )
      : undefined;
  const routeSupported =
    action.adapter.kind === "SWAP"
      ? route !== undefined
      : action.adapter.asset === action.inputToken;
  const slippage =
    action.maxSlippageBps === null
      ? policy.maxSlippageBps
      : String(action.maxSlippageBps);
  const recipient = action.recipient ?? intent.recipient;
  const lifetime = BigInt(intent.requestedExpirySeconds);
  const amountFailure: ReasonCode | null =
    amount === null || amount === 0n ? "AMOUNT_INVALID" : null;
  const capFailure = (
    cap: string | undefined,
    used: bigint,
    exceeded: ReasonCode,
  ): ReasonCode | null => {
    if (cap === undefined) return "ASSET_NOT_ACTIVE";
    if (amount === null || amount === 0n) return "AMOUNT_INVALID";
    return used + amount <= BigInt(cap) ? null : exceeded;
  };

  const rules = [
    rule(
      "CHAIN",
      intent.chainId === policy.chainId &&
        input.catalogChainId === policy.chainId
        ? null
        : "CHAIN_MISMATCH",
      policy.chainId,
      `intent ${intent.chainId}; catalog ${input.catalogChainId}`,
    ),
    rule(
      "ACCOUNT",
      intent.account === policy.account ? null : "ACCOUNT_MISMATCH",
      policy.account,
      intent.account,
    ),
    rule(
      "SERVICE",
      policy.services.includes(action.kind) ? null : "SERVICE_NOT_ALLOWED",
      policy.services.join(","),
      action.kind,
    ),
    rule(
      "PROTOCOL",
      policy.approvedAdapterIds.includes(action.adapter.id)
        ? null
        : "PROTOCOL_NOT_APPROVED",
      policy.approvedAdapterIds.join(","),
      action.adapter.id,
    ),
    rule(
      "ROUTE",
      routeSupported ? null : "ROUTE_UNSUPPORTED",
      action.adapter.kind === "SWAP"
        ? action.adapter.routes
            .map((entry) => `${entry.tokens.join("/")}@${entry.poolFee}`)
            .join(",")
        : action.adapter.asset,
      action.outputToken === null
        ? action.inputToken
        : `${action.inputToken}->${action.outputToken}`,
    ),
    rule(
      "PROTECTED_ASSET",
      policy.protectedAssets.includes(action.inputToken)
        ? "PROTECTED_ASSET_SPEND"
        : null,
      policy.protectedAssets.join(","),
      action.inputToken,
    ),
    rule(
      "ACTIVE_ASSET",
      assetLimit ? null : "ASSET_NOT_ACTIVE",
      policy.activeAssets.map((asset) => asset.token).join(","),
      action.inputToken,
    ),
    rule(
      "INPUT_AMOUNT",
      amountFailure,
      `> 0 with at most ${action.inputDecimals} decimals`,
      `${action.requestedAmount} (${amount ?? "unrepresentable"} base units)`,
    ),
    rule(
      "PER_TASK_CAP",
      capFailure(assetLimit?.maxInputPerTask, 0n, "PER_TASK_CAP_EXCEEDED"),
      assetLimit?.maxInputPerTask ?? "no limit: asset not active",
      String(amount ?? "unrepresentable"),
    ),
    rule(
      "DAILY_CAP",
      capFailure(assetLimit?.rollingDailyCap, dailySpent, "DAILY_CAP_EXCEEDED"),
      assetLimit?.rollingDailyCap ?? "no limit: asset not active",
      `${dailySpent} reserved in 24h + ${amount ?? "unrepresentable"}`,
    ),
    rule(
      "SLIPPAGE",
      BigInt(slippage) <= BigInt(policy.maxSlippageBps)
        ? null
        : "SLIPPAGE_EXCEEDED",
      policy.maxSlippageBps,
      action.maxSlippageBps === null
        ? `${slippage} (policy default)`
        : slippage,
    ),
    rule(
      "RECIPIENT",
      recipient === policy.account && intent.recipient === policy.account
        ? null
        : "RECIPIENT_NOT_ALLOWED",
      `${policy.allowedRecipients} (${policy.account})`,
      recipient === intent.recipient
        ? recipient
        : `planner ${recipient}; intent ${intent.recipient}`,
    ),
    rule(
      "LIFETIME",
      lifetime === 0n
        ? "LIFETIME_INVALID"
        : lifetime > BigInt(policy.maxTaskLifetimeSeconds)
          ? "LIFETIME_EXCEEDED"
          : null,
      policy.maxTaskLifetimeSeconds,
      intent.requestedExpirySeconds,
    ),
  ];

  return {
    maxSlippageBps: slippage,
    poolFee: route?.poolFee ?? null,
    rules,
  };
}
