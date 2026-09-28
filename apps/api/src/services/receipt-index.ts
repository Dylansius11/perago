import {
  apexCommerceAbi,
  type Hash,
  hashSchema,
  outcomeEvaluatorAbi,
  type SettlementDeployment,
} from "@perago/sdk";
import type { Sql } from "postgres";
import {
  type Address,
  decodeEventLog,
  keccak256,
  type PublicClient,
  stringToHex,
  toEventSelector,
  toHex,
} from "viem";

import type { MandateRecordStatus } from "../executions/chain.js";
import { readFinalizedMandate } from "../executions/chain.js";
import type { ChainEventInput } from "../indexer/project-chain-events.js";
import {
  applyFinalizedEvents,
  rebuildMandateProjection,
} from "../indexer/project-chain-events.js";
import type { ExecutionServiceConfig } from "./executions.js";

type ReceiptStatus = MandateRecordStatus;

type CommerceEvent =
  | {
      name: "CommerceJobSettled";
      transactionHash: Hash;
      blockNumber: bigint;
      blockHash: Hash;
      logIndex: number;
      args: { commerceContract: Address; jobId: bigint; mandateHash: Hash };
    }
  | {
      name: "JobCompleted";
      transactionHash: Hash;
      blockNumber: bigint;
      blockHash: Hash;
      logIndex: number;
      args: { jobId: bigint; evaluator: Address };
    }
  | {
      name: "PaymentReleased";
      transactionHash: Hash;
      blockNumber: bigint;
      blockHash: Hash;
      logIndex: number;
      args: { jobId: bigint; provider: Address; amount: bigint };
    };

type CommerceJob = {
  id: bigint;
  client: Address;
  provider: Address;
  evaluator: Address;
  hook: Address;
  budget: bigint;
  status: number;
};

export type FinalizedCommerceState = {
  status: "CONFIRMED" | "UNPAID" | "PENDING" | "INELIGIBLE";
  settlementTxHash: Hash | null;
  evidence?: {
    transactionHash: Hash;
    blockNumber: string;
    blockHash: Hash;
    evaluatorLogIndex: number;
    completionLogIndex: number;
    paymentLogIndex: number;
    provider: Address;
    paymentToken: Address;
    amount: string;
  };
};

const sameAddress = (left: Address, right: Address) =>
  left.toLowerCase() === right.toLowerCase();

