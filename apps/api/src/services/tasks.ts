import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";
import {
  type Address,
  type CompiledPlan,
  canonicalJson,
  createTaskRequestSchema,
  type Hash,
  hashTaskIntent,
  type PolicyDecision,
  type ProtocolCatalog,
  REASON_MESSAGES,
  type ReasonCode,
  type TaskIntent,
  walletPolicySchema,
} from "@perago/sdk";
import type { JSONValue, Sql, TransactionSql } from "postgres";

import type { WalletIdentity } from "../auth/wallet-auth.js";
import { COMPILER_VERSION, compileCandidate } from "../compiler/compile.js";
import { buildPlannerPrompt } from "../planner/prompt.js";
import { type Planner, PlannerUnavailableError } from "../planner/provider.js";

const CIPHER_VERSION = 1;

export type TaskServiceConfig = {
  catalog: ProtocolCatalog;
  /** A COMPILING task older than this may be reclaimed after a crash. */
  compileLeaseSeconds: number;
  /** 32-byte AES-256-GCM key for raw intent text at rest. */
  intentKey: Buffer;
  now: () => Date;
};

export type TaskView = {
  compilerVersion: string | null;
  decision: PolicyDecision | null;
  decisionHash: Hash | null;
  intentHash: Hash;
  plan: CompiledPlan | null;
  planHash: Hash | null;
  status: string;
  taskId: string;
};

export type CreateTaskResult =
  | { kind: "COMPILED"; task: TaskView }
  | { kind: "IN_PROGRESS"; taskId: string }
  | {
      kind: "PLANNING_FAILED";
      message: string;
      question: string | null;
      reasonCode: Extract<
        ReasonCode,
        | "PLANNER_UNAVAILABLE"
        | "PLANNER_OUTPUT_INVALID"
        | "INTENT_NEEDS_CLARIFICATION"
      >;
      taskId: string;
    };

type TaskRow = {
  compiled_plan: CompiledPlan | null;
  compiler_version: string | null;
  id: string;
  intent_document: Omit<TaskIntent, "goal">;
  intent_hash: Buffer;
  intent_text_ciphertext: Buffer | null;
  plan_hash: Buffer | null;
  policy_decision: PolicyDecision | null;
  policy_decision_hash: Buffer | null;
  status: string;
  wallet_policy_id: string;
};

function asBuffer(value: `0x${string}`): Buffer {
  return Buffer.from(value.slice(2), "hex");
}

function asHash(value: Uint8Array): Hash {
  return `0x${Buffer.from(value).toString("hex")}`;
}

export function validateTaskConfig(config: TaskServiceConfig): void {
  if (config.intentKey.length !== 32) {
    throw new RangeError("the intent encryption key must be 32 bytes");
  }
  if (config.compileLeaseSeconds <= 0) {
    throw new RangeError("the compile lease must be positive");
  }
}

/** AES-256-GCM, bound to the task id so a ciphertext cannot move rows. */
function encryptGoal(key: Buffer, taskId: string, goal: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`perago-intent-v${CIPHER_VERSION}:${taskId}`));
  const body = Buffer.concat([cipher.update(goal, "utf8"), cipher.final()]);
  return Buffer.concat([
    Buffer.from([CIPHER_VERSION]),
    iv,
    cipher.getAuthTag(),
    body,
  ]);
}

function decryptGoal(key: Buffer, taskId: string, sealed: Buffer): string {
  if (sealed[0] !== CIPHER_VERSION) {
    throw new Error("intent ciphertext version is unsupported");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, sealed.subarray(1, 13));
  decipher.setAAD(Buffer.from(`perago-intent-v${CIPHER_VERSION}:${taskId}`));
  decipher.setAuthTag(sealed.subarray(13, 29));
  return Buffer.concat([
    decipher.update(sealed.subarray(29)),
    decipher.final(),
  ]).toString("utf8");
}

