import {
  mandateSessionPermissionSchema,
  policyListResponseSchema,
  type TaskDetail,
  type TaskSummary,
  taskDetailSchema,
  taskListResponseSchema,
  type WalletSessionView,
  walletPolicySchema,
} from "@perago/sdk";
import type { Sql } from "postgres";

import type { WalletIdentity } from "../auth/wallet-auth.js";
import { decryptGoal, type TaskServiceConfig } from "./tasks.js";

const asHex = (value: Buffer) => `0x${value.toString("hex")}` as `0x${string}`;

export function sessionView(identity: WalletIdentity): WalletSessionView {
  return {
    account: identity.account,
    chainId: "97",
    expiresAt: identity.expiresAt,
    ownerEpoch: identity.ownerEpoch,
    rootOwner: identity.rootOwner,
    walletId: identity.walletId,
  };
}

type PolicyRow = {
  created_at: Date;
  id: string;
  permission_document: unknown | null;
  policy_document: unknown;
  policy_hash: Buffer;
  status: "DRAFT" | "ACTIVATING" | "ACTIVE" | "SUPERSEDED" | "REVOKED";
  updated_at: Date;
  version: number;
};

/** Reads all policies owned by the authenticated wallet, newest version first. */
export async function listPolicies(sql: Sql, identity: WalletIdentity) {
  const rows = await sql<PolicyRow[]>`
    select id, version, status, policy_document, policy_hash, permission_document,
      created_at, coalesce(terminal_at, activated_at, created_at) as updated_at
    from wallet_policies where wallet_id = ${identity.walletId}
    order by version desc
  `;
  return policyListResponseSchema.parse({
    policies: rows.map((row) => {
      const permission = row.permission_document
        ? mandateSessionPermissionSchema.parse(row.permission_document)
        : null;
      return {
        createdAt: row.created_at.toISOString(),
        permission,
        policy: walletPolicySchema.parse(row.policy_document),
        policyHash: asHex(row.policy_hash),
        policyId: row.id,
        status: row.status,
        updatedAt: row.updated_at.toISOString(),
        validUntil: permission?.validUntil ?? null,
        version: String(row.version),
      };
    }),
  });
}

type TaskSummaryRow = {
  created_at: Date;
  execution_status: string | null;
  goal_ciphertext: Buffer | null;
  id: string;
  kind: "SWAP" | "STAKE" | null;
  mandate_hash: Buffer | null;
  mandate_status: string | null;
  status: string;
};

export async function listTaskSummaries(
  sql: Sql,
  identity: WalletIdentity,
  config: TaskServiceConfig,
  limit: number,
) {
  const rows = await sql<TaskSummaryRow[]>`
    select t.id, t.status, t.intent_text_ciphertext as goal_ciphertext, t.created_at,
      t.compiled_plan #>> '{action,kind}' as kind, m.mandate_hash, m.status as mandate_status,
      e.status as execution_status
    from tasks t
    left join mandates m on m.task_id = t.id
    left join executions e on e.mandate_hash = m.mandate_hash
    where t.wallet_id = ${identity.walletId}
    order by t.created_at desc limit ${limit}
  `;
  const tasks: TaskSummary[] = rows.map((row) => ({
    createdAt: row.created_at.toISOString(),
    executionStatus: row.execution_status,
    goal: goalOf(config, row.id, row.goal_ciphertext),
    kind: row.kind,
    mandateHash: row.mandate_hash ? asHex(row.mandate_hash) : null,
    mandateStatus: row.mandate_status,
    status: row.status,
    taskId: row.id,
  }));
  return taskListResponseSchema.parse({ tasks });
}

type TaskDetailRow = {
  created_at: Date;
  decision: unknown | null;
  decision_hash: Buffer | null;
  execution_begin: Buffer | null;
  execution_error_code: string | null;
  execution_error_detail: string | null;
  execution_execution: Buffer | null;
  execution_status: string | null;
  execution_submission_attempts: number | null;
  execution_updated_at: Date | null;
  execution_user_operation: Buffer | null;
  execution_authorize: Buffer | null;
  goal_ciphertext: Buffer | null;
  id: string;
  intent_hash: Buffer;
  mandate_created_at: Date | null;
  mandate_document: unknown | null;
  mandate_hash: Buffer | null;
  mandate_status: string | null;
  plan: unknown | null;
  plan_hash: Buffer | null;
  receipt_status: "SUCCEEDED" | "FAILED" | "REVOKED" | "EXPIRED" | null;
  simulation_created_at: Date | null;
  simulation_hash: Buffer | null;
  simulation_id: string | null;
  simulation_result: unknown | null;
  simulation_sequence: number | null;
  simulation_status: "PASSED" | "REVERTED" | "STALE" | "ERROR" | null;
  status: string;
  terminal_reason_code: string | null;
  updated_at: Date;
};

