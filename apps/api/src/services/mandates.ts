import { randomBytes, randomUUID } from "node:crypto";
import {
  ADAPTER_EXECUTE_SELECTOR,
  type Address,
  type CompiledPlan,
  compiledPlanSchema,
  encodeSimulatedAction,
  getTaskMandateTypedData,
  type Hash,
  hashCompiledPlan,
  hashSimulationResult,
  mandateExecutorAbi,
  mandateSessionPermissionSchema,
  type ProtocolCatalog,
  type SimulationResult,
  signedMandateDocumentSchema,
  simulationResultSchema,
  submitMandateSignatureRequestSchema,
  type TaskIntent,
  type TaskMandate,
  taskMandateFromSimulation,
  walletPolicySchema,
} from "@perago/sdk";
import type { JSONValue, Sql, TransactionSql } from "postgres";
import {
  BaseError,
  ContractFunctionRevertedError,
  hashTypedData,
  type PublicClient,
  recoverTypedDataAddress,
} from "viem";

import type { WalletIdentity } from "../auth/wallet-auth.js";
import { recheckCompiledPlan } from "../compiler/compile.js";
import type { AdapterDeployment, PeragoDeployment } from "../deployment.js";
import { ReasonError } from "../errors.js";
import {
  canonicalHashAt,
  pinBlock,
  readChainSnapshot,
  readDeploymentState,
  type SimulationBlockTag,
  verifyDeploymentWiring,
} from "../simulation/context.js";
import { assessFreshness } from "../simulation/freshness.js";
import { simulatePlan } from "../simulation/simulate.js";
import { readStakePosition } from "../simulation/stake.js";
import {
  isTransportError,
  runExactPath,
} from "../simulation/user-operation.js";
import { loadDailySpent } from "./tasks.js";

export type MandateServiceConfig = {
  /** `finalized` on a live chain; a local fork has no separate finality. */
  blockTag: SimulationBlockTag;
  catalog: ProtocolCatalog;
  client: PublicClient;
  deployment: PeragoDeployment;
  now: () => Date;
  /** Seconds a simulation quote may back a signature. */
  quoteTtlSeconds: number;
};

type TaskContextRow = {
  account_address: Buffer;
  chain_id: string;
  compiled_plan: CompiledPlan | null;
  id: string;
  intent_document: Omit<TaskIntent, "goal">;
  owner_epoch: string;
  permission_document: unknown;
  plan_hash: Buffer | null;
  policy_document: unknown;
  policy_hash: Buffer;
  policy_status: string;
  root_owner_address: Buffer;
  status: string;
  wallet_id: string;
  wallet_policy_id: string;
};

type SimulationRow = {
  adapter_id: string;
  id: string;
  result_document: SimulationResult;
  sequence: number;
  simulation_hash: Buffer;
  status: string;
};

const asHex = (value: Uint8Array) =>
  `0x${Buffer.from(value).toString("hex")}` as `0x${string}`;
const asBuffer = (value: `0x${string}`) => Buffer.from(value.slice(2), "hex");

export function validateMandateConfig(config: MandateServiceConfig): void {
  if (config.deployment.chainId !== config.catalog.chainId) {
    throw new RangeError("deployment and catalog must name the same chain");
  }
  if (
    !Number.isInteger(config.quoteTtlSeconds) ||
    config.quoteTtlSeconds <= 0
  ) {
    throw new RangeError("the quote lifetime must be a positive integer");
  }
}

async function loadTaskContext(
  sql: Sql | TransactionSql,
  identity: WalletIdentity,
  taskId: string,
  lock = false,
): Promise<TaskContextRow> {
  const rows = lock
    ? await sql<TaskContextRow[]>`
        select t.id, t.status, t.wallet_id, t.wallet_policy_id,
          t.intent_document, t.compiled_plan, t.plan_hash,
          p.status as policy_status, p.policy_document, p.policy_hash,
          p.permission_document, w.account_address, w.root_owner_address,
          w.owner_epoch::text, w.chain_id::text
        from tasks t
        join wallet_policies p on p.id = t.wallet_policy_id
        join wallets w on w.id = t.wallet_id
        where t.id = ${taskId}
        for update of t, w
      `
    : await sql<TaskContextRow[]>`
        select t.id, t.status, t.wallet_id, t.wallet_policy_id,
          t.intent_document, t.compiled_plan, t.plan_hash,
          p.status as policy_status, p.policy_document, p.policy_hash,
          p.permission_document, w.account_address, w.root_owner_address,
          w.owner_epoch::text, w.chain_id::text
        from tasks t
        join wallet_policies p on p.id = t.wallet_policy_id
        join wallets w on w.id = t.wallet_id
        where t.id = ${taskId}
      `;
  const [row] = rows;
  // Another wallet's task is indistinguishable from a missing one.
  if (!row || row.wallet_id !== identity.walletId) {
    throw new Error("task was not found");
  }
  if (
    asHex(row.account_address) !== identity.account ||
    asHex(row.root_owner_address) !== identity.rootOwner
  ) {
    throw new Error("task wallet identity is stale");
  }
  return row;
}

