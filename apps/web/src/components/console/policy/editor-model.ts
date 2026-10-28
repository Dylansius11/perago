import type { PublicConfig, WalletPolicy } from "@perago/sdk";
import { formatUnits, parseUnits } from "viem";
import { type Mode, modeOf } from "./diff";

/*
 * The policy editor's form state and its validation, kept pure so every rule
 * is testable. Text fields hold what the owner typed; amounts become base
 * units only through viem's integer parser, never a float.
 */

type Catalog = Pick<PublicConfig, "tokens">;

export type AssetChoice = { mode: Mode; max: string; daily: string };

export type EditorState = {
  assets: Record<string, AssetChoice>;
  /** Basis points, as typed. */
  slippageBps: string;
  /** Minutes, as typed. */
  lifetimeMinutes: string;
};

export type EditorErrors = {
  assets: Record<string, { max?: string; daily?: string }>;
  slippage?: string;
  lifetime?: string;
  /** A rule that spans fields, e.g. at least one active token. */
  general?: string;
};

const DEFAULT_ASSET: Omit<AssetChoice, "mode"> = { max: "0.01", daily: "0.05" };

export function minutesFromSeconds(seconds: string | number): string {
  return String(Number(seconds) / 60);
}

/** The seconds a typed minutes value means, or null when it is not a whole number of seconds. */
export function secondsFromMinutes(minutes: string): number | null {
  if (!/^\d+(\.\d+)?$/u.test(minutes.trim())) return null;
  const exact = Number(minutes) * 60;
  const seconds = Math.round(exact);
  if (!Number.isSafeInteger(seconds) || Math.abs(exact - seconds) > 1e-6)
    return null;
  return seconds;
}

/**
 * Start from the policy in force so every edit is a visible change from it.
 * With no policy yet, spend WBNB-style defaults on the first token and protect
 * the rest.
 */
export function initialEditorState(
  policy: WalletPolicy | null,
  catalog: Catalog,
): EditorState {
  const assets: Record<string, AssetChoice> = {};
  for (const token of catalog.tokens) {
    const limit = policy?.activeAssets.find(
      (asset) => asset.token.toLowerCase() === token.address.toLowerCase(),
    );
    assets[token.symbol] = {
      mode: policy
        ? modeOf(policy, token.address)
        : token.symbol === "WBNB"
          ? "active"
          : "protected",
      max: limit
        ? formatUnits(BigInt(limit.maxInputPerTask), token.decimals)
        : DEFAULT_ASSET.max,
      daily: limit
        ? formatUnits(BigInt(limit.rollingDailyCap), token.decimals)
        : DEFAULT_ASSET.daily,
    };
  }
  return {
    assets,
    slippageBps: policy?.maxSlippageBps ?? "100",
    lifetimeMinutes: minutesFromSeconds(
      policy?.maxTaskLifetimeSeconds ?? "1800",
    ),
  };
}

/** A typed amount in base units, or the sentence that says why it is not one. */
export function parseAmountField(
  text: string,
  decimals: number,
): { value: bigint } | { error: string } {
  const typed = text.trim();
  if (typed.length === 0) return { error: "Enter an amount." };
  if (!/^\d+(\.\d+)?$/u.test(typed))
    return { error: "Use digits and one decimal point only." };
  const fraction = typed.split(".")[1] ?? "";
  if (fraction.length > decimals)
    return { error: `At most ${decimals} decimal places.` };
  const value = parseUnits(typed, decimals);
  if (value <= 0n) return { error: "Must be more than zero." };
  return { value };
}

export function validateEditor(
  state: EditorState,
  catalog: Catalog,
): EditorErrors {
  const errors: EditorErrors = { assets: {} };
  let active = 0;
  for (const token of catalog.tokens) {
    const choice = state.assets[token.symbol];
    if (choice?.mode !== "active") continue;
    active += 1;
    const max = parseAmountField(choice.max, token.decimals);
    const daily = parseAmountField(choice.daily, token.decimals);
    const own: { max?: string; daily?: string } = {};
    if ("error" in max) own.max = max.error;
    if ("error" in daily) own.daily = daily.error;
    if ("value" in max && "value" in daily && max.value > daily.value)
      own.max = "Cannot be more than the 24-hour cap.";
    if (own.max || own.daily) errors.assets[token.symbol] = own;
  }
  if (active === 0)
    errors.general =
      "Set at least one token to active, or Perago has nothing it may spend.";
  if (!/^\d+$/u.test(state.slippageBps.trim()))
    errors.slippage = "Whole basis points, from 0 to 10,000.";
  else if (Number(state.slippageBps) > 10_000)
    errors.slippage = "At most 10,000 bps (100%).";
  const seconds = secondsFromMinutes(state.lifetimeMinutes);
  if (seconds === null)
    errors.lifetime = "Minutes, as a number such as 30 or 7.5.";
  else if (seconds < 1) errors.lifetime = "At least one second.";
  return errors;
}

export function hasErrors(errors: EditorErrors): boolean {
  return (
    Object.keys(errors.assets).length > 0 ||
    errors.slippage !== undefined ||
    errors.lifetime !== undefined ||
    errors.general !== undefined
  );
}
