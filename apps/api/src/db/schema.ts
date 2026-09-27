import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const policyStatus = pgEnum("policy_status", [
  "DRAFT",
  "ACTIVATING",
  "ACTIVE",
  "SUPERSEDED",
  "REVOKED",
]);
export const taskStatus = pgEnum("task_status", [
  "DRAFT",
  "COMPILING",
  "REJECTED_POLICY",
  "READY_TO_SIMULATE",
  "SIMULATED",
  "READY_TO_SIGN",
  "SIGNED",
  "CANCELLED",
]);
export const mandateStatus = pgEnum("mandate_status", [
  "SIGNED",
  "AUTHORIZING",
  "AUTHORIZED",
  "EXECUTING",
  "SUCCEEDED",
  "FAILED",
  "REVOKING",
  "REVOKED",
  "EXPIRING",
  "EXPIRED",
]);
export const executionStatus = pgEnum("execution_status", [
  "QUEUED",
  "LEASED",
  "AUTHORIZING",
  "AUTHORIZED",
  "EXECUTING",
  "VERIFYING",
  "SETTLING",
  "REFUNDING",
  "RETRY_WAIT",
  "TERMINAL",
  "REJECTED",
]);
export const executionTransactionKind = pgEnum("execution_transaction_kind", [
  "AUTHORIZE",
  "BEGIN",
  "PERFORM",
  "FINALIZE_EXPIRED",
  "FINALIZE_STALLED",
  "SETTLE",
  "REJECT_JOB",
  "CLAIM_REFUND",
]);
export const verificationStatus = pgEnum("verification_status", [
  "PASSED",
  "FAILED",
  "ERROR",
]);
export const receiptStatus = pgEnum("receipt_status", [
  "SUCCEEDED",
  "FAILED",
  "REVOKED",
  "EXPIRED",
]);
export const chainEventStatus = pgEnum("chain_event_status", [
  "OBSERVED",
  "CONFIRMED",
  "ORPHANED",
]);
export const adapterStatus = pgEnum("adapter_status", [
  "PROPOSED",
  "VALIDATING",
  "ACTIVE",
  "PAUSED",
  "RETIRED",
]);

const createdAt = timestamp("created_at", { withTimezone: true })
  .notNull()
  .defaultNow();
const updatedAt = timestamp("updated_at", { withTimezone: true })
  .notNull()
  .defaultNow();