function compiledPlanOf(row: TaskContextRow): {
  plan: CompiledPlan;
  planHash: Hash;
} {
  if (!row.compiled_plan || !row.plan_hash) {
    throw new Error("only a compiled task can be simulated");
  }
  const plan = compiledPlanSchema.parse(row.compiled_plan);
  const planHash = hashCompiledPlan(plan);
  if (planHash !== asHex(row.plan_hash)) {
    throw new Error("stored plan does not match its hash");
  }
  return { plan, planHash };
}

async function latestSimulation(
  sql: Sql | TransactionSql,
  taskId: string,
): Promise<SimulationRow | null> {
  const [row] = await sql<SimulationRow[]>`
    select id, adapter_id, sequence, status, result_document, simulation_hash
    from simulations where task_id = ${taskId}
    order by sequence desc limit 1
  `;
  return row ?? null;
}

async function activeAdapterRow(
  sql: Sql | TransactionSql,
  deployment: PeragoDeployment,
  adapter: AdapterDeployment,
): Promise<string> {
  const [row] = await sql<
    { adapter_address: Buffer; adapter_code_hash: Buffer; id: string }[]
  >`
    select id, adapter_address, adapter_code_hash from protocol_adapters
    where chain_id = ${deployment.chainId} and slug = ${adapter.id}
      and status = 'ACTIVE'
  `;
  if (
    !row ||
    asHex(row.adapter_address) !== adapter.adapter.address ||
    asHex(row.adapter_code_hash) !== adapter.adapter.codeHash
  ) {
    throw new ReasonError(
      "DEPLOYMENT_MISMATCH",
      `no ACTIVE registry row for ${adapter.id} at ${adapter.adapter.address}`,
    );
  }
  return row.id;
}

/**
 * Registers each deployment adapter as `ACTIVE` after reading its wiring and
 * code hashes from chain at one block (ERD 5.13). An existing row for the same
 * slug must describe the same deployment; drift is refused, never rewritten.
 */
export async function registerDeploymentAdapters(
  sql: Sql,
  input: {
    blockTag: SimulationBlockTag;
    client: PublicClient;
    deployment: PeragoDeployment;
  },
): Promise<void> {
  const { client, deployment } = input;
  const block = await pinBlock(client, input.blockTag);
  for (const kind of ["SWAP", "STAKE"] as const) {
    const adapter = deployment.adapters[kind];
    const state = await readDeploymentState({
      adapter,
      block,
      client,
      deployment,
    });
    const wiring = await verifyDeploymentWiring({
      adapter,
      client,
      deployment,
      kind,
      snapshot: state,
    });
    if (wiring.problems.length > 0) {
      throw new ReasonError("DEPLOYMENT_MISMATCH", wiring.problems.join("; "));
    }
    await sql`
      insert into protocol_adapters (
        id, chain_id, kind, slug, status, adapter_address, adapter_code_hash,
        verifier_id, protocol_name, protocol_target_address, entry_selector,
        config_document, source_url, validated_block_number
      ) values (
        ${randomUUID()}, ${deployment.chainId}, ${kind}, ${adapter.id}, 'ACTIVE',
        ${asBuffer(adapter.adapter.address)}, ${asBuffer(adapter.adapter.codeHash)},
        ${asBuffer(wiring.verifierId)}, ${adapter.protocol},
        ${asBuffer(adapter.protocolTarget.address)},
        ${asBuffer(ADAPTER_EXECUTE_SELECTOR)},
        ${sql.json({
          mandateExecutor: deployment.mandateExecutor.address,
          protocolTargetCodeHash: adapter.protocolTarget.codeHash,
          verifier: adapter.verifier.address,
          verifierCodeHash: adapter.verifier.codeHash,
        })},
        ${adapter.sourceUrl}, ${block.number.toString()}
      )
      on conflict (chain_id, slug) do nothing
    `;
    await activeAdapterRow(sql, deployment, adapter);
  }
}

