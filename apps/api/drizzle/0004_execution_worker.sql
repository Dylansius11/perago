alter type execution_status add value 'REJECTED';

create type execution_transaction_kind as enum (
  'AUTHORIZE', 'BEGIN', 'PERFORM', 'FINALIZE_EXPIRED', 'FINALIZE_STALLED'
);

alter table executions
  add column begin_tx_hash bytea,
  add column finalize_tx_hash bytea,
  add column pending_transaction_kind execution_transaction_kind,
  add column pending_transaction_hash bytea,
  add column pending_raw_transaction bytea,
  add column pending_user_operation_hash bytea,
  add column last_error_detail text,
  add constraint execution_begin_tx_hash_length check (begin_tx_hash is null or octet_length(begin_tx_hash) = 32),
  add constraint execution_finalize_tx_hash_length check (finalize_tx_hash is null or octet_length(finalize_tx_hash) = 32),
  add constraint execution_pending_hash_length check (pending_transaction_hash is null or octet_length(pending_transaction_hash) = 32),
  add constraint execution_pending_raw_length check (pending_raw_transaction is null or octet_length(pending_raw_transaction) between 1 and 32768),
  add constraint execution_pending_user_operation_hash_length check (pending_user_operation_hash is null or octet_length(pending_user_operation_hash) = 32),
  add constraint execution_pending_transaction_fields check (
    (pending_transaction_kind is null) = (pending_transaction_hash is null)
    and (pending_transaction_hash is null) = (pending_raw_transaction is null)
  ),
  add constraint execution_pending_user_operation check (
    (pending_transaction_kind = 'PERFORM') = (pending_user_operation_hash is not null)
  ),
  add constraint execution_execute_transaction_pair check (
    (execute_user_operation_hash is null) = (execute_tx_hash is null)
  ),
  add constraint execution_last_error_detail check (
    last_error_detail is null or (last_error_code is not null and char_length(last_error_detail) <= 200)
  );

create function enforce_execution_progress() returns trigger language plpgsql as $$
begin
  if old.status in ('TERMINAL', 'REJECTED') then
    raise exception 'finished execution is immutable';
  end if;
  if new.id <> old.id or new.mandate_hash <> old.mandate_hash or new.created_at <> old.created_at then
    raise exception 'execution identity is immutable';
  end if;
  if (old.authorize_tx_hash is not null and new.authorize_tx_hash is distinct from old.authorize_tx_hash)
    or (old.begin_tx_hash is not null and new.begin_tx_hash is distinct from old.begin_tx_hash)
    or (old.execute_user_operation_hash is not null and new.execute_user_operation_hash is distinct from old.execute_user_operation_hash)
    or (old.execute_tx_hash is not null and new.execute_tx_hash is distinct from old.execute_tx_hash)
    or (old.finalize_tx_hash is not null and new.finalize_tx_hash is distinct from old.finalize_tx_hash)
    or (old.settlement_tx_hash is not null and new.settlement_tx_hash is distinct from old.settlement_tx_hash) then
    raise exception 'execution transaction evidence is write-once';
  end if;
  if old.pending_transaction_hash is not null and new.pending_transaction_hash is not null
    and new.pending_transaction_hash <> old.pending_transaction_hash then
    raise exception 'pending transaction must be cleared before replacement';
  end if;
  if new.submission_attempts <> old.submission_attempts then
    if new.submission_attempts <> old.submission_attempts + 1
      or old.pending_transaction_hash is not null
      or new.pending_transaction_hash is null then
      raise exception 'submission attempts advance only with a new pending transaction';
    end if;
  elsif old.pending_transaction_hash is null and new.pending_transaction_hash is not null then
    raise exception 'a new pending transaction increments submission attempts';
  end if;
  if new.status = 'TERMINAL' and (
    new.pending_transaction_hash is not null or not exists (
      select 1 from mandates where mandate_hash = new.mandate_hash
        and status in ('SUCCEEDED', 'FAILED', 'REVOKED', 'EXPIRED')
    )
  ) then
    raise exception 'terminal execution requires a terminal mandate without pending transaction';
  end if;
  if new.status = 'REJECTED' and (
    new.pending_transaction_hash is not null or new.authorize_tx_hash is not null
    or new.last_error_code is null or not exists (
      select 1 from mandates where mandate_hash = new.mandate_hash and status = 'SIGNED'
    )
  ) then
    raise exception 'rejected execution requires an unsigned mandate and rejection evidence';
  end if;
  return new;
end;
$$;
create trigger execution_progress before update on executions
  for each row execute function enforce_execution_progress();
