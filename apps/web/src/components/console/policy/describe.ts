import type { PublicConfig, WalletPolicy } from "@perago/sdk";
import { compact, amount as exact, short } from "../../../lib/format";

/*
 * The plain-language reading of a Wallet Policy. Everything here is derived
 * from the policy document and the public catalog; nothing is invented, and a
 * token or adapter the catalog does not know is shown by its raw identifier.
 * Amounts stay integer base units until `compact`/`amount` at the end.
 */

type Catalog = Pick<PublicConfig, "tokens" | "adapters">;

export type AmountText = {
  /** What a reader sees: scaled for very large values. */
  shown: string;
  /** Every digit, for a title attribute or an evidence row. */
  exact: string;
};

export type TokenLimit = {
  symbol: string;
  address: string;
  perTask: AmountText;
  daily: AmountText;
};

export type PolicyFacts = {
  /** "swap and stake" */
  services: string;
  adapters: {
    id: string;
    label: string;
    kind: "SWAP" | "STAKE" | null;
    known: boolean;
  }[];
  /** Tokens the agent may never spend. */
  protectedTokens: string[];
  /** Catalog tokens the policy neither allows nor protects. */
  offTokens: string[];
  limits: TokenLimit[];
  slippageBps: number;
  slippagePercent: string;
  lifetimeSeconds: number;
};

/** Basis points as a percentage without floating point: 100 is "1", 25 is "0.25". */
export function percentOfBps(bpsValue: string | number | bigint): string {
  const value = BigInt(bpsValue);
  const whole = value / 100n;
  const fraction = (value % 100n)
    .toString()
    .padStart(2, "0")
    .replace(/0+$/u, "");
  return fraction.length > 0 ? `${whole}.${fraction}` : whole.toString();
}

/** "a", "a and b", "a, b and c". */
export function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function amountText(value: string, decimals: number): AmountText {
  return {
    shown: compact(value, decimals),
    exact: exact(value, decimals, decimals),
  };
}

export function describePolicy(
  policy: WalletPolicy,
  catalog: Catalog,
): PolicyFacts {
  const token = (address: string) =>
    catalog.tokens.find(
      (item) => item.address.toLowerCase() === address.toLowerCase(),
    );
  const symbolOf = (address: string) =>
    token(address)?.symbol ?? short(address, 6, 4);
  const active = new Set(
    policy.activeAssets.map((asset) => asset.token.toLowerCase()),
  );
  const protectedSet = new Set(
    policy.protectedAssets.map((address) => address.toLowerCase()),
  );

  return {
    services: joinList(policy.services.map((service) => service.toLowerCase())),
    adapters: policy.approvedAdapterIds.map((id) => {
      const adapter = catalog.adapters.find((item) => item.id === id);
      return {
        id,
        label: adapter?.protocol ?? id,
        kind: adapter?.kind ?? null,
        known: adapter !== undefined,
      };
    }),
    protectedTokens: policy.protectedAssets.map(symbolOf),
    offTokens: catalog.tokens
      .filter(
        (item) =>
          !active.has(item.address.toLowerCase()) &&
          !protectedSet.has(item.address.toLowerCase()),
      )
      .map((item) => item.symbol),
    limits: policy.activeAssets.map((asset) => {
      const decimals = token(asset.token)?.decimals ?? 18;
      return {
        symbol: symbolOf(asset.token),
        address: asset.token,
        perTask: amountText(asset.maxInputPerTask, decimals),
        daily: amountText(asset.rollingDailyCap, decimals),
      };
    }),
    slippageBps: Number(policy.maxSlippageBps),
    slippagePercent: percentOfBps(policy.maxSlippageBps),
    lifetimeSeconds: Number(policy.maxTaskLifetimeSeconds),
  };
}
