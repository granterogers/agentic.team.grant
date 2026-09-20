/*
  0523 — harness traffic may not reach a production destination (anchor C)

  A reminder reading "Reminder: Remind me khgkowx8." arrived on Grant's real
  Telegram. `khgkowx8` is a `verify:mytasks` run token. The job behind it:

      kind            tasks.remind
      requested_by    verify:mytasks-khgkowx8
      is_fixture      TRUE
      harness_job()   TRUE
      announce        TRUE

  and the delivery row says `telegram -> 1386648496`, `state = sent`,
  `suppressed_reason = null`. **The office knew it was harness traffic and
  delivered it anyway** — nothing on the delivery path had ever consulted
  either flag.

  Measured before fixing: 162 harness deliveries SENT to real destinations
  across 42 distinct runs, 87 of them to Grant's own Telegram chat.

  ## Why cleanup cannot be the answer

  The send happened 0.26 seconds after the output was written. No teardown, no
  sweep and no `check:leaks` run at the end of a suite can be early enough. The
  previous run reported "no QA debris" truthfully — the database WAS clean, and
  the message had already left the building. That gap is the whole lesson:
  **"clean now" and "no synthetic side effect ever escaped" are different
  claims, and only the first was being made.**

  ## The shape: DEFAULT DENY, at the one door

  `app.claim_delivery` is the single chokepoint — every sender claims a row
  before it touches a network. The guard goes there rather than in the senders,
  because CLAUDE.md's rule is that a guard applied in one of two call paths
  guards nothing.

  A destination is PRODUCTION unless it has been explicitly registered as a
  test destination. That direction is deliberate and is 0304's asymmetry: a
  witness that can only ever EXCLUDE cannot hide a genuine escape. A new suite
  pointed somewhere nobody registered is blocked, which is the opposite of the
  behaviour that produced this defect.

  ## And a destination that real traffic uses can never be registered

  Enforced by trigger, not by care. Registering Grant's chat would reopen the
  hole completely, and the one piece of evidence that cannot be argued with is
  that non-harness traffic has been delivered there.
*/

create table if not exists public.test_destinations (
  channel     text not null,
  target_ref  text not null,
  why         text not null,
  created_at  timestamptz not null default app.now_utc(),
  primary key (channel, target_ref),
  constraint test_destinations_why_said check (length(btrim(why)) > 8)
);

comment on table public.test_destinations is
  'Destinations a harness may deliver to. Everything else is production. Anchor C, 0523.';

/*
  A destination real traffic has ever reached is not a test destination, and
  saying so is not a matter of judgement — the delivery rows know.
*/
create or replace function app.test_destination_is_not_real() returns trigger
language plpgsql security definer set search_path = '' as $t$
declare v_real int;
begin
  select count(*)::int into v_real
    from public.deliveries d
    left join public.jobs j on j.job_id = d.job_id
   where d.channel = new.channel
     and d.target_ref = new.target_ref
     and d.sent_at is not null
     and (d.job_id is null or not app.harness_job(d.job_id));
  if v_real > 0 then
    raise exception
      'refusing: % % has received % real delivery(s) - it is a production destination',
      new.channel, new.target_ref, v_real;
  end if;
  return new;
end;
$t$;

drop trigger if exists test_destinations_not_real on public.test_destinations;
create trigger test_destinations_not_real
  before insert or update on public.test_destinations
  for each row execute function app.test_destination_is_not_real();

/*
  The question `claim_delivery` asks, as its own function so a suite and a
  check can ask it too without restating the rule.

  A job that is not harness traffic is deliverable anywhere: this must not
  become a second opinion about where the office may talk. Only the harness
  half is constrained.
*/
create or replace function app.deliverable_to(
  p_job_id uuid, p_channel text, p_target_ref text
) returns boolean language sql stable security definer set search_path = '' as $f$
  select case
    when p_job_id is null then true
    when not app.harness_job(p_job_id) then true
    else exists (select 1 from public.test_destinations t
                  where t.channel = p_channel and t.target_ref = p_target_ref)
  end
$f$;