function toView(row: TaskRow): TaskView {
  return {
    compilerVersion: row.compiler_version,
    decision: row.policy_decision,
    decisionHash: row.policy_decision_hash
      ? asHash(row.policy_decision_hash)
      : null,
    intentHash: asHash(row.intent_hash),
    plan: row.compiled_plan,
    planHash: row.plan_hash ? asHash(row.plan_hash) : null,
    status: row.status,
    taskId: row.id,
  };
}

async function loadTask(sql: Sql, taskId: string): Promise<TaskRow> {
  const [row] = await sql<TaskRow[]>`
    select id, status, wallet_policy_id, intent_document, intent_hash,
      intent_text_ciphertext, compiled_plan, plan_hash, compiler_version,
      policy_decision, policy_decision_hash
    from tasks where id = ${taskId}
  `;
  if (!row) throw new Error("task was not found");
  return row;
}

/** Signed ceilings of live or spent mandates signed in the trailing 24 hours. */
export async function loadDailySpent(
  sql: Sql | TransactionSql,
  walletId: string,
  now: Date,
): Promise<Map<Address, bigint>> {
  const rows = await sql<{ spent: string; token: Address }[]>`
    select t.compiled_plan #>> '{action,inputToken}' as token,
      sum((t.compiled_plan #>> '{action,inputAmount}')::numeric)::text as spent
    from mandates m
    join tasks t on t.id = m.task_id
    where m.wallet_id = ${walletId}
      and m.status not in ('REVOKED', 'EXPIRED')
      and m.created_at > ${now}::timestamptz - interval '24 hours'
    group by 1
  `;
  return new Map(rows.map((row) => [row.token, BigInt(row.spent)]));
}

/**
 * Creates (or idempotently resumes) one task and compiles it: the planner's
 * untrusted output is strictly parsed and intersected with the active Wallet
 * Policy, and the rule-by-rule decision is persisted whether it passes or not.
 * Planner failure leaves the task in DRAFT so the same request can retry.
 */
