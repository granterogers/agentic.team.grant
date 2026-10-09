-- 1035: a lead's reply is never SENT after the team's answer to the same request has reached the same destination (#441).
--
-- WHAT WAS WRONG (the controlled real-model run, 8 October 2026). A delegated request makes two answers on two workers: the
-- lead's reply (her own finding and "I have asked N colleagues and will come back") and, later, the synthesis that is the
-- "coming back". With a real model the lead's own turn can finish AFTER two colleagues and the synthesis have, so the
-- hand-off announcement arrived after the result it announces and read as stale and contradictory.
--
-- THE ORDER IS A STATE, NOT A TIMING ASSUMPTION. The first half lives in the worker (`office.synthesise` does not answer until
-- the lead's reply has settled: lead job terminal and none of its deliveries still `claimed`; bounded to three minutes after
-- the team finished). This is the second half, which only the database can enforce, because the cases it covers are exactly
-- the ones a handler cannot see: the lead's send failed retryably and is redriven later, a worker restarted and the lead's
-- claim is reclaimed, the bound above expired and the synthesis went first. In each, a RESULT delivery of the lead is claimed
-- (or reclaimed) for a destination the synthesis of the same request has already reached.
--
-- THE RULE. `app.claim_delivery` is the one door every send passes. A `result` delivery of a job that opened a fan-in group is
-- refused, as `suppressed` with a reason a person can read, once the group's synthesis job has a SENT `result` delivery on the
-- same channel and destination. Recorded, not dropped: the row is the audit trail, `check:leaks` and the delivery readers see
-- it, and the output still exists on the job and in Team HQ's thread. Only purpose `result` is touched: a question that needs
-- his answer (`blocker`), a notice or a briefing is never suppressed by this. A delivery whose send is already in flight
-- (`send_started_at` set) is left alone, because suppressing a send that may have been accepted would be a lie about what
-- reached him; it resolves to sent or to the existing indeterminate path.
--
-- COMPATIBILITY. A worker built before this applies the rule with no code change (it is inside the SQL every send already
-- calls), and a worker built after this runs unchanged on a database without it (the handler gate reads tables only). Rolling
-- the database back is `create or replace` of the previous `claim_delivery` (see the rollback note in docs/audit) plus
-- `drop function app.result_superseded`; nothing else depends on it.
--
-- Spliced from the LIVE `app.claim_delivery` (as of 1034); the only change is the block marked 1035.

create or replace function app.result_superseded(
  p_office uuid,
  p_job uuid,
  p_channel text,
  p_target_ref text
) returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
      from public.branch_groups bg
      join public.jobs lead on lead.job_id = bg.parent_job_id and lead.office_id = p_office
      join public.deliveries d on d.job_id = bg.synthesis_job_id and d.office_id = p_office
     where bg.parent_job_id = p_job
       and bg.synthesis_job_id is not null
       and bg.synthesis_job_id <> p_job
       and d.purpose = 'result'
       and d.state::text = 'sent'
       and d.channel = p_channel
       and d.target_ref = p_target_ref
  )
$function$;

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

  /*
    1035. A LEAD'S RESULT IS NOT SENT AFTER THE ANSWER THAT SUPERSEDES IT.

    The synthesis of the same request has already reached this destination, so the lead's "I have asked N colleagues, I
    will come back" would arrive after the result it announces. Recorded as suppressed with its reason, never dropped. Only a
    `result`; never a send already in flight (it may have been accepted); never another office's row.
  */
  if p_purpose = 'result' and v_job is not null
     and app.result_superseded(p_office, v_job, p_channel, p_target_ref) then
    insert into public.deliveries
      (office_id, channel, dedupe_key, account_ref, target_ref, thread_ref, staff_id,
       correlation_id, job_id, purpose, state, suppressed_reason, lease_expires_at)
    values
      (p_office, p_channel, p_dedupe_key, p_account_ref, p_target_ref, p_thread_ref,
       p_staff_id, p_correlation_id, v_job, p_purpose, 'suppressed',
       'superseded: the team''s answer to this request has already reached this destination', app.now_utc())
    on conflict (dedupe_key) do update
       set state = 'suppressed',
           suppressed_reason = 'superseded: the team''s answer to this request has already reached this destination',
           lease_expires_at = app.now_utc()
     where public.deliveries.office_id = p_office
       and public.deliveries.state::text = 'claimed'
       and public.deliveries.send_started_at is null
    returning * into v_row;
    if found then
      return query select v_row.delivery_id, 'suppressed'::text, null::text, v_row.attempt;
      return;
    end if;
    -- Nothing changed: the row is already sent, suppressed, failed, in flight, or not ours. The ordinary path answers.
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
