import type { ExecutionReceipt } from "@perago/sdk";
import type { GlyphName, Tone } from "../console/ui";

/*
 * What the public receipt page says, derived only from the receipt the API
 * returned. Nothing here reads a wallet, a clock, or a cache: the same receipt
 * always yields the same words, so an unverified result can never be drawn as
 * verified.
 */

export const BSCSCAN = "https://testnet.bscscan.com";
export const CHAIN_NAME = "BNB Smart Chain Testnet";

export const txUrl = (hash: string): string => `${BSCSCAN}/tx/${hash}`;
export const addressUrl = (address: string): string =>
  `${BSCSCAN}/address/${address}`;

/** The contract page; its Read Contract tab holds `mandateRecord`. */
export const mandateRecordUrl = (mandateExecutor: string): string =>
  `${addressUrl(mandateExecutor)}#readContract`;

/** `MandateStatus` in the contract: NONE, AUTHORIZED, EXECUTING, then these four. */
export const STATUS_CODE = {
  SUCCEEDED: 3,
  FAILED: 4,
  REVOKED: 5,
  EXPIRED: 6,
} as const satisfies Record<ExecutionReceipt["status"], number>;

export type ReceiptVerdictKind =
  | "verified"
  | "unverified"
  | "failed"
  | "revoked"
  | "expired";

export type ReceiptVerdict = {
  kind: ReceiptVerdictKind;
  tone: Tone;
  glyph: GlyphName;
  /** The status chip. */
  label: string;
  headline: string;
  detail: string;
  /** The stable terminal reason, shown for every outcome except a verified success. */
  reason: { code: string; message: string } | null;
};

export function deriveReceiptVerdict(
  receipt: ExecutionReceipt,
): ReceiptVerdict {
  const ended = receipt.authorityConsumed
    ? "Authority ended."
    : "Authority has not been confirmed as ended.";
  const reason = {
    code: receipt.terminalReasonCode,
    message: receipt.terminalMessage,
  };
  const executed = receipt.transactions.execution !== null;

  switch (receipt.status) {
    case "SUCCEEDED":
      if (receipt.verification.status === "PASSED") {
        return {
          kind: "verified",
          tone: "ok",
          glyph: "check",
          label: "Verified",
          headline: `Verified onchain. ${ended}`,
          detail:
            "The chain recorded this task as succeeded and the outcome passed its check. The mandate was single use and cannot run again.",
          reason: null,
        };
      }
      return {
        kind: "unverified",
        tone: "pending",
        glyph: "clock",
        label: "Not verified",
        headline: "Recorded as succeeded. Verification not confirmed.",
        detail: `The chain recorded success, but the verification result is ${receipt.verification.status.toLowerCase().replace(/_/gu, " ")}, so this page does not call it verified. ${ended}`,
        reason,
      };
    case "FAILED":
      return {
        kind: "failed",
        tone: "fail",
        glyph: "cross",
        label: "Failed",
        headline: "The chain recorded this task as failed.",
        detail: `${ended} This mandate cannot run again.`,
        reason,
      };
    case "REVOKED":
      return {
        kind: "revoked",
        tone: "idle",
        glyph: "minus",
        label: "Revoked",
        headline: "Revoked before it ran.",
        detail: `${ended} ${
          executed
            ? "This mandate cannot run again."
            : "Nothing was executed under it."
        }`,
        reason,
      };
    case "EXPIRED":
      return {
        kind: "expired",
        tone: "idle",
        glyph: "clock",
        label: "Expired",
        headline: "Expired before it ran.",
        detail: `${ended} ${
          executed
            ? "This mandate cannot run again."
            : "Its deadline passed and nothing was executed under it."
        }`,
        reason,
      };
  }
}

/* ------------------------------------------------------------------ */
/* Proof rows                                                          */
/* ------------------------------------------------------------------ */

export type ProofRow = {
  key: "authorize" | "begin" | "execute" | "terminal";
  label: string;
  hash: string | null;
  href: string | null;
  block: string | null;
  note: string | null;
  /** Said plainly when the step has no transaction. */
  absent: string;
};

const TERMINAL_LABEL: Record<ExecutionReceipt["status"], string> = {
  SUCCEEDED: "Final state",
  FAILED: "Failure recorded",
  REVOKED: "Revocation",
  EXPIRED: "Expiry",
};

/**
 * The transactions that ended up on chain, in order, with the block each was
 * included in. The terminal event gets its own row only when it was emitted by
 * a transaction that is not already listed.
 */
export function proofRows(receipt: ExecutionReceipt): ProofRow[] {
  const { transactions: tx, terminal } = receipt;
  const link = (hash: string | null) => (hash ? txUrl(hash) : null);
  const terminalIsExecution = terminal.transactionHash === tx.execution;
  const rows: ProofRow[] = [
    {
      key: "authorize",
      label: "Authorize",
      hash: tx.authorize,
      href: link(tx.authorize),
      block: receipt.authorization.blockNumber,
      note: null,
      absent: "Not recorded",
    },
    {
      key: "begin",
      label: "Begin",
      hash: tx.begin,
      href: link(tx.begin),
      block: receipt.begin?.blockNumber ?? null,
      note: null,
      absent: "Execution never began",
    },
    {
      key: "execute",
      label: "Execute",
      hash: tx.execution,
      href: link(tx.execution),
      block: terminalIsExecution ? terminal.blockNumber : null,
      note: terminalIsExecution
        ? `Final event, log ${terminal.logIndex}`
        : null,
      absent: "Nothing was executed",
    },
  ];
  const listed = [tx.authorize, tx.begin, tx.execution];
  if (!listed.includes(terminal.transactionHash)) {
    rows.push({
      key: "terminal",
      label: TERMINAL_LABEL[receipt.status],
      hash: terminal.transactionHash,
      href: txUrl(terminal.transactionHash),
      block: terminal.blockNumber,
      note: `Final event, log ${terminal.logIndex}`,
      absent: "Not recorded",
    });
  }
  return rows;
}

/* ------------------------------------------------------------------ */
/* Verification and settlement                                         */
/* ------------------------------------------------------------------ */

export function verificationCopy(
  status: ExecutionReceipt["verification"]["status"],
): string {
  switch (status) {
    case "PASSED":
      return "Passed. The outcome was checked against what the mandate signed for.";
    case "NOT_VERIFIED":
      return "Not verified. The outcome did not pass the check.";
    case "NOT_APPLICABLE":
      return "Not applicable. There was no outcome to check.";
  }
}

/** Honest settlement copy. Only a confirmed status describes a payment as made. */
export function settlementCopy(
  settlement: ExecutionReceipt["settlement"],
): string {
  switch (settlement.status) {
    case "NOT_BOUND":
      return "No agent payment is attached to this task.";
    case "PENDING":
      return "A payment is bound to this task and has not settled yet.";
    case "INELIGIBLE":
      return "A payment is bound to this task, but the result did not qualify for it.";
    case "UNPAID":
      return "A payment is bound to this task, but no payout was recorded.";
    case "CONFIRMED":
      return "A payout for this task is confirmed onchain.";
  }
}
