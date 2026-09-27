import {
  apexCommerceAbi,
  EXECUTE_USER_OP_SELECTOR,
  type ExecutionJob,
  type ExecutionStatus,
  type ExecutionTransactionKind,
  encodeSimulatedAction,
  executionJobSchema,
  getTaskMandateTypedData,
  type Hash,
  MODULAR_ACCOUNT_V2_ADDRESSES,
  mandateExecutorAbi,
  mandateSessionPermissionSchema,
  outcomeEvaluatorAbi,
  type RecordPendingTransactionRequest,
  signedMandateDocumentSchema,
  simulationResultSchema,
} from "@perago/sdk";
import type { Sql, TransactionSql } from "postgres";
import {
  type Address,
  decodeFunctionData,
  encodeFunctionData,
  type Hex,
  keccak256,
  type PublicClient,
  parseAbi,
  parseEventLogs,
  parseTransaction,
  recoverTransactionAddress,
  slice,
  TransactionReceiptNotFoundError,
  type TransactionSerialized,
} from "viem";
import { entryPoint07Abi } from "viem/account-abstraction";

import type { PeragoDeployment } from "../deployment.js";
import { readFinalizedMandate } from "../executions/chain.js";
import { applyFinalizedEvents } from "../indexer/project-chain-events.js";
import { isTransportError } from "../simulation/user-operation.js";
import { revertName } from "./mandates.js";
import { readFinalizedCommerceState } from "./receipt-index.js";

export type ExecutionServiceConfig = {
  client: PublicClient;
  deployment: PeragoDeployment;
  leaseSeconds: number;
  workerTokenHash: Buffer;
};

export class LeaseLostError extends Error {
  constructor() {
    super("execution lease was lost");
    this.name = "LeaseLostError";
  }
}

/** A worker request the durable state or the chain refuses; answered with 409. */
export class ExecutionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExecutionConflictError";
  }
}

type ExecutionRow = {
  id: string;
  mandate_hash: Buffer;
  status: ExecutionStatus;
  mandate_status: string;
  typed_data: unknown;
  signature: Buffer;
  result_document: unknown;
  permission_document: unknown;
  lease_expires_at: Date | null;
  authorize_tx_hash: Buffer | null;
  begin_tx_hash: Buffer | null;
  execute_user_operation_hash: Buffer | null;
  execute_tx_hash: Buffer | null;
  settlement_tx_hash: Buffer | null;
  finalize_tx_hash: Buffer | null;
  pending_transaction_kind: ExecutionTransactionKind | null;
  pending_transaction_hash: Buffer | null;
  pending_raw_transaction: Buffer | null;
  pending_user_operation_hash: Buffer | null;
  last_error_code: string | null;
  last_error_detail: string | null;
};

const hex = (value: Buffer) => `0x${value.toString("hex")}` as `0x${string}`;

function jobFromRow(row: ExecutionRow): ExecutionJob {
  const document = signedMandateDocumentSchema.parse(row.typed_data);
  const session = mandateSessionPermissionSchema.parse(row.permission_document);
  const result = simulationResultSchema.parse(row.result_document);
  if (
    ![
      "SIGNED",
      "AUTHORIZED",
      "EXECUTING",
      "SUCCEEDED",
      "FAILED",
      "REVOKED",
      "EXPIRED",
    ].includes(row.mandate_status)
  ) {
    throw new Error("mandate projection status is not finalized");
  }
  return executionJobSchema.parse({
    executionId: row.id,
    mandateHash: hex(row.mandate_hash),
    status: row.status,
    mandateStatus: row.mandate_status,
    document,
    rootSignature: hex(row.signature),
    action: encodeSimulatedAction(result),
    session: { entityId: session.entityId, signer: session.sessionSigner },
    pending:
      row.pending_transaction_hash === null
        ? null
        : {
            kind: row.pending_transaction_kind,
            transactionHash: hex(row.pending_transaction_hash),
            rawTransaction: hex(row.pending_raw_transaction as Buffer),
            userOperationHash:
              row.pending_user_operation_hash === null
                ? null
                : hex(row.pending_user_operation_hash),
          },
    transactions: {
      authorize:
        row.authorize_tx_hash === null ? null : hex(row.authorize_tx_hash),
      begin: row.begin_tx_hash === null ? null : hex(row.begin_tx_hash),
      userOperation:
        row.execute_user_operation_hash === null
          ? null
          : hex(row.execute_user_operation_hash),
      perform: row.execute_tx_hash === null ? null : hex(row.execute_tx_hash),
      finalize:
        row.finalize_tx_hash === null ? null : hex(row.finalize_tx_hash),
    },
    lastError:
      row.last_error_code === null
        ? null
        : { code: row.last_error_code, detail: row.last_error_detail },
    leaseExpiresAt: row.lease_expires_at?.toISOString() ?? null,
  });
}

