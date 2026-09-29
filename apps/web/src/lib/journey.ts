import type { Address, WalletPolicy } from "@perago/sdk";

/*
 * The pure decisions of one task journey: when a signature is still valid, how
 * many wallet prompts finishing the task honestly costs, and which single step
 * the page may take on its own. The component owns the prompts and the API
 * calls; these functions own the arithmetic, so they can be read and tested
 * without a wallet or a chain.
 */

/** The executor may pull the mandate's exact input only while the allowance covers it. */
export function allowanceReady(
  allowance: bigint | null,
  maxInput: string,
): boolean {
  return allowance !== null && allowance >= BigInt(maxInput);
}

/** A prepared mandate is signable only while its simulation is current and its quote has not expired. */
export function mandateStale(input: {
  preparedQuoteExpiresAt: string | null;
  preparedSimulationHash: string | null;
  simulation: { status: string; simulationHash: string } | null;
  nowSeconds: number;
}): boolean {
  const { preparedQuoteExpiresAt, preparedSimulationHash, simulation } = input;
  if (preparedQuoteExpiresAt === null || preparedSimulationHash === null)
    return true;
  if (
    simulation === null ||
    simulation.status !== "PASSED" ||
    simulation.simulationHash !== preparedSimulationHash
  )
    return true;
  return Number(preparedQuoteExpiresAt) <= input.nowSeconds;
}

export type PromptCount = { restore: number; mandate: number; total: number };

/** One mandate signature; a short allowance adds the restore operation (one sponsored prompt, else sign and send). */
export function promptCount(input: {
  needsRestore: boolean;
  sponsorshipEnabled: boolean;
}): PromptCount {
  const restore = input.needsRestore ? (input.sponsorshipEnabled ? 1 : 2) : 0;
  return { restore, mandate: 1, total: restore + 1 };
}

/** The active policy's rolling cap for one token, matched without case; null when the policy does not make that token active. */
export function rollingCap(
  policy: WalletPolicy,
  token: Address,
): bigint | null {
  const limit = policy.activeAssets.find(
    (asset) => asset.token.toLowerCase() === token.toLowerCase(),
  );
  return limit ? BigInt(limit.rollingDailyCap) : null;
}

/** The restore approves exactly the policy cap, and only when that cap can cover this plan's input. */
export function restoreAmount(
  cap: bigint | null,
  maxInput: string,
): bigint | null {
  return cap === null || cap < BigInt(maxInput) ? null : cap;
}

export type AutomaticStep =
  | { step: "simulate"; key: string }
  | { step: "prepare"; key: string }
  | null;

export type AutomaticStepInput = {
  taskId: string;
  planPresent: boolean;
  decisionPassed: boolean;
  simulation: { simulationId: string; status: string } | null;
  mandateSigned: boolean;
  prepared: boolean;
};

/** Automatic simulations per page visit; past this the manual button remains. */
export const AUTOMATIC_SIMULATION_LIMIT = 3;

/**
 * The one step the page may take without a click: simulate a compiled, accepted
 * task, re-simulate each simulation the API marked stale, then prepare once per
 * passing simulation. Every attempt is recorded before it runs, so a failure
 * falls back to the manual buttons instead of looping, and a quote that moves
 * on every block stops after `AUTOMATIC_SIMULATION_LIMIT` runs.
 */
export function automaticStep(
  input: AutomaticStepInput & { attempted: ReadonlySet<string> },
): AutomaticStep {
  if (input.mandateSigned) return null;
  if (
    input.planPresent &&
    input.decisionPassed &&
    (input.simulation === null || input.simulation.status === "STALE")
  ) {
    const prefix = `${input.taskId}:simulate:`;
    const key = `${prefix}${input.simulation?.simulationId ?? "none"}`;
    const runs = [...input.attempted].filter((entry) =>
      entry.startsWith(prefix),
    ).length;
    return input.attempted.has(key) || runs >= AUTOMATIC_SIMULATION_LIMIT
      ? null
      : { step: "simulate", key };
  }
  if (input.simulation?.status === "PASSED" && !input.prepared) {
    const key = `${input.taskId}:prepare:${input.simulation.simulationId}`;
    return input.attempted.has(key) ? null : { step: "prepare", key };
  }
  return null;
}
