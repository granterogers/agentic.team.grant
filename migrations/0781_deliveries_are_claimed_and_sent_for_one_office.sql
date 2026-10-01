-- 0781 - a delivery is claimed, sent and recorded for ONE office (multi-user P3, cluster h-jobs).
--
-- `claim_delivery`, `record_delivery_sent`, `record_delivery_failure`, `resolve_indeterminate_delivery` and
-- `bind_delivery` took a delivery id (or a job id) and acted on whatever row that named, in whatever office. They now
-- take `p_office` first, and a delivery of another office, a job of another office and a delivery that does not exist
-- are the same thing to every one of them:
--
--   * claim_delivery        a job of another office is a job that does not exist - the delivery is recorded SUPPRESSED
--                           ("the job this delivery names does not exist"), exactly as an unknown job always was. The row
--                           carries its office EXPLICITLY (it no longer reaches the compatibility bridge), and a
--                           dedupe key that another office already holds is not shown as theirs: it reads `held`.
--   * record_delivery_*     "no delivery <id>" for a missing row AND for another office's row; the update is also
--     resolve_indeterminate  filtered by office, so a statement that somehow named a foreign row changes nothing.
--   * bind_delivery         false for a foreign or missing delivery or blocker, as it already was for a refused one.
--
-- Every protection `claim_delivery` had is kept, in the same order: the harness-containment decision
-- (`app.delivery_refusal`, which asks `app.harness_job` and `app.may_act_outside`) is made BEFORE the insert, and
-- a refused delivery is recorded rather than raised. What changed is only whose it is.
--
-- The recorders (sent / failed / resolved) deliberately do NOT require the office to be ACTIVE: they record what already
-- happened to a message that was already claimed. Refusing to write "it was sent" because the office was disabled in the
-- meantime would let the same message be sent again. New work (claim_delivery) does require it.
--
-- NOT done here, reported: `deliveries.dedupe_key` is UNIQUE across the deployment (P2 follow-up: make it
-- (office_id, dedupe_key)). Until then two offices that build the same key collide, and the second reads `held`.

create function app.claim_delivery(
  p_office uuid, p_channel text, p_dedupe_key text, p_account_ref text, p_target_ref text, p_purpose text,
  p_thread_ref text default null, p_staff_id uuid default null, p_correlation_id uuid default null,
  p_job_id uuid default null, p_lease interval default '00:02:00')
returns table(delivery_id uuid, outcome text, message_ref text, attempt integer)
language plpgsql
security definer
set search_path to ''
as $f$
declare
  v_row public.deliveries;
  v_refusal text;
  v_job uuid;
begin
  perform app.require_office(p_office);

  -- A job of ANOTHER office is, to this delivery, a job that does not exist: the refusal below is then the one an
  -- unknown job always got, and nothing about the foreign job (its origin, its harness-ness) is consulted.
  select j.job_id into v_job from public.jobs j where j.job_id = p_job_id and j.office_id = p_office;

  /*
    HARNESS TRAFFIC MAY NOT REACH A PRODUCTION DESTINATION. Ever, by anybody. (0601, #378)

    ONE decision for every delivery, and it fails closed: `app.delivery_refusal` is allowed to say yes to a job-less
    delivery only for a registered test destination or a registered operator sender. It is DEFAULT DENY and it lives here
    rather than in a caller. Suppressed rather than raised: a refusal that throws would fail the job and tell a suite its
    product is broken; `suppressed` is an outcome every sender already understands, it records the ATTEMPT where
    `check:leaks` can count it, and the suite carries on.
  */
  v_refusal := app.delivery_refusal(
    case when p_job_id is null then null
         when v_job is not null then v_job
         else '00000000-0000-0000-0000-000000000000'::uuid end,   -- never a job: "does not exist"
    p_dedupe_key, p_channel, p_target_ref);
  if v_refusal is not null then
    insert into public.deliveries
      (office_id, channel, dedupe_key, account_ref, target_ref, thread_ref, staff_id,
       correlation_id, job_id, purpose, state, suppressed_reason, lease_expires_at)
    values
      (p_office, p_channel, p_dedupe_key, p_account_ref, p_target_ref, p_thread_ref,
       p_staff_id, p_correlation_id,
       -- The job only if it exists in THIS office: a refusal of an unknown job must record, not raise.
       v_job,
       p_purpose, 'suppressed', v_refusal, app.now_utc())
    on conflict (dedupe_key) do nothing
    returning * into v_row;
    if not found then
      select * into v_row from public.deliveries d
       where d.dedupe_key = p_dedupe_key and d.office_id = p_office;
    end if;
    if v_row.delivery_id is null then
      -- The key is another office's. Nothing of theirs is shown.
      return query select null::uuid, 'held'::text, null::text, 0;
      return;
    end if;
    return query select v_row.delivery_id, 'suppressed'::text, null::text, v_row.attempt;
    return;
  end if;

  -- The insert IS the lock. Concurrent duplicates cannot both succeed here.
  insert into public.deliveries
    (office_id, channel, dedupe_key, account_ref, target_ref, thread_ref, staff_id,
     correlation_id, job_id, purpose, lease_expires_at)
  values
    (p_office, p_channel, p_dedupe_key, p_account_ref, p_target_ref, p_thread_ref,
     p_staff_id, p_correlation_id, v_job, p_purpose, app.now_utc() + p_lease)
  on conflict (dedupe_key) do nothing
  returning * into v_row;

  if found then
    return query select v_row.delivery_id, 'claimed'::text, null::text, v_row.attempt;
    return;
  end if;

  select * into v_row from public.deliveries d
    where d.dedupe_key = p_dedupe_key and d.office_id = p_office
    for update;

  if v_row.delivery_id is null then
    -- The key is held by another office (the key is global until the P2 follow-up). It is not reported as sent, as
    -- failed or as theirs: it is simply not ours to send.
    return query select null::uuid, 'held'::text, null::text, 0;
    return;
  end if;

  if v_row.state = 'sent' then
    return query select v_row.delivery_id, 'already_sent'::text, v_row.message_ref, v_row.attempt;
    return;
  elsif v_row.state = 'suppressed' then
    return query select v_row.delivery_id, 'suppressed'::text, null::text, v_row.attempt;
    return;
  elsif v_row.state = 'failed' then
    return query select v_row.delivery_id, 'failed'::text, null::text, v_row.attempt;
    return;
  end if;

  if v_row.lease_expires_at > app.now_utc() then
    return query select v_row.delivery_id, 'held'::text, null::text, v_row.attempt;
    return;
  end if;

  -- The reclaim. Fully qualified, because the bare column name is this function's own OUT parameter (0035).
  update public.deliveries
     set attempt = public.deliveries.attempt + 1,
         lease_expires_at = app.now_utc() + p_lease
   where public.deliveries.delivery_id = v_row.delivery_id
     and public.deliveries.office_id = p_office
  returning * into v_row;

  return query select v_row.delivery_id, 'reclaimed'::text, null::text, v_row.attempt;