async function loadJob(
  tx: Sql | TransactionSql,
  mandateHash: Buffer,
): Promise<ExecutionJob> {
  const [row] = await tx<ExecutionRow[]>`
    select e.id, e.mandate_hash, e.status, m.status as mandate_status,
      m.typed_data, m.signature, s.result_document, p.permission_document,
      e.lease_expires_at, e.authorize_tx_hash, e.begin_tx_hash,
      e.execute_user_operation_hash, e.execute_tx_hash, e.finalize_tx_hash,
      e.settlement_tx_hash, e.pending_transaction_kind, e.pending_transaction_hash,
      e.pending_raw_transaction, e.pending_user_operation_hash,
      e.last_error_code, e.last_error_detail
    from executions e
    join mandates m on m.mandate_hash = e.mandate_hash
    join simulations s on s.id = m.simulation_id
    join wallet_policies p on p.id = m.wallet_policy_id
    where e.mandate_hash = ${mandateHash}
  `;
  if (!row) throw new Error("execution was not found");
  return jobFromRow(row);
}

function hashBuffer(value: `0x${string}`): Buffer {
  return Buffer.from(value.slice(2), "hex");
}

async function lockLease(
  tx: TransactionSql,
  mandateHash: Buffer,
  workerId: string,
  config: ExecutionServiceConfig,
): Promise<void> {
  const rows = await tx<{ id: string }[]>`
    select id from executions where mandate_hash = ${mandateHash}
      and lease_owner = ${workerId} and lease_expires_at > clock_timestamp()
    for update
  `;
  if (!rows[0]) throw new LeaseLostError();
  await tx`
    update executions set lease_expires_at = clock_timestamp() + ${config.leaseSeconds} * interval '1 second', updated_at = now()
    where mandate_hash = ${mandateHash}
  `;
}

export async function leaseExecution(
  sql: Sql,
  workerId: string,
  config: ExecutionServiceConfig,
): Promise<{ job: ExecutionJob | null }> {
  const pinnedCommerce = config.deployment.settlement
    ? hashBuffer(config.deployment.settlement.commerce.address)
    : null;
  return sql.begin(async (tx) => {
    const [row] = await tx<{ mandate_hash: Buffer }[]>`
      select e.mandate_hash
      from executions e join mandates m on m.mandate_hash = e.mandate_hash
      where e.status not in ('TERMINAL', 'REJECTED')
        and (e.lease_owner is null or e.lease_expires_at <= clock_timestamp())
        and (e.next_retry_at is null or e.next_retry_at <= clock_timestamp())
        and (m.erc8183_contract is null or m.erc8183_contract = ${pinnedCommerce})
        and m.chain_id = ${config.deployment.chainId}
        and m.mandate_executor_address = ${hashBuffer(config.deployment.mandateExecutor.address)}
      order by e.created_at
      for update of e skip locked limit 1
    `;
    if (!row) return { job: null };
    await tx`
      update executions set lease_owner = ${workerId},
        lease_expires_at = clock_timestamp() + ${config.leaseSeconds} * interval '1 second',
        next_retry_at = null,
        status = case when status in ('QUEUED', 'RETRY_WAIT') then 'LEASED' else status end,
        updated_at = now()
      where mandate_hash = ${row.mandate_hash}
    `;
    return { job: await loadJob(tx, row.mandate_hash) };
  });
}

