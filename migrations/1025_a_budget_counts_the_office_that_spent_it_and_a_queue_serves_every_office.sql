-- 1025: tenant fairness and the shared budget (deep systems audit 6 October 2026, A-1 / C8 / A-2).
--
-- What was true before this file (REPLICA-PROVEN by scripts/isolated/office-fairness.ts against the schema at 1022):
--
--   * app.spent_today(agent) summed jobs.trace_pence over EVERY office. app.over_budget(agent) compared that sum to a
--     per-agent ceiling (60p) and an "office" ceiling (200p), and the "office" ceiling was in fact the whole deployment's.
--   * app.defer_over_budget() asked that question per agent and then moved not_before to tomorrow on EVERY queued job of
--     that agent in EVERY office. The eight agents are global staff rows, so one office driving an agent to its limit held
--     every other office's work for that agent until UTC midnight, and it did so for the operator's own conversation too:
--     an office.instruction typed by a person was parked for up to a day with no word to anybody.
--   * app.dequeue_job ordered by (priority, created_at) with no office term, so an office that enqueued two hundred jobs
--     ran every one of them before the next office's first job started.
--
-- What changes, and nothing else:
--
--   1. Spend is counted by (office, agent) and by office. spent_today and over_budget take the office as their first
--      argument and it is REQUIRED: a missing office raises rather than meaning "everybody", because a default is an
--      identity and the old default was the deployment. The ceilings are unchanged (same system_config keys, same
--      numbers); each office is now held to them by what IT spent.
--   2. defer_over_budget holds an over-budget office's own jobs for that agent and no other office's.
--   3. A person's own conversation is never parked by the budget. office.instruction (a turn, and a hand-off to a
--      specialist, which is the same kind) and office.pursue (the continuation of a turn) are exempt from DEFERRAL. Their
--      spend still counts, so an office whose conversation spent its ceiling holds its own background duties until
--      tomorrow, which says "your conversation used it" rather than silently stopping the conversation. The choice was
--      exemption over sending a word: a word needs the delivery path whose terminal-failure notice is changing in 1024,
--      and a turn a person is waiting on is the one job the budget should never be allowed to swallow.
--      app.budget_defers_kind is the single statement of which kinds that is, so the scan and the update cannot
--      disagree (a row list built twice is a list that will disagree).
--   4. dequeue_job serves offices fairly, and the rule is an ORDER BY term, not a cap. Among jobs of equal priority, the
--      job of an office that already holds its fair share of the in-flight slots (max(1, limit / offices with work ready))
--      sorts after the job of an office that does not. It never refuses a job, so a lone office still uses every slot,
--      a spare slot still goes to whoever is oldest, and priority still outranks it. It is ignored when nobody has more
--      than one office waiting, so a single office's queue order is exactly what it was.
--
-- Not done here, deliberately: a per-job cost cap, accounting for in-flight spend (spend is still counted at finished_at,
-- so a long retrying job is invisible until it finishes), a deployment-wide ceiling above the offices (it would be the
-- same coupling under a new name), and any change to the Sample's per-visitor limits (app.guest_allow keys on a
-- client-chosen id; out of scope, noted in the audit).

begin;

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. spend by office
-- ---------------------------------------------------------------------------------------------------------------------

create function app.spent_today(p_office uuid, p_agent text default null)
returns numeric
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
begin
  if p_office is null then
    raise exception 'no_office' using errcode = '42501',
      hint = 'spend is counted for one office; a missing office is refused, never read as the whole deployment';
  end if;
  return (
    select coalesce(sum(j.trace_pence), 0)::numeric
      from public.jobs j
     where j.office_id = p_office
       and j.finished_at >= date_trunc('day', app.now_utc())
       and coalesce(j.trace_pence, 0) > 0
       and (p_agent is null or j.recipient_agent = p_agent)
       and not coalesce(app.harness_job(j.job_id), false)
  );
end
$function$;

comment on function app.spent_today(uuid, text) is
  'Pence actually spent today by ONE office, in total or by one agent (#134, per office since 1025). Only rows with a real '
  'cost count: free-model work is most of what this office does. Harness traffic is excluded. Counted by finished_at, so '
  'work still in flight or retrying is invisible until it finishes.';

