import type { PublicConfig, WalletPolicy } from "@perago/sdk";
import { duration } from "../../../lib/format";
import { describePolicy, percentOfBps } from "./describe";

export type Mode = "active" | "protected" | "off";

export type DiffLine = {
  /** Stable key and row label, e.g. "Per task WBNB". */
  label: string;
  from: string;
  to: string;
};

export function modeOf(policy: WalletPolicy, address: string): Mode {
  const key = address.toLowerCase();
  if (policy.activeAssets.some((asset) => asset.token.toLowerCase() === key))
    return "active";
  if (policy.protectedAssets.some((token) => token.toLowerCase() === key))
    return "protected";
  return "off";
}

/**
 * What changes between the policy in force and the one about to be reviewed.
 * `base` is null when no policy has ever been active; every set value is then
 * a change from "not set".
 */
export function diffPolicies(
  base: WalletPolicy | null,
  next: WalletPolicy,
  catalog: Pick<PublicConfig, "tokens" | "adapters">,
): DiffLine[] {
  const nextFacts = describePolicy(next, catalog);
  const baseFacts = base ? describePolicy(base, catalog) : null;
  const lines: DiffLine[] = [];

  for (const token of catalog.tokens) {
    const to = modeOf(next, token.address);
    const from = base ? modeOf(base, token.address) : null;
    if (from !== to)
      lines.push({ label: token.symbol, from: from ?? "not set", to });
    if (to !== "active") continue;
    const after = nextFacts.limits.find(
      (limit) => limit.address.toLowerCase() === token.address.toLowerCase(),
    );
    const before = baseFacts?.limits.find(
      (limit) => limit.address.toLowerCase() === token.address.toLowerCase(),
    );
    if (!after) continue;
    if (before?.perTask.exact !== after.perTask.exact)
      lines.push({
        label: `Per task ${token.symbol}`,
        from: before?.perTask.exact ?? "not spendable",
        to: after.perTask.exact,
      });
    if (before?.daily.exact !== after.daily.exact)
      lines.push({
        label: `Per 24 hours ${token.symbol}`,
        from: before?.daily.exact ?? "not spendable",
        to: after.daily.exact,
      });
  }

  if (base?.maxSlippageBps !== next.maxSlippageBps)
    lines.push({
      label: "Slippage",
      from: base ? `${percentOfBps(base.maxSlippageBps)}%` : "not set",
      to: `${percentOfBps(next.maxSlippageBps)}%`,
    });
  if (base?.maxTaskLifetimeSeconds !== next.maxTaskLifetimeSeconds)
    lines.push({
      label: "Task lifetime",
      from: base ? duration(Number(base.maxTaskLifetimeSeconds)) : "not set",
      to: duration(Number(next.maxTaskLifetimeSeconds)),
    });
  return lines;
}
