import type { Address, PublicConfig, WithdrawalLeg } from "@perago/sdk";
import { formatUnits } from "viem";
import type { Failure } from "../../../lib/failure";
import { amount } from "../../../lib/format";
import type { Holdings } from "../../../lib/queries";
import { parseAmountField } from "../policy/editor-model";

/*
 * The Funds section's withdrawal, as pure functions: which assets can leave
 * the account, what the typed amounts mean, and what the owner will sign.
 * Amounts stay text until `parseAmountField` turns them into integer base
 * units, so nothing passes through floating point. The recipient is not a
 * parameter anywhere: `encodeOwnerWithdrawal` always pays the owner.
 */

type Catalog = PublicConfig["tokens"];

export type Asset = {
  /** The row key and the symbol shown: `tBNB` for the account's native balance. */
  id: string;
  symbol: string;
  kind: "NATIVE" | "TOKEN";
  address: Address | null;
  decimals: number;
  balance: bigint;
  /** WBNB, the one token that can be unwrapped to tBNB on the way out. */
  wrapsNative: boolean;
};

/** tBNB first, then each catalog token, keeping only what the account holds. */
export function withdrawAssets(input: {
  tokens: Catalog;
  holdings: Holdings;
}): Asset[] {
  const { tokens, holdings } = input;
  const rows: Asset[] = [
    {
      id: "tBNB",
      symbol: "tBNB",
      kind: "NATIVE",
      address: null,
      decimals: 18,
      balance: holdings.accountNative,
      wrapsNative: false,
    },
  ];
  for (const token of tokens) {
    rows.push({
      id: token.symbol,
      symbol: token.symbol.toUpperCase(),
      kind: "TOKEN",
      address: token.address,
      decimals: token.decimals,
      balance: holdings.tokens[token.symbol]?.balance ?? 0n,
      wrapsNative: token.symbol === "WBNB",
    });
  }
  return rows.filter((row) => row.balance > 0n);
}

export type WithdrawForm = {
  /** What was typed per asset id. Blank means the asset stays in the account. */
  amounts: Record<string, string>;
  /** Send WBNB out as tBNB. Applies to the WBNB row only. */
  unwrap: boolean;
};

export const emptyForm: WithdrawForm = { amounts: {}, unwrap: false };

/** Every digit of the balance, as the text field would hold it. */
export const maxText = (asset: Asset): string =>
  formatUnits(asset.balance, asset.decimals);

/** Every holding at its exact balance: the form behind Withdraw everything. */
export function everythingForm(assets: Asset[], unwrap: boolean): WithdrawForm {
  return {
    amounts: Object.fromEntries(
      assets.map((asset) => [asset.id, maxText(asset)]),
    ),
    unwrap,
  };
}

export type Entry = {
  asset: Asset;
  amount: bigint;
  leg: WithdrawalLeg;
  /** What leaves the account, e.g. `1 WBNB`. */
  leaves: string;
  /** What reaches the owner wallet. An unwrap arrives as tBNB. */
  arrives: string;
};

export type Plan = {
  entries: Entry[];
  /** One sentence per asset id, in token units. */
  errors: Record<string, string>;
  /** At least one valid amount and no errors: safe to review and sign. */
  ready: boolean;
};

const shown = (value: bigint, asset: Asset): string =>
  amount(value, asset.decimals, asset.decimals);

function legOf(asset: Asset, value: bigint, unwrap: boolean): WithdrawalLeg {
  if (asset.kind === "NATIVE") return { kind: "NATIVE", amount: value };
  if (!asset.address) throw new Error(`${asset.symbol} has no address.`);
  return asset.wrapsNative && unwrap
    ? { kind: "UNWRAP", wbnb: asset.address, amount: value }
    : { kind: "TOKEN", token: asset.address, amount: value };
}

/** What the typed amounts mean. Errors are in token units and never above the balance. */
export function planWithdrawal(assets: Asset[], form: WithdrawForm): Plan {
  const entries: Entry[] = [];
  const errors: Record<string, string> = {};
  for (const asset of assets) {
    const typed = form.amounts[asset.id] ?? "";
    if (typed.trim() === "") continue;
    const parsed = parseAmountField(typed, asset.decimals);
    if ("error" in parsed) {
      errors[asset.id] = parsed.error;
      continue;
    }
    if (parsed.value > asset.balance) {
      const held = shown(asset.balance, asset);
      errors[asset.id] =
        `The account holds ${held} ${asset.symbol}. Enter ${held} or less.`;
      continue;
    }
    const leg = legOf(asset, parsed.value, form.unwrap);
    const text = shown(parsed.value, asset);
    entries.push({
      asset,
      amount: parsed.value,
      leg,
      leaves: `${text} ${asset.symbol}`,
      arrives: `${text} ${leg.kind === "UNWRAP" ? "tBNB" : asset.symbol}`,
    });
  }
  return {
    entries,
    errors,
    ready: entries.length > 0 && Object.keys(errors).length === 0,
  };
}

