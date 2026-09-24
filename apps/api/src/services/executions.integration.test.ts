import { readFile } from "node:fs/promises";
import {
  encodeSwapAction,
  getTaskMandateTypedData,
  hashSwapPostcondition,
  mandateExecutorAbi,
  signedMandateDocumentSchema,
} from "@perago/sdk";
import postgres, { type Sql } from "postgres";
import { encodeFunctionData, type Hex, keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  deferExecution,
  ExecutionConflictError,
  type ExecutionServiceConfig,
  LeaseLostError,
  leaseExecution,
  recordPendingTransaction,
  releaseExecution,
} from "./executions.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl)
  throw new Error(
    "TEST_DATABASE_URL is required for database integration tests",
  );

const sql = postgres(databaseUrl, { max: 4, onnotice: () => {} });
const migrations = [
  new URL("../../drizzle/0000_constrained_lifecycle.sql", import.meta.url),
  new URL(
    "../../drizzle/0001_wallet_auth_policy_lifecycle.sql",
    import.meta.url,
  ),
  new URL("../../drizzle/0002_task_compilation.sql", import.meta.url),
  new URL("../../drizzle/0003_mandate_signing.sql", import.meta.url),
  new URL("../../drizzle/0004_execution_worker.sql", import.meta.url),
];
const bytes = (value: number, size: number) => Buffer.alloc(size, value);
const id = (value: number) =>
  `00000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;
const hex = (value: Buffer) => `0x${value.toString("hex")}` as `0x${string}`;
const deployment = {
  chainId: "97",
  mandateExecutor: {
    address: "0x1212121212121212121212121212121212121212",
    codeHash: `0x${"12".repeat(32)}`,
  },
} as const;
const config: ExecutionServiceConfig = {
  client: {} as never,
  deployment: deployment as unknown as ExecutionServiceConfig["deployment"],
  leaseSeconds: 60,
  workerTokenHash: bytes(42, 32),
};

async function seed(
  db: Sql,
  value: number,
  bound = false,
  executorAddress?: Buffer,
) {
  const walletId = id(value * 10 + 1);
  const policyId = id(value * 10 + 2);
  const adapterId = id(value * 10 + 3);
  const taskId = id(value * 10 + 4);
  const simulationId = id(value * 10 + 5);
  const mandateHash = bytes(value, 32);
  const account = bytes(value + 1, 20);
  const executor = executorAddress ?? bytes(value + 2, 20);
  const policyHash = bytes(value + 3, 32);
  const intentHash = bytes(value + 4, 32);
  const planHash = bytes(value + 5, 32);
  const simulationHash = bytes(value + 6, 32);
  const inputToken = hex(bytes(value + 23, 20));
  const outputToken = hex(bytes(value + 24, 20));
  const action = {
    tokenIn: inputToken,
    tokenOut: outputToken,
    poolFee: "500",
    amountIn: "1",
    minAmountOut: "1",
    recipient: hex(account),
    deadline: "9999999998",
  };
  const actionHash = keccak256(encodeSwapAction(action));
  const postconditionHash = hashSwapPostcondition(
    hex(account),
    outputToken,
    "1",
  );
  await db`
    insert into wallets (id, chain_id, account_address, root_owner_address, account_type, account_version, entry_point_address, owner_epoch)
    values (${walletId}, 97, ${account}, ${bytes(value + 9, 20)}, 'ALCHEMY_MODULAR_V2', '1', ${bytes(value + 10, 20)}, 0)
  `;
  await db`
    insert into wallet_policies (
      id, wallet_id, version, schema_version, status, policy_document, policy_hash,
      permission_document, permission_hash, permission_call_data, permission_user_operation_hash,
      permission_tx_hash, activation_call_data, activation_user_operation_hash, activation_tx_hash,
      activation_block_number, activated_at
    ) values (
      ${policyId}, ${walletId}, 1, '1', 'ACTIVE', ${db.json({})}, ${policyHash},
      ${db.json({ account: hex(account), entityId: 1, nativeSpendLimit: "0", selectors: ["0x12345678"], sessionSigner: hex(executor), target: deployment.mandateExecutor.address, validAfter: "0", validUntil: "9999999999" })}, ${bytes(value + 11, 32)}, ${bytes(value + 12, 4)}, ${bytes(value + 13, 32)},
      ${bytes(value + 14, 32)}, ${bytes(value + 15, 4)}, ${bytes(value + 13, 32)}, ${bytes(value + 14, 32)},
      1, now()
    )
  `;
  await db`
    insert into protocol_adapters (id, chain_id, kind, slug, status, adapter_address, adapter_code_hash, verifier_id, protocol_name, protocol_target_address, entry_selector, config_document, source_url, validated_block_number)
    values (${adapterId}, 97, 'SWAP', ${`swap-${value}`}, 'ACTIVE', ${bytes(value + 16, 20)}, ${bytes(value + 17, 32)}, ${bytes(value + 18, 32)}, 'test', ${bytes(value + 19, 20)}, ${bytes(value + 20, 4)}, ${db.json({})}, 'https://example.test', 1)
  `;
  await db`
    insert into tasks (id, wallet_id, wallet_policy_id, client_request_id, status, intent_hash, intent_document)
    values (${taskId}, ${walletId}, ${policyId}, ${`request-${value}`}, 'DRAFT', ${intentHash}, ${db.json({})})
  `;
  const result = {
    schemaVersion: "1",
    status: "PASSED",
    chainId: "97",
    account: hex(account),
    rootOwner: hex(bytes(value + 9, 20)),
    ownerEpoch: "0",
    policyHash: hex(policyHash),
    intentHash: hex(intentHash),
    planHash: hex(planHash),
    adapterId: `swap-${value}`,
    block: { number: "1", hash: hex(bytes(value + 22, 32)), timestamp: "1" },
    quoteExpiresAt: "9999999998",
    contracts: {
      mandateExecutor: {
        address: deployment.mandateExecutor.address,
        codeHash: deployment.mandateExecutor.codeHash,
      },
      adapter: {
        address: hex(bytes(value + 16, 20)),
        codeHash: hex(bytes(value + 17, 32)),
      },
      verifier: {
        address: hex(bytes(value + 18, 20)),
        codeHash: hex(bytes(value + 25, 32)),
      },
      protocolTarget: {
        address: hex(bytes(value + 19, 20)),
        codeHash: hex(bytes(value + 26, 32)),
      },
      account: { address: hex(account), codeHash: hex(bytes(value + 27, 32)) },
    },
    accountImplementation: hex(bytes(value + 28, 20)),
    verifierId: hex(bytes(value + 18, 32)),
    protocol: "test",
    mandate: {
      executor: hex(executor),
      nonce: String(value),
      expiresAt: "9999999999",
      commerceContract: "0x0000000000000000000000000000000000000000",
      commerceJobId: "0",
    },
    action: { kind: "SWAP", ...action },
    actionHash,
    postconditionHash,
    inputToken,
    maxInput: "1",
    outputToken,
    minOutput: "1",
    quotedOutput: "1",
    maxSlippageBps: "0",
    outcomeUnit: "TOKEN",
    recipient: hex(account),
    position: null,
    balances: {
      input: { before: "1", expectedAfter: "0" },
      outcome: { before: "0", expectedAfter: "1" },
    },
    allowanceAfter: "0",
    gasUsed: "1",
    failure: null,
    risks: ["test"],
  };
  await db`
    insert into simulations (id, task_id, adapter_id, sequence, status, chain_id, block_number, block_hash, adapter_code_hash, quote_expires_at, request_document, result_document, simulation_hash)
    values (${simulationId}, ${taskId}, ${adapterId}, 1, 'PASSED', 97, 1, ${bytes(value + 22, 32)}, ${bytes(value + 17, 32)}, now() + interval '1 hour', ${db.json({})}, ${db.json(result)}, ${simulationHash})
  `;
  await db`update tasks set status = 'COMPILING' where id = ${taskId}`;
  await db`
    update tasks set status = 'READY_TO_SIMULATE', compiled_plan = ${db.json({})},
      plan_hash = ${planHash}, compiler_version = 'test', policy_decision = ${db.json({})},
      policy_decision_hash = ${bytes(value + 21, 32)}
    where id = ${taskId}
  `;
  await db`update tasks set status = 'SIMULATED' where id = ${taskId}`;
  await db`update tasks set status = 'READY_TO_SIGN' where id = ${taskId}`;
  const document = {
    primaryType: "TaskMandate",
    domain: {
      chainId: "97",
      verifyingContract: deployment.mandateExecutor.address,
    },
    message: {
      account: hex(account),
      rootOwner: hex(bytes(value + 9, 20)),
      ownerEpoch: "0",
      executor: hex(executor),
      chainId: "97",
      nonce: String(value),
      expiresAt: "9999999999",
      policyHash: hex(policyHash),
      intentHash: hex(intentHash),
      planHash: hex(planHash),
      simulationHash: hex(simulationHash),
      adapter: hex(bytes(value + 16, 20)),
      adapterSelector: hex(bytes(value + 20, 4)),
      inputToken,
      maxInput: "1",
      outputToken,
      minOutput: "1",
      recipient: hex(account),
      actionHash,
      postconditionHash,
      commerceContract: "0x0000000000000000000000000000000000000000",
      commerceJobId: "0",
    },
  };
  await db`
    insert into mandates (mandate_hash, task_id, simulation_id, wallet_id, wallet_policy_id, adapter_id, chain_id, mandate_executor_address, root_owner_address, account_address, executor_address, nonce, expires_at_chain_seconds, typed_data, signature, status, erc8183_contract, erc8183_job_id)
    values (${mandateHash}, ${taskId}, ${simulationId}, ${walletId}, ${policyId}, ${adapterId}, 97, ${Buffer.from(deployment.mandateExecutor.address.slice(2), "hex")}, ${bytes(value + 9, 20)}, ${account}, ${executor}, ${value}, 9999999999, ${db.json(document)}, ${bytes(value + 25, 65)}, 'SIGNED', ${bound ? bytes(value + 26, 20) : null}, ${bound ? value : null})
  `;
  await db`insert into executions (id, mandate_hash, status) values (${id(value * 10 + 6)}, ${mandateHash}, 'QUEUED')`;
  return { mandateHash };
}

beforeAll(async () => {
  await sql.unsafe("drop schema public cascade; create schema public");
  for (const migration of migrations)
    await sql.unsafe(await readFile(migration, "utf8"));
});
afterAll(async () => {
  await sql.end();
});

describe("P4-002 execution queue", () => {
  it("leases a mandate to only one concurrent worker", async () => {
    await seed(sql, 1);
    const [left, right] = await Promise.all([
      leaseExecution(sql, "worker-a", config),
      leaseExecution(sql, "worker-b", config),
    ]);
    expect([left.job, right.job].filter(Boolean)).toHaveLength(1);
  });

  it("releases expired work for a new worker and refuses its former owner", async () => {
    const { mandateHash } = await seed(sql, 2);
    await leaseExecution(sql, "worker-a", config);
    await sql`update executions set lease_owner = null, lease_expires_at = null where mandate_hash = ${mandateHash}`;
    await expect(
      releaseExecution(sql, hex(mandateHash), "worker-a", config),
    ).rejects.toBeInstanceOf(LeaseLostError);
    expect(
      (await leaseExecution(sql, "worker-b", config)).job?.mandateHash,
    ).toBe(hex(mandateHash));
  });

  it("does not lease bound mandates and defers unsubmitted work", async () => {
    await seed(sql, 3, true);
    const unbound = await seed(sql, 4);
    expect((await leaseExecution(sql, "worker", config)).job?.mandateHash).toBe(
      hex(unbound.mandateHash),
    );
    await deferExecution(
      sql,
      hex(unbound.mandateHash),
      { workerId: "worker", code: "CHAIN_UNAVAILABLE", retryAfterSeconds: 60 },
      config,
    );
    expect((await leaseExecution(sql, "other", config)).job).toBeNull();
  });

  it("enforces durable progress and unique execution identity", async () => {
    const { mandateHash } = await seed(sql, 5);
    await expect(
      sql`insert into executions (id, mandate_hash, status) values (${id(999)}, ${mandateHash}, 'QUEUED')`,
    ).rejects.toMatchObject({ code: "23505" });
    const hash = bytes(90, 32);
    await sql`update executions set pending_transaction_kind = 'AUTHORIZE', pending_transaction_hash = ${hash}, pending_raw_transaction = ${bytes(91, 2)}, submission_attempts = 1 where mandate_hash = ${mandateHash}`;
    await expect(
      sql`update executions set pending_transaction_hash = ${bytes(92, 32)} where mandate_hash = ${mandateHash}`,
    ).rejects.toMatchObject({ code: "P0001" });
    await sql`update executions set pending_transaction_kind = null, pending_transaction_hash = null, pending_raw_transaction = null where mandate_hash = ${mandateHash}`;
    await sql`update executions set authorize_tx_hash = ${hash} where mandate_hash = ${mandateHash}`;
    await expect(
      sql`update executions set authorize_tx_hash = ${bytes(93, 32)} where mandate_hash = ${mandateHash}`,
    ).rejects.toMatchObject({ code: "P0001" });
    await expect(
      sql`update executions set status = 'TERMINAL' where mandate_hash = ${mandateHash}`,
    ).rejects.toMatchObject({ code: "P0001" });
    await expect(
      sql`update executions set status = 'REJECTED', last_error_code = 'AUTHORIZATION_REJECTED' where mandate_hash = ${mandateHash}`,
    ).rejects.toMatchObject({ code: "P0001" });
    await expect(
      sql`update executions set submission_attempts = submission_attempts + 1 where mandate_hash = ${mandateHash}`,
    ).rejects.toMatchObject({ code: "P0001" });
  });

  it("finishes once, keeps identity, and counts every new pending transaction", async () => {
    const { mandateHash } = await seed(sql, 6);
    await expect(
      sql`update executions set id = ${id(998)} where mandate_hash = ${mandateHash}`,
    ).rejects.toMatchObject({ code: "P0001" });
    await expect(
      sql`update executions set pending_transaction_kind = 'AUTHORIZE', pending_transaction_hash = ${bytes(94, 32)}, pending_raw_transaction = ${bytes(95, 2)} where mandate_hash = ${mandateHash}`,
    ).rejects.toMatchObject({ code: "P0001" });
    await expect(
      sql`update executions set pending_transaction_kind = 'AUTHORIZE', pending_transaction_hash = ${bytes(94, 32)}, pending_raw_transaction = ${bytes(95, 2)}, submission_attempts = submission_attempts + 2 where mandate_hash = ${mandateHash}`,
    ).rejects.toMatchObject({ code: "P0001" });
    await sql`update executions set status = 'REJECTED', last_error_code = 'AUTHORIZATION_REJECTED' where mandate_hash = ${mandateHash}`;
    await expect(
      sql`update executions set status = 'QUEUED' where mandate_hash = ${mandateHash}`,
    ).rejects.toMatchObject({ code: "P0001" });
  });

  it("records only the exact stage call signed by the mandate's executor", async () => {
    const signer = privateKeyToAccount(`0x${"7".repeat(64)}`);
    const stranger = privateKeyToAccount(`0x${"8".repeat(64)}`);
    const { mandateHash } = await seed(
      sql,
      7,
      false,
      Buffer.from(signer.address.slice(2), "hex"),
    );
    const key = hex(mandateHash);
    // Leases go to the oldest runnable job; park the earlier tests' jobs so this one is leased.
    await sql`
      update executions set next_retry_at = now() + interval '1 hour'
      where mandate_hash <> ${mandateHash} and status not in ('TERMINAL', 'REJECTED')
    `;
    const [row] = await sql<{ typed_data: unknown; signature: Buffer }[]>`
      select typed_data, signature from mandates where mandate_hash = ${mandateHash}
    `;
    if (!row) throw new Error("seeded mandate is missing");
    const document = signedMandateDocumentSchema.parse(row.typed_data);
    const authorize = encodeFunctionData({
      abi: mandateExecutorAbi,
      args: [
        getTaskMandateTypedData(document.message, document.domain).message,
        hex(row.signature),
      ],
      functionName: "authorize",
    });
    const sign = (
      from: typeof signer,
      fields: {
        chainId?: number;
        data?: Hex;
        nonce?: number;
        to?: Hex;
        value?: bigint;
      } = {},
    ) =>
      from.signTransaction({
        chainId: fields.chainId ?? 97,
        data: fields.data ?? authorize,
        gas: 500_000n,
        maxFeePerGas: 1n,
        maxPriorityFeePerGas: 1n,
        nonce: fields.nonce ?? 0,
        to: fields.to ?? deployment.mandateExecutor.address,
        type: "eip1559",
        value: fields.value ?? 0n,
      });
    expect(
      (await leaseExecution(sql, "worker-p", config)).job?.mandateHash,
    ).toBe(key);
    const record = (
      rawTransaction: Hex,
      kind: "AUTHORIZE" | "BEGIN" = "AUTHORIZE",
    ) =>
      recordPendingTransaction(
        sql,
        key,
        { kind, rawTransaction, userOperationHash: null, workerId: "worker-p" },
        config,
      );

    const refusals: [string, Hex, ("AUTHORIZE" | "BEGIN")?][] = [
      ["another sender", await sign(stranger)],
      ["another chain", await sign(signer, { chainId: 56 })],
      [
        "another target",
        await sign(signer, {
          to: "0x3434343434343434343434343434343434343434",
        }),
      ],
      ["attached value", await sign(signer, { value: 1n })],
      ["other calldata", await sign(signer, { data: `${authorize}00` })],
      [
        "a stage the projection forbids",
        await sign(signer, {
          data: encodeFunctionData({
            abi: mandateExecutorAbi,
            args: [key],
            functionName: "beginExecution",
          }),
        }),
        "BEGIN",
      ],
    ];
    for (const [label, raw, kind] of refusals) {
      await expect(record(raw, kind), label).rejects.toBeInstanceOf(
        ExecutionConflictError,
      );
    }

    const exact = await sign(signer);
    expect((await record(exact)).job.pending).toMatchObject({
      kind: "AUTHORIZE",
      transactionHash: keccak256(exact),
    });
    // Duplicate delivery of the same bytes is idempotent; different bytes are refused while one is pending.
    expect((await record(exact)).job.pending?.transactionHash).toBe(
      keccak256(exact),
    );
    await expect(
      record(await sign(signer, { nonce: 1 })),
    ).rejects.toBeInstanceOf(ExecutionConflictError);
    const [attempts] = await sql<{ submission_attempts: number }[]>`
      select submission_attempts from executions where mandate_hash = ${mandateHash}
    `;
    expect(attempts?.submission_attempts).toBe(1);
  });
});
