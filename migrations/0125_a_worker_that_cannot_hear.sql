-- 0125 — A worker that cannot hear must not take the voice notes
--
-- The pass now runs in two places: a Node process on a GitHub runner, and a
-- Deno Edge Function next to the database that the Telegram webhook kicks the
-- instant a message lands. That second one is what made replies fast.
--
-- It cannot transcribe. Voice notes are turned into words by faster-whisper in
-- `scripts/voice/transcribe.py`, deliberately — §15 and ADR-0009: Grant's
-- actual voice never leaves our own compute. The edge runtime has no
-- subprocesses and no Python, and the worker's own capability probe says so:
--
--   GET .../functions/v1/worker → {"can_transcribe": false}
--
-- So without this, the fast path would dequeue a voice note, fail to transcribe
-- it, and burn an attempt — and it would do that three times before the job
-- died. A voice note would be strictly WORSE off than before the speed-up,
-- which is the opposite of the point.
--
-- ## Why the filter is here and not in the handler
--
-- A handler that declines a job it has already been given has to put it back,
-- and "put it back" means a state transition that did not happen, an attempt
-- that must not count, and a lease to release. Three chances to get it wrong.
--
-- Not taking it in the first place has none of those properties. The dequeue
-- already holds the advisory lock and already filters on state, attempts and
-- `not_before`; one more predicate is free and cannot leave a job half-claimed.
--
-- ## Why the old signature stays
--
-- `create or replace` with an added defaulted parameter creates a SECOND
-- OVERLOAD rather than replacing anything (0090 learned this the hard way), and
-- here that is what we actually want: the two-argument form is genuinely a
-- different question. So the one-argument version is dropped by name first and
-- recreated as a thin call to the new one, defaulting to "yes, I can hear" —
-- which is true of every caller that existed before the edge worker.

begin;

drop function if exists app.dequeue_job(text);

create or replace function app.dequeue_job(p_worker text, p_can_transcribe boolean default true)
returns table(
  job_id uuid, kind text, correlation_id uuid, project_id uuid,
  idempotency_key text, attempt integer, pinned_config jsonb
)
language plpgsql
set search_path to 'pg_catalog', 'app', 'public'
as $function$
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
    -- A voice note that has NOT been transcribed yet needs a worker that can
    -- hear. Once `transcript` is filled the job is ordinary work — the words
    -- exist, and any worker can act on them — which is why the predicate tests
    -- the transcript and not merely the presence of audio. It also means a
    -- half-done voice job finished by the edge worker is a feature: the slow
    -- runner does the hearing, the fast one does the thinking.
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
     set state = 'running',
         started_at = coalesce(j.started_at, now()),
         attempt = j.attempt + 1,
         locked_by = p_worker,
         lease_expires_at = now() + make_interval(secs => v_lease),
         updated_at = now()
   where j.job_id = v_job_id;

  return query
  select j.job_id, j.kind, j.correlation_id, j.project_id,
         j.idempotency_key, j.attempt, j.pinned_config
    from public.jobs j
   where j.job_id = v_job_id;
end;
$function$;

grant execute on function app.dequeue_job(text, boolean) to ai_team_app, service_role;

create or replace function public.dequeue_job(p_worker text, p_can_transcribe boolean default true)
returns table(
  job_id uuid, kind text, correlation_id uuid, project_id uuid,
  idempotency_key text, attempt integer, pinned_config jsonb
)
language sql security definer set search_path = public, pg_catalog
as $$ select * from app.dequeue_job(p_worker, p_can_transcribe) $$;

revoke all on function public.dequeue_job(text, boolean) from public;
grant execute on function public.dequeue_job(text, boolean) to service_role;

commit;