export async function releaseExecution(
  sql: Sql,
  mandateHash: `0x${string}`,
  workerId: string,
  config: ExecutionServiceConfig,
): Promise<{ job: ExecutionJob }> {
  return sql.begin(async (tx) => {
    const key = hashBuffer(mandateHash);
    await lockLease(tx, key, workerId, config);
    await tx`update executions set lease_owner = null, lease_expires_at = null, updated_at = now() where mandate_hash = ${key}`;
    return { job: await loadJob(tx, key) };
  });
}

export async function deferExecution(
  sql: Sql,
  mandateHash: `0x${string}`,
  request: {
    workerId: string;
    code:
      | "APPROVAL_MISSING"
      | "INPUT_BALANCE_SHORT"
      | "CHAIN_UNAVAILABLE"
      | "COMMERCE_JOB_INVALID";
    retryAfterSeconds: number;
  },
  config: ExecutionServiceConfig,
): Promise<{ job: ExecutionJob }> {
  return sql.begin(async (tx) => {
    const key = hashBuffer(mandateHash);
    await lockLease(tx, key, request.workerId, config);
    const control = await loadControl(tx, key);
    if (control.pending_transaction_hash !== null) {
      throw new ExecutionConflictError(
        "a job with a pending transaction cannot be deferred",
      );
    }
    await tx`
      update executions set status = 'RETRY_WAIT',
        next_retry_at = clock_timestamp() + ${request.retryAfterSeconds} * interval '1 second',
        last_error_code = ${request.code}, last_error_detail = null,
        lease_owner = null, lease_expires_at = null, updated_at = now()
      where mandate_hash = ${key}
    `;
    return { job: await loadJob(tx, key) };
  });
}

type ControlRow = {
  commerce_contract: Buffer | null;
  commerce_job_id: string | null;
  settlement_tx_hash: Buffer | null;
  mandate_status: string;
  pending_transaction_kind: ExecutionTransactionKind | null;
  pending_transaction_hash: Buffer | null;
  pending_raw_transaction: Buffer | null;
  pending_user_operation_hash: Buffer | null;
  authorize_tx_hash: Buffer | null;
  execute_user_operation_hash: Buffer | null;
  typed_data: unknown;
  signature: Buffer;
  result_document: unknown;
  executor_address: Buffer;
  account_address: Buffer;
  simulation_block: string;
  /** First block not yet scanned for this mandate's finalized logs. */
  scan_from: string;
};

const cursorStream = (key: Buffer) => `mandate:0x${key.toString("hex")}`;

async function loadControl(
  tx: TransactionSql,
  key: Buffer,
): Promise<ControlRow> {
  const [row] = await tx<ControlRow[]>`
    select m.status as mandate_status, e.pending_transaction_kind, e.pending_transaction_hash,
      e.pending_raw_transaction, e.pending_user_operation_hash, e.authorize_tx_hash,
      e.execute_user_operation_hash, e.settlement_tx_hash, m.typed_data, m.signature, s.result_document,
      m.erc8183_contract as commerce_contract, m.erc8183_job_id::text as commerce_job_id,
      m.executor_address, m.account_address, s.block_number::text as simulation_block,
      coalesce(c.next_block_number, s.block_number)::text as scan_from
    from executions e
    join mandates m on m.mandate_hash = e.mandate_hash
    join simulations s on s.id = m.simulation_id
    left join indexer_checkpoints c
      on c.chain_id = m.chain_id and c.stream_name = ${cursorStream(key)}
    where e.mandate_hash = ${key}
  `;
  if (!row) throw new Error("execution was not found");
  return row;
}

/** Owner check and lease extension in their own short transaction; no row lock spans an RPC call. */
function readOwned(
  sql: Sql,
  key: Buffer,
  workerId: string,
  config: ExecutionServiceConfig,
) {
  return sql.begin(async (tx) => {
    await lockLease(tx, key, workerId, config);
    return loadControl(tx, key);
  });
}

const TERMINAL_MANDATES = new Set([
  "SUCCEEDED",
  "FAILED",
  "REVOKED",
  "EXPIRED",
]);

