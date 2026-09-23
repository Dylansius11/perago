-- P3-004: a signable task, a signed mandate, and its queue row must each point
-- at the evidence that justifies them. The database refuses the combinations the
-- service never writes, so a bug cannot persist an unjustified signature.

create function enforce_signable_task() returns trigger language plpgsql as $$
begin
  if new.status = old.status then
    return new;
  end if;
  if new.status in ('SIMULATED', 'READY_TO_SIGN') and not exists (
    select 1 from simulations s
    where s.task_id = new.id and s.status = 'PASSED'
      and s.sequence = (select max(sequence) from simulations where task_id = new.id)
  ) then
    raise exception 'a signable task requires its latest simulation to pass';
  end if;
  if new.status = 'SIGNED' and not exists (
    select 1 from mandates where task_id = new.id and status = 'SIGNED'
  ) then
    raise exception 'a signed task requires its signed mandate';
  end if;
  return new;
end;
$$;
create trigger task_signable_evidence before update on tasks
  for each row execute function enforce_signable_task();

create function enforce_mandate_evidence() returns trigger language plpgsql as $$
begin
  if new.status <> 'SIGNED' then
    raise exception 'a mandate is inserted as SIGNED';
  end if;
  if not exists (
    select 1 from simulations s
    join tasks t on t.id = s.task_id
    where s.id = new.simulation_id and s.task_id = new.task_id
      and s.status = 'PASSED' and s.adapter_id = new.adapter_id
      and s.chain_id = new.chain_id
      and t.status = 'READY_TO_SIGN' and t.wallet_id = new.wallet_id
      and t.wallet_policy_id = new.wallet_policy_id
      and s.sequence = (select max(sequence) from simulations where task_id = new.task_id)
  ) then
    raise exception 'a mandate requires the task''s latest passing simulation while ready to sign';
  end if;
  if not exists (
    select 1 from wallet_policies
    where id = new.wallet_policy_id and wallet_id = new.wallet_id and status = 'ACTIVE'
  ) then
    raise exception 'a mandate requires the active wallet policy';
  end if;
  return new;
end;
$$;
create trigger mandate_insert_evidence before insert on mandates
  for each row execute function enforce_mandate_evidence();

create function enforce_execution_queue() returns trigger language plpgsql as $$
begin
  if new.status <> 'QUEUED' or new.lease_owner is not null or new.submission_attempts <> 0 then
    raise exception 'an execution is queued fresh';
  end if;
  if not exists (
    select 1 from mandates where mandate_hash = new.mandate_hash and status = 'SIGNED'
  ) then
    raise exception 'only a signed mandate can be queued';
  end if;
  return new;
end;
$$;
create trigger execution_insert_queue before insert on executions
  for each row execute function enforce_execution_queue();