export type SimulationView = {
  result: SimulationResult;
  sequence: number;
  simulationHash: Hash;
  simulationId: string;
  status: "PASSED" | "REVERTED";
  taskStatus: string;
};

/**
 * Marks the simulation stale and returns the task to `READY_TO_SIMULATE`. A
 * task whose Wallet Policy left `ACTIVE` cannot re-enter simulation, so it keeps
 * its status; with no passing simulation it can never be signed.
 */
async function invalidate(
  sql: Sql | TransactionSql,
  taskId: string,
  simulationId: string,
): Promise<void> {
  await sql`
    update simulations set status = 'STALE'
    where id = ${simulationId} and status = 'PASSED'
  `;
  await sql`
    update tasks set status = 'READY_TO_SIMULATE', updated_at = now()
    where id = ${taskId} and status in ('SIMULATED', 'READY_TO_SIGN')
      and exists (
        select 1 from wallet_policies p
        where p.id = tasks.wallet_policy_id and p.status = 'ACTIVE'
      )
  `;
}

/**
 * Simulates the task's compiled plan at a freshly pinned block and appends
 * the result. A task that already holds a signable simulation is first
 * returned to `READY_TO_SIMULATE`, so a refresh never leaves two signable
 * simulations.
 */
export async function simulateTask(
  sql: Sql,
  identity: WalletIdentity,
  taskId: string,
  config: MandateServiceConfig,
): Promise<SimulationView> {
  const row = await loadTaskContext(sql, identity, taskId);
  if (row.policy_status !== "ACTIVE") {
    throw new ReasonError("STALE_POLICY");
  }
  if (row.status === "SIMULATED" || row.status === "READY_TO_SIGN") {
    const previous = await latestSimulation(sql, taskId);
    if (previous) await invalidate(sql, taskId, previous.id);
  } else if (row.status !== "READY_TO_SIMULATE") {
    throw new Error("only a compiled, unsigned task can be simulated");
  }
  const { plan, planHash } = compiledPlanOf(row);
  const permission = mandateSessionPermissionSchema.parse(
    row.permission_document,
  );
  const adapter = config.deployment.adapters[plan.action.kind];
  const adapterId = await activeAdapterRow(sql, config.deployment, adapter);

  const run = await simulatePlan(
    {
      blockTag: config.blockTag,
      client: config.client,
      deployment: config.deployment,
      quoteTtlSeconds: config.quoteTtlSeconds,
    },
    {
      executor: permission.sessionSigner,
      nonce: BigInt(`0x${randomBytes(16).toString("hex")}`),
      ownerEpoch: row.owner_epoch,
      plan,
      planHash,
      rootOwner: asHex(row.root_owner_address),
      sessionValidUntil: BigInt(permission.validUntil),
    },
  );

  return sql.begin(async (tx) => {
    const locked = await loadTaskContext(tx, identity, taskId, true);
    if (
      locked.status !== "READY_TO_SIMULATE" ||
      locked.policy_status !== "ACTIVE"
    ) {
      throw new Error("task state changed while simulating; simulate again");
    }
    const [next] = await tx<{ sequence: number }[]>`
      select coalesce(max(sequence), 0)::integer + 1 as sequence
      from simulations where task_id = ${taskId}
    `;
    const simulationId = randomUUID();
    const sequence = next?.sequence ?? 1;
    await tx`
      insert into simulations (
        id, task_id, adapter_id, sequence, status, chain_id, block_number,
        block_hash, adapter_code_hash, quote_expires_at, request_document,
        result_document, simulation_hash
      ) values (
        ${simulationId}, ${taskId}, ${adapterId}, ${sequence},
        ${run.result.status}, ${run.result.chainId}, ${run.result.block.number},
        ${asBuffer(run.result.block.hash)},
        ${asBuffer(run.result.contracts.adapter.codeHash)},
        ${new Date(Number(run.result.quoteExpiresAt) * 1000)},
        ${tx.json(run.request as JSONValue)},
        ${tx.json(run.result as unknown as JSONValue)},
        ${asBuffer(run.simulationHash)}
      )
    `;
    if (run.result.status === "PASSED") {
      await tx`
        update tasks set status = 'SIMULATED', updated_at = now()
        where id = ${taskId}
      `;
    }
    return {
      result: run.result,
      sequence,
      simulationHash: run.simulationHash,
      simulationId,
      status: run.result.status,
      taskStatus:
        run.result.status === "PASSED" ? "SIMULATED" : "READY_TO_SIMULATE",
    };
  });
}