/** The worker-visible stage, derived only from the finalized projection and the pending transaction. */
function deriveStatus(row: {
  commerce_contract: Buffer | null;
  settlement_tx_hash: Buffer | null;
  commerceFinished?: boolean;
  mandate_status: string;
  pending_transaction_kind: ExecutionTransactionKind | null;
  execute_user_operation_hash: Buffer | null;
}): ExecutionStatus {
  switch (row.pending_transaction_kind) {
    case "AUTHORIZE":
      return "AUTHORIZING";
    case "BEGIN":
    case "FINALIZE_EXPIRED":
      return "AUTHORIZED";
    case "PERFORM":
      return "VERIFYING";
    case "FINALIZE_STALLED":
      return "EXECUTING";
    case "SETTLE":
      return "SETTLING";
    case "REJECT_JOB":
    case "CLAIM_REFUND":
      return "REFUNDING";
    case null:
      break;
  }
  if (TERMINAL_MANDATES.has(row.mandate_status)) {
    if (row.commerce_contract !== null && !row.commerceFinished)
      return row.mandate_status === "SUCCEEDED" ? "SETTLING" : "REFUNDING";
    return "TERMINAL";
  }
  if (row.mandate_status === "SIGNED") return "LEASED";
  if (row.mandate_status === "AUTHORIZED") return "AUTHORIZED";
  if (row.mandate_status === "EXECUTING") {
    return row.execute_user_operation_hash === null ? "EXECUTING" : "VERIFYING";
  }
  throw new Error(
    `mandate projection ${row.mandate_status} has no execution stage`,
  );
}

async function receiptOf(client: PublicClient, hash: Hash) {
  try {
    return await client.getTransactionReceipt({ hash });
  } catch (error) {
    if (error instanceof TransactionReceiptNotFoundError) return null;
    throw error;
  }
}

type Confirmation = {
  kind: ExecutionTransactionKind;
  transactionHash: Buffer;
  succeeded: boolean;
  userOperationHash: Buffer | null;
};

/**
 * Re-reads the chain at its `finalized` block and moves the durable record to
 * match: a finalized pending transaction is recorded (write-once) and cleared,
 * MandateExecutor's finalized events rebuild the mandate projection, and a
 * never-authorized mandate whose `authorize` now reverts is rejected for good.
 * The status is derived here; nothing the worker says can set it.
 */
