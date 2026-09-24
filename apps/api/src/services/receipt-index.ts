import { type Hash, hashSchema } from "@perago/sdk";
import type { Sql } from "postgres";

import { readFinalizedMandate } from "../executions/chain.js";
import {
  applyFinalizedEvents,
  rebuildMandateProjection,
} from "../indexer/project-chain-events.js";
import type { ExecutionServiceConfig } from "./executions.js";

const buffer = (hash: Hash) => Buffer.from(hash.slice(2), "hex");
const stream = (hash: Hash) => `mandate:${hash.toLowerCase()}`;

/** Independently reconcile the public read path, including after the worker exits. */
export async function indexFinalizedReceipt(
  sql: Sql,
  config: ExecutionServiceConfig,
  inputHash: string,
): Promise<boolean> {
  const mandateHash = hashSchema.parse(inputHash).toLowerCase() as Hash;
  const key = buffer(mandateHash);
  const [source] = await sql<
    {
      chain_id: string;
      mandate_executor_address: Buffer;
      from_block: string;
    }[]
  >`
    select m.chain_id::text, m.mandate_executor_address,
      coalesce(c.next_block_number, s.block_number)::text as from_block
    from mandates m
    join simulations s on s.id = m.simulation_id
    left join indexer_checkpoints c on c.chain_id = m.chain_id
      and c.stream_name = ${stream(mandateHash)}
    where m.mandate_hash = ${key}
  `;
  if (!source) return false;
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
  await sql.begin(async (tx) => {
    // The worker and public reads share a cursor. Never commit an older RPC
    // snapshot over a newer finalized checkpoint.
    const [checkpoint] = await tx<{ next_block_number: string }[]>`
      select next_block_number::text from indexer_checkpoints
      where chain_id = ${source.chain_id} and stream_name = ${stream(mandateHash)}
      for update
    `;
    if (
      checkpoint &&
      BigInt(checkpoint.next_block_number) !== BigInt(source.from_block)
    ) {
      throw new Error("receipt index advanced during finalized read");
    }
    await applyFinalizedEvents(tx, BigInt(source.chain_id), scan.events);
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
  });
  return true;
}
