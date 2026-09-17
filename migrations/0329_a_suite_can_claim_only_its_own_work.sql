begin;

/**
 * A suite can claim only its own work.
 *
 * Issue #184. Found under #41 by running all 74 runnable suites in one pass
 * for the first time — a defect that can only appear in a full pass, which is
 * why it had never been seen.
 *
 * `verify:slack` and `verify:worker` both open by refusing to run:
 *
 *     the queue is not empty: 12 live job(s). This suite runs a real job and
 *     needs the queue to itself.
 *
 * The reason is sound and both suites state it: **dequeue is global**, so a job
 * left by anything else would be handed to a script holding no handler for it.
 * The consequence is that whichever suite runs second fails on the first one's
 * debris, and it fails as "22/26" rather than as "the queue was dirty".
 *
 * ## Why a scope rather than more tidying
 *
 * #184 lists the options and this is the first of them, because the others
 * make the debris smaller and leave the coupling in place. A suite that can
 * ask for its OWN job does not care what else is in the queue, and the
 * precondition disappears rather than being made more likely to pass.
 *
 * `p_kinds` (0147) already established the shape: a worker that holds five
 * handlers must not claim a job needing a sixth. `requested_by` is the same
 * argument one step further — a worker that exists to run ONE job must not
 * claim a different one, however well it could handle it.
 *
 * ## The capacity limit, and why a scope is not a way round it
 *
 * `max_concurrent_jobs` is 3 and the check is the first thing this function
 * does, so a scoped caller would still have been blocked by three unrelated
 * jobs running elsewhere — the coupling in its second form.
 *
 * A scoped claim therefore asks a different question: **is anything from THIS
 * scope already running?** One at a time per scope, rather than three across
 * the office.
 *
 * That is bounded rather than a bypass. The office's own workers pass no
 * scope and are governed exactly as before. A scope can hold one job, so the
 * only way to exceed the global limit is to run several differently-named
 * suites at once, which is a thing a person does one at a time from a
 * terminal — and the reason the limit exists is the free tier's throughput,
 * not the count itself.
 */

/*
  Dropped by exact signature first, both of them.

  `create or replace function` does not replace a function whose argument list
  changed — it creates a second overload, and every existing call then becomes
  ambiguous. CLAUDE.md records this, and records that the PUBLIC WRAPPER is the
  half that gets forgotten: it is the one that silently drops a new parameter.
*/
drop function if exists public.dequeue_job(text, boolean, boolean, text[]);
drop function if exists app.dequeue_job(text, boolean, boolean, text[]);

create function app.dequeue_job(
  p_worker text,
  p_can_transcribe boolean default true,
  p_can_subprocess boolean default true,
  p_kinds text[] default null,
  /**
   * Claim only work asked for by this exact name.
   *
   * Null means "anything", which is what every caller meant before this
   * existed and is what the office's own workers still mean.
   *
   * Matched exactly rather than by prefix. A suite knows the string it wrote
   * into `requested_by`, and a prefix match would let `verify:slack` claim
   * `verify:slack-other`, which is the coupling again in miniature.
   */
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
    Two different capacity questions, and which one is asked depends on
    whether the caller has scoped itself. See the header: the office's own
    workers are governed exactly as before, and a scope holds one job.
  */
  if p_requested_by is null then
    v_limit := app.capacity_limit('max_concurrent_jobs', 3);
    select count(*) into v_active
    from public.jobs
    where state in (
      'running', 'output_created', 'quality_review', 'committing', 'committed', 'notifying'
    );
  else
    v_limit := 1;
    select count(*) into v_active
    from public.jobs
    where requested_by = p_requested_by
      and state in (
        'running', 'output_created', 'quality_review', 'committing', 'committed', 'notifying'
      );
  end if;

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
  '#184, 0329. Claim one job. `p_requested_by` narrows the claim to work asked '
  'for by that exact name AND asks the capacity question of that scope alone, '
  'so a verification suite no longer needs the whole queue to itself. Null — '
  'what every office worker passes — behaves exactly as before.';

create function public.dequeue_job(
  p_worker text,
  p_can_transcribe boolean default true,
  p_can_subprocess boolean default true,
  p_kinds text[] default null,
  p_requested_by text default null)
returns table(
  job_id uuid, kind text, correlation_id uuid, project_id uuid,
  idempotency_key text, attempt integer, pinned_config jsonb)
language sql
security definer
set search_path to 'public', 'pg_catalog'
as $$
  select * from app.dequeue_job(p_worker, p_can_transcribe, p_can_subprocess,
                                p_kinds, p_requested_by)
$$;

grant execute on function app.dequeue_job(text, boolean, boolean, text[], text) to ai_team_app;
grant execute on function public.dequeue_job(text, boolean, boolean, text[], text) to ai_team_app;

commit;
