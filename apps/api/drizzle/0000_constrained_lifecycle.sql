create type policy_status as enum ('DRAFT', 'ACTIVATING', 'ACTIVE', 'SUPERSEDED', 'REVOKED');
create type task_status as enum ('DRAFT', 'COMPILING', 'REJECTED_POLICY', 'READY_TO_SIMULATE', 'SIMULATED', 'READY_TO_SIGN', 'SIGNED', 'CANCELLED');
create type mandate_status as enum ('SIGNED', 'AUTHORIZING', 'AUTHORIZED', 'EXECUTING', 'SUCCEEDED', 'FAILED', 'REVOKING', 'REVOKED', 'EXPIRING', 'EXPIRED');
create type execution_status as enum ('QUEUED', 'LEASED', 'AUTHORIZING', 'AUTHORIZED', 'EXECUTING', 'VERIFYING', 'SETTLING', 'RETRY_WAIT', 'TERMINAL');
create type verification_status as enum ('PASSED', 'FAILED', 'ERROR');
create type receipt_status as enum ('SUCCEEDED', 'FAILED', 'REVOKED', 'EXPIRED');
create type chain_event_status as enum ('OBSERVED', 'CONFIRMED', 'ORPHANED');
create type adapter_status as enum ('PROPOSED', 'VALIDATING', 'ACTIVE', 'PAUSED', 'RETIRED');

create table wallets (
  id uuid primary key,
  chain_id bigint not null,
  account_address bytea not null check (octet_length(account_address) = 20),
  root_owner_address bytea not null check (octet_length(root_owner_address) = 20),
  account_type text not null,
  account_version text not null,
  entry_point_address bytea not null check (octet_length(entry_point_address) = 20),
  factory_address bytea check (factory_address is null or octet_length(factory_address) = 20),
  owner_epoch bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wallet_chain_account_unique unique (chain_id, account_address),
  constraint wallet_owner_account_unique unique (chain_id, root_owner_address, account_address)
);

create table wallet_policies (
  id uuid primary key,
  wallet_id uuid not null references wallets(id),
  version integer not null check (version > 0),
  schema_version text not null,
  status policy_status not null,
  policy_document jsonb not null,
  policy_hash bytea not null check (octet_length(policy_hash) = 32),
  activation_tx_hash bytea check (activation_tx_hash is null or octet_length(activation_tx_hash) = 32),
  activation_block_number bigint,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  terminal_at timestamptz,
  constraint wallet_policy_version_unique unique (wallet_id, version),
  constraint wallet_policy_hash_unique unique (wallet_id, policy_hash),
  constraint wallet_policy_activation_fields check (
    status <> 'ACTIVE' or (
      activation_tx_hash is not null and activation_block_number is not null and activated_at is not null
    )
  ),
  constraint wallet_policy_terminal_fields check (
    status not in ('SUPERSEDED', 'REVOKED') or terminal_at is not null
  )
);
create unique index wallet_one_active_policy on wallet_policies(wallet_id) where status = 'ACTIVE';

create table protocol_adapters (
  id uuid primary key,
  chain_id bigint not null,
  kind text not null check (kind in ('SWAP', 'STAKE')),
  slug text not null,
  status adapter_status not null,
  adapter_address bytea not null check (octet_length(adapter_address) = 20),
  adapter_code_hash bytea not null check (octet_length(adapter_code_hash) = 32),
  verifier_id bytea not null check (octet_length(verifier_id) = 32),
  protocol_name text not null,
  protocol_target_address bytea not null check (octet_length(protocol_target_address) = 20),
  entry_selector bytea not null check (octet_length(entry_selector) = 4),
  config_document jsonb not null,
  source_url text not null,
  validated_block_number bigint,
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  constraint adapter_chain_slug_unique unique (chain_id, slug),
  constraint adapter_deployment_unique unique (chain_id, adapter_address, adapter_code_hash),
  constraint adapter_active_evidence check (status <> 'ACTIVE' or validated_block_number is not null)
);

create table tasks (
  id uuid primary key,
  wallet_id uuid not null references wallets(id),
  wallet_policy_id uuid not null references wallet_policies(id),
  client_request_id text not null,
  status task_status not null,
  intent_text_ciphertext bytea,
  intent_hash bytea not null check (octet_length(intent_hash) = 32),
  intent_document jsonb not null,
  compiled_plan jsonb,
  plan_hash bytea check (plan_hash is null or octet_length(plan_hash) = 32),
  compiler_version text,
  policy_decision jsonb,
  policy_decision_hash bytea check (policy_decision_hash is null or octet_length(policy_decision_hash) = 32),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  constraint task_wallet_request_unique unique (wallet_id, client_request_id),
  constraint task_passing_plan_fields check (
    status not in ('READY_TO_SIMULATE', 'SIMULATED', 'READY_TO_SIGN', 'SIGNED') or (
      compiled_plan is not null and plan_hash is not null and compiler_version is not null and
      policy_decision is not null and policy_decision_hash is not null
    )
  )
);

