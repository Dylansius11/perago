import {
  type Address,
  type ExecutionJob,
  type ExecutionTransactionKind,
  getTaskMandateTypedData,
  type MandateProjectionStatus,
} from "@perago/sdk";
import { hashTypedData, keccak256 } from "viem";

import type { ExecutorDeployment } from "./config.ts";

/** `PeragoTypes.MandateStatus` as MandateExecutor stores it. */
export const MANDATE_RECORD_STATUSES = [
  "NONE",
  "AUTHORIZED",
  "EXECUTING",
  "SUCCEEDED",
  "FAILED",
  "REVOKED",
  "EXPIRED",
] as const;

export type MandateRecordStatus = (typeof MANDATE_RECORD_STATUSES)[number];

/** What the worker reads at the chain's `latest` block before every action. */
export type ChainView = {
  timestamp: bigint;
  record: {
    status: MandateRecordStatus;
    executionStartedAt: bigint;
  };
  allowance: bigint;
  balance: bigint;
  executorNonce: bigint;
  /** The persisted in-flight transaction, located on the chain. */
  pending: null | {
    nonce: bigint;
    included: boolean;
    inMempool: boolean;
  };
};

export type Decision =
  | { kind: "DONE" }
  | { kind: "WAIT"; reason: string }
  | { kind: "REBROADCAST" }
  | { kind: "RETIRE" }
  | { kind: "SUBMIT"; transaction: ExecutionTransactionKind }
  | {
      kind: "DEFER";
      code: "APPROVAL_MISSING" | "INPUT_BALANCE_SHORT";
    };

const PROJECTION_OF_RECORD: Record<
  MandateRecordStatus,
  MandateProjectionStatus
> = {
  NONE: "SIGNED",
  AUTHORIZED: "AUTHORIZED",
  EXECUTING: "EXECUTING",
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
  REVOKED: "REVOKED",
  EXPIRED: "EXPIRED",
};

function fundsDeferral(job: ExecutionJob, chain: ChainView): Decision | null {
  const maxInput = BigInt(job.document.message.maxInput);
  if (chain.allowance < maxInput)
    return { kind: "DEFER", code: "APPROVAL_MISSING" };
  if (chain.balance < maxInput)
    return { kind: "DEFER", code: "INPUT_BALANCE_SHORT" };
  return null;
}

/**
 * The next step for one leased job, from the API's finalized projection and a
 * fresh `latest` read. Pure: every input is explicit, so each branch is tested
 * without a chain. Invariants:
 * - a persisted in-flight transaction is resolved (waited on, rebroadcast
 *   byte-for-byte, or retired as replaced) before anything new is signed;
 * - nothing is signed while `latest` disagrees with the finalized projection;
 * - the nonce and the accepted attempt are consumed only once the exact
 *   allowance and balance exist (D-004);
 * - one UserOperation at most is ever included per mandate: after inclusion the
 *   only remaining step is finalizing a stalled window.
 */
export function decide(
  job: ExecutionJob,
  chain: ChainView,
  executionWindowSeconds: bigint,
): Decision {
  if (job.status === "TERMINAL" || job.status === "REJECTED") {
    return { kind: "DONE" };
  }

  if (job.pending) {
    if (!chain.pending)
      throw new Error("a pending transaction was not looked up");
    if (chain.pending.included) {
      return { kind: "WAIT", reason: "pending transaction awaits finality" };
    }
    if (chain.pending.inMempool) {
      return { kind: "WAIT", reason: "pending transaction is in the mempool" };
    }
    return chain.executorNonce <= chain.pending.nonce
      ? { kind: "REBROADCAST" }
      : { kind: "RETIRE" };
  }

  if (PROJECTION_OF_RECORD[chain.record.status] !== job.mandateStatus) {
    return { kind: "WAIT", reason: "latest chain state is ahead of finality" };
  }

  const expiresAt = BigInt(job.document.message.expiresAt);
  switch (job.mandateStatus) {
    case "SIGNED": {
      if (chain.timestamp >= expiresAt) {
        return {
          kind: "WAIT",
          reason: "expired unauthorized; awaiting rejection",
        };
      }
      return (
        fundsDeferral(job, chain) ?? {
          kind: "SUBMIT",
          transaction: "AUTHORIZE",
        }
      );
    }
    case "AUTHORIZED": {
      if (chain.timestamp >= expiresAt) {
        return { kind: "SUBMIT", transaction: "FINALIZE_EXPIRED" };
      }
      return (
        fundsDeferral(job, chain) ?? { kind: "SUBMIT", transaction: "BEGIN" }
      );
    }
    case "EXECUTING": {
      if (
        chain.timestamp >
        chain.record.executionStartedAt + executionWindowSeconds
      ) {
        return { kind: "SUBMIT", transaction: "FINALIZE_STALLED" };
      }
      if (job.transactions.userOperation !== null) {
        return {
          kind: "WAIT",
          reason: "UserOperation included without a receipt",
        };
      }
      if (chain.timestamp >= expiresAt) {
        return { kind: "WAIT", reason: "mandate expired mid-window" };
      }
      return { kind: "SUBMIT", transaction: "PERFORM" };
    }
    default:
      return { kind: "WAIT", reason: "terminal projection awaits the API" };
  }
}

/**
 * Refuses a job this worker must not drive: another deployment or chain, a
 * mandate naming another executor or session, a stored document whose digest
 * is not the job's mandate hash, action bytes that are not the signed action,
 * or an ERC-8183 binding whose settlement this worker does not perform.
 */
export function assertDrivableJob(
  job: ExecutionJob,
  deployment: ExecutorDeployment,
  executor: Address,
): void {
  const { domain, message } = job.document;
  const self = executor.toLowerCase();
  const problems = [
    domain.verifyingContract !== deployment.mandateExecutor &&
      "the job names another MandateExecutor",
    domain.chainId !== String(deployment.chainId) &&
      "the job names another chain",
    message.executor !== self && "the mandate names another executor",
    job.session.signer !== self && "the session signer is not this executor",
    hashTypedData(getTaskMandateTypedData(message, domain)) !==
      job.mandateHash &&
      "the stored mandate does not hash to the job's mandate hash",
    keccak256(job.action) !== message.actionHash &&
      "the action bytes are not the signed action",
    (message.commerceJobId !== "0" ||
      message.commerceContract !==
        "0x0000000000000000000000000000000000000000") &&
      "ERC-8183 settlement is not performed by this worker",
  ].filter((problem): problem is string => typeof problem === "string");
  if (problems.length > 0) {
    throw new Error(`refusing job ${job.mandateHash}: ${problems.join("; ")}`);
  }
}