type SignableSimulation = {
  mandate: TaskMandate;
  mandateHash: Hash;
  result: SimulationResult;
  row: TaskContextRow;
  simulation: SimulationRow;
  simulationHash: Hash;
};

async function loadSignable(
  sql: Sql,
  identity: WalletIdentity,
  taskId: string,
  config: MandateServiceConfig,
  statuses: readonly string[],
): Promise<SignableSimulation> {
  const row = await loadTaskContext(sql, identity, taskId);
  if (!statuses.includes(row.status)) {
    throw new Error(`only a task in ${statuses.join(" or ")} can do this`);
  }
  const simulation = await latestSimulation(sql, taskId);
  if (simulation?.status !== "PASSED") {
    throw new Error("only a task with a passing simulation can be signed");
  }
  const result = simulationResultSchema.parse(simulation.result_document);
  const simulationHash = hashSimulationResult(result);
  if (simulationHash !== asHex(simulation.simulation_hash)) {
    throw new Error("stored simulation does not match its hash");
  }
  if (
    result.contracts.mandateExecutor.address !==
    config.deployment.mandateExecutor.address
  ) {
    throw new ReasonError("DEPLOYMENT_MISMATCH");
  }
  const mandate = taskMandateFromSimulation(result, simulationHash);
  const mandateHash = hashTypedData(
    getTaskMandateTypedData(mandate, mandateDomain(config)),
  );
  return { mandate, mandateHash, result, row, simulation, simulationHash };
}

function mandateDomain(config: MandateServiceConfig) {
  return {
    chainId: config.deployment.chainId,
    verifyingContract: config.deployment.mandateExecutor.address,
  };
}

/**
 * Re-reads every fact the simulation committed to at the current block and
 * returns the pinned block the reads used. Anything stale sends the task back
 * to `READY_TO_SIMULATE` and refuses.
 */
async function requireFresh(
  sql: Sql,
  signable: SignableSimulation,
  config: MandateServiceConfig,
) {
  const { result, row, simulation } = signable;
  const { client, deployment } = config;
  const block = await pinBlock(client, config.blockTag);
  const adapter = deployment.adapters[result.action.kind];
  const [current, canonical, nonceUsed, currentPosition] = await Promise.all([
    readChainSnapshot({
      account: result.account,
      adapter,
      block,
      client,
      deployment,
    }),
    canonicalHashAt(client, BigInt(result.block.number)),
    client.readContract({
      abi: mandateExecutorAbi,
      address: deployment.mandateExecutor.address,
      args: [result.account, BigInt(result.mandate.nonce)],
      blockNumber: block.number,
      functionName: "isNonceUsed",
    }),
    result.action.kind === "STAKE"
      ? readStakePosition({
          adapter: adapter.adapter.address,
          blockNumber: block.number,
          client,
          pool: adapter.protocolTarget.address,
          recipient: result.recipient,
        })
      : null,
  ]);
  const reasons = assessFreshness({
    canonicalHashAtSimulatedBlock: canonical,
    current,
    currentPosition,
    nonceUsed,
    policyActive: row.policy_status === "ACTIVE",
    simulated: {
      accountImplementation: result.accountImplementation,
      block: result.block,
      codeHashes: {
        account: result.contracts.account.codeHash,
        adapter: result.contracts.adapter.codeHash,
        mandateExecutor: result.contracts.mandateExecutor.codeHash,
        protocolTarget: result.contracts.protocolTarget.codeHash,
        verifier: result.contracts.verifier.codeHash,
      },
      ownerEpoch: result.ownerEpoch,
      policyHash: result.policyHash,
      position: result.position,
      quoteExpiresAt: result.quoteExpiresAt,
      rootOwner: result.rootOwner,
    },
    wallet: {
      ownerEpoch: row.owner_epoch,
      rootOwner: asHex(row.root_owner_address),
    },
  });
  const [first] = reasons;
  if (first) {
    await sql.begin((tx) => invalidate(tx, row.id, simulation.id));
    throw new ReasonError(first, reasons.join(", "));
  }
  return block;
}