create table simulations (
  id uuid primary key,
  task_id uuid not null references tasks(id),
  adapter_id uuid not null references protocol_adapters(id),
  sequence integer not null check (sequence > 0),
  status text not null check (status in ('PASSED', 'REVERTED', 'STALE', 'ERROR')),
  chain_id bigint not null,
  block_number bigint not null,
  block_hash bytea not null check (octet_length(block_hash) = 32),
  adapter_code_hash bytea not null check (octet_length(adapter_code_hash) = 32),
  quote_expires_at timestamptz not null,
  request_document jsonb not null,
  result_document jsonb not null,
  simulation_hash bytea not null check (octet_length(simulation_hash) = 32),
  created_at timestamptz not null default now(),
  constraint simulation_task_sequence_unique unique (task_id, sequence),
  constraint simulation_hash_unique unique (simulation_hash)
);

create table mandates (
  mandate_hash bytea primary key check (octet_length(mandate_hash) = 32),
  task_id uuid not null unique references tasks(id),
  simulation_id uuid not null references simulations(id),
  wallet_id uuid not null references wallets(id),
  wallet_policy_id uuid not null references wallet_policies(id),
  adapter_id uuid not null references protocol_adapters(id),
  chain_id bigint not null,
  mandate_executor_address bytea not null check (octet_length(mandate_executor_address) = 20),
  root_owner_address bytea not null check (octet_length(root_owner_address) = 20),
  account_address bytea not null check (octet_length(account_address) = 20),
  executor_address bytea not null check (octet_length(executor_address) = 20),
  nonce numeric(78, 0) not null,
  expires_at_chain_seconds numeric(78, 0) not null,
  typed_data jsonb not null,
  signature bytea not null,
  status mandate_status not null,
  erc8183_contract bytea check (erc8183_contract is null or octet_length(erc8183_contract) = 20),
  erc8183_job_id numeric(78, 0),
  authorize_tx_hash bytea check (authorize_tx_hash is null or octet_length(authorize_tx_hash) = 32),
  terminal_tx_hash bytea check (terminal_tx_hash is null or octet_length(terminal_tx_hash) = 32),
  terminal_reason_code text,
  created_at timestamptz not null default now(),
  authorized_at timestamptz,
  terminal_at timestamptz,
  constraint mandate_nonce_unique unique (chain_id, mandate_executor_address, account_address, nonce),
  constraint mandate_commerce_binding_pair check ((erc8183_contract is null) = (erc8183_job_id is null)),
  constraint mandate_terminal_fields check (
    status not in ('SUCCEEDED', 'FAILED', 'REVOKED', 'EXPIRED') or (
      terminal_tx_hash is not null and terminal_reason_code is not null and terminal_at is not null
    )
  )
);
create unique index mandate_commerce_job_unique
  on mandates(chain_id, erc8183_contract, erc8183_job_id)
  where erc8183_contract is not null;

create table executions (
  id uuid primary key,
  mandate_hash bytea not null unique references mandates(mandate_hash),
  status execution_status not null,
  lease_owner text,
  lease_expires_at timestamptz,
  submission_attempts integer not null default 0 check (submission_attempts >= 0),
  authorize_tx_hash bytea check (authorize_tx_hash is null or octet_length(authorize_tx_hash) = 32),
  execute_user_operation_hash bytea check (execute_user_operation_hash is null or octet_length(execute_user_operation_hash) = 32),
  execute_tx_hash bytea check (execute_tx_hash is null or octet_length(execute_tx_hash) = 32),
  settlement_tx_hash bytea check (settlement_tx_hash is null or octet_length(settlement_tx_hash) = 32),
  last_error_code text,
  next_retry_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint execution_lease_pair check ((lease_owner is null) = (lease_expires_at is null))
);