create function app.over_budget(p_office uuid, p_agent text)
returns text
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  with lim as (
    select coalesce((select (value #>> '{}')::numeric from public.system_config
                      where key = 'budget.pence_per_agent_per_day'), 60) as per_agent,
           coalesce((select (value #>> '{}')::numeric from public.system_config
                      where key = 'budget.pence_for_the_office_per_day'), 200) as office
  ),
  spent as (
    select app.spent_today(p_office) as office,
           case when p_agent is not null then app.spent_today(p_office, p_agent) end as agent
  )
  select case
    -- The office ceiling binds above the per-agent ones, and is checked first so its sentence is the one a person sees
    -- when both are reached. It counts THIS office's spend only.
    when spent.office >= lim.office then
      format('the office has spent %sp today, which is its daily limit of %sp',
             round(spent.office), round(lim.office))
    when p_agent is not null and spent.agent >= lim.per_agent then
      format('%s has spent %sp today, which is their daily limit of %sp',
             p_agent, round(spent.agent), round(lim.per_agent))
    else null
  end
  from lim, spent
$function$;

comment on function app.over_budget(uuid, text) is
  'Why one office may not start work for an agent yet, as a sentence, or null (#134, per office since 1025). The per-agent '
  'and the office-wide ceilings both count only the named office''s own spend.';

revoke all on function app.spent_today(uuid, text) from public, anon, authenticated, service_role;
revoke all on function app.over_budget(uuid, text) from public, anon, authenticated, service_role;

-- The deployment-wide shapes go. Nothing but defer_over_budget called them (it is redefined below, and a plpgsql body is
-- resolved when it runs), and a surviving one-argument form would be the old coupling one wrong call away.
drop function app.over_budget(text);
drop function app.spent_today(text);

-- ---------------------------------------------------------------------------------------------------------------------
-- 2 and 3. deferral holds the spending office's own background work, and never a person's conversation
-- ---------------------------------------------------------------------------------------------------------------------

create function app.budget_defers_kind(p_kind text)
returns boolean
language sql
immutable
set search_path to 'pg_catalog'
as $function$
  select p_kind is null or p_kind <> all (array['office.instruction', 'office.pursue'])
$function$;

comment on function app.budget_defers_kind(text) is
  'Whether the daily budget may park a job of this kind (1025). A person''s conversation (a turn, a hand-off to a '
  'specialist, a plan''s continuation) is never parked, because nothing tells the person it was.';

revoke all on function app.budget_defers_kind(text) from public, anon, authenticated, service_role;

create or replace function app.defer_over_budget()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_held int := 0;
  v_row  record;
  v_why  text;
  v_off  uuid[] := '{}';
begin
  for v_row in
    select distinct j.office_id, j.recipient_agent as agent
      from public.jobs j
     where j.state = 'queued'
       and (j.not_before is null or j.not_before <= app.now_utc())
       and app.budget_defers_kind(j.kind)
       and not coalesce(app.harness_job(j.job_id), false)
  loop
    v_why := app.over_budget(v_row.office_id, v_row.agent);
    continue when v_why is null;
    update public.jobs j
       set not_before = date_trunc('day', app.now_utc()) + interval '1 day',
           state_reason = v_why,
           updated_at = app.now_utc()
     where j.state = 'queued'
       and j.office_id = v_row.office_id
       and j.recipient_agent is not distinct from v_row.agent
       and (j.not_before is null or j.not_before <= app.now_utc())
       and app.budget_defers_kind(j.kind)
       and not coalesce(app.harness_job(j.job_id), false);
    v_held := v_held + 1;
    if not v_row.office_id = any(v_off) then
      v_off := v_off || v_row.office_id;
    end if;
  end loop;
  return jsonb_build_object('agents_held', v_held, 'offices_held', coalesce(array_length(v_off, 1), 0));
end;
$function$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. the queue serves every office
-- ---------------------------------------------------------------------------------------------------------------------
-- Spliced from the live definition (0852); the only changes are the two new variables, the share computed once per call,
-- the per-office in-flight count, and the second ORDER BY term.

create or replace function app.dequeue_job(
  p_worker text,
  p_can_transcribe boolean default true,
  p_can_subprocess boolean default true,
  p_kinds text[] default null::text[],
  p_requested_by text default null::text)
returns table(job_id uuid, kind text, correlation_id uuid, project_id uuid, idempotency_key text, attempt integer,
              pinned_config jsonb, office_id uuid)
language plpgsql
set search_path to 'pg_catalog', 'app', 'public'
as $function$
declare
  v_limit          integer;
  v_active         integer;
  v_lease          integer;
  v_job_id         uuid;
  v_may_reflect    boolean;
  v_ready_offices  integer;
  v_share          integer;
begin
  if p_worker is null or length(trim(p_worker)) = 0 then
    raise exception 'a worker identity is required to dequeue'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('ai_team_hq.job_dequeue'));

  /*
    The same limit, counted over the same work the claim can reach.

    Unscoped, that is the whole queue, exactly as it has always been. Scoped,
    it is that scope's own jobs — because a caller that cannot CLAIM another
    scope's work should not be BLOCKED by it either, which is the whole of
    #184.
  */
  v_limit := app.capacity_limit('max_concurrent_jobs', 3);
  select count(*) into v_active
  from public.jobs
  where state in (
    'running', 'output_created', 'quality_review', 'committing', 'committed', 'notifying'
  )
    and (p_requested_by is null or requested_by = p_requested_by);

  if v_active >= v_limit then
    return;
  end if;

  -- 0216: asked once per dequeue rather than once per candidate row. A
  -- stable function in a WHERE clause is not guaranteed to be hoisted, and
  -- the budget cannot change during a single call anyway.
  v_may_reflect := app.self_improvement_within_budget();

  /*
    1025: a fair share of the slots, asked once per call.

    How many offices have work this caller could take right now, and so how many in-flight slots each is entitled to.
    It is an ORDERING term below and never a refusal: an office over its share is served after one under its share
    of the same priority, and it still runs when nobody under its share is waiting. With one office waiting the share is the whole limit
    and no job is over it, so the order is exactly (priority, created_at) as before.
  */
  select count(distinct q.office_id)::integer into v_ready_offices
  from public.jobs q
  where q.state = 'queued'
    and q.attempt < q.max_attempts
    and (q.not_before is null or q.not_before <= now())
    and (p_kinds is null or q.kind = any(p_kinds))
    and (p_requested_by is null or q.requested_by = p_requested_by)
    and exists (select 1 from public.offices o where o.office_id = q.office_id and o.state = 'active');
  v_share := greatest(1, v_limit / greatest(coalesce(v_ready_offices, 1), 1));

  with busy as (
    select f.office_id, count(*)::integer as n
    from public.jobs f
    where f.state in ('running', 'output_created', 'quality_review', 'committing', 'committed', 'notifying')
    group by f.office_id
  )
  select j.job_id into v_job_id
  from public.jobs j
  where j.state = 'queued'
    and j.attempt < j.max_attempts
    -- A disabled office's work waits where it is: its data is untouched and nothing of it runs (P3).
    and exists (select 1 from public.offices o where o.office_id = j.office_id and o.state = 'active')
    -- 0074: a delayed job is not a queued job yet.
    and (j.not_before is null or j.not_before <= now())
    -- 0125: an untranscribed voice note needs a worker that can hear. The Edge
    -- worker cannot — no subprocesses, no Python — and it reports that about
    -- itself at GET /functions/v1/worker. Tests the TRANSCRIPT rather than the
    -- audio, so a note already transcribed is ordinary work any worker may
    -- finish.
    and (
      p_can_transcribe
      or not exists (
        select 1 from public.inbound_commands c
         where c.job_id = j.job_id
           and c.voice_file_id is not null
           and coalesce(trim(c.transcript), '') = ''
      )
    )
    -- 0137: and the same argument for everything else that needs a local
    -- process. A kind not in the table runs anywhere.
    and (
      p_can_subprocess
      or not exists (
        select 1 from public.job_kind_needs n
         where n.kind = j.kind and n.needs_subprocess
      )
    )
    -- 0147: and the most obvious form of the same rule, which was missing.
    -- A worker that holds five handlers must not claim a job needing a sixth.
    -- Null means "everything", which is what every caller meant before this
    -- argument existed.
    and (p_kinds is null or j.kind = any(p_kinds))
    -- 0329: and one step further, for #184. A worker that exists to run ONE
    -- job must not claim a different one, however well it could handle it.
    and (p_requested_by is null or j.requested_by = p_requested_by)
    /*
      0216: and the office does not keep thinking about itself once today's
      budget is spent (#53, ADR-0018).

      Here rather than in the handlers because a check in the caller is a check
      in one of the callers. Work FOR Grant is untouched — only the kinds in
      `self_improvement_kinds` wait, and they wait rather than fail, so the
      queue drains itself when the rolling window moves.
    */
    and (
      v_may_reflect
      or not exists (
        select 1 from public.self_improvement_kinds s where s.kind = j.kind
      )
    )
  order by j.priority asc,
           -- 1025: false (an office under its share) sorts first.
           (coalesce((select b.n from busy b where b.office_id = j.office_id), 0) >= v_share) asc,
           j.created_at asc
  for update skip locked
  limit 1;

  if v_job_id is null then
    return;
  end if;

  v_lease := coalesce(
    (select value::text::integer from public.system_config where key = 'jobs.lease_seconds'),
    300
  );

  update public.jobs j
  set state        = 'running',
      leased_by    = p_worker,
      leased_until = now() + make_interval(secs => v_lease),
      attempt      = j.attempt + 1,
      claim_gen    = greatest(j.claim_gen, j.attempt) + 1,
      state_reason = format('dequeued by %s', p_worker)
  where j.job_id = v_job_id;

  -- The job whole, with the office it belongs to. The worker passes this office to every later call.
  return query
    select j.job_id, j.kind, j.correlation_id, j.project_id,
           j.idempotency_key, j.attempt, j.pinned_config, j.office_id
    from public.jobs j
    where j.job_id = v_job_id;
end
$function$;

commit;