export type PreparedMandate = {
  domain: { chainId: string; verifyingContract: Address };
  mandate: TaskMandate;
  mandateHash: Hash;
  simulation: SimulationResult;
  simulationHash: Hash;
  simulationId: string;
  taskStatus: "READY_TO_SIGN";
};

/**
 * Revalidates freshness and releases the one Task Mandate the passing
 * simulation authorizes. The client derives the EIP-712 payload itself with
 * `getTaskMandateTypedData(mandate, domain)` and can recompute every field from
 * `simulation` with `taskMandateFromSimulation`.
 */
export async function prepareMandate(
  sql: Sql,
  identity: WalletIdentity,
  taskId: string,
  config: MandateServiceConfig,
): Promise<PreparedMandate> {
  const signable = await loadSignable(sql, identity, taskId, config, [
    "SIMULATED",
    "READY_TO_SIGN",
  ]);
  await requireFresh(sql, signable, config);
  if (signable.row.status === "SIMULATED") {
    await sql`
      update tasks set status = 'READY_TO_SIGN', updated_at = now()
      where id = ${taskId} and status = 'SIMULATED'
    `;
  }
  return {
    domain: mandateDomain(config),
    mandate: signable.mandate,
    mandateHash: signable.mandateHash,
    simulation: signable.result,
    simulationHash: signable.simulationHash,
    simulationId: signable.simulation.id,
    taskStatus: "READY_TO_SIGN",
  };
}

export type SignedMandateView = {
  executionStatus: "QUEUED";
  mandateHash: Hash;
  status: "SIGNED";
  taskStatus: "SIGNED";
};

/** The decoded contract error name of a reverted call, never its raw data. */
export function revertName(error: unknown): string {
  if (error instanceof BaseError) {
    const reverted = error.walk(
      (cause) => cause instanceof ContractFunctionRevertedError,
    );
    if (reverted instanceof ContractFunctionRevertedError) {
      return reverted.data?.errorName ?? reverted.reason ?? "reverted";
    }
  }
  return "reverted";
}

/**
 * Accepts the root owner's signature only if it recovers to the wallet's root
 * owner over the exact prepared digest, every simulated fact is still fresh,
 * the signed action still passes the exact path now, MandateExecutor would
 * authorize it, and the Wallet Policy - including the rolling daily cap - still
 * admits it. The signed mandate and its queue row commit in one transaction.
 */