/** Rejects every incomplete, cross-transaction, or mismatched payout proof. */
export function projectFinalizedCommerce(
  settlement: SettlementDeployment,
  input: {
    receiptStatus: ReceiptStatus;
    mandateHash: Hash;
    account: Address;
    commerceContract: Address;
    jobId: bigint;
    settled: boolean;
    job: CommerceJob;
    paymentToken: Address;
    events: readonly CommerceEvent[];
  },
): FinalizedCommerceState {
  if (input.receiptStatus !== "SUCCEEDED")
    return { status: "INELIGIBLE", settlementTxHash: null };

  const matchesJob =
    input.job.id === input.jobId &&
    sameAddress(input.commerceContract, settlement.commerce.address) &&
    sameAddress(input.job.client, input.account) &&
    sameAddress(input.job.provider, settlement.provider) &&
    sameAddress(input.job.evaluator, settlement.evaluator.address) &&
    sameAddress(input.job.hook, settlement.hook.address) &&
    sameAddress(input.paymentToken, settlement.paymentToken.address) &&
    input.job.budget > 0n;
  if (!matchesJob) return { status: "PENDING", settlementTxHash: null };
  if (input.job.status === 4 || input.job.status === 5)
    return { status: "UNPAID", settlementTxHash: null };
  if (input.job.status !== 3 || !input.settled)
    return { status: "PENDING", settlementTxHash: null };

  const evaluatorEvent = input.events.find(
    (event): event is Extract<CommerceEvent, { name: "CommerceJobSettled" }> =>
      event.name === "CommerceJobSettled" &&
      sameAddress(event.args.commerceContract, input.commerceContract) &&
      event.args.jobId === input.jobId &&
      event.args.mandateHash.toLowerCase() === input.mandateHash.toLowerCase(),
  );
  if (!evaluatorEvent) return { status: "PENDING", settlementTxHash: null };
  const completion = input.events.find(
    (event): event is Extract<CommerceEvent, { name: "JobCompleted" }> =>
      event.name === "JobCompleted" &&
      event.transactionHash === evaluatorEvent.transactionHash &&
      event.args.jobId === input.jobId &&
      sameAddress(event.args.evaluator, settlement.evaluator.address),
  );
  const payment = input.events.find(
    (event): event is Extract<CommerceEvent, { name: "PaymentReleased" }> =>
      event.name === "PaymentReleased" &&
      event.transactionHash === evaluatorEvent.transactionHash &&
      event.args.jobId === input.jobId &&
      sameAddress(event.args.provider, settlement.provider) &&
      event.args.amount === input.job.budget,
  );
  if (
    !completion ||
    !payment ||
    completion.blockNumber !== evaluatorEvent.blockNumber ||
    payment.blockNumber !== evaluatorEvent.blockNumber ||
    completion.blockHash !== evaluatorEvent.blockHash ||
    payment.blockHash !== evaluatorEvent.blockHash ||
    completion.logIndex >= evaluatorEvent.logIndex ||
    payment.logIndex >= evaluatorEvent.logIndex
  ) {
    return { status: "PENDING", settlementTxHash: null };
  }

  return {
    status: "CONFIRMED",
    settlementTxHash: evaluatorEvent.transactionHash,
    evidence: {
      transactionHash: evaluatorEvent.transactionHash,
      blockNumber: evaluatorEvent.blockNumber.toString(),
      blockHash: evaluatorEvent.blockHash,
      evaluatorLogIndex: evaluatorEvent.logIndex,
      completionLogIndex: completion.logIndex,
      paymentLogIndex: payment.logIndex,
      provider: settlement.provider,
      paymentToken: settlement.paymentToken.address,
      amount: input.job.budget.toString(),
    },
  };
}

const commerceEventTopics: Record<string, true> = {
  [toEventSelector("CommerceJobSettled(address,uint256,bytes32)")]: true,
  [toEventSelector("JobCompleted(uint256,address,bytes32)")]: true,
  [toEventSelector("PaymentReleased(uint256,address,uint256)")]: true,
};

const implementationSlot = toHex(
  BigInt(keccak256(stringToHex("eip1967.proxy.implementation"))) - 1n,
  { size: 32 },
);

function finalizedEvent(
  log: {
    address: Address;
    blockHash: Hash | null;
    blockNumber: bigint | null;
    data: Hash | `0x${string}`;
    logIndex: number | null;
    topics: readonly Hash[];
    transactionHash: Hash | null;
  },
  decodedName: string,
  decodedArgs: Record<string, string>,
  observedAt: Date,
): ChainEventInput {
  if (
    log.blockHash === null ||
    log.blockNumber === null ||
    log.logIndex === null ||
    log.transactionHash === null
  ) {
    throw new Error("a finalized commerce log is missing its identity");
  }
  return {
    blockHash: Buffer.from(log.blockHash.slice(2), "hex"),
    blockNumber: log.blockNumber,
    contractAddress: Buffer.from(log.address.slice(2), "hex"),
    data: Buffer.from(log.data.slice(2), "hex"),
    decodedArgs,
    decodedName,
    logIndex: log.logIndex,
    observedAt,
    topic0: Buffer.from((log.topics[0] ?? "0x").slice(2), "hex"),
    topics: log.topics,
    transactionHash: Buffer.from(log.transactionHash.slice(2), "hex"),
  };
}

/**
 * Reads only finalized evaluator/APEX state and raw logs. It never decides to
 * pay and returns no confirmation unless every independent onchain witness agrees.
 */
export async function readFinalizedCommerceState(input: {
  client: PublicClient;
  settlement: SettlementDeployment;
  account: Address;
  receiptStatus: ReceiptStatus;
  commerceContract: Address;
  jobId: bigint;
  mandateExecutor: Address;
  mandateHash: Hash;
  priorSettlementTxHash?: Hash | null;
  fromBlock: bigint;
  finalizedBlock: bigint;
  observedAt: Date;
}): Promise<
  FinalizedCommerceState & { events: ChainEventInput[]; jobStatus: number }