create table verification_results (
  id uuid primary key,
  execution_id uuid not null unique references executions(id),
  verifier_id bytea not null check (octet_length(verifier_id) = 32),
  status verification_status not null,
  reason_code text not null,
  observed_document jsonb not null,
  evidence_hash bytea not null check (octet_length(evidence_hash) = 32),
  chain_id bigint not null,
  transaction_hash bytea not null check (octet_length(transaction_hash) = 32),
  block_number bigint not null,
  log_index integer not null check (log_index >= 0),
  created_at timestamptz not null default now(),
  constraint verification_event_unique unique (chain_id, transaction_hash, log_index)
);

create table execution_receipts (
  mandate_hash bytea primary key references mandates(mandate_hash),
  status receipt_status not null,
  policy_hash bytea not null check (octet_length(policy_hash) = 32),
  intent_hash bytea not null check (octet_length(intent_hash) = 32),
  plan_hash bytea not null check (octet_length(plan_hash) = 32),
  simulation_hash bytea not null check (octet_length(simulation_hash) = 32),
  action_hash bytea not null check (octet_length(action_hash) = 32),
  postcondition_hash bytea not null check (octet_length(postcondition_hash) = 32),
  verification_hash bytea check (verification_hash is null or octet_length(verification_hash) = 32),
  authority_consumed boolean not null check (authority_consumed),
  authorize_tx_hash bytea not null check (octet_length(authorize_tx_hash) = 32),
  execution_tx_hash bytea check (execution_tx_hash is null or octet_length(execution_tx_hash) = 32),
  settlement_tx_hash bytea check (settlement_tx_hash is null or octet_length(settlement_tx_hash) = 32),
  erc8183_contract bytea check (erc8183_contract is null or octet_length(erc8183_contract) = 20),
  erc8183_job_id numeric(78, 0),
  terminal_block_number bigint not null,
  terminal_at timestamptz not null,
  constraint receipt_verification_required check (status <> 'SUCCEEDED' or verification_hash is not null),
  constraint receipt_execution_tx_required check (status in ('REVOKED', 'EXPIRED') or execution_tx_hash is not null),
  constraint receipt_non_success_unsettled check (status = 'SUCCEEDED' or settlement_tx_hash is null),
  constraint receipt_commerce_binding_pair check ((erc8183_contract is null) = (erc8183_job_id is null))
);

create table chain_events (
  chain_id bigint not null,
  transaction_hash bytea not null check (octet_length(transaction_hash) = 32),
  log_index integer not null check (log_index >= 0),
  block_number bigint not null,
  block_hash bytea not null check (octet_length(block_hash) = 32),
  contract_address bytea not null check (octet_length(contract_address) = 20),
  topic0 bytea not null check (octet_length(topic0) = 32),
  topics jsonb not null,
  data bytea not null,
  decoded_name text,
  decoded_args jsonb,
  status chain_event_status not null,
  observed_at timestamptz not null,
  confirmed_at timestamptz,
  orphaned_at timestamptz,
  primary key (chain_id, transaction_hash, log_index),
  constraint chain_event_status_timestamps check (
    (status <> 'CONFIRMED' or confirmed_at is not null) and
    (status <> 'ORPHANED' or orphaned_at is not null)
  )
);
create index chain_event_replay_index on chain_events(chain_id, block_number, log_index);

create table indexer_checkpoints (
  chain_id bigint not null,
  stream_name text not null,
  next_block_number bigint not null,
  last_canonical_block_hash bytea not null check (octet_length(last_canonical_block_hash) = 32),
  confirmation_depth integer not null check (confirmation_depth > 0),
  updated_at timestamptz not null default now(),
  primary key (chain_id, stream_name)
);

create function protect_wallet_policy_immutability() returns trigger language plpgsql as $$
begin
  if new.wallet_id is distinct from old.wallet_id
    or new.version is distinct from old.version
    or new.schema_version is distinct from old.schema_version
    or new.policy_document is distinct from old.policy_document
    or new.policy_hash is distinct from old.policy_hash
    or new.created_at is distinct from old.created_at then
    raise exception 'wallet policy immutable fields cannot change';
  end if;
  return new;
end;
$$;
create trigger wallet_policy_immutable before update on wallet_policies
  for each row execute function protect_wallet_policy_immutability();

create function protect_simulation_immutability() returns trigger language plpgsql as $$
begin
  if new.status <> 'STALE'
    or old.status = 'STALE'
    or new.id is distinct from old.id
    or new.task_id is distinct from old.task_id
    or new.adapter_id is distinct from old.adapter_id
    or new.sequence is distinct from old.sequence
    or new.chain_id is distinct from old.chain_id
    or new.block_number is distinct from old.block_number
    or new.block_hash is distinct from old.block_hash
    or new.adapter_code_hash is distinct from old.adapter_code_hash
    or new.quote_expires_at is distinct from old.quote_expires_at
    or new.request_document is distinct from old.request_document
    or new.result_document is distinct from old.result_document
    or new.simulation_hash is distinct from old.simulation_hash
    or new.created_at is distinct from old.created_at then
    raise exception 'simulation is immutable except for a one-way STALE marker';
  end if;
  return new;
