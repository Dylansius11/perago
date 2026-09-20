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