> {
  const events: CommerceEvent[] = [];
  const rawEvents: ChainEventInput[] = [];
  const priorReceipt = input.priorSettlementTxHash
    ? await input.client.getTransactionReceipt({
        hash: input.priorSettlementTxHash,
      })
    : null;
  if (priorReceipt) {
    const canonical = await input.client.getBlock({
      blockNumber: priorReceipt.blockNumber,
    });
    if (
      priorReceipt.status !== "success" ||
      priorReceipt.blockNumber > input.finalizedBlock ||
      priorReceipt.transactionHash.toLowerCase() !==
        input.priorSettlementTxHash?.toLowerCase() ||
      canonical.hash !== priorReceipt.blockHash
    )
      throw new Error("previously confirmed commerce payout is not canonical");
  }
  let from =
    priorReceipt && priorReceipt.blockNumber < input.fromBlock
      ? priorReceipt.blockNumber
      : input.fromBlock;
  while (from <= input.finalizedBlock) {
    const prior =
      priorReceipt &&
      from === priorReceipt.blockNumber &&
      from < input.fromBlock;
    const to = prior
      ? from
      : from + 9n < input.finalizedBlock
        ? from + 9n
        : input.finalizedBlock;
    const [evaluatorLogs, commerceLogs] = prior
      ? [
          priorReceipt.logs.filter((log) =>
            sameAddress(log.address, input.settlement.evaluator.address),
          ),
          priorReceipt.logs.filter((log) =>
            sameAddress(log.address, input.settlement.commerce.address),
          ),
        ]
      : await Promise.all([
          input.client.getLogs({
            address: input.settlement.evaluator.address,
            fromBlock: from,
            toBlock: to,
          }),
          input.client.getLogs({
            address: input.settlement.commerce.address,
            fromBlock: from,
            toBlock: to,
          }),
        ]);
    for (const log of evaluatorLogs) {
      if (commerceEventTopics[log.topics[0] ?? ""] !== true) continue;
      const decoded = decodeEventLog({
        abi: outcomeEvaluatorAbi,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName !== "CommerceJobSettled") continue;
      const args = decoded.args as {
        commerceContract: Address;
        jobId: bigint;
        mandateHash: Hash;
      };
      if (
        !sameAddress(args.commerceContract, input.commerceContract) ||
        args.jobId !== input.jobId ||
        args.mandateHash.toLowerCase() !== input.mandateHash.toLowerCase()
      ) {
        continue;
      }
      if (
        log.blockHash === null ||
        log.blockNumber === null ||
        log.logIndex === null ||
        log.transactionHash === null
      ) {
        throw new Error("a finalized commerce log is missing its identity");
      }
      events.push({
        name: decoded.eventName,
        transactionHash: log.transactionHash,
        blockNumber: log.blockNumber,
        blockHash: log.blockHash,
        logIndex: log.logIndex,
        args,
      });
      rawEvents.push(
        finalizedEvent(
          log,
          decoded.eventName,
          {
            commerceContract: args.commerceContract,
            jobId: args.jobId.toString(),
            mandateHash: args.mandateHash,
          },
          input.observedAt,
        ),
      );
    }
    for (const log of commerceLogs) {
      if (commerceEventTopics[log.topics[0] ?? ""] !== true) continue;
      const decoded = decodeEventLog({
        abi: apexCommerceAbi,
        data: log.data,
        topics: log.topics,
      });
      if (
        decoded.eventName !== "JobCompleted" &&
        decoded.eventName !== "PaymentReleased"
      ) {
        continue;
      }
      if (
        log.blockHash === null ||
        log.blockNumber === null ||
        log.logIndex === null ||
        log.transactionHash === null
      ) {
        throw new Error("a finalized commerce log is missing its identity");
      }
      if (decoded.eventName === "JobCompleted") {
        const args = decoded.args as { jobId: bigint; evaluator: Address };
        if (args.jobId !== input.jobId) continue;
        events.push({
          name: decoded.eventName,
          transactionHash: log.transactionHash,
          blockNumber: log.blockNumber,
          blockHash: log.blockHash,
          logIndex: log.logIndex,
          args,
        });
        rawEvents.push(
          finalizedEvent(
            log,
            decoded.eventName,
            { jobId: args.jobId.toString(), evaluator: args.evaluator },
            input.observedAt,
          ),
        );
      } else {
        const args = decoded.args as {
          jobId: bigint;
          provider: Address;
          amount: bigint;
        };
        if (args.jobId !== input.jobId) continue;
        events.push({
          name: decoded.eventName,
          transactionHash: log.transactionHash,
          blockNumber: log.blockNumber,
          blockHash: log.blockHash,
          logIndex: log.logIndex,
          args,
        });
        rawEvents.push(
          finalizedEvent(
            log,
            decoded.eventName,
            {
              jobId: args.jobId.toString(),
              provider: args.provider,
              amount: args.amount.toString(),
            },
            input.observedAt,
          ),
        );
      }
    }
    from = prior ? input.fromBlock : to + 1n;
  }
  for (const target of [
    input.settlement.evaluator,
    input.settlement.commerce,
    input.settlement.paymentToken,
    input.settlement.hook,
  ]) {
    const code = await input.client.getCode({
      address: target.address,
      blockNumber: input.finalizedBlock,
    });
    if (!code || keccak256(code) !== target.codeHash)
      throw new Error("finalized commerce deployment code hash changed");
  }
  for (const proxy of [
    input.settlement.commerce,
    input.settlement.paymentToken,
  ]) {
    const implementation = await input.client.getStorageAt({
      address: proxy.address,
      blockNumber: input.finalizedBlock,
      slot: implementationSlot,
    });
    if (
      !implementation ||
      BigInt(implementation) !== BigInt(proxy.implementation)
    )
      throw new Error("finalized commerce proxy implementation changed");
    const code = await input.client.getCode({
      address: proxy.implementation,
      blockNumber: input.finalizedBlock,
    });
    if (!code || keccak256(code) !== proxy.implementationCodeHash)
      throw new Error("finalized commerce implementation code hash changed");
  }
  for (const [functionName, expected] of [
    ["executor", input.mandateExecutor],
    ["commerce", input.settlement.commerce.address],
    ["provider", input.settlement.provider],
    ["hook", input.settlement.hook.address],
    ["paymentToken", input.settlement.paymentToken.address],
  ] as const) {
    const actual = await input.client.readContract({
      abi: outcomeEvaluatorAbi,
      address: input.settlement.evaluator.address,
      blockNumber: input.finalizedBlock,
      functionName,
    });
    if (actual.toLowerCase() !== expected.toLowerCase())
      throw new Error(`finalized commerce evaluator ${functionName} changed`);
  }
  const [settled, job, paymentToken] = await Promise.all([
    input.client.readContract({
      abi: outcomeEvaluatorAbi,
      address: input.settlement.evaluator.address,
      args: [input.commerceContract, input.jobId],
      blockNumber: input.finalizedBlock,
      functionName: "settled",
    }),
    input.client.readContract({
      abi: apexCommerceAbi,
      address: input.settlement.commerce.address,
      args: [input.jobId],
      blockNumber: input.finalizedBlock,
      functionName: "getJob",
    }),
    input.client.readContract({
      abi: apexCommerceAbi,
      address: input.settlement.commerce.address,
      args: [input.jobId],
      blockNumber: input.finalizedBlock,
      functionName: "jobPaymentToken",
    }),
  ]);
  return {
    ...projectFinalizedCommerce(input.settlement, {
      receiptStatus: input.receiptStatus,
      mandateHash: input.mandateHash,
      account: input.account,
      commerceContract: input.commerceContract,
      jobId: input.jobId,
      settled,
      job: job as CommerceJob,
      paymentToken,
      events,
    }),
    events: rawEvents,
    jobStatus: job.status,
  };
}

const buffer = (hash: Hash) => Buffer.from(hash.slice(2), "hex");
const stream = (hash: Hash) => `mandate:${hash.toLowerCase()}`;
const commerceStream = (hash: Hash) => `commerce:${hash.toLowerCase()}`;
/** Independently reconcile the public read path, including after the worker exits. */
export async function indexFinalizedReceipt(
  sql: Sql,
  config: ExecutionServiceConfig,
  inputHash: string,
): Promise<{
  recordStatus: MandateRecordStatus;
  verificationHash: Hash;
  failureReasonHash: Hash;
  commerce: FinalizedCommerceState | null;
} | null> {
  const mandateHash = hashSchema.parse(inputHash);
  const key = buffer(mandateHash);
  const [source] = await sql<
    {
      chain_id: string;
      mandate_executor_address: Buffer;
      account_address: Buffer;
      erc8183_contract: Buffer | null;
      erc8183_job_id: string | null;
      settlement_tx_hash: Buffer | null;
      from_block: string;
      commerce_from_block: string;
    }[]
  >`
    select m.chain_id::text, m.mandate_executor_address, m.account_address,
      m.erc8183_contract, m.erc8183_job_id::text, r.settlement_tx_hash,
      coalesce(c.next_block_number, s.block_number)::text as from_block,
      coalesce(cc.next_block_number, s.block_number)::text as commerce_from_block
    from mandates m
    join simulations s on s.id = m.simulation_id
    left join execution_receipts r on r.mandate_hash = m.mandate_hash
    left join indexer_checkpoints c on c.chain_id = m.chain_id
      and c.stream_name = ${stream(mandateHash)}
    left join indexer_checkpoints cc on cc.chain_id = m.chain_id
      and cc.stream_name = ${commerceStream(mandateHash)}
    where m.mandate_hash = ${key}
  `;
  if (!source) return null;
  const { deployment, client } = config;
  if (
    source.chain_id !== String(deployment.chainId) ||
    !source.mandate_executor_address.equals(
      buffer(deployment.mandateExecutor.address),
    )
  ) {
    throw new Error("receipt mandate does not match this API deployment");
  }
  const scan = await readFinalizedMandate({
    client,
    fromBlock: BigInt(source.from_block),
    mandateExecutor: deployment.mandateExecutor.address,
    mandateHash,
    now: new Date(),
  });
  const commerceScan =
    source.erc8183_contract === null ||
    source.erc8183_job_id === null ||
    !deployment.settlement ||
    !source.erc8183_contract.equals(
      buffer(deployment.settlement.commerce.address),
    )
      ? null
      : await readFinalizedCommerceState({
          client,
          settlement: deployment.settlement,
          receiptStatus: scan.recordStatus,
          mandateExecutor: deployment.mandateExecutor.address,
          account: `0x${source.account_address.toString("hex")}` as Address,
          commerceContract:
            `0x${source.erc8183_contract.toString("hex")}` as Address,
          jobId: BigInt(source.erc8183_job_id),
          mandateHash,
          priorSettlementTxHash:
            source.settlement_tx_hash === null
              ? null
              : (`0x${source.settlement_tx_hash.toString("hex")}` as Hash),
          fromBlock: BigInt(source.commerce_from_block),
          finalizedBlock: scan.finalized.number,
          observedAt: new Date(),
        });
  const commerce: FinalizedCommerceState | null =
    source.erc8183_contract === null || source.erc8183_job_id === null
      ? null
      : (commerceScan ?? {
          status: scan.recordStatus === "SUCCEEDED" ? "PENDING" : "INELIGIBLE",
          settlementTxHash: null,
        });
  await sql.begin(async (tx) => {
    // The worker and public reads share a cursor. Never commit an older RPC
    // snapshot over a newer finalized checkpoint.
    const [checkpoint] = await tx<{ next_block_number: string }[]>`
      select next_block_number::text from indexer_checkpoints
      where chain_id = ${source.chain_id} and stream_name = ${stream(mandateHash)}
      for update
    `;
    const [commerceCheckpoint] = await tx<{ next_block_number: string }[]>`
      select next_block_number::text from indexer_checkpoints
      where chain_id = ${source.chain_id}
        and stream_name = ${commerceStream(mandateHash)}
      for update
    `;
    if (
      checkpoint &&
      BigInt(checkpoint.next_block_number) !== BigInt(source.from_block)
    ) {
      throw new Error("receipt index advanced during finalized read");
    }
    if (
      commerceScan !== null &&
      commerceCheckpoint &&
      BigInt(commerceCheckpoint.next_block_number) !==
        BigInt(source.commerce_from_block)
    ) {
      throw new Error("commerce receipt index advanced during finalized read");
    }
    await applyFinalizedEvents(tx, BigInt(source.chain_id), scan.events);
    if (commerceScan !== null) {
      await applyFinalizedEvents(
        tx,
        BigInt(source.chain_id),
        commerceScan.events,
      );
    }
    const [cached] = await tx<{ status: string }[]>`
      select status from mandates where mandate_hash = ${key} for update
    `;
    if (!cached) throw new Error("receipt mandate disappeared during indexing");
    if (
      ["SUCCEEDED", "FAILED", "REVOKED", "EXPIRED"].includes(scan.recordStatus)
    ) {
      const [receipt] = await tx`
        select mandate_hash from execution_receipts where mandate_hash = ${key}
      `;
      if (!receipt) await rebuildMandateProjection(tx, key);
    }
    if (
      commerce?.status === "CONFIRMED" &&
      commerce.settlementTxHash !== null
    ) {
      const settlementTxHash = commerce.settlementTxHash;
      const updated = await tx`
        update execution_receipts
        set settlement_tx_hash = ${buffer(settlementTxHash)}
        where mandate_hash = ${key} and settlement_tx_hash is null
        returning settlement_tx_hash
      `;
      if (updated.count === 0) {
        const [receipt] = await tx<{ settlement_tx_hash: Buffer }[]>`
          select settlement_tx_hash from execution_receipts where mandate_hash = ${key}
        `;
        if (!receipt?.settlement_tx_hash.equals(buffer(settlementTxHash))) {
          throw new Error("receipt already records a different settlement");
        }
      }
    }
    const [projected] = await tx<{ status: string }[]>`
      select status from mandates where mandate_hash = ${key}
    `;
    if (
      (projected?.status === "SIGNED" ? "NONE" : projected?.status) !==
      scan.recordStatus
    ) {
      throw new Error(
        "public receipt projection disagrees with finalized mandate",
      );
    }
    await tx`
      insert into indexer_checkpoints (
        chain_id, stream_name, next_block_number, last_canonical_block_hash, confirmation_depth
      ) values (
        ${source.chain_id}, ${stream(mandateHash)}, ${(scan.finalized.number + 1n).toString()},
        ${buffer(scan.finalized.hash)}, 1
      ) on conflict (chain_id, stream_name) do update set
        next_block_number = greatest(indexer_checkpoints.next_block_number, excluded.next_block_number),
        last_canonical_block_hash = case
          when excluded.next_block_number > indexer_checkpoints.next_block_number
          then excluded.last_canonical_block_hash
          else indexer_checkpoints.last_canonical_block_hash
        end,
        updated_at = now()
    `;
    if (commerceScan !== null) {
      await tx`
        insert into indexer_checkpoints (
          chain_id, stream_name, next_block_number, last_canonical_block_hash,
          confirmation_depth
        ) values (
          ${source.chain_id}, ${commerceStream(mandateHash)},
          ${(scan.finalized.number + 1n).toString()}, ${buffer(scan.finalized.hash)}, 1
        ) on conflict (chain_id, stream_name) do update set
          next_block_number = greatest(
            indexer_checkpoints.next_block_number, excluded.next_block_number
          ),
          last_canonical_block_hash = case
            when excluded.next_block_number > indexer_checkpoints.next_block_number
            then excluded.last_canonical_block_hash
            else indexer_checkpoints.last_canonical_block_hash
          end,
          updated_at = now()
      `;
    }
  });
  return {
    recordStatus: scan.recordStatus,
    verificationHash: scan.verificationHash,
    failureReasonHash: scan.failureReasonHash,
    commerce,
  };
}
