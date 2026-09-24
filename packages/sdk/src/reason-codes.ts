import { z } from "zod";

/**
 * Stable machine-readable reason codes and their human sentences (PRD-F-016).
 * Codes are a published interface: never rename one; add a new code instead.
 */
export const REASON_MESSAGES = {
  CHAIN_MISMATCH: "The plan targets a different chain than the Wallet Policy.",
  ACCOUNT_MISMATCH:
    "The intent names a different smart account than the Wallet Policy.",
  SERVICE_NOT_ALLOWED: "The Wallet Policy does not allow this service.",
  PROTOCOL_NOT_APPROVED:
    "The Wallet Policy does not approve this protocol adapter.",
  ROUTE_UNSUPPORTED:
    "The protocol adapter has no pinned route for these assets.",
  PROTECTED_ASSET_SPEND:
    "The plan would spend an asset the Wallet Policy protects.",
  ASSET_NOT_ACTIVE:
    "The spend asset is not an active asset in the Wallet Policy.",
  AMOUNT_INVALID:
    "The amount is zero or has more decimal places than the token supports.",
  PER_TASK_CAP_EXCEEDED:
    "The amount is larger than the Wallet Policy allows for one task.",
  DAILY_CAP_EXCEEDED:
    "The amount would exceed the Wallet Policy rolling daily cap for this asset.",
  SLIPPAGE_EXCEEDED:
    "The requested slippage is wider than the Wallet Policy allows.",
  RECIPIENT_NOT_ALLOWED:
    "The recipient is not the smart account, the only recipient the Wallet Policy allows.",
  LIFETIME_INVALID: "The requested expiry must be at least one second.",
  LIFETIME_EXCEEDED:
    "The requested expiry is longer than the Wallet Policy task lifetime.",
  PLANNER_UNAVAILABLE:
    "The planner could not be reached. Nothing was compiled; retry the same request.",
  PLANNER_OUTPUT_INVALID:
    "The planner returned output outside the closed plan schema. Nothing was compiled; retry the same request.",
  INTENT_NEEDS_CLARIFICATION:
    "The goal is ambiguous or unsupported. Nothing was compiled; restate the goal as a new request.",
  ACCOUNT_NOT_REGISTERED:
    "The smart account's owner, owner epoch, or active policy is not registered with this MandateExecutor.",
  COMMERCE_BINDING_REQUIRED:
    "This MandateExecutor requires an ERC-8183 job for every mandate, and Perago cannot create one yet.",
  DEPLOYMENT_MISMATCH:
    "A pinned contract's onchain code or wiring does not match the reviewed deployment manifest.",
  SESSION_EXPIRES_FIRST:
    "The executor session permission expires before this mandate would, so it could never execute.",
  INSUFFICIENT_BALANCE:
    "The smart account holds less of the spend asset than the plan spends.",
  QUOTE_UNAVAILABLE:
    "The protocol returned no usable quote or position estimate at the simulation block.",
  MINIMUM_OUTPUT_ZERO:
    "After the slippage bound the minimum output is zero, so the amount is too small to protect.",
  SIMULATION_REVERTED:
    "The exact action failed in simulation at the pinned block; nothing can be signed.",
  STALE_BLOCK: "The simulation block is no longer canonical. Simulate again.",
  STALE_QUOTE: "The simulation quote has expired. Simulate again.",
  STALE_POLICY:
    "The active Wallet Policy changed since the simulation. Simulate again.",
  STALE_ACCOUNT:
    "The smart account's owner, owner epoch, code, or implementation changed since the simulation.",
  STALE_CODE:
    "A pinned contract's code changed since the simulation. Simulate again.",
  STALE_POSITION:
    "The staking position or the pool's fees changed since the simulation. Simulate again.",
  POSITION_UNAVAILABLE:
    "The staking position or pool terms could not be read, so nothing can be signed.",
  STALE_NONCE:
    "The mandate nonce was used or invalidated since the simulation. Simulate again.",
  STALE_ACTION:
    "The exact signed action no longer passes at the current block. Simulate and sign again.",
  SIGNATURE_INVALID:
    "The signature does not recover to the root owner over the prepared mandate.",
  AUTHORIZATION_REJECTED:
    "MandateExecutor would reject this signed mandate at the current block.",
  CHAIN_UNAVAILABLE:
    "The chain could not be read, so nothing changed. Retry shortly.",
  APPROVAL_MISSING:
    "The smart account has not approved MandateExecutor for this task's exact input yet.",
  INPUT_BALANCE_SHORT:
    "The smart account holds less than this task's signed input.",
  TRANSACTION_REVERTED:
    "An execution transaction was included but reverted; the chain state decides the next step.",
  ONCHAIN_SUCCEEDED:
    "The mandate succeeded onchain and its verifier commitment was recorded.",
  ONCHAIN_FAILED:
    "The mandate ended unsuccessfully onchain; its failure hash is a commitment, not a decoded cause.",
  ONCHAIN_REVOKED:
    "The mandate was revoked onchain before a successful execution.",
  ONCHAIN_EXPIRED: "The mandate expired onchain before a successful execution.",
} as const;

export type ReasonCode = keyof typeof REASON_MESSAGES;

export const reasonCodeSchema = z.enum(
  Object.keys(REASON_MESSAGES) as [ReasonCode, ...ReasonCode[]],
);
