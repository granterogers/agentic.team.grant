-- 0147 — A worker that cannot do a job should not take it, either
--
-- Three real duty jobs were sitting in `paused` tonight: a mail refresh from
-- six hours earlier, a discovery sync, and a backup. Each said the same thing:
--
--   "no handler for kind google.read_mail in this worker — paused rather than
--    failed, because a deploy that knows the kind can resume it"
--
-- Two separate faults, and the second is the one that hurt.
--
-- ## Taking work you cannot do
--
-- A verification suite drains the live queue with a deliberately small set of
-- handlers. `dequeue_job` handed it real work, the suite could not do it, and
-- the worker's honest response — park it rather than fail it — took it out of
-- the queue.
--
-- 0125 and 0137 already established the rule for two special cases: a worker
-- says what it cannot do and the dequeue respects it. The most obvious case of
-- all was missing. A worker holding five handlers must not claim a job that
-- needs a sixth, and now it cannot.
--
-- ## Nothing ever resumed them
--
-- The comment says "a deploy that knows the kind can resume it". Nothing does.
-- `paused -> queued` has been a legal transition since the state machine was
-- written and no code has ever made it, so every job parked this way was
-- parked for good. The mail refresh had been waiting six and a half hours.
--
-- `app.resume_paused` is called by the drain, before it claims anything, in the
-- same place and for the same reason as `recover_stalled_jobs`: the sweep and
-- the claim belong together, because a sweep nobody calls is the defect this
-- codebase keeps re-finding.
--
-- Body of `dequeue_job` copied programmatically from 0137, with one predicate
-- inserted. 0128 is why.

begin;

create or replace function app.dequeue_job(
  p_worker text,
  p_can_transcribe boolean default true,
  p_can_subprocess boolean default true,
  p_kinds text[] default null
)
  returns table (
    job_id          uuid,
    kind            text,
    correlation_id  uuid,
    project_id      uuid,
    idempotency_key text,
    attempt         integer,
    pinned_config   jsonb
  )
  language plpgsql
  set search_path = pg_catalog, app, public
as $$
declare
  v_limit   integer;
  v_active  integer;
  v_lease   integer;
  v_job_id  uuid;
begin
  if p_worker is null or length(trim(p_worker)) = 0 then
    raise exception 'a worker identity is required to dequeue'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('ai_team_hq.job_dequeue'));

  v_limit := app.capacity_limit('max_concurrent_jobs', 3);

  select count(*) into v_active
  from public.jobs
  where state in (
    'running', 'output_created', 'quality_review', 'committing', 'committed', 'notifying'
  );

  if v_active >= v_limit then
    return;
  end if;

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
$$;

comment on function app.dequeue_job(text, boolean, boolean, text[]) is
  'Capacity-limited dequeue, oldest highest-priority first, skipping jobs '
  'whose not_before has not arrived and — when the caller says it cannot — '
  'untranscribed voice notes, any kind in job_kind_needs that wants a local '
  'subprocess, and anything outside the kinds the caller says it handles. The '
  'advisory lock is load-bearing: SKIP LOCKED stops two workers taking the '
  'same job but not two workers each taking a different job past the limit.';


-- ---------------------------------------------------------------------------
-- And put back what was parked
-- ---------------------------------------------------------------------------

create or replace function app.resume_paused(p_kinds text[] default null)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_count integer := 0;
  r record;
begin
  for r in
    select j.job_id, j.kind from public.jobs j
     where j.state = 'paused'
       and (p_kinds is null or j.kind = any(p_kinds))
       -- Only the ones parked for the reason this fixes. A job paused for any
       -- other reason was paused deliberately, and un-pausing it would be
       -- overriding a decision rather than repairing an accident.
       and coalesce(j.state_reason, '') like 'no handler for kind%'
     for update skip locked
  loop
    update public.jobs
       set state = 'queued',
           state_reason = 'resumed: a worker that knows this kind is running now',
           leased_by = null,
           leased_until = null
     where job_id = r.job_id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end
$$;

comment on function app.resume_paused(text[]) is
  'Requeue jobs parked because the worker that claimed them had no handler. '
  'Called by the drain before it claims anything. Only that reason: a job '
  'paused deliberately stays paused.';

grant execute on function app.resume_paused(text[]) to ai_team_app, service_role;

create or replace function public.resume_paused(p_kinds text[] default null)
returns integer language sql security definer set search_path = public, pg_catalog
as $$ select app.resume_paused(p_kinds) $$;

revoke all on function public.resume_paused(text[]) from public;
grant execute on function public.resume_paused(text[]) to service_role;

grant execute on function app.dequeue_job(text, boolean, boolean, text[]) to ai_team_app, service_role;

-- The three-argument form goes, so nothing can call the old shape and quietly
-- claim work it cannot do.
drop function if exists public.dequeue_job(text, boolean, boolean);
drop function if exists app.dequeue_job(text, boolean, boolean);

create or replace function public.dequeue_job(
  p_worker text,
  p_can_transcribe boolean default true,
  p_can_subprocess boolean default true,
  p_kinds text[] default null
)
returns table (
  job_id uuid, kind text, correlation_id uuid, project_id uuid,
  idempotency_key text, attempt integer, pinned_config jsonb
)
language sql security definer set search_path = public, pg_catalog
as $$ select * from app.dequeue_job(p_worker, p_can_transcribe, p_can_subprocess, p_kinds) $$;

revoke all on function public.dequeue_job(text, boolean, boolean, text[]) from public;
grant execute on function public.dequeue_job(text, boolean, boolean, text[]) to service_role;

-- Prove both halves, here, on the rows that are actually parked.
do $$
declare v_resumed integer; v_left integer;
begin
  select app.resume_paused() into v_resumed;
  raise notice 'resumed % job(s) parked for want of a handler', v_resumed;

  select count(*) into v_left from public.jobs
   where state = 'paused' and coalesce(state_reason, '') like 'no handler for kind%';
  if v_left <> 0 then
    raise exception '% job(s) still parked for want of a handler', v_left;
  end if;

  -- And that the dequeue still dequeues, with the new argument in place.
  perform app.dequeue_job('migration-0147-probe', true, true, array['verification.probe']);
  update public.jobs
     set leased_until = now() - interval '1 hour',
         state_reason = 'lease released by the 0147 probe'
   where leased_by = 'migration-0147-probe';
  perform app.recover_stalled_jobs();
end
$$;

commit;
