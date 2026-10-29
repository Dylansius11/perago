import type { WalletPolicy } from "@perago/sdk";

/*
 * When the owner is offered a one-step renewal, and what a renewal is. A
 * session lasts 24 hours; the button appears once it has ended and for the
 * last two hours, early enough that nobody finds Perago unable to act at the
 * moment they need it.
 */

export const RENEW_WINDOW_SECONDS = 7_200;

export type RenewState = "ended" | "ending" | null;

/** `secondsLeft` is the time to the session's end, or null when the policy has none. */
export function renewState(secondsLeft: number | null): RenewState {
  if (secondsLeft === null) return null;
  if (secondsLeft <= 0) return "ended";
  return secondsLeft < RENEW_WINDOW_SECONDS ? "ending" : null;
}

/**
 * The active policy carried over unchanged, with only the version advanced.
 * It is never rebuilt from the editor or the current catalog, so a renewal
 * cannot add a service or adapter, or drop an asset the catalog no longer
 * lists. `versions` are every version the account has used.
 */
export function renewedPolicy(
  active: WalletPolicy,
  versions: readonly string[],
): WalletPolicy {
  const latest = versions.reduce(
    (highest, version) =>
      BigInt(version) > highest ? BigInt(version) : highest,
    BigInt(active.version),
  );
  return { ...active, version: String(latest + 1n) };
}
