-- 1029: a finished answer is redriven until it is sent, or visibly given up. It is never left in `claimed`.
--
-- WHAT WAS WRONG (N1, with C7 and C9/C10 of the deep audit). `app.record_delivery_failure` already did the right thing
-- for a RETRYABLE failure: it kept the row `claimed` and pushed `lease_expires_at` out by an exponential backoff, and
-- gave up (`failed`) once `delivery.max_attempts` was spent. But a lapsed lease only makes a row ELIGIBLE for
-- `app.claim_delivery` to reclaim; something has to call the sender again, and for a finished answer NOTHING did. The
-- job had already moved to `complete` (the notifier's failure does not fail the job), `deliverPending` only looks at
-- `notifying`, and the paused-question sweep only looks at blockers. So a Telegram 429 or a 5xx on the answer left a row
-- `claimed` for ever, and the person got nothing until a human pressed Retry. The comment in the worker that says the
-- layer's "max_attempts and backoff bound the retry" described a retry nobody started.
--
-- THE STATE MACHINE (also in docs/delivery/DELIVERY-STATE-MACHINE.md). The enum is unchanged:
--   claimed    a send is owed. Sub-states are DERIVED, never stored:
--                in flight    lease live
--                backing off  lease live, error_code set (a retryable failure was recorded)
--                due          lease lapsed, send_started_at null  -> the redrive resends it (bounded)
--                ambiguous    lease lapsed, send_started_at set   -> a send began and nothing recorded how it ended:
--                             the provider MAY have accepted it. Never resent on its own: parked `failed`.
--   sent       terminal. Provider accepted it and a message reference is recorded.
--   failed     terminal. error_code says why. `indeterminate:*` may be resolved by looking (resolve_indeterminate) or
--              by a person (retry_delivery); `abandoned:*` and `gave_up` are surfaced on the undelivered list.
--              `superseded:*` is closed bookkeeping, not a failure, and is not listed.
--   suppressed terminal. Containment refused the destination (harness, retired, no provenance).
--
-- THE CRASH WINDOW (honestly). Telegram offers no idempotency key and a bot cannot read its own messages, so a crash
-- between "the provider accepted it" and "we recorded it" cannot be made exactly-once. The intent is recorded BEFORE the
-- send (`send_started_at`, set by `app.begin_delivery_send`, which is also the fence that stops a second worker sending
-- the same attempt). A lapse with intent recorded is treated as AMBIGUOUS and parked, visibly, instead of resent: the
-- cost is that a message the provider did NOT in fact accept waits for a person (or, on Slack, for `reconcile`); the
-- benefit is that no message is duplicated by recovery. What remains is the window between `begin_delivery_send` and
-- the provider's reply where a crash is resolved conservatively (not sent) rather than by a retry. A retry after a
-- failure the provider REPORTED (429, 5xx, rate limit) is at-most-once because the provider said it did not accept.
--
-- RETRY-AFTER. `record_delivery_failure` takes the provider's wait (seconds) and waits at least that long, up to
-- `delivery.retry_after_cap_seconds` (default 3600) so a hostile value cannot park a row.
--
-- C2 (say_once). The duty's "said" fingerprint is written before delivery, so a failed send suppressed the identical
-- retry for 20 hours. `app.reopen_duty_voice` ages that record when the announcement ends in a DEFINITE failure with
-- nothing sent, so the next run says it again. Called from the terminal paths below.
--
-- C3 (reminders): `app.job_delivery_state` is the delivery-side primitive a reminder needs to mark itself reminded
-- only on a delivered result. reminders.ts belongs to another change and is not edited here.

alter table public.deliveries add column if not exists send_started_at timestamptz;
comment on column public.deliveries.send_started_at is
  'Set by app.begin_delivery_send immediately before the transport is called, null otherwise. A lapsed claim with this set is AMBIGUOUS (the provider may have accepted the message): it is parked, never resent. Cleared when the provider reports a definite refusal or when a person or a reconciliation decides.';

-- ---------------------------------------------------------------------------------------------------------------------
-- A note on the events ledger, never fatal: a failed note must not undo the state change it describes.
create or replace function app.delivery_note(p_delivery uuid, p_action text, p_why text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  insert into public.events
    (office_id, correlation_id, project_id, actor_kind, actor, trigger, action_type, reversible,
     rationale_summary, related_job_id, after_state)
  select d.office_id, coalesce(d.correlation_id, j.correlation_id, gen_random_uuid()), j.project_id,
         'system', 'delivery', 'delivery sweep', p_action, false, left(p_why, 1000), d.job_id,
         jsonb_build_object('delivery_id', d.delivery_id, 'channel', d.channel, 'purpose', d.purpose,
                            'attempt', d.attempt, 'error_code', d.error_code)
    from public.deliveries d
    left join public.jobs j on j.job_id = d.job_id and j.office_id = d.office_id
   where d.delivery_id = p_delivery;
exception when others then
  null;
end;
$fn$;

-- C2: age the duty's "said" record so the next identical run speaks again. Only for a job that is a duty and only when
-- nothing it announced was sent.
create or replace function app.reopen_duty_voice(p_job_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_kind text;
  v_project uuid;
  v_office uuid;
begin
  if p_job_id is null then return false; end if;
  select j.kind, coalesce(j.project_id, app.unnamed_project(j.office_id)), j.office_id
    into v_kind, v_project, v_office
    from public.jobs j where j.job_id = p_job_id;
  if v_kind is null then return false; end if;
  if exists (select 1 from public.deliveries d where d.job_id = p_job_id and d.state = 'sent') then
    return false;
  end if;
  if not exists (select 1 from public.responsibilities r where r.job_kind = v_kind and r.office_id = v_office) then
    return false;
  end if;
  update public.duty_said
     set said_at = least(said_at, app.now_utc() - interval '21 hours')
   where job_kind = v_kind and project_id = v_project;
  return found;
end;
$fn$;

-- C3 primitive: what became of the messages a job owed. 'sent' if any was sent; else 'pending' if any is still owed;
-- else 'failed' if any ended failed or suppressed; else 'none' (nothing was ever claimed).
create or replace function app.job_delivery_state(p_office uuid, p_job_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_sent int; v_open int; v_bad int;
begin
  perform app.require_office(p_office);
  select count(*) filter (where d.state = 'sent'),
         count(*) filter (where d.state = 'claimed'),
         count(*) filter (where d.state in ('failed', 'suppressed') and coalesce(d.error_code, '') not like 'superseded:%')
    into v_sent, v_open, v_bad
    from public.deliveries d
   where d.job_id = p_job_id and d.office_id = p_office;
  return case when v_sent > 0 then 'sent' when v_open > 0 then 'pending' when v_bad > 0 then 'failed' else 'none' end;
end;
$fn$;

-- ---------------------------------------------------------------------------------------------------------------------
-- The fence and the intent record. Called by the sender between claim and send.
--   go            this attempt may send
--   fenced        another attempt owns the row, or this attempt already began a send: do NOT send
--   already_sent  the message exists
--   not_claimed   the row is terminal (failed, suppressed): do NOT send
create or replace function app.begin_delivery_send(
  p_office uuid, p_delivery_id uuid, p_attempt integer, p_lease interval default interval '5 minutes')
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.deliveries;
begin
  perform app.require_office(p_office);
  select * into v_row from public.deliveries d
    where d.delivery_id = p_delivery_id and d.office_id = p_office for update;
  if not found then
    raise exception 'no delivery %', p_delivery_id using errcode = 'no_data_found';
  end if;
  if v_row.state = 'sent' then return 'already_sent'; end if;
  if v_row.state <> 'claimed' then return 'not_claimed'; end if;
  if v_row.attempt <> p_attempt or v_row.send_started_at is not null then return 'fenced'; end if;
  update public.deliveries
     set send_started_at = app.now_utc(),
         lease_expires_at = app.now_utc() + p_lease
   where delivery_id = p_delivery_id and office_id = p_office;
  return 'go';
end;
$fn$;

-- ---------------------------------------------------------------------------------------------------------------------
-- claim_delivery, spliced from its live definition. ONE change: a reclaim of a row whose previous attempt BEGAN a send
-- and recorded no ending is ambiguous, so it is parked `failed` instead of being handed to a second sender.
create or replace function app.claim_delivery(p_office uuid, p_channel text, p_dedupe_key text, p_account_ref text, p_target_ref text, p_purpose text, p_thread_ref text DEFAULT NULL::text, p_staff_id uuid DEFAULT NULL::uuid, p_correlation_id uuid DEFAULT NULL::uuid, p_job_id uuid DEFAULT NULL::uuid, p_lease interval DEFAULT '00:02:00'::interval)
 RETURNS TABLE(delivery_id uuid, outcome text, message_ref text, attempt integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  -- 1029: the previous attempt began a send and never recorded how it ended. The provider may have accepted it, so a
  -- second sender is the one thing that must not happen. Parked, visibly, as `failed` (an outcome every caller of this
  -- function already understands; a new outcome word would be read as "send" by a worker built before this).
  if v_row.send_started_at is not null then
    update public.deliveries
       set state = 'failed', error_code = 'indeterminate:lease_lapsed_mid_send', send_started_at = null
     where public.deliveries.delivery_id = v_row.delivery_id
       and public.deliveries.office_id = p_office
       and public.deliveries.state = 'claimed';
    perform app.delivery_note(v_row.delivery_id, 'delivery.unconfirmed',
      'A send began and the worker never recorded how it ended; the provider may or may not have accepted it, so it was not sent again.');
    return query select v_row.delivery_id, 'failed'::text, null::text, v_row.attempt;
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
$function$;

-- ---------------------------------------------------------------------------------------------------------------------
-- record_delivery_failure: a fifth parameter (the provider's wait) and the terminal paths surface and reopen. The old
-- four-argument signature is dropped by its exact argument list; a four-argument call still resolves to this one.
drop function if exists app.record_delivery_failure(uuid, uuid, text, boolean);

create or replace function app.record_delivery_failure(p_office uuid, p_delivery_id uuid, p_error_code text, p_retryable boolean, p_retry_after integer default null)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row public.deliveries;
  v_max int;
  v_base int;
  v_ceiling int;
  v_cap int;
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
       set state = 'failed', error_code = p_error_code, send_started_at = null
     where delivery_id = p_delivery_id and office_id = p_office and state = 'claimed';
    perform app.delivery_note(p_delivery_id, 'delivery.failed',
      'The provider refused the message and it will not be retried: ' || left(coalesce(p_error_code, ''), 200));
    -- An indeterminate failure may in fact have been sent, so it does not reopen the duty's voice.
    if coalesce(p_error_code, '') not like 'indeterminate%' then
      perform app.reopen_duty_voice(v_row.job_id);
    end if;
    return 'failed';
  end if;

  select coalesce((select value::int from public.system_config
                    where key = 'delivery.max_attempts'), 5),
         coalesce((select value::int from public.system_config
                    where key = 'delivery.backoff_seconds'), 30),
         coalesce((select value::int from public.system_config
                    where key = 'delivery.backoff_ceiling_seconds'), 900),
         coalesce((select value::int from public.system_config
                    where key = 'delivery.retry_after_cap_seconds'), 3600)
    into v_max, v_base, v_ceiling, v_cap;

  -- Out of road. The last error code is kept rather than replaced with something generic, and it is SAID.
  if v_row.attempt >= v_max then
    update public.deliveries
       set state = 'failed', error_code = p_error_code, send_started_at = null
     where delivery_id = p_delivery_id and office_id = p_office and state = 'claimed';
    perform app.delivery_note(p_delivery_id, 'delivery.gave_up',
      'The message could not be sent after ' || v_row.attempt::text || ' attempts: ' || left(coalesce(p_error_code, ''), 200));
    perform app.reopen_duty_voice(v_row.job_id);
    return 'gave_up';
  end if;

  -- Exponential, with a ceiling, computed from the attempt already made; never shorter than what the provider asked.
  v_wait := least(v_ceiling, (v_base * power(2, greatest(0, v_row.attempt - 1)))::int);
  if p_retry_after is not null and p_retry_after > 0 then
    v_wait := greatest(v_wait, least(p_retry_after, v_cap));
  end if;

  -- The provider reported the refusal, so the message was not accepted: the intent record is cleared and the row is
  -- plainly DUE once the wait is over (not ambiguous).
  update public.deliveries
     set lease_expires_at = app.now_utc() + make_interval(secs => v_wait),
         error_code = p_error_code,
         send_started_at = null
   where delivery_id = p_delivery_id and office_id = p_office and state = 'claimed';

  return 'retry_in_' || v_wait::text;
end;
$function$;

revoke all on function app.record_delivery_failure(uuid, uuid, text, boolean, integer) from public;

-- ---------------------------------------------------------------------------------------------------------------------
-- The two doors where a person (or a look at the provider) decides a parked row should be sent: the decision clears the
-- intent record, because it replaces the ambiguity. Spliced from the live definitions; one assignment added to each.
create or replace function app.retry_delivery(p_office uuid, p_delivery_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row public.deliveries;
begin
  perform app.require_office(p_office);
  select * into v_row from public.deliveries
    where delivery_id = p_delivery_id and office_id = p_office for update;
  if not found then
    raise exception 'no delivery %', p_delivery_id using errcode = 'no_data_found';
  end if;

  if v_row.state = 'sent' then
    return 'already_sent';
  end if;
  if v_row.state = 'suppressed' then
    -- Suppression is a decision somebody made about whether this SHOULD be
    -- sent. Undoing it here would let a retry button override a policy.
    return 'suppressed';
  end if;

  update public.deliveries
     set state = 'claimed',
         attempt = 1,
         lease_expires_at = app.now_utc(),
         send_started_at = null
   where delivery_id = p_delivery_id and office_id = p_office;

  return 'queued';
end;
$function$;

create or replace function app.resolve_indeterminate_delivery(p_office uuid, p_delivery_id uuid, p_message_ref text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
     set state = 'claimed', error_code = null, send_started_at = null,
         lease_expires_at = app.now_utc() - interval '1 second'
   where delivery_id = p_delivery_id and office_id = p_office;
  return 'retryable';
end;
$function$;

-- ---------------------------------------------------------------------------------------------------------------------
-- THE SWEEP: every lapsed `claimed` row is given an ending the redrive does not have to guess at. SQL only, no notifier,
-- so it works whatever the worker can reach. Run once per tick, before the redrive.
create or replace function app.settle_lapsed_deliveries(p_max_age interval default interval '2 days')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  r public.deliveries;
  v_refusal text;
  v_unconfirmed int := 0;
  v_suppressed int := 0;
  v_superseded int := 0;
  v_abandoned int := 0;
  v_due int := 0;
  v_state text;
  v_has_output boolean;
begin
  for r in
    select d.* from public.deliveries d
     where d.state = 'claimed' and d.lease_expires_at < app.now_utc()
     order by d.lease_expires_at
     limit 200
       for update skip locked
  loop
    -- 1. AMBIGUOUS: a send began and nothing recorded how it ended. Not resent; parked and said.
    if r.send_started_at is not null then
      update public.deliveries
         set state = 'failed', error_code = 'indeterminate:lease_lapsed_mid_send', send_started_at = null
       where delivery_id = r.delivery_id and office_id = r.office_id and state = 'claimed';
      perform app.delivery_note(r.delivery_id, 'delivery.unconfirmed',
        'A send began and the worker never recorded how it ended; the provider may or may not have accepted it, so it was not sent again.');
      v_unconfirmed := v_unconfirmed + 1;
      continue;
    end if;

    -- 2. CONTAINMENT, asked again: a destination retired or a job found to be harness since the claim is a refusal now.
    v_refusal := app.delivery_refusal(r.job_id, r.dedupe_key, r.channel, r.target_ref);
    if v_refusal is not null then
      update public.deliveries
         set state = 'suppressed', suppressed_reason = v_refusal
       where delivery_id = r.delivery_id and office_id = r.office_id and state = 'claimed';
      v_suppressed := v_suppressed + 1;
      continue;
    end if;

    -- 3. SUPERSEDED: the same job already reached this same destination on another delivery. Resending would be a
    -- second visible message, so the row is closed (and is not a failure Grant is shown).
    if r.job_id is not null and exists (
         select 1 from public.deliveries s
          where s.job_id = r.job_id and s.office_id = r.office_id and s.state = 'sent'
            and s.channel = r.channel and s.target_ref = r.target_ref and s.delivery_id <> r.delivery_id) then
      update public.deliveries
         set state = 'failed', error_code = 'superseded:sent_by_sibling'
       where delivery_id = r.delivery_id and office_id = r.office_id and state = 'claimed';
      v_superseded := v_superseded + 1;
      continue;
    end if;

    -- 4. TOO OLD: a deploy must not spring an old answer on a person.
    if r.created_at < app.now_utc() - p_max_age then
      update public.deliveries
         set state = 'failed', error_code = 'abandoned:older_than_redrive_window'
       where delivery_id = r.delivery_id and office_id = r.office_id and state = 'claimed';
      perform app.delivery_note(r.delivery_id, 'delivery.abandoned', 'The message was never sent and is too old to send now.');
      perform app.reopen_duty_voice(r.job_id);
      v_abandoned := v_abandoned + 1;
      continue;
    end if;

    -- 5. NOTHING TO REDRIVE WITH. Only a job's result is rebuilt from its stored output (the key is `job:<id>:<channel>`).
    -- Anything else gets the question-asking sweep's window (an hour), then an honest ending.
    if r.purpose <> 'result' or r.job_id is null or r.dedupe_key not like 'job:' || r.job_id::text || ':%' then
      if r.lease_expires_at < app.now_utc() - interval '1 hour' then
        update public.deliveries
           set state = 'failed', error_code = 'abandoned:' || r.purpose || '_not_redriven'
         where delivery_id = r.delivery_id and office_id = r.office_id and state = 'claimed';
        perform app.delivery_note(r.delivery_id, 'delivery.abandoned',
          'A ' || r.purpose || ' message was claimed, never sent, and has nothing to rebuild it from.');
        perform app.reopen_duty_voice(r.job_id);
        v_abandoned := v_abandoned + 1;
      end if;
      continue;
    end if;

    select j.state::text, exists (select 1 from public.outputs o where o.job_id = j.job_id)
      into v_state, v_has_output
      from public.jobs j where j.job_id = r.job_id and j.office_id = r.office_id;
    if v_state is null or not v_has_output or v_state in ('failed', 'cancelled') then
      update public.deliveries
         set state = 'failed', error_code = 'abandoned:no_answer_to_redrive'
       where delivery_id = r.delivery_id and office_id = r.office_id and state = 'claimed';
      perform app.delivery_note(r.delivery_id, 'delivery.abandoned', 'The message was never sent and there is no stored answer to send.');
      perform app.reopen_duty_voice(r.job_id);
      v_abandoned := v_abandoned + 1;
      continue;
    end if;

    v_due := v_due + 1;   -- the redrive resends it
  end loop;

  return jsonb_build_object('unconfirmed', v_unconfirmed, 'suppressed', v_suppressed, 'superseded', v_superseded,
                            'abandoned', v_abandoned, 'due', v_due);
end;
$fn$;

-- THE REDRIVE LIST: one row per job whose finished answer owes a send that is due. The worker hands each to the same
-- notifier that sent it the first time; claim_delivery dedupes, fences and bounds it.
create or replace function app.deliveries_to_redrive(p_limit integer default 10)
returns table(job_id uuid, output_id uuid)
language sql
stable
security definer
set search_path = ''
as $fn$
  select x.job_id, x.output_id
    from (
      select distinct on (d.job_id) d.job_id, d.lease_expires_at,
             (select o.output_id from public.outputs o where o.job_id = d.job_id
               order by o.created_at desc limit 1) as output_id
        from public.deliveries d
        join public.jobs j on j.job_id = d.job_id and j.office_id = d.office_id
       where d.state = 'claimed' and d.lease_expires_at < app.now_utc()
         and d.send_started_at is null
         and d.purpose = 'result'
         and d.dedupe_key like 'job:' || d.job_id::text || ':%'
         and j.state = 'complete' and j.announce
         and not app.harness_job(j.job_id)
       order by d.job_id, d.lease_expires_at
    ) x
   where x.output_id is not null
   order by x.lease_expires_at
   limit greatest(1, least(coalesce(p_limit, 10), 50));
$fn$;

revoke all on function app.settle_lapsed_deliveries(interval) from public;
revoke all on function app.deliveries_to_redrive(integer) from public;
revoke all on function app.begin_delivery_send(uuid, uuid, integer, interval) from public;
revoke all on function app.job_delivery_state(uuid, uuid) from public;
revoke all on function app.reopen_duty_voice(uuid) from public;
revoke all on function app.delivery_note(uuid, text, text) from public;

-- ---------------------------------------------------------------------------------------------------------------------
-- The list Grant reads: spliced from the live definition. Two changes: a superseded row is bookkeeping and is not listed,
-- and the sentence for an abandoned row says what happened rather than "the provider refused it".
create or replace function app.undelivered(p_project_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select coalesce(jsonb_agg(x.v order by x.at desc), '[]'::jsonb)
    from (
      select d.updated_at as at,
             jsonb_build_object(
               'delivery_id', d.delivery_id,
               'channel',     d.channel,
               'purpose',     d.purpose,
               'target',      d.target_ref,
               'attempt',     d.attempt,
               'error_code',  d.error_code,
               'job',         d.job_id,
               'project',     j.project_id,
               'at',          d.updated_at,
               -- A code nobody can act on is a code nobody reads.
               'says', case
                 when d.error_code like 'chat_not_found%'
                   then 'That chat no longer exists, or the bot was removed from it.'
                 when d.error_code like 'indeterminate%'
                   then 'The provider did not say whether it arrived.'
                 when d.error_code like 'abandoned:%'
                   then 'It was never sent and the office stopped trying.'
                 when d.error_code like '%rate%'
                   then 'The provider is rate-limiting us.'
                 when d.error_code like '%timeout%' or d.error_code like '%ECONN%'
                   then 'The provider could not be reached.'
                 else 'The provider refused it.'
               end
             ) as v
        from public.deliveries d
        join public.jobs j on j.job_id = d.job_id
       where d.state = 'failed'
         and coalesce(d.error_code, '') not like 'superseded:%'
         and not app.harness_job(j.job_id)
         and (p_project_id is null or j.project_id = p_project_id)
       order by d.updated_at desc
       limit greatest(1, least(coalesce(p_limit, 50), 200))
    ) x
$function$;
