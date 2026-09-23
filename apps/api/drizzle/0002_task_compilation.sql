alter table tasks
  add constraint task_decision_fields_together check (
    (policy_decision is null) = (policy_decision_hash is null)
    and (policy_decision is null) = (compiler_version is null)
  ),
  add constraint task_plan_fields_together check (
    (compiled_plan is null) = (plan_hash is null)
    and (compiled_plan is null or policy_decision is not null)
  ),
  add constraint task_uncompiled_fields check (
    status not in ('DRAFT', 'COMPILING') or (
      policy_decision is null and compiled_plan is null
    )
  ),
  add constraint task_rejected_fields check (
    status <> 'REJECTED_POLICY' or (
      policy_decision is not null and compiled_plan is null
    )
  ),
  add constraint task_cancellation_time check (
    (status = 'CANCELLED') = (cancelled_at is not null)
  );

create index task_wallet_policy_idx on tasks(wallet_policy_id);

create function enforce_task_transition() returns trigger language plpgsql as $$
begin
  if new.id is distinct from old.id
    or new.wallet_id is distinct from old.wallet_id
    or new.wallet_policy_id is distinct from old.wallet_policy_id
    or new.client_request_id is distinct from old.client_request_id
    or new.intent_hash is distinct from old.intent_hash
    or new.intent_document is distinct from old.intent_document
    or new.created_at is distinct from old.created_at
    or (new.intent_text_ciphertext is distinct from old.intent_text_ciphertext
      and new.intent_text_ciphertext is not null) then
    raise exception 'task intent is immutable except for retention purge';
  end if;
  if old.policy_decision is not null and (
    new.policy_decision is distinct from old.policy_decision
    or new.policy_decision_hash is distinct from old.policy_decision_hash
    or new.compiler_version is distinct from old.compiler_version
    or new.compiled_plan is distinct from old.compiled_plan
    or new.plan_hash is distinct from old.plan_hash
  ) then
    raise exception 'task compilation is immutable';
  end if;
  if new.status = old.status then
    return new;
  end if;
  if new.status in ('COMPILING', 'READY_TO_SIMULATE') and not exists (
    select 1 from wallet_policies
    where id = new.wallet_policy_id and wallet_id = new.wallet_id and status = 'ACTIVE'
  ) then
    raise exception 'task compilation requires the active wallet policy';
  end if;
  if new.status = 'CANCELLED' and exists (
    select 1 from mandates where task_id = new.id and status <> 'SIGNED'
  ) then
    raise exception 'a task with an authorized mandate cannot be cancelled';
  end if;
  if (old.status = 'DRAFT' and new.status = 'COMPILING')
    or (old.status = 'COMPILING' and new.status in ('DRAFT', 'REJECTED_POLICY', 'READY_TO_SIMULATE'))
    or (old.status = 'READY_TO_SIMULATE' and new.status = 'SIMULATED')
    or (old.status = 'SIMULATED' and new.status in ('READY_TO_SIGN', 'READY_TO_SIMULATE'))
    or (old.status = 'READY_TO_SIGN' and new.status in ('SIGNED', 'READY_TO_SIMULATE'))
    or (old.status not in ('REJECTED_POLICY', 'CANCELLED') and new.status = 'CANCELLED') then
    return new;
  end if;
  raise exception 'illegal task transition from % to %', old.status, new.status;
end;
$$;
create trigger task_transition before update on tasks
  for each row execute function enforce_task_transition();

create function enforce_task_insert() returns trigger language plpgsql as $$
begin
  if new.status <> 'DRAFT' then
    raise exception 'a task must start as DRAFT';
  end if;
  return new;
end;
$$;
create trigger task_insert_draft before insert on tasks
  for each row execute function enforce_task_insert();