export async function reconcileExecution(
  sql: Sql,
  mandateHash: Hash,
  workerId: string,
  config: ExecutionServiceConfig,
): Promise<{ job: ExecutionJob }> {
  const key = hashBuffer(mandateHash);
  const { client, deployment } = config;
  const before = await readOwned(sql, key, workerId, config);
  const finalized = await client.getBlock({ blockTag: "finalized" });

  let confirmation: Confirmation | null = null;
  if (before.pending_transaction_hash && before.pending_transaction_kind) {
    const receipt = await receiptOf(
      client,
      hex(before.pending_transaction_hash),
    );
    if (receipt && receipt.blockNumber <= finalized.number) {
      const canonical = await client.getBlock({
        blockNumber: receipt.blockNumber,
      });
      if (canonical.hash === receipt.blockHash) {
        let userOperationHash: Buffer | null = null;
        if (
          before.pending_transaction_kind === "PERFORM" &&
          before.pending_user_operation_hash
        ) {
          const expected = hex(before.pending_user_operation_hash);
          const included = parseEventLogs({
            abi: entryPoint07Abi,
            eventName: "UserOperationEvent",
            logs: receipt.logs,
          }).find(
            (log) =>
              log.address.toLowerCase() ===
                MODULAR_ACCOUNT_V2_ADDRESSES.entryPoint.toLowerCase() &&
              log.args.userOpHash.toLowerCase() === expected,
          );
          userOperationHash = included
            ? before.pending_user_operation_hash
            : null;
        }
        confirmation = {
          kind: before.pending_transaction_kind,
          succeeded:
            receipt.status === "success" &&
            (before.pending_transaction_kind !== "PERFORM" ||
              userOperationHash !== null),
          transactionHash: before.pending_transaction_hash,
          userOperationHash,
        };
      }
    }
  }

  const scan = await readFinalizedMandate({
    client,
    fromBlock: BigInt(before.scan_from),
    mandateExecutor: deployment.mandateExecutor.address,
    mandateHash,
    now: new Date(),
  });

  const settlement = deployment.settlement;
  if (before.commerce_contract !== null && !settlement)
    throw new Error("bound execution has no pinned settlement deployment");
  const commerce =
    before.commerce_contract !== null &&
    before.commerce_job_id !== null &&
    settlement &&
    TERMINAL_MANDATES.has(scan.recordStatus)
      ? await readFinalizedCommerceState({
          client,
          settlement,
          mandateExecutor: deployment.mandateExecutor.address,
          receiptStatus: scan.recordStatus,
          account: hex(before.account_address),
          commerceContract: hex(before.commerce_contract),
          jobId: BigInt(before.commerce_job_id),
          mandateHash,
          fromBlock: BigInt(before.simulation_block),
          finalizedBlock: scan.finalized.number,
          observedAt: new Date(),
        })
      : null;
  let rejection: string | null = null;
  const pendingRemains =
    before.pending_transaction_hash !== null && confirmation === null;
  if (
    scan.recordStatus === "NONE" &&
    before.mandate_status === "SIGNED" &&
    !pendingRemains &&
    before.authorize_tx_hash === null
  ) {
    const document = signedMandateDocumentSchema.parse(before.typed_data);
    try {
      await client.simulateContract({
        abi: mandateExecutorAbi,
        account: hex(before.executor_address),
        address: deployment.mandateExecutor.address,
        args: [
          getTaskMandateTypedData(document.message, document.domain).message,
          hex(before.signature),
        ],
        blockNumber: scan.finalized.number,
        functionName: "authorize",
      });
    } catch (error) {
      if (isTransportError(error)) throw error;
      rejection = revertName(error);
    }
  }

  return sql.begin(async (tx) => {
    await lockLease(tx, key, workerId, config);
    if (confirmation) {
      const hash = confirmation.transactionHash;
      const stage = confirmation.succeeded
        ? {
            authorize: confirmation.kind === "AUTHORIZE" ? hash : null,
            begin: confirmation.kind === "BEGIN" ? hash : null,
            finalize: confirmation.kind.startsWith("FINALIZE_") ? hash : null,
          }
        : { authorize: null, begin: null, finalize: null };
      await tx`
        update executions set
          authorize_tx_hash = coalesce(authorize_tx_hash, ${stage.authorize}),
          begin_tx_hash = coalesce(begin_tx_hash, ${stage.begin}),
          finalize_tx_hash = coalesce(finalize_tx_hash, ${stage.finalize}),
          execute_user_operation_hash = coalesce(execute_user_operation_hash, ${confirmation.userOperationHash}),
          execute_tx_hash = coalesce(execute_tx_hash, ${confirmation.userOperationHash ? hash : null}),
          pending_transaction_kind = null, pending_transaction_hash = null,
          pending_raw_transaction = null, pending_user_operation_hash = null,
          last_error_code = ${confirmation.succeeded ? null : "TRANSACTION_REVERTED"},
          last_error_detail = ${confirmation.succeeded ? null : confirmation.kind},
          updated_at = now()
        where mandate_hash = ${key}
      `;
    }
    await applyFinalizedEvents(tx, BigInt(deployment.chainId), scan.events);
    if (commerce) {
      await applyFinalizedEvents(
        tx,
        BigInt(deployment.chainId),
        commerce.events,
      );
      if (commerce.status === "CONFIRMED" && commerce.settlementTxHash) {
        await tx`
          update executions set settlement_tx_hash = coalesce(settlement_tx_hash, ${hashBuffer(commerce.settlementTxHash)}),
            updated_at = now()
          where mandate_hash = ${key}
        `;
      }
    }
    // The finalized cursor only moves forward; blocks at or below it cannot reorg.
    await tx`
      insert into indexer_checkpoints (
        chain_id, stream_name, next_block_number, last_canonical_block_hash, confirmation_depth
      ) values (
        ${deployment.chainId}, ${cursorStream(key)}, ${(scan.finalized.number + 1n).toString()},
        ${hashBuffer(scan.finalized.hash)}, 1
      )
      on conflict (chain_id, stream_name) do update set
        next_block_number = greatest(indexer_checkpoints.next_block_number, excluded.next_block_number),
        last_canonical_block_hash = case
          when excluded.next_block_number > indexer_checkpoints.next_block_number
          then excluded.last_canonical_block_hash
          else indexer_checkpoints.last_canonical_block_hash
        end,
        updated_at = now()
    `;

    const after = await loadControl(tx, key);
    const projected =
      after.mandate_status === "SIGNED" ? "NONE" : after.mandate_status;
    if (projected !== scan.recordStatus) {
      throw new Error(
        `finalized projection ${after.mandate_status} disagrees with MandateExecutor ${scan.recordStatus}`,
      );
    }
    const rejected =
      rejection !== null && after.pending_transaction_hash === null;
    const commerceFinished =
      commerce !== null &&
      (commerce.status === "CONFIRMED" ||
        commerce.status === "UNPAID" ||
        (scan.recordStatus !== "SUCCEEDED" &&
          (commerce.jobStatus === 4 || commerce.jobStatus === 5)));
    const status: ExecutionStatus = rejected
      ? "REJECTED"
      : deriveStatus({ ...after, commerceFinished });
    const finished = status === "TERMINAL" || status === "REJECTED";
    await tx`
      update executions set
        status = ${status},
        last_error_code = ${rejected ? "AUTHORIZATION_REJECTED" : tx`last_error_code`},
        last_error_detail = ${rejected ? rejection : tx`last_error_detail`},
        lease_owner = ${finished ? null : workerId},
        lease_expires_at = ${finished ? null : tx`lease_expires_at`},
        updated_at = now()
      where mandate_hash = ${key}
    `;
    return { job: await loadJob(tx, key) };
  });
}