export async function submitMandateSignature(
  sql: Sql,
  identity: WalletIdentity,
  taskId: string,
  requestInput: unknown,
  config: MandateServiceConfig,
): Promise<SignedMandateView> {
  const { signature } = submitMandateSignatureRequestSchema.parse(requestInput);
  const existing = await sql<{ mandate_hash: Buffer; signature: Buffer }[]>`
    select m.mandate_hash, m.signature from mandates m
    join tasks t on t.id = m.task_id
    where m.task_id = ${taskId} and t.wallet_id = ${identity.walletId}
  `;
  const [signed] = existing;
  if (signed) {
    if (asHex(signed.signature) !== signature) {
      throw new Error("task is already signed with a different signature");
    }
    return {
      executionStatus: "QUEUED",
      mandateHash: asHex(signed.mandate_hash),
      status: "SIGNED",
      taskStatus: "SIGNED",
    };
  }

  const signable = await loadSignable(sql, identity, taskId, config, [
    "READY_TO_SIGN",
  ]);
  const { mandate, mandateHash, result, simulation } = signable;
  const domain = mandateDomain(config);
  const typedData = getTaskMandateTypedData(mandate, domain);
  const recovered = await recoverTypedDataAddress({
    ...typedData,
    signature,
  }).catch(() => null);
  if (recovered?.toLowerCase() !== identity.rootOwner) {
    throw new ReasonError("SIGNATURE_INVALID");
  }

  const block = await requireFresh(sql, signable, config);
  const adapter = config.deployment.adapters[result.action.kind];
  const replay = await runExactPath({
    action: encodeSimulatedAction(result),
    block,
    client: config.client,
    executor: config.deployment.mandateExecutor.address,
    mandate,
    verifier: adapter.verifier.address,
  });
  const observed =
    replay.kind === "OBSERVED" && replay.observation.status === "SUCCEEDED"
      ? replay.observation
      : null;
  if (
    !observed ||
    observed.outcomeAfter - observed.outcomeBefore <
      BigInt(mandate.minOutput) ||
    observed.inputBalanceBefore - observed.inputBalanceAfter !==
      BigInt(mandate.maxInput)
  ) {
    await sql.begin((tx) => invalidate(tx, taskId, simulation.id));
    throw new ReasonError(
      "STALE_ACTION",
      replay.kind === "REVERTED"
        ? replay.reason
        : `at block ${block.number} the signed action ${observed ? "fell below its minimum" : `recorded ${replay.observation.status}`}`,
    );
  }

  try {
    const { result: authorized } = await config.client.simulateContract({
      abi: mandateExecutorAbi,
      account: mandate.executor,
      address: config.deployment.mandateExecutor.address,
      args: [typedData.message, signature],
      blockNumber: block.number,
      functionName: "authorize",
    });
    if (authorized.toLowerCase() !== mandateHash) {
      throw new Error("MandateExecutor computed a different mandate digest");
    }
  } catch (error) {
    if (isTransportError(error)) throw error;
    if (error instanceof Error && error.message.includes("different mandate")) {
      throw error;
    }
    throw new ReasonError("AUTHORIZATION_REJECTED", revertName(error));
  }

  return sql.begin(async (tx) => {
    const locked = await loadTaskContext(tx, identity, taskId, true);
    const latest = await latestSimulation(tx, taskId);
    if (
      locked.status !== "READY_TO_SIGN" ||
      locked.policy_status !== "ACTIVE" ||
      latest?.id !== simulation.id ||
      latest.status !== "PASSED"
    ) {
      throw new Error("task state changed while signing; prepare again");
    }
    const failing = recheckCompiledPlan({
      catalog: config.catalog,
      dailySpent: await loadDailySpent(tx, identity.walletId, config.now()),
      intent: locked.intent_document,
      plan: compiledPlanOf(locked).plan,
      policy: walletPolicySchema.parse(locked.policy_document),
    });
    const [rule] = failing;
    if (rule) {
      throw new ReasonError(
        rule.reasonCode ?? "DAILY_CAP_EXCEEDED",
        failing.map((entry) => `${entry.rule}: ${entry.observed}`).join("; "),
      );
    }

    await tx`
      insert into mandates (
        mandate_hash, task_id, simulation_id, wallet_id, wallet_policy_id,
        adapter_id, chain_id, mandate_executor_address, root_owner_address,
        account_address, executor_address, nonce, expires_at_chain_seconds,
        typed_data, signature, status, erc8183_contract, erc8183_job_id
      ) values (
        ${asBuffer(mandateHash)}, ${taskId}, ${simulation.id},
        ${identity.walletId}, ${locked.wallet_policy_id}, ${simulation.adapter_id},
        ${mandate.chainId}, ${asBuffer(domain.verifyingContract)},
        ${asBuffer(mandate.rootOwner)}, ${asBuffer(mandate.account)},
        ${asBuffer(mandate.executor)}, ${mandate.nonce}, ${mandate.expiresAt},
        ${tx.json(
          signedMandateDocumentSchema.parse({
            primaryType: "TaskMandate",
            domain,
            message: mandate,
          }) as unknown as JSONValue,
        )},
        ${asBuffer(signature)}, 'SIGNED',
        ${result.mandate.commerceJobId === "0" ? null : asBuffer(mandate.commerceContract)},
        ${result.mandate.commerceJobId === "0" ? null : mandate.commerceJobId}
      )
    `;
    await tx`
      insert into executions (id, mandate_hash, status)
      values (${randomUUID()}, ${asBuffer(mandateHash)}, 'QUEUED')
    `;
    await tx`
      update tasks set status = 'SIGNED', updated_at = now() where id = ${taskId}
    `;
    return {
      executionStatus: "QUEUED",
      mandateHash,
      status: "SIGNED",
      taskStatus: "SIGNED",
    };
  });
}
