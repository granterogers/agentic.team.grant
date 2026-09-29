-- 0601 - An outbound message must name what caused it (#378).
--
-- Slack narration posted 523 messages to the office floor channel between 7
-- and 29 September and 381 of them were narrations of HARNESS work - test
-- turns, suites, deploy probes. The containment guard never saw one:
-- `app.deliverable_to(job, channel, target)` opened with
--
--     when p_job_id is null then true
--
-- and narration delivered with no job id, so every one of them was waved
-- through. The witness (`app.harness_escapes`) joins deliveries to jobs on the
-- same empty column, so it counted none either - which is how a real harness
-- message and "0 new escapes" appeared on the same afternoon.
--
-- A missing job is not evidence that a message is legitimate. After this:
--
--   * a delivery that names a job is decided by that job's lineage, as before
--     (harness work may reach only a registered test destination);
--   * a delivery that names NO job is allowed only to a registered test
--     destination, or from a sender registered in `public.operator_senders` -
--     the handful of operator commands (npm run notify, say-hello, the token
--     deploys) that genuinely have no job. Everything else is SUPPRESSED, with
--     the reason recorded where check:leaks counts it.
--
-- The rule lives in one function, `app.delivery_refusal`, called from the one
-- place every delivery-layer send passes through, `app.claim_delivery`. A new
-- feature that forgets its provenance now fails closed instead of open.
--
-- Deploy the worker first: it is what makes narration name its job. With this
-- migration applied and the old worker still running, narration (an
-- unregistered, job-less sender) is suppressed - safe, and silent until the
-- worker catches up.

create table if not exists public.operator_senders (
  namespace text primary key
    check (namespace ~ '^[a-z][a-z0-9-]*$'),
  reason text not null check (length(btrim(reason)) >= 20),
  registered_at timestamptz not null default app.now_utc()
);

comment on table public.operator_senders is
  'The dedupe-key namespaces (the part before the first colon) of senders that '
  'legitimately deliver with NO job: operator commands a person runs. A '
  'job-less delivery from any other namespace is refused by '
  'app.delivery_refusal (#378). Adding a row is a deliberate, reviewable act.';

insert into public.operator_senders (namespace, reason) values
  ('build',        'npm run notify / npm run step: the build agent telling Grant it is blocked or done'),
  ('hello',        'scripts/staff/say-hello.ts: an operator introducing each specialist once'),
  ('introduction', 'scripts/slack/introductions.ts: the one-time staff introductions in Slack'),
  ('mcp-token',    'scripts/deploy/mcp.ts: an operator sending Grant a freshly minted MCP credential'),
  ('hq-token',     'scripts/deploy/hq-token.ts: an operator sending Grant his dashboard credential')
on conflict (namespace) do nothing;

create or replace function app.delivery_refusal(
  p_job_id uuid, p_dedupe_key text, p_channel text, p_target_ref text)
returns text
language sql
stable
security definer
set search_path = ''
as $f$
  select case
    -- A registered, contained test destination may receive anything.
    when exists (select 1 from public.test_destinations t
                  where t.channel = p_channel and t.target_ref = p_target_ref) then null
    -- No job: only an operator sender that has been registered by name.
    when p_job_id is null then
      case when exists (select 1 from public.operator_senders s
                         where s.namespace = split_part(coalesce(p_dedupe_key, ''), ':', 1))
           then null
           else 'no provenance: a delivery must name its job or a registered operator sender'
      end
    -- A job nobody can find is not provenance. app.harness_job answers "real"
    -- for an id it cannot see, so this has to be asked first.
    when not exists (select 1 from public.jobs j where j.job_id = p_job_id) then
      'no provenance: the job this delivery names does not exist'
    -- A job: decided by its lineage.
    when app.harness_job(p_job_id) then
      'harness traffic may not reach a production destination'
    else null
  end
$f$;

comment on function app.delivery_refusal(uuid, text, text, text) is
  'Why a delivery may NOT be made, or null when it may. The single policy '
  'app.claim_delivery applies to every delivery-layer send (#378). Fails '
  'closed: a delivery with no job is refused unless its target is a registered '
  'test destination or its dedupe namespace is a registered operator sender.';

-- The per-job question keeps its meaning, and no longer answers "yes" to a
-- delivery that named no job.
create or replace function app.deliverable_to(p_job_id uuid, p_channel text, p_target_ref text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $f$
  select case
    when exists (select 1 from public.test_destinations t
                  where t.channel = p_channel and t.target_ref = p_target_ref) then true
    when p_job_id is null then false
    when not exists (select 1 from public.jobs j where j.job_id = p_job_id) then false
    else not app.harness_job(p_job_id)
  end
$f$;

CREATE OR REPLACE FUNCTION app.claim_delivery(p_channel text, p_dedupe_key text, p_account_ref text, p_target_ref text, p_purpose text, p_thread_ref text DEFAULT NULL::text, p_staff_id uuid DEFAULT NULL::uuid, p_correlation_id uuid DEFAULT NULL::uuid, p_job_id uuid DEFAULT NULL::uuid, p_lease interval DEFAULT '00:02:00'::interval)
 RETURNS TABLE(delivery_id uuid, outcome text, message_ref text, attempt integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row public.deliveries;
  v_refusal text;
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
  /*
    0601 (#378): ONE decision for every delivery, and it fails closed.

    `app.deliverable_to` answered TRUE for any delivery that named no job, so
    a sender that dropped its provenance - Slack narration, 381 of 523 of
    whose posts were of harness work - was waved through, and the witness
    that joins deliveries to jobs could not see it either. The decision now
    lives in `app.delivery_refusal`, which also knows the job-less case: it
    is allowed only to a registered test destination or from a registered
    operator sender. Anything else is refused as having no provenance.
  */
  v_refusal := app.delivery_refusal(p_job_id, p_dedupe_key, p_channel, p_target_ref);
  if v_refusal is not null then
    insert into public.deliveries
      (channel, dedupe_key, account_ref, target_ref, thread_ref, staff_id,
       correlation_id, job_id, purpose, state, suppressed_reason, lease_expires_at)
    values
      (p_channel, p_dedupe_key, p_account_ref, p_target_ref, p_thread_ref,
       p_staff_id, p_correlation_id,
       -- The job only if it exists: a refusal of an unknown job must record, not raise.
       (select j.job_id from public.jobs j where j.job_id = p_job_id),
       p_purpose, 'suppressed', v_refusal, app.now_utc())
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