/** Reads one task only when it belongs to the authenticated wallet. */
export async function getTaskDetail(
  sql: Sql,
  identity: WalletIdentity,
  config: TaskServiceConfig,
  taskId: string,
): Promise<TaskDetail> {
  const [row] = await sql<TaskDetailRow[]>`
    select t.id, t.status, t.intent_text_ciphertext as goal_ciphertext, t.intent_hash,
      t.compiled_plan as plan, t.plan_hash, t.policy_decision as decision,
      t.policy_decision_hash as decision_hash, t.created_at, t.updated_at,
      s.id as simulation_id, s.sequence as simulation_sequence, s.status as simulation_status,
      s.simulation_hash, s.result_document as simulation_result, s.created_at as simulation_created_at,
      m.mandate_hash, m.typed_data as mandate_document, m.status as mandate_status,
      m.created_at as mandate_created_at, m.terminal_reason_code,
      e.status as execution_status, e.last_error_code as execution_error_code,
      e.last_error_detail as execution_error_detail, e.submission_attempts as execution_submission_attempts,
      e.authorize_tx_hash as execution_authorize, e.begin_tx_hash as execution_begin,
      e.execute_user_operation_hash as execution_user_operation, e.execute_tx_hash as execution_execution,
      e.updated_at as execution_updated_at, r.status as receipt_status
    from tasks t
    left join lateral (
      select id, sequence, status, simulation_hash, result_document, created_at
      from simulations where task_id = t.id order by sequence desc limit 1
    ) s on true
    left join mandates m on m.task_id = t.id
    left join executions e on e.mandate_hash = m.mandate_hash
    left join execution_receipts r on r.mandate_hash = m.mandate_hash
    where t.id = ${taskId} and t.wallet_id = ${identity.walletId}
  `;
  if (!row) throw new Error("task was not found");
  return taskDetailSchema.parse({
    createdAt: row.created_at.toISOString(),
    decision: row.decision,
    decisionHash: row.decision_hash ? asHex(row.decision_hash) : null,
    execution:
      row.execution_status === null || row.execution_updated_at === null
        ? null
        : {
            lastErrorCode: row.execution_error_code,
            lastErrorDetail: row.execution_error_detail,
            status: row.execution_status,
            submissionAttempts: row.execution_submission_attempts ?? 0,
            transactions: {
              authorize: row.execution_authorize
                ? asHex(row.execution_authorize)
                : null,
              begin: row.execution_begin ? asHex(row.execution_begin) : null,
              execution: row.execution_execution
                ? asHex(row.execution_execution)
                : null,
              userOperation: row.execution_user_operation
                ? asHex(row.execution_user_operation)
                : null,
            },
            updatedAt: row.execution_updated_at.toISOString(),
          },
    goal: goalOf(config, row.id, row.goal_ciphertext),
    intentHash: asHex(row.intent_hash),
    mandate:
      row.mandate_hash === null ||
      row.mandate_document === null ||
      row.mandate_created_at === null
        ? null
        : {
            createdAt: row.mandate_created_at.toISOString(),
            mandate: mandateMessage(row.mandate_document),
            mandateHash: asHex(row.mandate_hash),
            status: row.mandate_status ?? "SIGNED",
          },
    plan: row.plan,
    planHash: row.plan_hash ? asHex(row.plan_hash) : null,
    receipt:
      row.receipt_status === null || row.terminal_reason_code === null
        ? null
        : {
            status: row.receipt_status,
            terminalReasonCode: row.terminal_reason_code,
          },
    simulation:
      row.simulation_id === null ||
      row.simulation_hash === null ||
      row.simulation_result === null ||
      row.simulation_created_at === null ||
      row.simulation_sequence === null ||
      row.simulation_status === null ||
      row.simulation_status === "ERROR"
        ? null
        : {
            createdAt: row.simulation_created_at.toISOString(),
            result: row.simulation_result,
            sequence: row.simulation_sequence,
            simulationHash: asHex(row.simulation_hash),
            simulationId: row.simulation_id,
            status: row.simulation_status,
          },
    status: row.status,
    taskId: row.id,
    updatedAt: row.updated_at.toISOString(),
  });
}

function goalOf(
  config: TaskServiceConfig,
  taskId: string,
  ciphertext: Buffer | null,
) {
  if (!ciphertext) throw new Error("task intent is unavailable");
  return decryptGoal(config.intentKey, taskId, ciphertext);
}

function mandateMessage(document: unknown): unknown {
  if (
    typeof document !== "object" ||
    document === null ||
    !("message" in document)
  ) {
    throw new Error("stored mandate document is invalid");
  }
  return document.message;
}
