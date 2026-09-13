begin;

/**
 * A scope gets the same allowance the office does.
 *
 * Issue #184. 0329 gave a scoped claim a limit of ONE — "is anything from this
 * scope already running?" — and that is too tight by exactly the amount a
 * verification suite needs.
 *
 * `verify:worker` deliberately parks jobs in intermediate states, because
 * those states are what it is testing. At the point it asks for its one real
 * provider call, its own scope holds:
 *
 *     committing   research.conclusion            1
 *     paused       research.nobody_handles_this   1
 *     queued       research.live                  1
 *     retrying     research.explodes              1
 *
 * `committing` is one of the six states the capacity check counts, so the
 * scope was full and the last two checks of the suite failed — 24/26, having
 * been 26/26 the run before. The fix for a coupling had produced a narrower
 * one.
 *
 * ## The number, and why it is the same number
 *
 * `max_concurrent_jobs` bounds what the OFFICE does at once, for the free
 * tier's throughput. Counting it per scope keeps that guarantee proportional
 * rather than inventing a second policy: a scope may have as much work in
 * flight as the office may, and the office's own workers — which pass no scope
 * — are governed exactly as before.
 *
 * The alternative was to count only jobs actually LEASED when scoped, on the
 * grounds that a job parked in `committing` by a test occupies no worker. That
 * is probably true and it is a second definition of "active" for one limit,
 * which is how two rules for one thing start. A suite that genuinely has three
 * jobs in flight at once has something worth surfacing.
 */

create or replace function app.dequeue_job(
  p_worker text,
  p_can_transcribe boolean default true,
  p_can_subprocess boolean default true,
  p_kinds text[] default null,
  p_requested_by text default null)
returns table(
  job_id uuid, kind text, correlation_id uuid, project_id uuid,
  idempotency_key text, attempt integer, pinned_config jsonb)
language plpgsql
set search_path to 'pg_catalog', 'app', 'public'
as $function$
declare
  v_limit       integer;
  v_active      integer;
  v_lease       integer;
  v_job_id      uuid;
  v_may_reflect boolean;
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

  select j.job_id into v_job_id
  from public.jobs j
  where j.state = 'queued'
    and j.attempt < j.max_attempts
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
      state_reason = format('dequeued by %s', p_worker)
  where j.job_id = v_job_id;

  return query
    select j.job_id, j.kind, j.correlation_id, j.project_id,
           j.idempotency_key, j.attempt, j.pinned_config
    from public.jobs j
    where j.job_id = v_job_id;
end
$function$;

comment on function app.dequeue_job is
  '#184, 0329-30. Claim one job. `p_requested_by` narrows BOTH the claim and '
  'the capacity question to work asked for by that exact name, so a caller '
  'that cannot reach another scope''s work is not blocked by it either. Null — '
  'what every office worker passes — behaves exactly as before.';

commit;
