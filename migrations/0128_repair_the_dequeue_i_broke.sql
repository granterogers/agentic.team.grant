-- 0128 — Repair the dequeue I broke
--
-- 0125 added one predicate to `app.dequeue_job` so the Edge worker would stop
-- claiming voice notes it cannot transcribe. The predicate was right. The way I
-- wrote the migration was not: I read the live definition with
-- `pg_get_functiondef`, the output was truncated at fifty lines before the
-- UPDATE, and I reconstructed the rest from memory.
--
-- Memory said `locked_by` and `lease_expires_at`. The columns are `leased_by`
-- and `leased_until`, and there is a `state_reason` I dropped entirely. So
-- every dequeue since has failed with:
--
--   ERROR: column "locked_by" of relation "jobs" does not exist
--
-- The queue was dead for two hours and seven jobs sat in `queued`. Nothing
-- reported it: the heartbeat kept returning HTTP 200 because `net.http_post`
-- reports delivery, not outcome, and the pass swallows a failed drain rather
-- than taking the worker down with it. A broken consumer that answers 200 is
-- the exact failure this whole day of work has been about, and I built another
-- one.
--
-- ## What this migration does differently
--
-- The body below is copied verbatim from 0074, which is the migration that last
-- authored it, with the single new predicate inserted. Not from
-- `pg_get_functiondef`, and not from memory. A function's source of truth is
-- the migration that wrote it; a truncated read of the live catalogue is a
-- guess wearing a fact's clothes.
--
-- ## And the check that would have caught it
--
-- `verify:jobs` caught this within seconds of being run — it exercises a real
-- dequeue. I had not run it after 0125. `npm run verify:db` is the gate that
-- exists precisely so a schema change cannot ship unexercised, and skipping it
-- is what turned a typo into two hours.

begin;

create or replace function app.dequeue_job(p_worker text, p_can_transcribe boolean default true)
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

comment on function app.dequeue_job(text, boolean) is
  'Capacity-limited dequeue, oldest highest-priority first, skipping jobs '
  'whose not_before has not arrived and — when the caller cannot transcribe — '
  'voice notes with no transcript yet. The advisory lock is load-bearing: SKIP '
  'LOCKED stops two workers taking the same job but not two workers each '
  'taking a different job past the limit.';

grant execute on function app.dequeue_job(text, boolean) to ai_team_app, service_role;

create or replace function public.dequeue_job(p_worker text, p_can_transcribe boolean default true)
returns table (
  job_id uuid, kind text, correlation_id uuid, project_id uuid,
  idempotency_key text, attempt integer, pinned_config jsonb
)
language sql security definer set search_path = public, pg_catalog
as $$ select * from app.dequeue_job(p_worker, p_can_transcribe) $$;

revoke all on function public.dequeue_job(text, boolean) from public;
grant execute on function public.dequeue_job(text, boolean) to service_role;

-- Prove it works, here, rather than trusting that it does. A dequeue that
-- raises is what shipped last time; an assertion in the migration is cheap and
-- fails the deploy instead of the queue.
do $$
declare v_count integer;
begin
  -- Runs a REAL dequeue against whatever is queued and immediately puts it
  -- back. If the function raises, this migration rolls back.
  create temporary table _dq_probe as select * from app.dequeue_job('migration-0128-probe', true);
  select count(*) into v_count from _dq_probe;

  -- Give the lease back the way a dead worker does, not by forcing the state.
  -- The first version set state = 'queued' directly and the transition guard
  -- refused it: "illegal job transition running -> queued". That guard is
  -- right, and the designed way back is an EXPIRED LEASE — every drain calls
  -- `recover_stalled_jobs` first, which returns it legally and counts it as
  -- the recovery it actually is.
  update public.jobs
     set leased_until = now() - interval '1 hour',
         state_reason = 'lease released by the 0128 dequeue probe'
   where leased_by = 'migration-0128-probe';

  perform app.recover_stalled_jobs();

  raise notice 'dequeue probe: took and returned % job(s)', v_count;
end;
$$;

commit;
