import { signedMandateDocumentSchema } from "@perago/sdk";

import type { JSONValue, Sql, TransactionSql } from "postgres";

export interface ChainEventInput {
  transactionHash: Buffer;
  logIndex: number;
  blockNumber: bigint;
  blockHash: Buffer;
  contractAddress: Buffer;
  topic0: Buffer;
  topics: readonly string[];
  data: Buffer;
  decodedName: string | null;
  decodedArgs: Record<string, JSONValue> | null;
  observedAt: Date;
}

export interface ChainEventBatch {
  chainId: bigint;
  streamName: string;
  fromBlockNumber: bigint;
  nextBlockNumber: bigint;
  parentBlockHash: Buffer;
  lastCanonicalBlockHash: Buffer;
  confirmationDepth: number;
  events: readonly ChainEventInput[];
}

export interface ChainEventBatchResult {
  inserted: number;
  duplicates: number;
  orphaned: number;
}

const terminalEventNames: Record<string, true> = {
  MandateRevoked: true,
  MandateExpired: true,
  ExecutionReceiptRecorded: true,
};

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return Buffer.from(left).equals(Buffer.from(right));
}

function decodeHex(value: unknown, bytes: number, field: string): Buffer {
  if (
    typeof value !== "string" ||
    !new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`).test(value)
  ) {
    throw new TypeError(`${field} must be a ${bytes}-byte hex value`);
  }
  return Buffer.from(value.slice(2), "hex");
}

function mandateHashFromArgs(
  args: Record<string, JSONValue> | null,
): Buffer | null {
  if (args === null || !("mandateHash" in args)) return null;
  return decodeHex(args.mandateHash, 32, "decodedArgs.mandateHash");
}

function terminalStatus(
  decodedName: string,
  decodedArgs: Record<string, JSONValue> | null,
): "SUCCEEDED" | "FAILED" | "REVOKED" | "EXPIRED" | null {
  if (decodedName === "MandateRevoked") return "REVOKED";
  if (decodedName === "MandateExpired") return "EXPIRED";
  if (decodedName !== "ExecutionReceiptRecorded") return null;
  const status = decodedArgs?.status;
  if (status === "SUCCEEDED" || status === "FAILED") return status;
  throw new TypeError(
    "ExecutionReceiptRecorded status must be SUCCEEDED or FAILED",
  );
}

function validateBatch(batch: ChainEventBatch): void {
  if (batch.confirmationDepth <= 0)
    throw new RangeError("confirmationDepth must be positive");
  if (batch.nextBlockNumber <= batch.fromBlockNumber) {
    throw new RangeError("nextBlockNumber must follow fromBlockNumber");
  }
  for (const event of batch.events) {
    if (
      event.blockNumber < batch.fromBlockNumber ||
      event.blockNumber >= batch.nextBlockNumber
    ) {
      throw new RangeError("event block lies outside the committed batch");
    }
    if (event.transactionHash.length !== 32 || event.blockHash.length !== 32) {
      throw new RangeError(
        "event transaction and block hashes must be 32 bytes",
      );
    }
    if (event.contractAddress.length !== 20 || event.topic0.length !== 32) {
      throw new RangeError(
        "event contract address or topic0 has the wrong width",
      );
    }
    if (
      event.decodedName !== null &&
      mandateHashFromArgs(event.decodedArgs) === null
    ) {
      throw new TypeError("decoded lifecycle events require mandateHash");
    }
  }
}

type ProjectionEvent = {
  transaction_hash: Buffer;
  block_number: string;
  decoded_name: string | null;
  decoded_args: Record<string, JSONValue> | null;
  observed_at: Date;
};

type ReceiptMaterial = {
  policy_hash: Buffer;
  intent_hash: Buffer;
  plan_hash: Buffer | null;
  simulation_hash: Buffer;
  typed_data: unknown;
  authorize_tx_hash: Buffer | null;
  erc8183_contract: Buffer | null;
  erc8183_job_id: string | null;
};

async function writeReceipt(
  tx: TransactionSql,
  mandateHash: Buffer,
  event: ProjectionEvent,
  status: "SUCCEEDED" | "FAILED" | "REVOKED" | "EXPIRED",
): Promise<void> {
  const [material] = await tx<ReceiptMaterial[]>`
    select
      wp.policy_hash, t.intent_hash, t.plan_hash, s.simulation_hash,
      m.typed_data, m.authorize_tx_hash, m.erc8183_contract,
      m.erc8183_job_id::text
    from mandates m
    join wallet_policies wp on wp.id = m.wallet_policy_id
    join tasks t on t.id = m.task_id
    join simulations s on s.id = m.simulation_id
    where m.mandate_hash = ${mandateHash}
  `;
  if (
    !material ||
    material.plan_hash === null ||
    material.authorize_tx_hash === null
  ) {
    throw new Error(
      "terminal receipt projection requires complete signed mandate evidence",
    );
  }

  const message = signedMandateDocumentSchema.parse(
    material.typed_data,
  ).message;
  const actionHash = decodeHex(
    message.actionHash,
    32,
    "typed_data.message.actionHash",
  );
  const postconditionHash = decodeHex(
    message.postconditionHash,
    32,
    "typed_data.message.postconditionHash",
  );
  const recordsExecution = status === "SUCCEEDED" || status === "FAILED";
  const verificationHash = recordsExecution
    ? decodeHex(
        event.decoded_args?.verificationHash,
        32,
        "decodedArgs.verificationHash",
      )
    : null;
  const executionTxHash = recordsExecution ? event.transaction_hash : null;

  await tx`
    insert into execution_receipts (
      mandate_hash, status, policy_hash, intent_hash, plan_hash, simulation_hash,
      action_hash, postcondition_hash, verification_hash, authority_consumed,
      authorize_tx_hash, execution_tx_hash, erc8183_contract, erc8183_job_id,
      terminal_block_number, terminal_at
    ) values (
      ${mandateHash}, ${status}, ${material.policy_hash}, ${material.intent_hash},
      ${material.plan_hash}, ${material.simulation_hash}, ${actionHash},
      ${postconditionHash}, ${verificationHash}, true, ${material.authorize_tx_hash},
      ${executionTxHash}, ${material.erc8183_contract}, ${material.erc8183_job_id},
      ${event.block_number}, ${event.observed_at}
    )
  `;
}

async function rebuildMandateProjection(
  tx: TransactionSql,
  mandateHash: Buffer,
): Promise<void> {
  const [mandate] = await tx<{ exists: boolean }[]>`
    select true as exists from mandates where mandate_hash = ${mandateHash}
  `;
  if (!mandate) {
    throw new Error(
      `chain event references unknown mandate 0x${mandateHash.toString("hex")}`,
    );
  }

  await tx`delete from execution_receipts where mandate_hash = ${mandateHash}`;
  await tx`
    update mandates
    set status = 'SIGNED', authorize_tx_hash = null, authorized_at = null,
        terminal_tx_hash = null, terminal_reason_code = null, terminal_at = null
    where mandate_hash = ${mandateHash}
  `;

  const events = await tx<ProjectionEvent[]>`
    select transaction_hash, block_number::text, decoded_name, decoded_args, observed_at
    from chain_events
    where status = 'CONFIRMED'
      and decoded_args->>'mandateHash' = ${`0x${mandateHash.toString("hex")}`}
    order by block_number, log_index
  `;

  for (const event of events) {
    if (event.decoded_name === "MandateAuthorized") {
      await tx`
        update mandates
        set status = 'AUTHORIZED', authorize_tx_hash = ${event.transaction_hash},
            authorized_at = ${event.observed_at}
        where mandate_hash = ${mandateHash}
      `;
      continue;
    }
    if (event.decoded_name === "ExecutionBegun") {
      await tx`update mandates set status = 'EXECUTING' where mandate_hash = ${mandateHash}`;
      continue;
    }
    if (
      event.decoded_name === null ||
      !(event.decoded_name in terminalEventNames)
    )
      continue;

    const status = terminalStatus(event.decoded_name, event.decoded_args);
    if (status === null) continue;
    await tx`
      update mandates
      set status = ${status}, terminal_tx_hash = ${event.transaction_hash},
          terminal_reason_code = ${`ONCHAIN_${status}`}, terminal_at = ${event.observed_at}
      where mandate_hash = ${mandateHash}
    `;
    await writeReceipt(tx, mandateHash, event, status);
  }
}

async function insertConfirmedEvents(
  tx: TransactionSql,
  chainId: bigint,
  events: readonly ChainEventInput[],
  affectedMandates: Map<string, Buffer>,
): Promise<number> {
  let inserted = 0;
  for (const event of events) {
    const rows = await tx`
      insert into chain_events (
        chain_id, transaction_hash, log_index, block_number, block_hash,
        contract_address, topic0, topics, data, decoded_name, decoded_args,
        status, observed_at, confirmed_at
      ) values (
        ${chainId.toString()}, ${event.transactionHash}, ${event.logIndex},
        ${event.blockNumber.toString()}, ${event.blockHash}, ${event.contractAddress},
        ${event.topic0}, ${tx.json([...event.topics])}, ${event.data}, ${event.decodedName},
        ${event.decodedArgs === null ? null : tx.json(event.decodedArgs)},
        'CONFIRMED', ${event.observedAt}, ${event.observedAt}
      )
      on conflict (chain_id, transaction_hash, log_index) do nothing
      returning transaction_hash
    `;
    inserted += rows.count;
    const mandateHash = mandateHashFromArgs(event.decodedArgs);
    if (mandateHash)
      affectedMandates.set(mandateHash.toString("hex"), mandateHash);
  }
  return inserted;
}

async function rebuildAffectedMandates(
  tx: TransactionSql,
  mandates: Iterable<Buffer>,
): Promise<void> {
  for (const mandateHash of mandates)
    await rebuildMandateProjection(tx, mandateHash);
}

/**
 * Events fetched at `finalized` cannot reorg, so this path deliberately writes
 * no indexer checkpoint.
 */
export async function applyFinalizedEvents(
  tx: TransactionSql,
  chainId: bigint,
  events: readonly ChainEventInput[],
): Promise<{ inserted: number }> {
  const affectedMandates = new Map<string, Buffer>();
  const inserted = await insertConfirmedEvents(
    tx,
    chainId,
    events,
    affectedMandates,
  );
  await rebuildAffectedMandates(tx, affectedMandates.values());
  return { inserted };
}

async function batchAlreadyCanonical(
  tx: TransactionSql,
  batch: ChainEventBatch,
): Promise<boolean> {
  if (batch.events.length === 0) return false;
  for (const event of batch.events) {
    const [existing] = await tx<{ block_hash: Buffer }[]>`
      select block_hash
      from chain_events
      where chain_id = ${batch.chainId.toString()}
        and transaction_hash = ${event.transactionHash}
        and log_index = ${event.logIndex}
        and status = 'CONFIRMED'
    `;
    if (!existing || !equalBytes(existing.block_hash, event.blockHash))
      return false;
  }
  return true;
}

export async function applyChainEventBatch(
  sql: Sql,
  batch: ChainEventBatch,
): Promise<ChainEventBatchResult> {
  validateBatch(batch);

  return sql.begin(async (tx) => {
    const [checkpoint] = await tx<
      { next_block_number: string; last_canonical_block_hash: Buffer }[]
    >`
      select next_block_number::text, last_canonical_block_hash
      from indexer_checkpoints
      where chain_id = ${batch.chainId.toString()} and stream_name = ${batch.streamName}
      for update
    `;

    if (checkpoint && (await batchAlreadyCanonical(tx, batch))) {
      return { inserted: 0, duplicates: batch.events.length, orphaned: 0 };
    }

    let orphaned = 0;
    const affectedMandates = new Map<string, Buffer>();
    if (checkpoint) {
      const isAppend =
        BigInt(checkpoint.next_block_number) === batch.fromBlockNumber &&
        equalBytes(checkpoint.last_canonical_block_hash, batch.parentBlockHash);
      if (!isAppend) {
        const [ancestor] = await tx<{ exists: boolean }[]>`
          select true as exists
          from chain_events
          where chain_id = ${batch.chainId.toString()}
            and block_number = ${(batch.fromBlockNumber - 1n).toString()}
            and block_hash = ${batch.parentBlockHash}
            and status = 'CONFIRMED'
          limit 1
        `;
        if (!ancestor)
          throw new Error(
            "reorg batch does not identify a stored canonical parent",
          );

        const replaced = await tx<
          { decoded_args: Record<string, JSONValue> | null }[]
        >`
          select decoded_args
          from chain_events
          where chain_id = ${batch.chainId.toString()}
            and block_number >= ${batch.fromBlockNumber.toString()}
            and status = 'CONFIRMED'
        `;
        for (const event of replaced) {
          const mandateHash = mandateHashFromArgs(event.decoded_args);
          if (mandateHash)
            affectedMandates.set(mandateHash.toString("hex"), mandateHash);
        }
        const updated = await tx`
          update chain_events
          set status = 'ORPHANED', orphaned_at = now()
          where chain_id = ${batch.chainId.toString()}
            and block_number >= ${batch.fromBlockNumber.toString()}
            and status = 'CONFIRMED'
          returning transaction_hash
        `;
        orphaned = updated.count;
      }
    }

    const inserted = await insertConfirmedEvents(
      tx,
      batch.chainId,
      batch.events,
      affectedMandates,
    );

    await tx`
      insert into indexer_checkpoints (
        chain_id, stream_name, next_block_number, last_canonical_block_hash,
        confirmation_depth, updated_at
      ) values (
        ${batch.chainId.toString()}, ${batch.streamName}, ${batch.nextBlockNumber.toString()},
        ${batch.lastCanonicalBlockHash}, ${batch.confirmationDepth}, now()
      )
      on conflict (chain_id, stream_name) do update set
        next_block_number = excluded.next_block_number,
        last_canonical_block_hash = excluded.last_canonical_block_hash,
        confirmation_depth = excluded.confirmation_depth,
        updated_at = excluded.updated_at
    `;

    await rebuildAffectedMandates(tx, affectedMandates.values());

    return {
      inserted,
      duplicates: batch.events.length - inserted,
      orphaned,
    };
  });
}