grant execute on function app.deliverable_to(uuid, text, text) to authenticated, service_role;

/*
  What a harness has actually tried to send to a real destination, so the
  attempt is COUNTABLE rather than merely prevented. A guard nobody can measure
  is one nobody notices decaying.
*/
create or replace function app.harness_delivery_attempts(p_since interval default '30 days')
returns jsonb language sql stable security definer set search_path = '' as $f$
  select coalesce(jsonb_agg(jsonb_build_object(
           'channel', d.channel, 'target', d.target_ref, 'by', j.requested_by,
           'state', d.state, 'at', d.created_at) order by d.created_at desc), '[]'::jsonb)
    from public.deliveries d
    join public.jobs j on j.job_id = d.job_id
   where app.harness_job(d.job_id)
     and d.created_at > app.now_utc() - p_since
     and not app.deliverable_to(d.job_id, d.channel, d.target_ref)
$f$;

grant execute on function app.harness_delivery_attempts(interval) to authenticated, service_role;

CREATE OR REPLACE FUNCTION app.claim_delivery(p_channel text, p_dedupe_key text, p_account_ref text, p_target_ref text, p_purpose text, p_thread_ref text DEFAULT NULL::text, p_staff_id uuid DEFAULT NULL::uuid, p_correlation_id uuid DEFAULT NULL::uuid, p_job_id uuid DEFAULT NULL::uuid, p_lease interval DEFAULT '00:02:00'::interval)
 RETURNS TABLE(delivery_id uuid, outcome text, message_ref text, attempt integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row public.deliveries;
begin
  /*
    HARNESS TRAFFIC MAY NOT REACH A PRODUCTION DESTINATION. Ever, by anybody.

    This is the whole of the fix for the reminder that read "Remind me
    khgkowx8" on Grant's real Telegram. That job carried `is_fixture = true`
    AND `app.harness_job() = true`, and it was delivered anyway, because
    nothing on this path had ever asked. 162 harness deliveries had been sent
    to real destinations across 42 runs before anybody counted; 87 of them to
    Grant.

    It is DEFAULT DENY and it lives here rather than in a caller, because a
    guard in one of two call paths guards nothing and because cleanup is
    structurally too late: the send happened 0.26 seconds after the output.

    Suppressed rather than raised. A refusal that throws would fail the job and
    tell a suite its product is broken; `suppressed` is an outcome every sender
    already understands, it records the ATTEMPT where `check:leaks` can count
    it, and the suite carries on.
  */
  if not app.deliverable_to(p_job_id, p_channel, p_target_ref) then
    insert into public.deliveries
      (channel, dedupe_key, account_ref, target_ref, thread_ref, staff_id,
       correlation_id, job_id, purpose, state, suppressed_reason, lease_expires_at)
    values
      (p_channel, p_dedupe_key, p_account_ref, p_target_ref, p_thread_ref,
       p_staff_id, p_correlation_id, p_job_id, p_purpose, 'suppressed',
       'harness traffic may not reach a production destination', app.now_utc())
    on conflict (dedupe_key) do nothing
    returning * into v_row;
    if not found then
      select * into v_row from public.deliveries d where d.dedupe_key = p_dedupe_key;
    end if;
    return query select v_row.delivery_id, 'suppressed'::text, null::text, v_row.attempt;
    return;
  end if;

  -- The insert IS the lock. Concurrent duplicates cannot both succeed here.
  insert into public.deliveries
    (channel, dedupe_key, account_ref, target_ref, thread_ref, staff_id,
     correlation_id, job_id, purpose, lease_expires_at)
  values
    (p_channel, p_dedupe_key, p_account_ref, p_target_ref, p_thread_ref,
     p_staff_id, p_correlation_id, p_job_id, p_purpose, app.now_utc() + p_lease)
  on conflict (dedupe_key) do nothing
  returning * into v_row;

  if found then
    return query select v_row.delivery_id, 'claimed'::text, null::text, v_row.attempt;
    return;
  end if;

  select * into v_row from public.deliveries d
    where d.dedupe_key = p_dedupe_key
    for update;

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

  -- The reclaim. Fully qualified, because the bare column name is this
  -- function's own OUT parameter (0035).
  update public.deliveries
     set attempt = public.deliveries.attempt + 1,
         lease_expires_at = app.now_utc() + p_lease
   where public.deliveries.delivery_id = v_row.delivery_id
  returning * into v_row;

  return query select v_row.delivery_id, 'reclaimed'::text, null::text, v_row.attempt;
end;
$function$;

/*
  DRIVE IT. A migration that applies cleanly is not a guard that holds, and
  this is the one guard in the office whose failure Grant sees personally.
*/
do $drive$
declare
  v_job   uuid;
  v_real  uuid;
  v_out   record;
  v_grant text := '1386648496';   -- his real chat, from the delivery that escaped
begin
  -- A harness job, named the way the escaped one was.
  insert into public.jobs (correlation_id, idempotency_key, kind, requested_by, state, announce)
  values (extensions.gen_random_uuid(), 'drive-0523-harness-'||extensions.gen_random_uuid()::text,
          'office.instruction', 'verify:drive-0523', 'queued', true)
  returning job_id into v_job;

  -- 1. it may NOT reach Grant
  if app.deliverable_to(v_job, 'telegram', v_grant) then
    raise exception '0523: a harness job is still deliverable to Grant''s real chat';
  end if;
  select * into v_out from app.claim_delivery(
    'telegram', 'drive-0523-a', 'chief', v_grant, 'result', null, null, null, v_job);
  if v_out.outcome <> 'suppressed' then
    raise exception '0523: claiming a delivery to Grant from a harness job returned %', v_out.outcome;
  end if;
  if not exists (select 1 from public.deliveries
                  where dedupe_key = 'drive-0523-a' and state = 'suppressed'
                    and suppressed_reason like '%production destination%') then
    raise exception '0523: the refusal was not recorded where it can be counted';
  end if;
  if (select count(*) from jsonb_array_elements(app.harness_delivery_attempts())) < 1 then
    raise exception '0523: the attempt is not visible to the reader built for it';
  end if;

  -- 2. CONTROL: a REAL job may still reach him. The guard is about the harness,
  --    not a second opinion about where the office may talk.
  insert into public.jobs (correlation_id, idempotency_key, kind, requested_by, state, announce)
  values (extensions.gen_random_uuid(), 'drive-0523-real-'||extensions.gen_random_uuid()::text,
          'office.instruction', 'telegram:grant', 'queued', true)
  returning job_id into v_real;
  if not app.deliverable_to(v_real, 'telegram', v_grant) then
    raise exception '0523: a REAL job can no longer reach Grant - the guard is too wide';
  end if;

  -- 3. and a harness job MAY reach a registered test destination
  insert into public.test_destinations (channel, target_ref, why)
  values ('telegram', '-100999000111', 'the 0523 drive, a chat that does not exist');
  if not app.deliverable_to(v_job, 'telegram', '-100999000111') then
    raise exception '0523: a registered test destination is still refused';
  end if;

  -- 4. CONTROL: Grant''s chat can never BE registered, and the refusal says why
  begin
    insert into public.test_destinations (channel, target_ref, why)
    values ('telegram', v_grant, 'this must never be allowed to succeed');
    raise exception '0523: Grant''s real chat was accepted as a test destination';
  exception when others then
    if sqlerrm not like '%production destination%' then
      raise exception '0523: it was refused for the WRONG reason: %', sqlerrm;
    end if;
  end;

  -- teardown of the drive's own rows
  delete from public.test_destinations where target_ref = '-100999000111';
  delete from public.deliveries where dedupe_key = 'drive-0523-a';
  /*
    The jobs are CANCELLED, not deleted. `job_state_transitions` holds a
    foreign key and a job can never be removed — CLAUDE.md records it, and the
    first draft of this drive hit it. Both are `verify:`-named, so
    `is_fixture` is generated true and neither can reach a reader that shows
    Grant anything.
  */
  update public.jobs set state = 'cancelled', announce = false
   where job_id in (v_job, v_real);
  raise notice '0523 drive: six checks passed';
end;
$drive$;
