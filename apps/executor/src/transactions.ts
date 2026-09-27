import {
  apexCommerceAbi,
  type ExecutionJob,
  type ExecutionTransactionKind,
  getTaskMandateTypedData,
  type Hash,
  MODULAR_ACCOUNT_V2_ADDRESSES,
  mandateExecutorAbi,
  outcomeEvaluatorAbi,
} from "@perago/sdk";
import {
  type Address,
  type Chain,
  encodeFunctionData,
  type Hex,
  keccak256,
  type LocalAccount,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";

import type { ExecutorDeployment } from "./config.ts";
import { buildPerformUserOperation } from "./user-operation.ts";

export type SignedSubmission = {
  kind: ExecutionTransactionKind;
  rawTransaction: Hex;
  transactionHash: Hash;
  userOperationHash: Hash | null;
};

/** The exact call each lifecycle stage makes; nothing else is ever signed. */
async function stageCall(input: {
  kind: ExecutionTransactionKind;
  client: PublicClient;
  deployment: ExecutorDeployment;
  executor: LocalAccount;
  job: ExecutionJob;
  executionStartedAt: bigint;
}): Promise<{ to: Address; data: Hex; userOperationHash: Hash | null }> {
  const { deployment, job, kind } = input;
  const to = deployment.mandateExecutor;
  switch (kind) {
    case "AUTHORIZE": {
      const { message } = getTaskMandateTypedData(
        job.document.message,
        job.document.domain,
      );
      return {
        data: encodeFunctionData({
          abi: mandateExecutorAbi,
          args: [message, job.rootSignature],
          functionName: "authorize",
        }),
        to,
        userOperationHash: null,
      };
    }
    case "BEGIN":
      return {
        data: encodeFunctionData({
          abi: mandateExecutorAbi,
          args: [job.mandateHash],
          functionName: "beginExecution",
        }),
        to,
        userOperationHash: null,
      };
    case "FINALIZE_EXPIRED":
      return {
        data: encodeFunctionData({
          abi: mandateExecutorAbi,
          args: [job.mandateHash],
          functionName: "finalizeExpired",
        }),
        to,
        userOperationHash: null,
      };
    case "FINALIZE_STALLED":
      return {
        data: encodeFunctionData({
          abi: mandateExecutorAbi,
          args: [job.mandateHash],
          functionName: "finalizeStalledExecution",
        }),
        to,
        userOperationHash: null,
      };
    case "SETTLE":
    case "REJECT_JOB":
    case "CLAIM_REFUND": {
      const settlement = deployment.settlement;
      if (
        !settlement ||
        job.document.message.commerceJobId === "0" ||
        job.document.message.commerceContract !== settlement.commerce.address
      )
        throw new Error("commerce settlement is not pinned for this mandate");
      if (kind === "CLAIM_REFUND") {
        return {
          data: encodeFunctionData({
            abi: apexCommerceAbi,
            args: [BigInt(job.document.message.commerceJobId)],
            functionName: "claimRefund",
          }),
          to: settlement.commerce.address,
          userOperationHash: null,
        };
      }
      return {
        data: encodeFunctionData({
          abi: outcomeEvaluatorAbi,
          args: [BigInt(job.document.message.commerceJobId), job.mandateHash],
          functionName: kind === "SETTLE" ? "settle" : "reject",
        }),
        to: settlement.evaluator.address,
        userOperationHash: null,
      };
    }
    case "PERFORM": {
      const built = await buildPerformUserOperation({
        client: input.client,
        executionStartedAt: input.executionStartedAt,
        executionWindowSeconds: deployment.executionWindowSeconds,
        executor: input.executor,
        job,
      });
      return {
        data: built.handleOpsData,
        to: MODULAR_ACCOUNT_V2_ADDRESSES.entryPoint,
        userOperationHash: built.userOperationHash,
      };
    }
  }
}

/**
 * Builds and signs one stage transaction without broadcasting it. Gas is
 * estimated against `latest`, so a call that would revert now is never signed;
 * the returned hash is persisted before the bytes leave the process.
 */
export async function signStageTransaction(input: {
  kind: ExecutionTransactionKind;
  client: PublicClient;
  wallet: WalletClient<Transport, Chain, LocalAccount>;
  deployment: ExecutorDeployment;
  job: ExecutionJob;
  executionStartedAt: bigint;
}): Promise<SignedSubmission> {
  const call = await stageCall({ ...input, executor: input.wallet.account });
  const request = await input.wallet.prepareTransactionRequest({
    data: call.data,
    to: call.to,
    value: 0n,
  });
  const rawTransaction = await input.wallet.signTransaction(request);
  return {
    kind: input.kind,
    rawTransaction,
    transactionHash: keccak256(rawTransaction),
    userOperationHash: call.userOperationHash,
  };
}