const accountExecuteAbi = parseAbi([
  "function execute(address target, uint256 value, bytes data) payable returns (bytes)",
]);

const REQUIRED_PROJECTION: Record<ExecutionTransactionKind, string> = {
  AUTHORIZE: "SIGNED",
  BEGIN: "AUTHORIZED",
  FINALIZE_EXPIRED: "AUTHORIZED",
  PERFORM: "EXECUTING",
  FINALIZE_STALLED: "EXECUTING",
  SETTLE: "SUCCEEDED",
  REJECT_JOB: "FAILED",
  CLAIM_REFUND: "SUCCEEDED",
};

const same = (left: string, right: string) =>
  left.toLowerCase() === right.toLowerCase();

/**
 * Checks that signed transaction bytes are exactly the one call their stage
 * allows, from the mandate's executor, on this chain. For `PERFORM` the single
 * UserOperation must be the account calling `perform` with the stored mandate
 * and action, and its hash is read from the EntryPoint itself.
 */
async function assertStageTransaction(
  control: ControlRow,
  mandateHash: Hash,
  request: RecordPendingTransactionRequest,
  config: ExecutionServiceConfig,
): Promise<void> {
  const { deployment } = config;
  const transaction = parseTransaction(request.rawTransaction);
  const sender = await recoverTransactionAddress({
    serializedTransaction: request.rawTransaction as TransactionSerialized,
  });
  const document = signedMandateDocumentSchema.parse(control.typed_data);
  const { message } = getTaskMandateTypedData(
    document.message,
    document.domain,
  );
  const data = transaction.data ?? "0x";
  const problems: string[] = [];
  if (transaction.chainId !== Number(deployment.chainId))
    problems.push("chain");
  if (!same(sender, hex(control.executor_address))) problems.push("sender");
  if ((transaction.value ?? 0n) !== 0n) problems.push("value");

  const executorCall = (
    functionName:
      | "beginExecution"
      | "finalizeExpired"
      | "finalizeStalledExecution",
  ) =>
    encodeFunctionData({
      abi: mandateExecutorAbi,
      args: [mandateHash],
      functionName,
    });
  const expected: Record<Exclude<ExecutionTransactionKind, "PERFORM">, Hex> = {
    AUTHORIZE: encodeFunctionData({
      abi: mandateExecutorAbi,
      args: [message, hex(control.signature)],
      functionName: "authorize",
    }),
    BEGIN: executorCall("beginExecution"),
    FINALIZE_EXPIRED: executorCall("finalizeExpired"),
    FINALIZE_STALLED: executorCall("finalizeStalledExecution"),
    SETTLE: encodeFunctionData({
      abi: outcomeEvaluatorAbi,
      functionName: "settle",
      args: [BigInt(message.commerceJobId), mandateHash],
    }),
    REJECT_JOB: encodeFunctionData({
      abi: outcomeEvaluatorAbi,
      functionName: "reject",
      args: [BigInt(message.commerceJobId), mandateHash],
    }),
    CLAIM_REFUND: encodeFunctionData({
      abi: apexCommerceAbi,
      functionName: "claimRefund",
      args: [BigInt(message.commerceJobId)],
    }),
  };

  if (request.kind !== "PERFORM") {
    const settlementCall =
      request.kind === "SETTLE" ||
      request.kind === "REJECT_JOB" ||
      request.kind === "CLAIM_REFUND";
    const target =
      request.kind === "CLAIM_REFUND"
        ? deployment.settlement?.commerce.address
        : settlementCall
          ? deployment.settlement?.evaluator.address
          : deployment.mandateExecutor.address;
    if (
      settlementCall &&
      (!deployment.settlement ||
        !control.commerce_contract ||
        !same(
          hex(control.commerce_contract),
          deployment.settlement.commerce.address,
        ) ||
        control.commerce_job_id !== String(message.commerceJobId) ||
        message.commerceContract !== deployment.settlement.commerce.address)
    )
      problems.push("commerce binding");
    if (!transaction.to || !target || !same(transaction.to, target))
      problems.push("target");
    if (!same(data, expected[request.kind])) problems.push("call");
  } else {
    if (
      !transaction.to ||
      !same(transaction.to, MODULAR_ACCOUNT_V2_ADDRESSES.entryPoint)
    )
      problems.push("target");
    const handleOps = decodeFunctionData({ abi: entryPoint07Abi, data });
    const [operation, ...others] =
      handleOps.functionName === "handleOps" ? handleOps.args[0] : [];
    if (!operation || others.length > 0) {
      problems.push("operations");
    } else {
      if (!same(operation.sender, hex(control.account_address)))
        problems.push("account");
      if (!same(slice(operation.callData, 0, 4), EXECUTE_USER_OP_SELECTOR))
        problems.push("wrapper");
      const execute = decodeFunctionData({
        abi: accountExecuteAbi,
        data: slice(operation.callData, 4),
      });
      const [target, value, performData] = execute.args;
      if (!same(target, deployment.mandateExecutor.address) || value !== 0n)
        problems.push("account call");
      const perform = decodeFunctionData({
        abi: mandateExecutorAbi,
        data: performData,
      });
      if (perform.functionName !== "perform") {
        problems.push("function");
      } else {
        const action = encodeSimulatedAction(
          simulationResultSchema.parse(control.result_document),
        );
        const [, , proof, proofSignature] = perform.args;
        const rebuilt = encodeFunctionData({
          abi: mandateExecutorAbi,
          args: [message, action, proof, proofSignature],
          functionName: "perform",
        });
        if (!same(rebuilt, performData)) problems.push("mandate or action");
        if (
          !same(proof.mandateHash, mandateHash) ||
          !same(proof.account, hex(control.account_address))
        ) {
          problems.push("proof");
        }
      }
      const userOperationHash = await config.client.readContract({
        abi: entryPoint07Abi,
        address: MODULAR_ACCOUNT_V2_ADDRESSES.entryPoint,
        args: [operation],
        functionName: "getUserOpHash",
      });
      if (
        request.userOperationHash === null ||
        !same(userOperationHash, request.userOperationHash)
      ) {
        problems.push("UserOperation hash");
      }
    }
  }
  if (problems.length > 0) {
    throw new ExecutionConflictError(
      `the ${request.kind} transaction is not the allowed call: ${problems.join(", ")}`,
    );
  }
}

