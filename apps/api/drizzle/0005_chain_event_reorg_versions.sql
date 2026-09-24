-- A signed transaction can be re-included after a reorg with the same hash and
-- log index but a different block hash. Retain both payload-immutable versions;
-- only one version may be canonical at a time.
alter table chain_events drop constraint chain_events_pkey;
alter table chain_events add constraint chain_events_pkey
  primary key (chain_id, transaction_hash, log_index, block_hash);
create unique index chain_event_confirmed_identity_unique
  on chain_events (chain_id, transaction_hash, log_index)
  where status = 'CONFIRMED';
