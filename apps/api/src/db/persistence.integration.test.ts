import { readFile } from "node:fs/promises";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  applyChainEventBatch,
  type ChainEventInput,
} from "../indexer/project-chain-events.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "TEST_DATABASE_URL is required for database integration tests",
  );
}

const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
const migrations = [
  new URL("../../drizzle/0000_constrained_lifecycle.sql", import.meta.url),
  new URL("../../drizzle/0004_execution_worker.sql", import.meta.url),
];

const id = (value: number) =>
  `00000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;
const bytes = (value: number, length: number) => Buffer.alloc(length, value);
const hex = (value: Uint8Array) => `0x${Buffer.from(value).toString("hex")}`;

async function seedMandate(
  db: Sql,
  seed: number,
  options: {
    authoritySeed?: number;
    nonce?: bigint;
    commerceContract?: Buffer | null;
    commerceJobId?: bigint | null;
    status?: "SIGNED" | "SUCCEEDED";
    terminal?: boolean;
  } = {},
) {
  const authoritySeed = options.authoritySeed ?? seed;
  const walletId = id(authoritySeed * 10 + 1);
  const policyId = id(authoritySeed * 10 + 2);
  const adapterId = id(authoritySeed * 10 + 3);
  const taskId = id(seed * 10 + 4);
  const simulationId = id(seed * 10 + 5);
  const mandateHash = bytes(seed, 32);
  const accountAddress = bytes(authoritySeed, 20);
  const rootOwnerAddress = bytes(authoritySeed + 1, 20);
  const adapterAddress = bytes(authoritySeed + 2, 20);
  const policyHash = bytes(authoritySeed + 4, 32);
  const intentHash = bytes(seed + 9, 32);
  const planHash = bytes(seed + 15, 32);
  const simulationHash = bytes(seed + 11, 32);
  const actionHash = bytes(seed + 16, 32);
  const postconditionHash = bytes(seed + 17, 32);

  if (authoritySeed === seed) {
    await db`
      insert into wallets (
        id, chain_id, account_address, root_owner_address, account_type,
        account_version, entry_point_address, owner_epoch
      ) values (
        ${walletId}, 97, ${accountAddress}, ${rootOwnerAddress},
        'ALCHEMY_MODULAR_V2', '1', ${bytes(authoritySeed + 3, 20)}, 0
      )
    `;
    await db`
      insert into wallet_policies (
        id, wallet_id, version, schema_version, status, policy_document, policy_hash
      ) values (
        ${policyId}, ${walletId}, 1, '1', 'DRAFT', ${sql.json({ version: 1 })}, ${policyHash}
      )
    `;
    await db`
      insert into protocol_adapters (
        id, chain_id, kind, slug, status, adapter_address, adapter_code_hash,
        verifier_id, protocol_name, protocol_target_address, entry_selector,
        config_document, source_url
      ) values (
        ${adapterId}, 97, 'SWAP', ${`swap-${authoritySeed}`}, 'PROPOSED',
        ${adapterAddress}, ${bytes(authoritySeed + 5, 32)},
        ${bytes(authoritySeed + 6, 32)}, 'Test Protocol',
        ${bytes(authoritySeed + 7, 20)}, ${bytes(authoritySeed + 8, 4)},
        ${sql.json({})}, 'https://example.test/source'
      )
    `;
  }

  await db`
    insert into tasks (
      id, wallet_id, wallet_policy_id, client_request_id, status,
      intent_hash, intent_document, compiled_plan, plan_hash, compiler_version,
      policy_decision, policy_decision_hash
    ) values (
      ${taskId}, ${walletId}, ${policyId}, ${`request-${seed}`}, 'DRAFT',
      ${intentHash}, ${sql.json({ action: "SWAP" })}, ${sql.json({ action: "SWAP" })},
      ${planHash}, 'test-1', ${sql.json({ passed: true })}, ${bytes(seed + 18, 32)}
    )
  `;
  await db`
    insert into simulations (
      id, task_id, adapter_id, sequence, status, chain_id, block_number,
      block_hash, adapter_code_hash, quote_expires_at, request_document,
      result_document, simulation_hash
    ) values (
      ${simulationId}, ${taskId}, ${adapterId}, 1, 'PASSED', 97, 1,
      ${bytes(seed + 10, 32)}, ${bytes(authoritySeed + 5, 32)},
      now() + interval '1 hour', ${sql.json({})}, ${sql.json({})}, ${simulationHash}
    )
  `;

  const terminal = options.terminal ?? false;
  await db`
    insert into mandates (
      mandate_hash, task_id, simulation_id, wallet_id, wallet_policy_id,
      adapter_id, chain_id, mandate_executor_address, root_owner_address,
      account_address, executor_address, nonce, expires_at_chain_seconds,
      typed_data, signature, status, erc8183_contract, erc8183_job_id,
      terminal_tx_hash, terminal_reason_code, terminal_at
    ) values (
      ${mandateHash}, ${taskId}, ${simulationId}, ${walletId}, ${policyId},
      ${adapterId}, 97, ${bytes(authoritySeed + 12, 20)}, ${rootOwnerAddress},
      ${accountAddress}, ${bytes(seed + 13, 20)},
      ${(options.nonce ?? BigInt(seed)).toString()}, 9999999999,
      ${sql.json({
        primaryType: "TaskMandate",
        domain: {
          chainId: "97",
          verifyingContract: hex(bytes(authoritySeed + 12, 20)),
        },
        message: {
          account: hex(accountAddress),
          rootOwner: hex(rootOwnerAddress),
          ownerEpoch: "0",
          executor: hex(bytes(seed + 13, 20)),
          chainId: "97",
          nonce: (options.nonce ?? BigInt(seed)).toString(),
          expiresAt: "9999999999",
          policyHash: hex(policyHash),
          intentHash: hex(intentHash),
          planHash: hex(planHash),
          simulationHash: hex(simulationHash),
          adapter: hex(adapterAddress),
          adapterSelector: hex(bytes(authoritySeed + 8, 4)),
          inputToken: hex(bytes(seed + 20, 20)),
          maxInput: "1",
          outputToken: hex(bytes(seed + 21, 20)),
          minOutput: "1",
          recipient: hex(accountAddress),
          actionHash: hex(actionHash),
          postconditionHash: hex(postconditionHash),
          commerceContract: "0x0000000000000000000000000000000000000000",
          commerceJobId: "0",
        },
      })},
      ${bytes(seed + 14, 65)}, ${options.status ?? "SIGNED"},
      ${options.commerceContract ?? null}, ${options.commerceJobId?.toString() ?? null},
      ${terminal ? bytes(seed + 19, 32) : null},
      ${terminal ? "ONCHAIN_SUCCEEDED" : null}, ${terminal ? new Date() : null}
    )
  `;

  return { mandateHash, walletId };
}

function chainEvent(input: {
  seed: number;
  blockNumber: bigint;
  blockHash: Buffer;
  name: ChainEventInput["decodedName"];
  mandateHash: Buffer;
}): ChainEventInput {
  return {
    transactionHash: bytes(input.seed, 32),
    logIndex: 0,
    blockNumber: input.blockNumber,
    blockHash: input.blockHash,
    contractAddress: bytes(90, 20),
    topic0: bytes(input.seed + 1, 32),
    topics: [],
    data: Buffer.alloc(0),
    decodedName: input.name,
    decodedArgs: { mandateHash: hex(input.mandateHash) },
    observedAt: new Date(
      `2026-01-01T00:00:${input.seed.toString().padStart(2, "0")}Z`,
    ),
  };
}

beforeAll(async () => {
  await sql.unsafe("drop schema public cascade; create schema public");
  for (const migration of migrations) {
    await sql.unsafe(await readFile(migration, "utf8"));
  }
});

afterAll(async () => {
  await sql.end();
});

describe("P3-001 constrained persistence", () => {
  it("enforces active-policy, nonce, commerce-job, event, terminal, and secret boundaries", async () => {
    const walletId = id(9001);
    await sql`
      insert into wallets (
        id, chain_id, account_address, root_owner_address, account_type,
        account_version, entry_point_address, owner_epoch
      ) values (
        ${walletId}, 97, ${bytes(1, 20)}, ${bytes(2, 20)},
        'ALCHEMY_MODULAR_V2', '1', ${bytes(3, 20)}, 0
      )
    `;
    await sql`
      insert into wallet_policies (
        id, wallet_id, version, schema_version, status, policy_document,
        policy_hash, activation_tx_hash, activation_block_number, activated_at
      ) values (
        ${id(9002)}, ${walletId}, 1, '1', 'ACTIVE', ${sql.json({ version: 1 })},
        ${bytes(4, 32)}, ${bytes(5, 32)}, 10, now()
      )
    `;
    await expect(
      sql`
        insert into wallet_policies (
          id, wallet_id, version, schema_version, status, policy_document,
          policy_hash, activation_tx_hash, activation_block_number, activated_at
        ) values (
          ${id(9003)}, ${walletId}, 2, '1', 'ACTIVE', ${sql.json({ version: 2 })},
          ${bytes(6, 32)}, ${bytes(7, 32)}, 11, now()
        )
      `,
    ).rejects.toMatchObject({ code: "23505" });

    const first = await seedMandate(sql, 10, {
      nonce: 77n,
      commerceContract: bytes(70, 20),
      commerceJobId: 88n,
    });
    await expect(
      seedMandate(sql, 11, { authoritySeed: 10, nonce: 77n }),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      seedMandate(sql, 12, {
        authoritySeed: 10,
        nonce: 78n,
        commerceContract: bytes(70, 20),
        commerceJobId: 88n,
      }),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      seedMandate(sql, 13, { status: "SUCCEEDED" }),
    ).rejects.toMatchObject({ code: "23514" });

    await sql`
      insert into chain_events (
        chain_id, transaction_hash, log_index, block_number, block_hash,
        contract_address, topic0, topics, data, decoded_name, decoded_args,
        status, observed_at, confirmed_at
      ) values (
        97, ${bytes(80, 32)}, 0, 10, ${bytes(81, 32)}, ${bytes(82, 20)},
        ${bytes(83, 32)}, ${sql.json([])}, ${Buffer.alloc(0)}, 'MandateAuthorized',
        ${sql.json({ mandateHash: hex(first.mandateHash) })}, 'CONFIRMED', now(), now()
      )
    `;
    await expect(
      sql`
        insert into chain_events (
          chain_id, transaction_hash, log_index, block_number, block_hash,
          contract_address, topic0, topics, data, status, observed_at, confirmed_at
        ) values (
          97, ${bytes(80, 32)}, 0, 10, ${bytes(81, 32)}, ${bytes(82, 20)},
          ${bytes(83, 32)}, ${sql.json([])}, ${Buffer.alloc(0)}, 'CONFIRMED', now(), now()
        )
      `,
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      sql`update chain_events set data = ${bytes(1, 1)} where transaction_hash = ${bytes(80, 32)}`,
    ).rejects.toMatchObject({ code: "P0001" });

    const secretColumns = await sql<{ column_name: string }[]>`
      select column_name
      from information_schema.columns
      where table_schema = 'public'
        and column_name in (
          'private_key', 'seed_phrase', 'session_key', 'wallet_share',
          'recovery_material', 'authorization_header'
        )
    `;
    expect(secretColumns).toEqual([]);
  });

  it("deduplicates raw events and rebuilds mandate projections across a reorg", async () => {
    const { mandateHash } = await seedMandate(sql, 20);
    const block9 = bytes(9, 32);
    const block10 = bytes(10, 32);
    const block11 = bytes(11, 32);
    const fork11 = bytes(21, 32);

    const authorized = {
      chainId: 97n,
      streamName: "mandate-executor-v1",
      fromBlockNumber: 10n,
      nextBlockNumber: 11n,
      parentBlockHash: block9,
      lastCanonicalBlockHash: block10,
      confirmationDepth: 2,
      events: [
        chainEvent({
          seed: 30,
          blockNumber: 10n,
          blockHash: block10,
          name: "MandateAuthorized",
          mandateHash,
        }),
      ],
    } as const;

    expect(await applyChainEventBatch(sql, authorized)).toEqual({
      inserted: 1,
      duplicates: 0,
      orphaned: 0,
    });
    expect(await applyChainEventBatch(sql, authorized)).toEqual({
      inserted: 0,
      duplicates: 1,
      orphaned: 0,
    });

    await applyChainEventBatch(sql, {
      ...authorized,
      fromBlockNumber: 11n,
      nextBlockNumber: 12n,
      parentBlockHash: block10,
      lastCanonicalBlockHash: block11,
      events: [
        chainEvent({
          seed: 31,
          blockNumber: 11n,
          blockHash: block11,
          name: "ExecutionBegun",
          mandateHash,
        }),
      ],
    });

    const [executing] = await sql<{ status: string }[]>`
      select status from mandates where mandate_hash = ${mandateHash}
    `;
    expect(executing?.status).toBe("EXECUTING");

    expect(
      await applyChainEventBatch(sql, {
        ...authorized,
        fromBlockNumber: 11n,
        nextBlockNumber: 12n,
        parentBlockHash: block10,
        lastCanonicalBlockHash: fork11,
        events: [
          chainEvent({
            seed: 32,
            blockNumber: 11n,
            blockHash: fork11,
            name: "MandateRevoked",
            mandateHash,
          }),
        ],
      }),
    ).toEqual({ inserted: 1, duplicates: 0, orphaned: 1 });

    const [mandate] = await sql<
      {
        status: string;
        terminal_reason_code: string;
        terminal_tx_hash: Buffer;
      }[]
    >`
      select status, terminal_reason_code, terminal_tx_hash
      from mandates
      where mandate_hash = ${mandateHash}
    `;
    expect(mandate).toMatchObject({
      status: "REVOKED",
      terminal_reason_code: "ONCHAIN_REVOKED",
      terminal_tx_hash: bytes(32, 32),
    });

    const statuses = await sql<{ status: string; count: string }[]>`
      select status, count(*)::text as count
      from chain_events
      where decoded_args->>'mandateHash' = ${hex(mandateHash)}
      group by status
      order by status
    `;
    expect(statuses).toEqual([
      { status: "CONFIRMED", count: "2" },
      { status: "ORPHANED", count: "1" },
    ]);

    const [checkpoint] = await sql<
      { next_block_number: string; last_canonical_block_hash: Buffer }[]
    >`
      select next_block_number::text, last_canonical_block_hash
      from indexer_checkpoints
      where chain_id = 97 and stream_name = 'mandate-executor-v1'
    `;
    expect(checkpoint).toEqual({
      next_block_number: "12",
      last_canonical_block_hash: fork11,
    });
  });
});