/**
 * Persists the one transaction the worker is about to broadcast, after
 * checking its bytes against the stage the finalized projection allows. The
 * same bytes again are idempotent; different bytes while one is pending are a
 * conflict.
 */
export async function recordPendingTransaction(
  sql: Sql,
  mandateHash: Hash,
  request: RecordPendingTransactionRequest,
  config: ExecutionServiceConfig,
): Promise<{ job: ExecutionJob }> {
  const key = hashBuffer(mandateHash);
  const transactionHash = keccak256(request.rawTransaction);
  const control = await readOwned(sql, key, request.workerId, config);
  if (control.pending_transaction_hash) {
    if (same(hex(control.pending_transaction_hash), transactionHash)) {
      return sql.begin(async (tx) => ({ job: await loadJob(tx, key) }));
    }
    throw new ExecutionConflictError(
      "another transaction is pending; it must be confirmed or retired first",
    );
  }
  if (
    request.kind === "REJECT_JOB"
      ? !["FAILED", "REVOKED", "EXPIRED"].includes(control.mandate_status)
      : request.kind === "CLAIM_REFUND"
        ? !TERMINAL_MANDATES.has(control.mandate_status)
        : control.mandate_status !== REQUIRED_PROJECTION[request.kind]
  ) {
    throw new ExecutionConflictError(
      `${request.kind} requires the matching finalized mandate outcome`,
    );
  }
  if (
    request.kind === "PERFORM" &&
    control.execute_user_operation_hash !== null
  ) {
    throw new ExecutionConflictError(
      "a UserOperation was already included for this mandate",
    );
  }
  await assertStageTransaction(control, mandateHash, request, config);

  return sql.begin(async (tx) => {
    await lockLease(tx, key, request.workerId, config);
    const current = await loadControl(tx, key);
    if (
      current.pending_transaction_hash !== null ||
      current.mandate_status !== control.mandate_status ||
      current.commerce_job_id !== control.commerce_job_id ||
      (current.settlement_tx_hash !== null &&
        (request.kind === "SETTLE" ||
          request.kind === "REJECT_JOB" ||
          request.kind === "CLAIM_REFUND"))
    ) {
      throw new ExecutionConflictError(
        "the execution changed while the transaction was checked",
      );
    }
    await tx`
      update executions set
        pending_transaction_kind = ${request.kind},
        pending_transaction_hash = ${hashBuffer(transactionHash)},
        pending_raw_transaction = ${hashBuffer(request.rawTransaction)},
        pending_user_operation_hash = ${request.userOperationHash ? hashBuffer(request.userOperationHash) : null},
        submission_attempts = submission_attempts + 1,
        status = ${deriveStatus({ ...current, pending_transaction_kind: request.kind })},
        updated_at = now()
      where mandate_hash = ${key}
    `;
    return { job: await loadJob(tx, key) };
  });
}

