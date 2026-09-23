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
} as const;

export type ReasonCode = keyof typeof REASON_MESSAGES;

export const reasonCodeSchema = z.enum(
  Object.keys(REASON_MESSAGES) as [ReasonCode, ...ReasonCode[]],
);
