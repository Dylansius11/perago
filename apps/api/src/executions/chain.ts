import { type Hash, mandateExecutorAbi } from "@perago/sdk";
import {
  type Address,
  decodeEventLog,
  type Log,
  type PublicClient,
  toEventSelector,
} from "viem";

import type { ChainEventInput } from "../indexer/project-chain-events.js";

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

/** Lifecycle events that index the mandate hash as their first topic. */
const LIFECYCLE_TOPICS = new Set<string>([
  toEventSelector("MandateAuthorized(bytes32,address,address,uint256,uint48)"),
  toEventSelector("ExecutionBegun(bytes32,uint48)"),
  toEventSelector("MandateRevoked(bytes32,address)"),
  toEventSelector("MandateExpired(bytes32)"),
  toEventSelector("ExecutionReceiptRecorded(bytes32,uint8,bytes32,bytes32)"),
]);

/**
 * Widest `eth_getLogs` range requested at once. Alchemy's free tier serves at
 * most 10 blocks per request on chain 97; a paid tier only makes this cheaper.
 */
export const LOG_RANGE_BLOCKS = 10n;

type JsonScalar = string | number | boolean | null;
type JsonValue = JsonScalar | JsonValue[] | { [key: string]: JsonValue };

function jsonValue(value: unknown): JsonValue {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return value.toLowerCase();
  if (typeof value === "number" || typeof value === "boolean" || value === null)
    return value;
  if (Array.isArray(value)) return value.map(jsonValue);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => Number.isNaN(Number(key)))
        .map(([key, entry]) => [key, jsonValue(entry)]),
    );
  }
  throw new TypeError(`cannot project a ${typeof value} event argument`);
}

function asBuffer(value: string | null): Buffer {
  if (value === null)
    throw new Error("a finalized log is missing its block or transaction");
  return Buffer.from(value.slice(2), "hex");
}

function toEvent(log: Log, observedAt: Date): ChainEventInput {
  const decoded = decodeEventLog({
    abi: mandateExecutorAbi,
    data: log.data,
    topics: log.topics,
  });
  const args = jsonValue(decoded.args);
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    throw new TypeError("decoded event arguments must be an object");
  }
  if (decoded.eventName === "ExecutionReceiptRecorded") {
    const name = MANDATE_RECORD_STATUSES[Number(decoded.args.status)];
    if (!name) throw new Error("unknown receipt status");
    args.status = name;
  }
  if (log.logIndex === null || log.blockNumber === null) {
    throw new Error("a finalized log is missing its position");
  }
  return {
    blockHash: asBuffer(log.blockHash),
    blockNumber: log.blockNumber,
    contractAddress: asBuffer(log.address),
    data: asBuffer(log.data),
    decodedArgs: args,
    decodedName: decoded.eventName,
    logIndex: log.logIndex,
    observedAt,
    topic0: asBuffer(log.topics[0] ?? null),
    topics: log.topics,
    transactionHash: asBuffer(log.transactionHash),
  };
}

/**
 * A verified direct read at the chain's `finalized` block: the mandate's
 * lifecycle logs from `fromBlock` onward, scanned in bounded ranges, and the
 * mandate record MandateExecutor itself stores at that block. Finalized blocks
 * cannot reorg, so the caller may project these without an indexer checkpoint
 * of canonical ancestry; it must still check the projection against
 * `recordStatus`.
 */
export async function readFinalizedMandate(input: {
  client: PublicClient;
  mandateExecutor: Address;
  mandateHash: Hash;
  fromBlock: bigint;
  now: Date;
}): Promise<{
  finalized: { hash: Hash; number: bigint };
  events: ChainEventInput[];
  recordStatus: MandateRecordStatus;
  verificationHash: Hash;
  failureReasonHash: Hash;
}> {
  const finalized = await input.client.getBlock({ blockTag: "finalized" });
  const events: ChainEventInput[] = [];
  for (
    let from = input.fromBlock;
    from <= finalized.number;
    from += LOG_RANGE_BLOCKS
  ) {
    const to =
      from + LOG_RANGE_BLOCKS - 1n < finalized.number
        ? from + LOG_RANGE_BLOCKS - 1n
        : finalized.number;
    const logs = await input.client.getLogs({
      address: input.mandateExecutor,
      fromBlock: from,
      toBlock: to,
    });
    for (const log of logs) {
      const [topic0, topic1] = log.topics;
      if (
        topic0 &&
        LIFECYCLE_TOPICS.has(topic0) &&
        topic1?.toLowerCase() === input.mandateHash
      ) {
        events.push(toEvent(log, input.now));
      }
    }
  }
  const record = await input.client.readContract({
    abi: mandateExecutorAbi,
    address: input.mandateExecutor,
    args: [input.mandateHash],
    blockNumber: finalized.number,
    functionName: "mandateRecord",
  });
  const recordStatus = MANDATE_RECORD_STATUSES[record.status];
  if (!recordStatus) throw new Error("unknown mandate record status");
  return {
    events,
    finalized: { hash: finalized.hash, number: finalized.number },
    recordStatus,
    verificationHash: record.verificationHash,
    failureReasonHash: record.failureReasonHash,
  };
}
