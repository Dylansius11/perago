create table wallet_auth_challenges (
  id uuid primary key,
  domain text not null,
  uri text not null,
  chain_id bigint not null,
  account_address bytea not null check (octet_length(account_address) = 20),
  root_owner_address bytea not null check (octet_length(root_owner_address) = 20),
  nonce text not null unique,
  message text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint wallet_auth_challenge_expiry check (expires_at > created_at),
  constraint wallet_auth_challenge_consumption check (
    consumed_at is null or consumed_at >= created_at
  )
);

create table wallet_sessions (
  token_hash bytea primary key check (octet_length(token_hash) = 32),
  wallet_id uuid not null references wallets(id),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint wallet_session_expiry check (expires_at > created_at),
  constraint wallet_session_revocation check (
    revoked_at is null or revoked_at >= created_at
  )
);
create index wallet_session_wallet_idx on wallet_sessions(wallet_id);
create index wallet_session_expiry_idx on wallet_sessions(expires_at);

create function protect_wallet_auth_challenge() returns trigger language plpgsql as $$
begin
  if new.id is distinct from old.id
    or new.domain is distinct from old.domain
    or new.uri is distinct from old.uri
    or new.chain_id is distinct from old.chain_id
    or new.account_address is distinct from old.account_address
    or new.root_owner_address is distinct from old.root_owner_address
    or new.nonce is distinct from old.nonce
    or new.message is distinct from old.message
    or new.expires_at is distinct from old.expires_at
    or new.created_at is distinct from old.created_at
    or old.consumed_at is not null
    or new.consumed_at is null then
    raise exception 'wallet authentication challenge is immutable except for first consumption';
  end if;
  return new;
end;
$$;
create trigger wallet_auth_challenge_immutable before update on wallet_auth_challenges
  for each row execute function protect_wallet_auth_challenge();

create function protect_wallet_session_identity() returns trigger language plpgsql as $$
begin
  if new.token_hash is distinct from old.token_hash
    or new.wallet_id is distinct from old.wallet_id
    or new.expires_at is distinct from old.expires_at
    or new.created_at is distinct from old.created_at
    or old.revoked_at is not null
    or new.revoked_at is null then
    raise exception 'wallet session identity is immutable except for first revocation';
  end if;
  return new;
end;
$$;
create trigger wallet_session_identity_immutable before update on wallet_sessions
  for each row execute function protect_wallet_session_identity();

alter table wallet_policies
  add column permission_document jsonb,
  add column permission_hash bytea,
  add column permission_call_data bytea,
  add column permission_user_operation_hash bytea,
  add column permission_tx_hash bytea,
  add column activation_call_data bytea,
  add column activation_user_operation_hash bytea,
  add column revocation_call_data bytea,
  add column revocation_user_operation_hash bytea,
  add column revocation_tx_hash bytea,
  add column revocation_block_number bigint;

alter table wallet_policies
  drop constraint wallet_policy_activation_fields,
  add constraint wallet_policy_permission_hash_length check (
    permission_hash is null or octet_length(permission_hash) = 32
  ),
  add constraint wallet_policy_permission_user_operation_hash_length check (
    permission_user_operation_hash is null
      or octet_length(permission_user_operation_hash) = 32
  ),
  add constraint wallet_policy_permission_tx_hash_length check (
    permission_tx_hash is null or octet_length(permission_tx_hash) = 32
  ),
  add constraint wallet_policy_activation_user_operation_hash_length check (
    activation_user_operation_hash is null
      or octet_length(activation_user_operation_hash) = 32
  ),
  add constraint wallet_policy_revocation_user_operation_hash_length check (
    revocation_user_operation_hash is null
      or octet_length(revocation_user_operation_hash) = 32
  ),
  add constraint wallet_policy_revocation_tx_hash_length check (
    revocation_tx_hash is null or octet_length(revocation_tx_hash) = 32
  ),
  add constraint wallet_policy_activation_fields check (
    status <> 'ACTIVE' or (
      permission_document is not null
      and permission_hash is not null
      and permission_call_data is not null
      and permission_user_operation_hash is not null
      and permission_tx_hash is not null
      and activation_call_data is not null
      and activation_user_operation_hash is not null
      and activation_tx_hash is not null
      and activation_block_number is not null
      and activated_at is not null
    )
  ),
  add constraint wallet_policy_revocation_fields check (
    status <> 'REVOKED'
    or permission_document is null
    or (
      revocation_call_data is not null
      and revocation_user_operation_hash is not null
      and revocation_tx_hash is not null
      and revocation_block_number is not null
      and terminal_at is not null
    )
  );

create function enforce_wallet_policy_transition() returns trigger language plpgsql as $$
begin
  if new.status = old.status then
    return new;
  end if;
  if (old.status = 'DRAFT' and new.status in ('ACTIVATING', 'REVOKED'))
    or (old.status = 'ACTIVATING' and new.status in ('ACTIVE', 'REVOKED'))
    or (old.status = 'ACTIVE' and new.status in ('SUPERSEDED', 'REVOKED')) then
    return new;
  end if;
  raise exception 'illegal wallet policy transition from % to %', old.status, new.status;
end;
$$;
create trigger wallet_policy_transition before update on wallet_policies
  for each row execute function enforce_wallet_policy_transition();

create function protect_wallet_policy_evidence() returns trigger language plpgsql as $$
begin
  if old.status <> 'DRAFT' and (
    new.permission_document is distinct from old.permission_document
    or new.permission_hash is distinct from old.permission_hash
    or new.permission_call_data is distinct from old.permission_call_data
    or new.permission_user_operation_hash is distinct from old.permission_user_operation_hash
    or new.permission_tx_hash is distinct from old.permission_tx_hash
    or new.activation_call_data is distinct from old.activation_call_data
    or new.activation_user_operation_hash is distinct from old.activation_user_operation_hash
    or new.activation_tx_hash is distinct from old.activation_tx_hash
    or new.activation_block_number is distinct from old.activation_block_number
    or new.activated_at is distinct from old.activated_at
  ) then
    raise exception 'wallet policy activation evidence is immutable after submission';
  end if;
  if old.status = 'REVOKED' and (
    new.revocation_call_data is distinct from old.revocation_call_data
    or new.revocation_user_operation_hash is distinct from old.revocation_user_operation_hash
    or new.revocation_tx_hash is distinct from old.revocation_tx_hash
    or new.revocation_block_number is distinct from old.revocation_block_number
    or new.terminal_at is distinct from old.terminal_at
  ) then
    raise exception 'wallet policy revocation evidence is immutable';
  end if;
  return new;
end;
$$;
create trigger wallet_policy_evidence_immutable before update on wallet_policies
  for each row execute function protect_wallet_policy_evidence();