export async function createTask(
  sql: Sql,
  identity: WalletIdentity,
  requestInput: unknown,
  config: TaskServiceConfig,
  planner: Planner,
): Promise<CreateTaskResult> {
  const request = createTaskRequestSchema.parse(requestInput);
  if (
    request.intent.account !== identity.account ||
    request.intent.chainId !== identity.chainId
  ) {
    throw new Error("task intent does not match the authenticated wallet");
  }

  const [policyRow] = await sql<
    { id: string; policy_document: unknown; policy_hash: Buffer }[]
  >`
    select id, policy_document, policy_hash from wallet_policies
    where wallet_id = ${identity.walletId} and status = 'ACTIVE'
  `;
  if (!policyRow) {
    throw new Error("only a wallet with an active policy can compile a task");
  }
  const policy = walletPolicySchema.parse(policyRow.policy_document);
  if (
    policy.account !== identity.account ||
    policy.chainId !== identity.chainId
  ) {
    throw new Error(
      "active wallet policy does not match the authenticated wallet",
    );
  }

  const taskId = randomUUID();
  const { goal, ...intentFields } = request.intent;
  const intentDocument = { ...intentFields, salt: asHash(randomBytes(32)) };
  const intent: TaskIntent = { ...intentDocument, goal };
  const intentHash = hashTaskIntent(intent);
  const [inserted] = await sql<{ id: string }[]>`
    insert into tasks (
      id, wallet_id, wallet_policy_id, client_request_id, status,
      intent_text_ciphertext, intent_hash, intent_document
    ) values (
      ${taskId}, ${identity.walletId}, ${policyRow.id}, ${request.clientRequestId},
      'DRAFT', ${encryptGoal(config.intentKey, taskId, goal)},
      ${asBuffer(intentHash)}, ${sql.json(intentDocument as unknown as JSONValue)}
    )
    on conflict (wallet_id, client_request_id) do nothing
    returning id
  `;

  let row: TaskRow;
  if (inserted) {
    row = await loadTask(sql, taskId);
  } else {
    const [existing] = await sql<{ id: string }[]>`
      select id from tasks
      where wallet_id = ${identity.walletId}
        and client_request_id = ${request.clientRequestId}
    `;
    if (!existing) throw new Error("task was not found");
    row = await loadTask(sql, existing.id);
    const { salt: _salt, ...storedFields } = row.intent_document;
    if (
      !row.intent_text_ciphertext ||
      canonicalJson(storedFields) !== canonicalJson(intentFields) ||
      decryptGoal(config.intentKey, row.id, row.intent_text_ciphertext) !== goal
    ) {
      throw new Error(
        "a client request id cannot be reused for a different intent",
      );
    }
    if (row.status !== "DRAFT" && row.status !== "COMPILING") {
      return { kind: "COMPILED", task: toView(row) };
    }
    if (row.wallet_policy_id !== policyRow.id) {
      throw new Error("task policy is stale; submit the goal as a new request");
    }
  }

  const [claimed] = await sql<{ id: string }[]>`
    update tasks set status = 'COMPILING', updated_at = now()
    where id = ${row.id} and (
      status = 'DRAFT' or (
        status = 'COMPILING'
        and updated_at < now() - make_interval(secs => ${config.compileLeaseSeconds})
      )
    )
    returning id
  `;
  if (!claimed) return { kind: "IN_PROGRESS", taskId: row.id };

  const storedIntent: TaskIntent = { ...row.intent_document, goal };
  const release = async (
    reasonCode: Extract<
      CreateTaskResult,
      { kind: "PLANNING_FAILED" }
    >["reasonCode"],
    question: string | null,
  ): Promise<CreateTaskResult> => {
    await sql`
      update tasks set status = 'DRAFT', updated_at = now()
      where id = ${row.id} and status = 'COMPILING'
    `;
    return {
      kind: "PLANNING_FAILED",
      message: REASON_MESSAGES[reasonCode],
      question,
      reasonCode,
      taskId: row.id,
    };
  };

  let candidate: unknown;
  try {
    candidate = await planner(buildPlannerPrompt(config.catalog, storedIntent));
  } catch (error) {
    if (error instanceof PlannerUnavailableError) {
      return release("PLANNER_UNAVAILABLE", null);
    }
    await release("PLANNER_UNAVAILABLE", null);
    throw error;
  }

  const outcome = compileCandidate({
    catalog: config.catalog,
    candidate,
    dailySpent: await loadDailySpent(sql, identity.walletId, config.now()),
    intent: storedIntent,
    intentHash: asHash(row.intent_hash),
    policy,
    policyHash: asHash(policyRow.policy_hash),
  });
  if (outcome.status === "PLANNING_FAILED") {
    return release(outcome.reasonCode, null);
  }
  if (outcome.status === "NEEDS_CLARIFICATION") {
    return release(outcome.reasonCode, outcome.question);
  }

  const plan = outcome.status === "READY_TO_SIMULATE" ? outcome.plan : null;
  const planHash =
    outcome.status === "READY_TO_SIMULATE" ? asBuffer(outcome.planHash) : null;
  const persisted = await sql`
    update tasks set
      status = ${outcome.status},
      compiled_plan = ${plan ? sql.json(plan as unknown as JSONValue) : null},
      plan_hash = ${planHash},
      compiler_version = ${COMPILER_VERSION},
      policy_decision = ${sql.json(outcome.decision as unknown as JSONValue)},
      policy_decision_hash = ${asBuffer(outcome.decisionHash)},
      updated_at = now()
    where id = ${row.id} and status = 'COMPILING'
  `;
  const current = await loadTask(sql, row.id);
  if (persisted.count === 0 && current.policy_decision === null) {
    return { kind: "IN_PROGRESS", taskId: row.id };
  }
  return { kind: "COMPILED", task: toView(current) };
}
