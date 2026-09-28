create type faucet_claim_status as enum ('PENDING', 'BROADCAST', 'CONFIRMED', 'FAILED');

create table faucet_claims (
  id uuid primary key,
  wallet_id uuid not null references wallets(id),
  recipient_address bytea not null check (octet_length(recipient_address) = 20),
  client_ip_hash bytea not null check (octet_length(client_ip_hash) = 32),
  amount_wei numeric(78, 0) not null check (amount_wei > 0),
  status faucet_claim_status not null,
  transaction_hash bytea check (transaction_hash is null or octet_length(transaction_hash) = 32),
  created_at timestamptz not null default now(),
  broadcast_at timestamptz,
  confirmed_at timestamptz,
  constraint faucet_claim_transaction_state check (
    (status = 'PENDING' and transaction_hash is null and broadcast_at is null and confirmed_at is null)
    or (status = 'BROADCAST' and transaction_hash is not null and broadcast_at is not null and confirmed_at is null)
    or (status = 'CONFIRMED' and transaction_hash is not null and broadcast_at is not null and confirmed_at is not null)
    or (status = 'FAILED' and transaction_hash is not null and broadcast_at is not null and confirmed_at is not null)
  )
);

create unique index faucet_claim_transaction_hash_unique
  on faucet_claims(transaction_hash) where transaction_hash is not null;
create index faucet_claim_wallet_created_idx on faucet_claims(wallet_id, created_at desc);
create index faucet_claim_ip_created_idx on faucet_claims(client_ip_hash, created_at desc);
create index faucet_claim_budget_created_idx on faucet_claims(created_at desc)
  where status in ('PENDING', 'BROADCAST', 'CONFIRMED');
