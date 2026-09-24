import type { Address, Hash, ReasonCode } from "@perago/sdk";

import type { ChainSnapshot } from "./context.js";
import type { StakePosition } from "./stake.js";

const POSITION_FACTS = [
  "holder",
  "holderDeployed",
  "sharesBefore",
  "withdrawFeeBps",
  "withdrawFeePeriodSeconds",
  "performanceFeeBps",
] as const satisfies readonly (keyof StakePosition)[];

/** The committed facts a signable simulation must still match. */
export type SimulatedFacts = {
  accountImplementation: Address;
  block: { hash: Hash; number: string; timestamp: string };
  codeHashes: ChainSnapshot["codeHashes"];
  ownerEpoch: string;
  policyHash: Hash;
  /** The stake position the simulation read; null for a swap. */
  position: StakePosition | null;
  quoteExpiresAt: string;
  rootOwner: Address;
};

export type FreshnessInput = {
  /** The hash at the simulated height now; null when the node cannot serve it. */
  canonicalHashAtSimulatedBlock: Hash | null;
  current: ChainSnapshot;
  /** The stake position re-read now; null for a swap. */
  currentPosition: StakePosition | null;
  nonceUsed: boolean;
  /** The task's Wallet Policy row is still `ACTIVE`. */
  policyActive: boolean;
  simulated: SimulatedFacts;
  wallet: { ownerEpoch: string; rootOwner: Address };
};

/**
 * Every reason the simulation can no longer back a signature (PRD-S-009), in
 * a fixed order. Empty means fresh. The quote expires at its deadline: chain
 * time equal to `quoteExpiresAt` is already stale.
 */
export function assessFreshness(input: FreshnessInput): ReasonCode[] {
  const { current, simulated } = input;
  const reasons: ReasonCode[] = [];

  if (input.canonicalHashAtSimulatedBlock !== simulated.block.hash) {
    reasons.push("STALE_BLOCK");
  }
  if (current.block.timestamp >= BigInt(simulated.quoteExpiresAt)) {
    reasons.push("STALE_QUOTE");
  }
  if (
    !input.policyActive ||
    current.accountConfig.activePolicyHash !== simulated.policyHash
  ) {
    reasons.push("STALE_POLICY");
  }
  if (
    current.accountConfig.rootOwner !== simulated.rootOwner ||
    current.accountConfig.ownerEpoch !== simulated.ownerEpoch ||
    input.wallet.rootOwner !== simulated.rootOwner ||
    input.wallet.ownerEpoch !== simulated.ownerEpoch ||
    current.accountImplementation !== simulated.accountImplementation ||
    current.codeHashes.account !== simulated.codeHashes.account
  ) {
    reasons.push("STALE_ACCOUNT");
  }
  if (
    current.codeHashes.adapter !== simulated.codeHashes.adapter ||
    current.codeHashes.mandateExecutor !==
      simulated.codeHashes.mandateExecutor ||
    current.codeHashes.protocolTarget !== simulated.codeHashes.protocolTarget ||
    current.codeHashes.verifier !== simulated.codeHashes.verifier
  ) {
    reasons.push("STALE_CODE");
  }
  // A stake whose position was not re-read (null) never matches.
  const simulatedPosition = simulated.position;
  if (
    simulatedPosition !== null &&
    POSITION_FACTS.some(
      (fact) => input.currentPosition?.[fact] !== simulatedPosition[fact],
    )
  ) {
    reasons.push("STALE_POSITION");
  }
  if (input.nonceUsed) reasons.push("STALE_NONCE");
  return reasons;
}
