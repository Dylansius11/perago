import { setTimeout as delay } from "node:timers/promises";
import type { ExecutionJob } from "@perago/sdk";
import type {
  Chain,
  LocalAccount,
  PublicClient,
  Transport,
  WalletClient,
} from "viem";

import {
  ApiRequestError,
  type ExecutionApi,
  LeaseLostError,
} from "./api-client.ts";
import { readChainView } from "./chain.ts";
import type { ExecutorDeployment } from "./config.ts";
import { describeError, type Logger } from "./log.ts";
import { assertDrivableJob, type Decision, decide } from "./reconcile.ts";
import { signStageTransaction } from "./transactions.ts";

export type WorkerDependencies = {
  api: ExecutionApi;
  client: PublicClient;
  wallet: WalletClient<Transport, Chain, LocalAccount>;
  deployment: ExecutorDeployment;
  logger: Logger;
  pollIntervalMs: number;
  deferSeconds: number;
};

/**
 * `loop` drives each job to its end. `once` stops the process right after its
 * first chain-changing step - a broadcast, a retirement, or a deferral - without
 * releasing the lease, exactly as a crash would; the next process must recover
 * from the persisted state after the lease expires.
 */
export type WorkerMode = "loop" | "once";

export type JobOutcome = "FINISHED" | "DEFERRED" | "STOPPED" | "LEASE_LOST";

/** Broadcast failures never decide state: the persisted hash does. */
async function broadcast(
  deps: WorkerDependencies,
  job: ExecutionJob,
  rawTransaction: `0x${string}`,
): Promise<void> {
  try {
    await deps.client.sendRawTransaction({
      serializedTransaction: rawTransaction,
    });
  } catch (error) {
    deps.logger.warn("broadcast.unconfirmed", {
      mandateHash: job.mandateHash,
      ...describeError(error),
    });
  }
}

async function act(
  deps: WorkerDependencies,
  job: ExecutionJob,
  decision: Decision,
  executionStartedAt: bigint,
): Promise<"CONTINUE" | "ACTED" | "DEFERRED" | "FINISHED"> {
  switch (decision.kind) {
    case "DONE":
      return "FINISHED";
    case "WAIT":
      return "CONTINUE";
    case "REBROADCAST": {
      if (!job.pending) throw new Error("nothing to rebroadcast");
      deps.logger.info("transaction.rebroadcast", {
        kind: job.pending.kind,
        mandateHash: job.mandateHash,
        transactionHash: job.pending.transactionHash,
      });
      await broadcast(deps, job, job.pending.rawTransaction);
      return "ACTED";
    }
    case "RETIRE": {
      if (!job.pending) throw new Error("nothing to retire");
      try {
        await deps.api.retireReplaced(
          job.mandateHash,
          job.pending.transactionHash,
        );
      } catch (error) {
        // The replacing nonce is not finalized yet; the API decides at finality.
        if (error instanceof ApiRequestError && error.status === 409)
          return "CONTINUE";
        throw error;
      }
      deps.logger.info("transaction.retired", {
        mandateHash: job.mandateHash,
        transactionHash: job.pending.transactionHash,
      });
      return "ACTED";
    }
    case "DEFER": {
      await deps.api.defer(job.mandateHash, {
        code: decision.code,
        retryAfterSeconds: deps.deferSeconds,
      });
      deps.logger.info("job.deferred", {
        code: decision.code,
        mandateHash: job.mandateHash,
      });
      return "DEFERRED";
    }
    case "SUBMIT": {
      let signed: Awaited<ReturnType<typeof signStageTransaction>>;
      try {
        signed = await signStageTransaction({
          client: deps.client,
          deployment: deps.deployment,
          executionStartedAt,
          job,
          kind: decision.transaction,
          wallet: deps.wallet,
        });
      } catch (error) {
        // Estimation reverted at `latest`: the chain would refuse this step now.
        deps.logger.warn("transaction.not_admissible", {
          kind: decision.transaction,
          mandateHash: job.mandateHash,
          ...describeError(error),
        });
        return "CONTINUE";
      }
      // The hash is durable before the bytes leave this process.
      await deps.api.recordPending(job.mandateHash, {
        kind: signed.kind,
        rawTransaction: signed.rawTransaction,
        userOperationHash: signed.userOperationHash,
      });
      deps.logger.info("transaction.submitted", {
        kind: signed.kind,
        mandateHash: job.mandateHash,
        transactionHash: signed.transactionHash,
        userOperationHash: signed.userOperationHash,
      });
      await broadcast(deps, job, signed.rawTransaction);
      return "ACTED";
    }
  }
}

/** Reconciles and advances one leased job until it ends, defers, or stops. */
export async function runJob(
  deps: WorkerDependencies,
  leased: ExecutionJob,
  mode: WorkerMode,
  signal: AbortSignal,
): Promise<JobOutcome> {
  const executor = deps.wallet.account.address;
  assertDrivableJob(leased, deps.deployment, executor);
  const { mandateHash } = leased;

  try {
    while (!signal.aborted) {
      const job = await deps.api.reconcile(mandateHash);
      const chain =
        job.status === "TERMINAL" || job.status === "REJECTED"
          ? null
          : await readChainView({
              client: deps.client,
              deployment: deps.deployment,
              executor,
              job,
            });
      const decision = chain
        ? decide(job, chain, deps.deployment.executionWindowSeconds)
        : ({ kind: "DONE" } as const);
      deps.logger.info("job.decision", {
        decision,
        mandateHash,
        mandateStatus: job.mandateStatus,
        status: job.status,
      });

      const result = await act(
        deps,
        job,
        decision,
        chain?.record.executionStartedAt ?? 0n,
      );
      if (result === "FINISHED") {
        deps.logger.info("job.finished", {
          lastError: job.lastError,
          mandateHash,
          status: job.status,
          transactions: job.transactions,
        });
        return "FINISHED";
      }
      if (result === "DEFERRED") return "DEFERRED";
      if (result === "ACTED" && mode === "once") return "STOPPED";
      // Polls the chain toward finality; there is no event to await.
      await delay(deps.pollIntervalMs, undefined, { signal }).catch(() => {});
    }
    await deps.api.release(mandateHash);
    return "STOPPED";
  } catch (error) {
    if (error instanceof LeaseLostError) {
      deps.logger.warn("job.lease_lost", { mandateHash });
      return "LEASE_LOST";
    }
    throw error;
  }
}

/** Leases and runs jobs one at a time until stopped. */
export async function runWorker(
  deps: WorkerDependencies,
  mode: WorkerMode,
  signal: AbortSignal,
): Promise<void> {
  while (!signal.aborted) {
    let job: ExecutionJob | null;
    try {
      job = await deps.api.lease();
    } catch (error) {
      deps.logger.error("lease.failed", describeError(error));
      job = null;
    }
    if (job) {
      deps.logger.info("job.leased", {
        mandateHash: job.mandateHash,
        status: job.status,
      });
      try {
        const outcome = await runJob(deps, job, mode, signal);
        if (mode === "once") return;
        if (outcome !== "LEASE_LOST") continue;
      } catch (error) {
        deps.logger.error("job.failed", {
          mandateHash: job.mandateHash,
          ...describeError(error),
        });
        if (mode === "once") throw error;
      }
    }
    // Polls the queue; Postgres leases carry no notification channel. A
    // once-run also waits here for a lease a crashed predecessor still holds.
    await delay(deps.pollIntervalMs, undefined, { signal }).catch(() => {});
  }
}