end;
$$;
create trigger simulation_immutable before update on simulations
  for each row execute function protect_simulation_immutability();

create function protect_mandate_authorization() returns trigger language plpgsql as $$
begin
  if new.mandate_hash is distinct from old.mandate_hash
    or new.task_id is distinct from old.task_id
    or new.simulation_id is distinct from old.simulation_id
    or new.wallet_id is distinct from old.wallet_id
    or new.wallet_policy_id is distinct from old.wallet_policy_id
    or new.adapter_id is distinct from old.adapter_id
    or new.chain_id is distinct from old.chain_id
    or new.mandate_executor_address is distinct from old.mandate_executor_address
    or new.root_owner_address is distinct from old.root_owner_address
    or new.account_address is distinct from old.account_address
    or new.executor_address is distinct from old.executor_address
    or new.nonce is distinct from old.nonce
    or new.expires_at_chain_seconds is distinct from old.expires_at_chain_seconds
    or new.typed_data is distinct from old.typed_data
    or new.signature is distinct from old.signature
    or new.erc8183_contract is distinct from old.erc8183_contract
    or new.erc8183_job_id is distinct from old.erc8183_job_id
    or new.created_at is distinct from old.created_at then
    raise exception 'signed mandate fields cannot change';
  end if;
  return new;
end;
$$;
create trigger mandate_authorization_immutable before update on mandates
  for each row execute function protect_mandate_authorization();

create function protect_verification_immutability() returns trigger language plpgsql as $$
begin
  raise exception 'verification result is immutable';
end;
$$;
create trigger verification_immutable before update on verification_results
  for each row execute function protect_verification_immutability();

create function protect_receipt_immutability() returns trigger language plpgsql as $$
begin
  if old.settlement_tx_hash is not null
    or new.settlement_tx_hash is null
    or new.mandate_hash is distinct from old.mandate_hash
    or new.status is distinct from old.status
    or new.policy_hash is distinct from old.policy_hash
    or new.intent_hash is distinct from old.intent_hash
    or new.plan_hash is distinct from old.plan_hash
    or new.simulation_hash is distinct from old.simulation_hash
    or new.action_hash is distinct from old.action_hash
    or new.postcondition_hash is distinct from old.postcondition_hash
    or new.verification_hash is distinct from old.verification_hash
    or new.authority_consumed is distinct from old.authority_consumed
    or new.authorize_tx_hash is distinct from old.authorize_tx_hash
    or new.execution_tx_hash is distinct from old.execution_tx_hash
    or new.erc8183_contract is distinct from old.erc8183_contract
    or new.erc8183_job_id is distinct from old.erc8183_job_id
    or new.terminal_block_number is distinct from old.terminal_block_number
    or new.terminal_at is distinct from old.terminal_at then
    raise exception 'execution receipt is immutable except for first settlement';
  end if;
  return new;
end;
$$;
create trigger receipt_immutable before update on execution_receipts
  for each row execute function protect_receipt_immutability();

create function protect_chain_event_payload() returns trigger language plpgsql as $$
begin
  if new.chain_id is distinct from old.chain_id
    or new.transaction_hash is distinct from old.transaction_hash
    or new.log_index is distinct from old.log_index
    or new.block_number is distinct from old.block_number
    or new.block_hash is distinct from old.block_hash
    or new.contract_address is distinct from old.contract_address
    or new.topic0 is distinct from old.topic0
    or new.topics is distinct from old.topics
    or new.data is distinct from old.data
    or new.decoded_name is distinct from old.decoded_name
    or new.decoded_args is distinct from old.decoded_args
    or new.observed_at is distinct from old.observed_at then
    raise exception 'chain event payload is append-only';
  end if;
  return new;
end;
$$;
create trigger chain_event_payload_immutable before update on chain_events
  for each row execute function protect_chain_event_payload();

create function enforce_future_execution_lease() returns trigger language plpgsql as $$
begin
  if new.lease_owner is not null and new.lease_expires_at <= clock_timestamp() then
    raise exception 'active execution lease must expire in the future';
  end if;
  return new;
end;
$$;
create trigger execution_lease_future before insert or update on executions
  for each row execute function enforce_future_execution_lease();
