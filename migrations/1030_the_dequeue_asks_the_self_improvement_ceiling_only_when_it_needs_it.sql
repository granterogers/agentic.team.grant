-- 1030 - the dequeue asks the self-improvement ceiling only when a job could need it (efficiency run, 6 October 2026; NOT applied to production).
--
-- WHAT WAS MEASURED (two local replicas of ONE seeded database, one rolled back to the predecessors by the exact rollback files, so
-- the data, the clock and the statistics are identical; scripts/forensics/normal-load.ts and resource-probe.ts). An empty worker
-- pass touched 2,600 buffers, and 2,400 of them were one statement: `v_may_reflect := app.self_improvement_within_budget()` at the top
-- of app.dequeue_job. That function sums the last 24 hours of inference_usage, probing the job of every usage row (about 3 buffers
-- a row; 160 to 230 rows on the seed), to answer a question that matters only if a queued job is of a self-improvement kind. The
-- worker pass runs every minute, so the office did this 1,440 times a day while nothing was queued.
--
-- WHAT CHANGED. The eager call is gone. The same question is asked where it is used, as an uncorrelated scalar subquery
-- `(select app.self_improvement_within_budget())`, an InitPlan: evaluated at most once per statement, and only when a candidate row
-- is of a self-improvement kind (the `not exists (...)` disjunct is true for every other job, which short-circuits the OR). With
-- nothing queued, or only ordinary work queued, the ceiling is never computed.
--
-- WHAT DOES NOT CHANGE. Which job is claimed. A self-improvement job still waits while the budget is spent and is claimed as soon as
-- it is not; work for a person is never held by the ceiling; the limit on concurrent jobs, the scope, the lease, the claim, the
-- return value and every other predicate are the live definition byte for byte. The ceiling is read inside the SAME statement that
-- chooses the job, which is stricter than before (the old flag was read in an earlier statement of the call, so a budget that
-- changed between the two could be acted on stale; the new read cannot be older than the choice).
--
-- Proof: scripts/isolated/dequeue-ceiling-equivalence.ts runs the frozen definition (scripts/isolated/reference/dequeue.pre-1030.sql,
-- the live app.dequeue_job as of migration 0852's chain) beside this one on edge cases, and a counter shows the ceiling is not
-- evaluated when it need not be. Roll back by re-applying scripts/isolated/reference/dequeue.pre-1030.sql (create or replace; no data
-- changed; grants and owner are kept by create or replace).

begin;

CREATE OR REPLACE FUNCTION app.dequeue_job(p_worker text, p_can_transcribe boolean DEFAULT true, p_can_subprocess boolean DEFAULT true, p_kinds text[] DEFAULT NULL::text[], p_requested_by text DEFAULT NULL::text)
 RETURNS TABLE(job_id uuid, kind text, correlation_id uuid, project_id uuid, idempotency_key text, attempt integer, pinned_config jsonb, office_id uuid)
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'app', 'public'
AS $function$
declare
  v_limit       integer;
  v_active      integer;
  v_lease       integer;
  v_job_id      uuid;
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

      1030: the ceiling is asked as an uncorrelated scalar subquery, which
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
  order by j.priority asc, j.created_at asc
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