/**
 * Clears a pending transaction that can never be included: it has no receipt
 * and the executor's nonce it used is consumed at the `finalized` block by
 * another transaction. The next step is re-decided from chain state.
 */
export async function retireReplacedTransaction(
  sql: Sql,
  mandateHash: Hash,
  request: { workerId: string; transactionHash: Hash },
  config: ExecutionServiceConfig,
): Promise<{ job: ExecutionJob }> {
  const key = hashBuffer(mandateHash);
  const control = await readOwned(sql, key, request.workerId, config);
  if (
    !control.pending_transaction_hash ||
    !control.pending_raw_transaction ||
    !same(hex(control.pending_transaction_hash), request.transactionHash)
  ) {
    throw new ExecutionConflictError(
      "only the current pending transaction can be retired",
    );
  }
  if (await receiptOf(config.client, request.transactionHash)) {
    throw new ExecutionConflictError(
      "the pending transaction was included; it cannot be retired",
    );
  }
  const { nonce } = parseTransaction(hex(control.pending_raw_transaction));
  const finalizedNonce = await config.client.getTransactionCount({
    address: hex(control.executor_address) as Address,
    blockTag: "finalized",
  });
  if (nonce === undefined || finalizedNonce <= nonce) {
    throw new ExecutionConflictError(
      "the pending transaction's nonce is not finalized under another transaction",
    );
  }

  return sql.begin(async (tx) => {
    await lockLease(tx, key, request.workerId, config);
    const current = await loadControl(tx, key);
    if (
      !current.pending_transaction_hash ||
      !same(hex(current.pending_transaction_hash), request.transactionHash)
    ) {
      throw new ExecutionConflictError(
        "the pending transaction changed while it was checked",
      );
    }
    await tx`
      update executions set
        pending_transaction_kind = null, pending_transaction_hash = null,
        pending_raw_transaction = null, pending_user_operation_hash = null,
        status = ${deriveStatus({ ...current, pending_transaction_kind: null })},
        updated_at = now()
      where mandate_hash = ${key}
    `;
    return { job: await loadJob(tx, key) };
  });
}
