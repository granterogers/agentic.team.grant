-- DEFERRED, NOT A MIGRATION: this file is deliberately outside `migrations/` so no runner can apply it by accident.
--
-- The efficiency workstream's unapplied 1030 (claude/efficiency-deep-optimization, "the dequeue asks the self-improvement ceiling only when it
-- needs it") and the V1 reliability migration 1044 (authored 1025, "a budget counts the office that spent it and a queue serves every office")
-- both replace app.dequeue_job. Applied in the order 1044 then 1030 as written, 1030 would restore a definition that has no fairness term, no
-- per-office in-flight count and no ready-office share: the queue would again run one office's whole burst before another office's first job
-- (the defect 1044 fixes). Applied the other way round, 1044 would bring the eager ceiling call back (the 2,400-buffer-per-pass cost 1030 removes).
-- Neither order is correct. This is the combined definition: 1044's body, with 1030's single change.
--
-- WHAT IT CHANGES relative to the 1044 definition (and nothing else; a diff of the two is the first thing the proof prints):
--   * the eager `v_may_reflect := app.self_improvement_within_budget();` at the top of the call is gone, and so is the variable;
--   * the claim asks the ceiling where it is used, as an uncorrelated scalar subquery `(select app.self_improvement_within_budget())`, an
--     InitPlan evaluated at most once per statement and only when a candidate is of a self-improvement kind.
-- WHAT IT KEEPS from 1044: the per-office fair share (an ORDER BY term, never a refusal), the ready-offices count, the in-flight count by office,
-- priority outranking fairness, the concurrency limit and its scope, the active-office filter, the lease, claim_gen and every return column.
--
-- HERMES 1078 (11 October 2026) CHANGES WHERE THIS GOES. The claim is now app.dequeue_job_core (six arguments, the last is p_can_engine) and app.dequeue_job is a
-- one-line wrapper that says p_can_engine = false: that is what stops a worker built before Hermes from claiming a message sent to Hermes. THIS FILE AS WRITTEN
-- REPLACES app.dequeue_job WITH A FULL BODY AND WOULD SILENTLY REMOVE THE GATE. Apply its change (the lazy ceiling) to app.dequeue_job_core instead, keeping
-- both `p_can_engine or not exists (...)` predicates, and leave the wrapper alone. tests/migrations/dequeue-redefinition.test.ts fails a migration that does not.
--
-- TO USE IT (a release decision, not part of the V1 release): (1) read app.schema_migrations; (2) take the next free number above every applied
-- file (1053 or later at the time of writing); (3) read the LIVE app.dequeue_job with pg_get_functiondef and confirm it is still 1044's (the proof
-- `scripts/isolated/dequeue-reconciled.ts` shows how); (4) put this body in a numbered file with the usual header; (5) never apply efficiency's own
-- 1030. Proof: scripts/isolated/dequeue-reconciled.ts (equivalence with 1044 on the claim; the fairness the old 1030 loses; the ceiling asked only when needed).

begin;

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

      Efficiency 1030, carried onto 1025's body: the ceiling is asked as an uncorrelated scalar subquery, which
      the executor runs at most once and only when a candidate is of one of
      those kinds. It was asked at the top of every call, so an empty pass
      paid for a day's usage it had no use for.
    */
    and (
      not exists (
        select 1 from public.self_improvement_kinds s where s.kind = j.kind
      )
      or (select app.self_improvement_within_budget())
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