end;
$f$;
revoke all on function app.claim_delivery(uuid, text, text, text, text, text, text, uuid, uuid, uuid, interval) from public, anon, authenticated, service_role;
drop function app.claim_delivery(text, text, text, text, text, text, uuid, uuid, uuid, interval);

create function app.record_delivery_sent(p_office uuid, p_delivery_id uuid, p_message_ref text, p_link text default null)
returns text
language plpgsql
security definer
set search_path to ''
as $f$
declare
  v_row public.deliveries;
begin
  if p_office is null or not exists (select 1 from public.offices o where o.office_id = p_office) then
    raise exception 'no_office' using errcode = '42501';
  end if;
  select * into v_row from public.deliveries
    where delivery_id = p_delivery_id and office_id = p_office for update;
  if not found then
    raise exception 'no delivery %', p_delivery_id using errcode = 'no_data_found';
  end if;

  if v_row.state = 'sent' then
    -- A retry of the RECORDING step, not of the send. Keeping the first message_ref keeps the one that exists.
    return 'already_sent';
  end if;

  if v_row.state = 'failed' then
    -- Use app.resolve_indeterminate_delivery, which asks whether you looked.
    return 'failed';
  end if;

  if v_row.state = 'suppressed' then
    -- The suppression lost the race. The message EXISTS and must be deleted, not forgotten, so the reference is
    -- recorded even though the state stays suppressed - that reference is the only handle on it.
    update public.deliveries
       set message_ref = p_message_ref, link = p_link
     where delivery_id = p_delivery_id and office_id = p_office;
    return 'suppressed_too_late';
  end if;

  update public.deliveries
     set state = 'sent', message_ref = p_message_ref, link = p_link,
         sent_at = app.now_utc()
   where delivery_id = p_delivery_id and office_id = p_office;

  return 'sent';
end;
$f$;
revoke all on function app.record_delivery_sent(uuid, uuid, text, text) from public, anon, authenticated, service_role;
drop function app.record_delivery_sent(uuid, text, text);

create function app.record_delivery_failure(p_office uuid, p_delivery_id uuid, p_error_code text, p_retryable boolean)
returns text
language plpgsql
security definer
set search_path to ''
as $f$
declare
  v_row public.deliveries;
  v_max int;
  v_base int;
  v_ceiling int;
  v_wait int;