/** True when the plan empties every asset the account holds. */
export const withdrawsEverything = (assets: Asset[], plan: Plan): boolean =>
  plan.ready &&
  assets.length > 0 &&
  assets.every((asset) =>
    plan.entries.some(
      (entry) => entry.asset.id === asset.id && entry.amount === asset.balance,
    ),
  );

/* ------------------------------------------------------------------ */
/* Gas                                                                 */
/* ------------------------------------------------------------------ */

export type GasLine = {
  headline: string;
  /** What happens on this path, in one sentence. */
  note: string;
  /** Shown before signing when the owner wallet may not be able to pay. */
  warning: string | null;
};

/**
 * Who pays, from the same `sponsorFor` decision `sendRootOperation` acts on.
 * `sponsored` is true when a sponsor is offered; a refusal still falls back
 * to the owner wallet, which the warning names while the balance is short.
 */
export function gasLine(input: {
  sponsored: boolean;
  ownerNative: bigint | null;
  floor: bigint;
}): GasLine {
  const { sponsored, ownerNative, floor } = input;
  const short = ownerNative !== null && ownerNative < floor;
  const held = ownerNative === null ? "" : amount(ownerNative, 18, 18);
  const needed = amount(floor, 18, 18);
  if (sponsored) {
    return {
      headline: "Sponsored by Perago",
      note: "If sponsorship is refused, your wallet sends the same signed operation and pays.",
      warning: short
        ? `If sponsorship is refused your wallet pays, and it holds ${held} tBNB. That needs about ${needed} tBNB.`
        : null,
    };
  }
  return {
    headline: "Paid from your wallet",
    note: "Your wallet sends the signed operation, so it asks once more to confirm the transaction.",
    warning: short
      ? `Your wallet holds ${held} tBNB. Paying this fee needs about ${needed} tBNB.`
      : null,
  };
}

/** The path that actually ran, read from the finished operation. */
export const settledGas = (sponsored: boolean): string =>
  sponsored ? "Sponsored by Perago" : "Paid from your wallet";

/* ------------------------------------------------------------------ */
/* Deep links                                                          */
/* ------------------------------------------------------------------ */

export type FundsIntent = {
  direction: "withdraw";
  symbol: string | null;
  amount: string | null;
};

/** `/app?funds=withdraw[&asset=][&amount=]#funds`, so a task page can open the form. */
export function fundsHref(input: {
  symbol: string | null;
  amount: string | null;
}): string {
  const params = new URLSearchParams({ funds: "withdraw" });
  if (input.symbol) params.set("asset", input.symbol);
  if (input.symbol && input.amount) params.set("amount", input.amount);
  return `/app?${params.toString()}#funds`;
}

/** The withdrawal a link asked for. Unknown assets and malformed amounts are dropped, never guessed. */
export function parseFundsIntent(
  search: string,
  symbols: readonly string[],
): FundsIntent | null {
  const params = new URLSearchParams(search);
  if (params.get("funds") !== "withdraw") return null;
  const asked = params.get("asset")?.toLowerCase();
  const symbol =
    symbols.find((candidate) => candidate.toLowerCase() === asked) ?? null;
  const typed = params.get("amount");
  return {
    direction: "withdraw",
    symbol,
    amount: symbol && typed && /^\d+(\.\d+)?$/u.test(typed) ? typed : null,
  };
}

/* ------------------------------------------------------------------ */
/* Failures                                                            */
/* ------------------------------------------------------------------ */

/**
 * A declined wallet prompt at the send step is not "nothing was signed": the
 * UserOperation hash was already signed and only the transaction that submits
 * it was refused. Other failures and the sign step keep their own sentence.
 */
export function withdrawalFailure(failure: Failure, step: string): Failure {
  return failure.code === "WALLET_REJECTED" && step === "send"
    ? {
        ...failure,
        sentence:
          "The UserOperation was signed. You declined the transaction that would submit it.",
      }
    : failure;
}