export const walletAuthChallenges = pgTable(
  "wallet_auth_challenges",
  {
    id: uuid().primaryKey(),
    domain: text().notNull(),
    uri: text().notNull(),
    chainId: bigint("chain_id", { mode: "bigint" }).notNull(),
    accountAddress: bytea("account_address").notNull(),
    rootOwnerAddress: bytea("root_owner_address").notNull(),
    nonce: text().notNull().unique(),
    message: text().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt,
  },
  (table) => [
    check(
      "wallet_auth_challenge_account_length",
      sql`octet_length(${table.accountAddress}) = 20`,
    ),
    check(
      "wallet_auth_challenge_owner_length",
      sql`octet_length(${table.rootOwnerAddress}) = 20`,
    ),
    check(
      "wallet_auth_challenge_expiry",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    check(
      "wallet_auth_challenge_consumption",
      sql`${table.consumedAt} is null or ${table.consumedAt} >= ${table.createdAt}`,
    ),
  ],
);

export const wallets = pgTable(
  "wallets",
  {
    id: uuid().primaryKey(),
    chainId: bigint("chain_id", { mode: "bigint" }).notNull(),
    accountAddress: bytea("account_address").notNull(),
    rootOwnerAddress: bytea("root_owner_address").notNull(),
    accountType: text("account_type").notNull(),
    accountVersion: text("account_version").notNull(),
    entryPointAddress: bytea("entry_point_address").notNull(),
    factoryAddress: bytea("factory_address"),
    ownerEpoch: bigint("owner_epoch", { mode: "bigint" }).notNull().default(0n),
    createdAt,
    updatedAt,
  },
  (table) => [
    unique("wallet_chain_account_unique").on(
      table.chainId,
      table.accountAddress,
    ),
    unique("wallet_owner_account_unique").on(
      table.chainId,
      table.rootOwnerAddress,
      table.accountAddress,
    ),
    check(
      "wallet_account_address_length",
      sql`octet_length(${table.accountAddress}) = 20`,
    ),
    check(
      "wallet_root_owner_length",
      sql`octet_length(${table.rootOwnerAddress}) = 20`,
    ),
    check(
      "wallet_entry_point_length",
      sql`octet_length(${table.entryPointAddress}) = 20`,
    ),
    check(
      "wallet_factory_length",
      sql`${table.factoryAddress} is null or octet_length(${table.factoryAddress}) = 20`,
    ),
  ],
);
export const walletSessions = pgTable(
  "wallet_sessions",
  {
    tokenHash: bytea("token_hash").primaryKey(),
    walletId: uuid("wallet_id")
      .notNull()
      .references(() => wallets.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt,
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    index("wallet_session_wallet_idx").on(table.walletId),
    index("wallet_session_expiry_idx").on(table.expiresAt),
    check(
      "wallet_session_token_hash_length",
      sql`octet_length(${table.tokenHash}) = 32`,
    ),
    check(
      "wallet_session_expiry",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    check(
      "wallet_session_revocation",
      sql`${table.revokedAt} is null or ${table.revokedAt} >= ${table.createdAt}`,
    ),
  ],
);

export const walletPolicies = pgTable(
  "wallet_policies",
  {
    id: uuid().primaryKey(),
    walletId: uuid("wallet_id")
      .notNull()
      .references(() => wallets.id),
    version: integer().notNull(),
    schemaVersion: text("schema_version").notNull(),
    status: policyStatus().notNull(),
    policyDocument: jsonb("policy_document").notNull(),
    policyHash: bytea("policy_hash").notNull(),
    permissionDocument: jsonb("permission_document"),
    permissionHash: bytea("permission_hash"),
    permissionCallData: bytea("permission_call_data"),
    permissionUserOperationHash: bytea("permission_user_operation_hash"),
    permissionTxHash: bytea("permission_tx_hash"),
    activationCallData: bytea("activation_call_data"),
    activationUserOperationHash: bytea("activation_user_operation_hash"),
    activationTxHash: bytea("activation_tx_hash"),
    activationBlockNumber: bigint("activation_block_number", {
      mode: "bigint",
    }),
    revocationCallData: bytea("revocation_call_data"),
    revocationUserOperationHash: bytea("revocation_user_operation_hash"),
    revocationTxHash: bytea("revocation_tx_hash"),
    revocationBlockNumber: bigint("revocation_block_number", {
      mode: "bigint",
    }),
    createdAt,
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    terminalAt: timestamp("terminal_at", { withTimezone: true }),
  },
  (table) => [
    unique("wallet_policy_version_unique").on(table.walletId, table.version),
    unique("wallet_policy_hash_unique").on(table.walletId, table.policyHash),
    uniqueIndex("wallet_one_active_policy")
      .on(table.walletId)
      .where(sql`${table.status} = 'ACTIVE'`),
    check("wallet_policy_positive_version", sql`${table.version} > 0`),
    check(
      "wallet_policy_hash_length",
      sql`octet_length(${table.policyHash}) = 32`,
    ),
    check(
      "wallet_policy_permission_hash_length",
      sql`${table.permissionHash} is null or octet_length(${table.permissionHash}) = 32`,
    ),
    check(
      "wallet_policy_permission_user_operation_hash_length",
      sql`${table.permissionUserOperationHash} is null or octet_length(${table.permissionUserOperationHash}) = 32`,
    ),
    check(
      "wallet_policy_permission_tx_hash_length",
      sql`${table.permissionTxHash} is null or octet_length(${table.permissionTxHash}) = 32`,
    ),
    check(
      "wallet_policy_activation_user_operation_hash_length",
      sql`${table.activationUserOperationHash} is null or octet_length(${table.activationUserOperationHash}) = 32`,
    ),
    check(
      "wallet_policy_revocation_user_operation_hash_length",
      sql`${table.revocationUserOperationHash} is null or octet_length(${table.revocationUserOperationHash}) = 32`,
    ),
    check(
      "wallet_policy_revocation_tx_hash_length",
      sql`${table.revocationTxHash} is null or octet_length(${table.revocationTxHash}) = 32`,
    ),
    check(
      "wallet_policy_revocation_fields",
      sql`${table.status} <> 'REVOKED' or ${table.permissionDocument} is null or (${table.revocationCallData} is not null and ${table.revocationUserOperationHash} is not null and ${table.revocationTxHash} is not null and ${table.revocationBlockNumber} is not null and ${table.terminalAt} is not null)`,
    ),
    check(
      "wallet_policy_activation_fields",
      sql`${table.status} <> 'ACTIVE' or (${table.permissionDocument} is not null and ${table.permissionHash} is not null and ${table.permissionCallData} is not null and ${table.permissionUserOperationHash} is not null and ${table.permissionTxHash} is not null and ${table.activationCallData} is not null and ${table.activationUserOperationHash} is not null and ${table.activationTxHash} is not null and ${table.activationBlockNumber} is not null and ${table.activatedAt} is not null)`,
    ),
    check(
      "wallet_policy_activation_atomic_evidence",
      sql`${table.status} <> 'ACTIVE' or (${table.permissionUserOperationHash} = ${table.activationUserOperationHash} and ${table.permissionTxHash} = ${table.activationTxHash})`,
    ),
    check(
      "wallet_policy_terminal_fields",
      sql`${table.status} not in ('SUPERSEDED', 'REVOKED') or ${table.terminalAt} is not null`,
    ),
  ],
);

export const protocolAdapters = pgTable(
  "protocol_adapters",
  {
    id: uuid().primaryKey(),
    chainId: bigint("chain_id", { mode: "bigint" }).notNull(),
    kind: text().notNull(),
    slug: text().notNull(),
    status: adapterStatus().notNull(),
    adapterAddress: bytea("adapter_address").notNull(),
    adapterCodeHash: bytea("adapter_code_hash").notNull(),
    verifierId: bytea("verifier_id").notNull(),
    protocolName: text("protocol_name").notNull(),
    protocolTargetAddress: bytea("protocol_target_address").notNull(),
    entrySelector: bytea("entry_selector").notNull(),
    configDocument: jsonb("config_document").notNull(),
    sourceUrl: text("source_url").notNull(),
    validatedBlockNumber: bigint("validated_block_number", { mode: "bigint" }),
    createdAt,
    retiredAt: timestamp("retired_at", { withTimezone: true }),
  },
  (table) => [
    unique("adapter_chain_slug_unique").on(table.chainId, table.slug),
    unique("adapter_deployment_unique").on(
      table.chainId,
      table.adapterAddress,
      table.adapterCodeHash,
    ),
    check("adapter_kind_closed", sql`${table.kind} in ('SWAP', 'STAKE')`),
    check(
      "adapter_address_length",
      sql`octet_length(${table.adapterAddress}) = 20`,
    ),
    check(
      "adapter_code_hash_length",
      sql`octet_length(${table.adapterCodeHash}) = 32`,
    ),
    check(
      "adapter_verifier_id_length",
      sql`octet_length(${table.verifierId}) = 32`,
    ),
    check(
      "adapter_protocol_target_length",
      sql`octet_length(${table.protocolTargetAddress}) = 20`,
    ),
    check(
      "adapter_selector_length",
      sql`octet_length(${table.entrySelector}) = 4`,
    ),
    check(
      "adapter_active_evidence",
      sql`${table.status} <> 'ACTIVE' or ${table.validatedBlockNumber} is not null`,
    ),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid().primaryKey(),
    walletId: uuid("wallet_id")
      .notNull()
      .references(() => wallets.id),
    walletPolicyId: uuid("wallet_policy_id")
      .notNull()
      .references(() => walletPolicies.id),
    clientRequestId: text("client_request_id").notNull(),
    status: taskStatus().notNull(),
    intentTextCiphertext: bytea("intent_text_ciphertext"),
    intentHash: bytea("intent_hash").notNull(),
    intentDocument: jsonb("intent_document").notNull(),
    compiledPlan: jsonb("compiled_plan"),
    planHash: bytea("plan_hash"),
    compilerVersion: text("compiler_version"),
    policyDecision: jsonb("policy_decision"),
    policyDecisionHash: bytea("policy_decision_hash"),
    createdAt,
    updatedAt,
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  },
  (table) => [
    unique("task_wallet_request_unique").on(
      table.walletId,
      table.clientRequestId,
    ),
    check(
      "task_intent_hash_length",
      sql`octet_length(${table.intentHash}) = 32`,
    ),
    check(
      "task_plan_hash_length",
      sql`${table.planHash} is null or octet_length(${table.planHash}) = 32`,
    ),
    check(
      "task_decision_hash_length",
      sql`${table.policyDecisionHash} is null or octet_length(${table.policyDecisionHash}) = 32`,
    ),
    check(
      "task_passing_plan_fields",
      sql`${table.status} not in ('READY_TO_SIMULATE', 'SIMULATED', 'READY_TO_SIGN', 'SIGNED') or (${table.compiledPlan} is not null and ${table.planHash} is not null and ${table.compilerVersion} is not null and ${table.policyDecision} is not null and ${table.policyDecisionHash} is not null)`,
    ),
    check(
      "task_decision_fields_together",
      sql`(${table.policyDecision} is null) = (${table.policyDecisionHash} is null) and (${table.policyDecision} is null) = (${table.compilerVersion} is null)`,
    ),
    check(
      "task_plan_fields_together",
      sql`(${table.compiledPlan} is null) = (${table.planHash} is null) and (${table.compiledPlan} is null or ${table.policyDecision} is not null)`,
    ),
    check(
      "task_uncompiled_fields",
      sql`${table.status} not in ('DRAFT', 'COMPILING') or (${table.policyDecision} is null and ${table.compiledPlan} is null)`,
    ),
    check(
      "task_rejected_fields",
      sql`${table.status} <> 'REJECTED_POLICY' or (${table.policyDecision} is not null and ${table.compiledPlan} is null)`,
    ),
    check(
      "task_cancellation_time",
      sql`(${table.status} = 'CANCELLED') = (${table.cancelledAt} is not null)`,
    ),
    index("task_wallet_policy_idx").on(table.walletPolicyId),
  ],
);

export const simulations = pgTable(
  "simulations",
  {
    id: uuid().primaryKey(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id),
    adapterId: uuid("adapter_id")
      .notNull()
      .references(() => protocolAdapters.id),
    sequence: integer().notNull(),
    status: text().notNull(),
    chainId: bigint("chain_id", { mode: "bigint" }).notNull(),
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    blockHash: bytea("block_hash").notNull(),
    adapterCodeHash: bytea("adapter_code_hash").notNull(),
    quoteExpiresAt: timestamp("quote_expires_at", {
      withTimezone: true,
    }).notNull(),
    requestDocument: jsonb("request_document").notNull(),
    resultDocument: jsonb("result_document").notNull(),
    simulationHash: bytea("simulation_hash").notNull(),
    createdAt,
  },
  (table) => [
    unique("simulation_task_sequence_unique").on(table.taskId, table.sequence),
    unique("simulation_hash_unique").on(table.simulationHash),
    check("simulation_positive_sequence", sql`${table.sequence} > 0`),
    check(
      "simulation_status_closed",
      sql`${table.status} in ('PASSED', 'REVERTED', 'STALE', 'ERROR')`,
    ),
    check(
      "simulation_block_hash_length",
      sql`octet_length(${table.blockHash}) = 32`,
    ),
    check(
      "simulation_adapter_hash_length",
      sql`octet_length(${table.adapterCodeHash}) = 32`,
    ),
    check(
      "simulation_hash_length",
      sql`octet_length(${table.simulationHash}) = 32`,
    ),
  ],
);

export const mandates = pgTable(
  "mandates",
  {
    mandateHash: bytea("mandate_hash").primaryKey(),
    taskId: uuid("task_id")
      .notNull()
      .unique()
      .references(() => tasks.id),
    simulationId: uuid("simulation_id")
      .notNull()
      .references(() => simulations.id),
    walletId: uuid("wallet_id")
      .notNull()
      .references(() => wallets.id),
    walletPolicyId: uuid("wallet_policy_id")
      .notNull()
      .references(() => walletPolicies.id),
    adapterId: uuid("adapter_id")
      .notNull()
      .references(() => protocolAdapters.id),
    chainId: bigint("chain_id", { mode: "bigint" }).notNull(),
    mandateExecutorAddress: bytea("mandate_executor_address").notNull(),
    rootOwnerAddress: bytea("root_owner_address").notNull(),
    accountAddress: bytea("account_address").notNull(),
    executorAddress: bytea("executor_address").notNull(),
    nonce: numeric({ precision: 78, scale: 0 }).notNull(),
    expiresAtChainSeconds: numeric("expires_at_chain_seconds", {
      precision: 78,
      scale: 0,
    }).notNull(),
    typedData: jsonb("typed_data").notNull(),
    signature: bytea().notNull(),
    status: mandateStatus().notNull(),
    erc8183Contract: bytea("erc8183_contract"),
    erc8183JobId: numeric("erc8183_job_id", { precision: 78, scale: 0 }),
    authorizeTxHash: bytea("authorize_tx_hash"),
    terminalTxHash: bytea("terminal_tx_hash"),
    terminalReasonCode: text("terminal_reason_code"),
    createdAt,
    authorizedAt: timestamp("authorized_at", { withTimezone: true }),
    terminalAt: timestamp("terminal_at", { withTimezone: true }),
  },
  (table) => [
    unique("mandate_nonce_unique").on(
      table.chainId,
      table.mandateExecutorAddress,
      table.accountAddress,
      table.nonce,
    ),
    uniqueIndex("mandate_commerce_job_unique")
      .on(table.chainId, table.erc8183Contract, table.erc8183JobId)
      .where(sql`${table.erc8183Contract} is not null`),
    check("mandate_hash_length", sql`octet_length(${table.mandateHash}) = 32`),
    check(
      "mandate_address_lengths",
      sql`octet_length(${table.mandateExecutorAddress}) = 20 and octet_length(${table.rootOwnerAddress}) = 20 and octet_length(${table.accountAddress}) = 20 and octet_length(${table.executorAddress}) = 20`,
    ),
    check(
      "mandate_commerce_binding_pair",
      sql`(${table.erc8183Contract} is null) = (${table.erc8183JobId} is null)`,
    ),
    check(
      "mandate_terminal_fields",
      sql`${table.status} not in ('SUCCEEDED', 'FAILED', 'REVOKED', 'EXPIRED') or (${table.terminalTxHash} is not null and ${table.terminalReasonCode} is not null and ${table.terminalAt} is not null)`,
    ),
  ],
);

export const executions = pgTable(
  "executions",
  {
    id: uuid().primaryKey(),
    mandateHash: bytea("mandate_hash")
      .notNull()
      .unique()
      .references(() => mandates.mandateHash),
    status: executionStatus().notNull(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    submissionAttempts: integer("submission_attempts").notNull().default(0),
    authorizeTxHash: bytea("authorize_tx_hash"),
    beginTxHash: bytea("begin_tx_hash"),
    executeUserOperationHash: bytea("execute_user_operation_hash"),
    executeTxHash: bytea("execute_tx_hash"),
    settlementTxHash: bytea("settlement_tx_hash"),
    finalizeTxHash: bytea("finalize_tx_hash"),
    pendingTransactionKind: executionTransactionKind(
      "pending_transaction_kind",
    ),
    pendingTransactionHash: bytea("pending_transaction_hash"),
    pendingRawTransaction: bytea("pending_raw_transaction"),
    pendingUserOperationHash: bytea("pending_user_operation_hash"),
    lastErrorCode: text("last_error_code"),
    lastErrorDetail: text("last_error_detail"),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    check(
      "execution_attempts_nonnegative",
      sql`${table.submissionAttempts} >= 0`,
    ),
    check(
      "execution_lease_pair",
      sql`(${table.leaseOwner} is null) = (${table.leaseExpiresAt} is null)`,
    ),
  ],
);

export const verificationResults = pgTable(
  "verification_results",
  {
    id: uuid().primaryKey(),
    executionId: uuid("execution_id")
      .notNull()
      .unique()
      .references(() => executions.id),
    verifierId: bytea("verifier_id").notNull(),
    status: verificationStatus().notNull(),
    reasonCode: text("reason_code").notNull(),
    observedDocument: jsonb("observed_document").notNull(),
    evidenceHash: bytea("evidence_hash").notNull(),
    chainId: bigint("chain_id", { mode: "bigint" }).notNull(),
    transactionHash: bytea("transaction_hash").notNull(),
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    logIndex: integer("log_index").notNull(),
    createdAt,
  },
  (table) => [
    unique("verification_event_unique").on(
      table.chainId,
      table.transactionHash,
      table.logIndex,
    ),
    check(
      "verification_id_length",
      sql`octet_length(${table.verifierId}) = 32`,
    ),
    check(
      "verification_evidence_length",
      sql`octet_length(${table.evidenceHash}) = 32`,
    ),
    check(
      "verification_tx_length",
      sql`octet_length(${table.transactionHash}) = 32`,
    ),
    check("verification_log_index_nonnegative", sql`${table.logIndex} >= 0`),
  ],
);

export const executionReceipts = pgTable(
  "execution_receipts",
  {
    mandateHash: bytea("mandate_hash")
      .primaryKey()
      .references(() => mandates.mandateHash),
    status: receiptStatus().notNull(),
    policyHash: bytea("policy_hash").notNull(),
    intentHash: bytea("intent_hash").notNull(),
    planHash: bytea("plan_hash").notNull(),
    simulationHash: bytea("simulation_hash").notNull(),
    actionHash: bytea("action_hash").notNull(),
    postconditionHash: bytea("postcondition_hash").notNull(),
    verificationHash: bytea("verification_hash"),
    authorityConsumed: boolean("authority_consumed").notNull(),
    authorizeTxHash: bytea("authorize_tx_hash").notNull(),
    executionTxHash: bytea("execution_tx_hash"),
    settlementTxHash: bytea("settlement_tx_hash"),
    erc8183Contract: bytea("erc8183_contract"),
    erc8183JobId: numeric("erc8183_job_id", { precision: 78, scale: 0 }),
    terminalBlockNumber: bigint("terminal_block_number", {
      mode: "bigint",
    }).notNull(),
    terminalAt: timestamp("terminal_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check("receipt_authority_consumed", sql`${table.authorityConsumed}`),
    check(
      "receipt_hash_lengths",
      sql`octet_length(${table.policyHash}) = 32 and octet_length(${table.intentHash}) = 32 and octet_length(${table.planHash}) = 32 and octet_length(${table.simulationHash}) = 32 and octet_length(${table.actionHash}) = 32 and octet_length(${table.postconditionHash}) = 32`,
    ),
    check(
      "receipt_verification_required",
      sql`${table.status} <> 'SUCCEEDED' or ${table.verificationHash} is not null`,
    ),
    check(
      "receipt_execution_tx_required",
      sql`${table.status} in ('REVOKED', 'EXPIRED') or ${table.executionTxHash} is not null`,
    ),
    check(
      "receipt_non_success_unsettled",
      sql`${table.status} = 'SUCCEEDED' or ${table.settlementTxHash} is null`,
    ),
    check(
      "receipt_commerce_binding_pair",
      sql`(${table.erc8183Contract} is null) = (${table.erc8183JobId} is null)`,
    ),
  ],
);

export const chainEvents = pgTable(
  "chain_events",
  {
    chainId: bigint("chain_id", { mode: "bigint" }).notNull(),
    transactionHash: bytea("transaction_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    blockHash: bytea("block_hash").notNull(),
    contractAddress: bytea("contract_address").notNull(),
    topic0: bytea().notNull(),
    topics: jsonb().notNull(),
    data: bytea().notNull(),
    decodedName: text("decoded_name"),
    decodedArgs: jsonb("decoded_args"),
    status: chainEventStatus().notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    orphanedAt: timestamp("orphaned_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({
      columns: [
        table.chainId,
        table.transactionHash,
        table.logIndex,
        table.blockHash,
      ],
    }),
    uniqueIndex("chain_event_confirmed_identity_unique")
      .on(table.chainId, table.transactionHash, table.logIndex)
      .where(sql`${table.status} = 'CONFIRMED'`),
    index("chain_event_replay_index").on(
      table.chainId,
      table.blockNumber,
      table.logIndex,
    ),
    check(
      "chain_event_tx_length",
      sql`octet_length(${table.transactionHash}) = 32`,
    ),
    check(
      "chain_event_block_hash_length",
      sql`octet_length(${table.blockHash}) = 32`,
    ),
    check(
      "chain_event_contract_length",
      sql`octet_length(${table.contractAddress}) = 20`,
    ),
    check("chain_event_topic0_length", sql`octet_length(${table.topic0}) = 32`),
    check("chain_event_log_index_nonnegative", sql`${table.logIndex} >= 0`),
    check(
      "chain_event_status_timestamps",
      sql`(${table.status} <> 'CONFIRMED' or ${table.confirmedAt} is not null) and (${table.status} <> 'ORPHANED' or ${table.orphanedAt} is not null)`,
    ),
  ],
);

export const indexerCheckpoints = pgTable(
  "indexer_checkpoints",
  {
    chainId: bigint("chain_id", { mode: "bigint" }).notNull(),
    streamName: text("stream_name").notNull(),
    nextBlockNumber: bigint("next_block_number", { mode: "bigint" }).notNull(),
    lastCanonicalBlockHash: bytea("last_canonical_block_hash").notNull(),
    confirmationDepth: integer("confirmation_depth").notNull(),
    updatedAt,
  },
  (table) => [
    primaryKey({ columns: [table.chainId, table.streamName] }),
    check(
      "checkpoint_hash_length",
      sql`octet_length(${table.lastCanonicalBlockHash}) = 32`,
    ),
    check("checkpoint_positive_depth", sql`${table.confirmationDepth} > 0`),
  ],
);