begin
  if p_office is null or not exists (select 1 from public.offices o where o.office_id = p_office) then
    raise exception 'no_office' using errcode = '42501';
  end if;
  select * into v_row from public.deliveries
    where delivery_id = p_delivery_id and office_id = p_office for update;
  if not found then
    raise exception 'no delivery %', p_delivery_id using errcode = 'no_data_found';
  end if;

  if v_row.state = 'sent' then
    -- Two attempts disagree about reality. The sent record wins: it has a message reference, which is evidence; the
    -- failure has only a code.
    return 'already_sent';
  end if;

  if not p_retryable then
    update public.deliveries
       set state = 'failed', error_code = p_error_code
     where delivery_id = p_delivery_id and office_id = p_office and state = 'claimed';
    return 'failed';
  end if;

  select coalesce((select value::int from public.system_config
                    where key = 'delivery.max_attempts'), 5),
         coalesce((select value::int from public.system_config
                    where key = 'delivery.backoff_seconds'), 30),
         coalesce((select value::int from public.system_config
                    where key = 'delivery.backoff_ceiling_seconds'), 900)
    into v_max, v_base, v_ceiling;

  -- Out of road. The last error code is kept rather than replaced with something generic.
  if v_row.attempt >= v_max then
    update public.deliveries
       set state = 'failed', error_code = p_error_code
     where delivery_id = p_delivery_id and office_id = p_office and state = 'claimed';
    return 'gave_up';
  end if;

  -- Exponential, with a ceiling, computed from the attempt already made.
  v_wait := least(v_ceiling, (v_base * power(2, greatest(0, v_row.attempt - 1)))::int);

  update public.deliveries
     set lease_expires_at = app.now_utc() + make_interval(secs => v_wait),
         error_code = p_error_code
   where delivery_id = p_delivery_id and office_id = p_office and state = 'claimed';

  return 'retry_in_' || v_wait::text;
end;
$f$;
revoke all on function app.record_delivery_failure(uuid, uuid, text, boolean) from public, anon, authenticated, service_role;
drop function app.record_delivery_failure(uuid, text, boolean);

create function app.resolve_indeterminate_delivery(p_office uuid, p_delivery_id uuid, p_message_ref text)
returns text
language plpgsql
security definer
set search_path to ''
as $f$
declare
  v_row public.deliveries;
begin
  if p_office is null or not exists (select 1 from public.offices o where o.office_id = p_office) then
    raise exception 'no_office' using errcode = '42501';
  end if;
  select * into v_row from public.deliveries
    where delivery_id = p_delivery_id and office_id = p_office for update;
  if not found then
    raise exception 'no delivery %', p_delivery_id using errcode = 'no_data_found';
  end if;

  if v_row.state = 'sent' then return 'already_sent'; end if;

  if v_row.state <> 'failed' or coalesce(v_row.error_code, '') not like 'indeterminate:%' then
    -- Not an exception: a sweep meets rows that resolved themselves between the read and the write, and that is normal.
    return 'not_indeterminate';
  end if;

  if p_message_ref is not null then
    update public.deliveries
       set state = 'sent', message_ref = p_message_ref, sent_at = app.now_utc()
     where delivery_id = p_delivery_id and office_id = p_office;
    return 'sent';
  end if;

  update public.deliveries
     set state = 'claimed', error_code = null,
         lease_expires_at = app.now_utc() - interval '1 second'
   where delivery_id = p_delivery_id and office_id = p_office;
  return 'retryable';
end;
$f$;
revoke all on function app.resolve_indeterminate_delivery(uuid, uuid, text) from public, anon, authenticated, service_role;
drop function app.resolve_indeterminate_delivery(uuid, text);

-- Naming the question a message asks. The delivery and the blocker must BOTH be this office's: the composite keys
-- already refuse a foreign blocker, but as a 23503 whose text names which of two constraints failed - a missing
-- blocker and a foreign one must not be told apart, so both are checked here and both are simply false.
create function app.bind_delivery(p_office uuid, p_delivery uuid, p_blocker uuid)
returns boolean
language plpgsql
security definer
set search_path to ''
as $f$
begin
  if p_delivery is null or p_blocker is null then return false; end if;
  if p_office is null or not exists (select 1 from public.offices o where o.office_id = p_office) then
    raise exception 'no_office' using errcode = '42501';
  end if;
  if not exists (select 1 from public.blockers b where b.blocker_id = p_blocker and b.office_id = p_office)
     or not exists (select 1 from public.deliveries d where d.delivery_id = p_delivery and d.office_id = p_office) then
    return false;
  end if;
  update public.deliveries set blocker_id = p_blocker
   where delivery_id = p_delivery and office_id = p_office
     and (blocker_id is null or blocker_id = p_blocker)
     and state <> 'suppressed';
  return found;
exception when check_violation then
  return false;   -- a foreign or already-named delivery binds nothing; the caller sends unbound and fails closed
end;
$f$;
revoke all on function app.bind_delivery(uuid, uuid, uuid) from public, anon, authenticated, service_role;
drop function app.bind_delivery(uuid, uuid);

-- Which question a delivery asked, for the press that answers it. The legacy inference ("the job had exactly one
-- question by then") may only count the DELIVERY'S OWN office's questions.
create or replace function app.approval_for_delivery(p_delivery uuid)
returns uuid
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $f$
  select case
    when d.blocker_id is not null then d.blocker_id
    -- Provable and bounded: a message from before this migration, whose job had exactly one question by then.
    when d.created_at < coalesce((select (value #>> '{}')::timestamptz from public.system_config where key = 'delivery.bindings_from'), '-infinity')
         and (select count(*) from public.blockers b where b.job_id = d.job_id and b.office_id = d.office_id and b.created_at <= d.created_at) = 1
      then (select b.blocker_id from public.blockers b where b.job_id = d.job_id and b.office_id = d.office_id and b.created_at <= d.created_at)
  end
    from public.deliveries d where d.delivery_id = p_delivery
$f$;
