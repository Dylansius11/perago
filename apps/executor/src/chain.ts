import {
  type Address,
  type ExecutionJob,
  mandateExecutorAbi,
} from "@perago/sdk";
import {
  erc20Abi,
  type PublicClient,
  parseTransaction,
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
} from "viem";

import type { ExecutorDeployment } from "./config.ts";
import { type ChainView, MANDATE_RECORD_STATUSES } from "./reconcile.ts";

async function located<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    if (
      error instanceof TransactionReceiptNotFoundError ||
      error instanceof TransactionNotFoundError
    ) {
      return null;
    }
    throw error;
  }
}

/**
 * Everything `decide` needs, read at one `latest` block: the mandate record,
 * the account's exact allowance and balance of the signed input, the executor
 * nonce, and where the persisted in-flight transaction is.
 */
export async function readChainView(input: {
  client: PublicClient;
  deployment: ExecutorDeployment;
  executor: Address;
  job: ExecutionJob;
}): Promise<ChainView> {
  const { client, deployment, executor, job } = input;
  const { message } = job.document;
  const block = await client.getBlock({ blockTag: "latest" });
  const at = { blockNumber: block.number };

  const [record, allowance, balance, executorNonce] = await Promise.all([
    client.readContract({
      ...at,
      abi: mandateExecutorAbi,
      address: deployment.mandateExecutor,
      args: [job.mandateHash],
      functionName: "mandateRecord",
    }),
    client.readContract({
      ...at,
      abi: erc20Abi,
      address: message.inputToken,
      args: [message.account, deployment.mandateExecutor],
      functionName: "allowance",
    }),
    client.readContract({
      ...at,
      abi: erc20Abi,
      address: message.inputToken,
      args: [message.account],
      functionName: "balanceOf",
    }),
    client.getTransactionCount({ address: executor, ...at }),
  ]);

  const status = MANDATE_RECORD_STATUSES[record.status];
  if (!status)
    throw new Error(`unknown mandate record status ${record.status}`);

  let pending: ChainView["pending"] = null;
  if (job.pending) {
    const hash = job.pending.transactionHash;
    const receipt = await located(() => client.getTransactionReceipt({ hash }));
    const transaction = receipt
      ? null
      : await located(() => client.getTransaction({ hash }));
    const { nonce } = parseTransaction(job.pending.rawTransaction);
    if (nonce === undefined)
      throw new Error("pending transaction has no nonce");
    pending = {
      nonce: BigInt(nonce),
      included: receipt !== null,
      inMempool: transaction !== null,
    };
  }

  return {
    timestamp: block.timestamp,
    record: {
      status,
      executionStartedAt: BigInt(record.executionStartedAt),
    },
    allowance,
    balance,
    executorNonce: BigInt(executorNonce),
    pending,
  };
}
