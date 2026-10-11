-- 1078 - A worker that does not know about Hermes cannot claim a message the person sent to Hermes (Hermes, stale-worker prevention).
--
-- 1077 made the failure FINDABLE: a message chosen for Hermes and answered by the team. This makes it impossible for the claim to happen.
-- The worker that predates the engine seam does not read inbound_commands.engine, so a Hermes message it claims is answered by the team with
-- nothing to say it was not Hermes. The database is the one place every worker, old and new, must go through to take a job, so that is where
-- the gate goes, and it is the pattern the claim already has twice: 0125 (a worker that cannot hear does not claim an untranscribed voice
-- note) and 0137 (a worker without subprocesses does not claim a job that needs one). A worker is judged by what it SAYS it can do.
--
--   app.dequeue_job_core(..., p_can_engine boolean)   the whole claim, as it was (1044, the fair-share body), plus ONE predicate: a job whose
--                                                     own command chose an engine other than the team is claimed only when p_can_engine.
--   app.dequeue_job(<the same five arguments>)         the signature every existing worker calls, unchanged. It now says p_can_engine = false.
--
-- So a worker built before this migration, which cannot know the sixth argument exists, calls the five-argument function and is refused every
-- Hermes message: they wait in `queued`, loudly (app.jobs_stuck_queued and the health reading report work nobody has taken) instead of being
-- answered by the wrong engine. A worker that carries the seam calls the core with p_can_engine = true and claims everything it always could,
-- Hermes messages included. A legacy team command (engine = 'team', the column's default) is untouched for both. Cancellation, retries,
-- idempotency and resume are untouched: they act on the job, and only the claim changed. No table is added; one small partial index makes the
-- check a lookup (it holds only the rows that chose an engine other than the team, none until Hermes is used).
--
-- MIXED VERSIONS. Old worker on this schema: Hermes messages wait, team work runs (proved against the pinned pre-Hermes worker build, which is
-- run, not read: scripts/isolated/engine-gate.ts). New worker on a schema without this migration: it falls back to the five-argument call
-- (src/jobs/worker.ts), which is exactly what it did, and no Hermes message can exist before 1070. Order: this migration, then the worker.
--
-- ONE THING TO CARRY FORWARD. A later migration that replaces app.dequeue_job with a full body (the deferred efficiency migration
-- docs/audit/deferred-migrations/dequeue_job-efficiency-1030-reconciled-with-1044.sql is one) would silently remove the gate by turning the
-- wrapper back into a claim of its own. tests/migrations/dequeue-engine-gate.test.ts fails any migration after this one that does that.
--
-- ROLLBACK. Restore app.dequeue_job from 1044 (the full body) and drop app.dequeue_job_core and the index; the gate is gone and the stale-worker
-- risk returns to detection by 1077. Do that only after switching Hermes off and draining (RELEASE-READINESS section 10).

create index if not exists inbound_commands_chose_an_engine
  on public.inbound_commands (job_id)
  where engine <> 'team';

do $splice$
declare
  v_def  text;
  v_core text;
begin
  v_def := pg_get_functiondef('app.dequeue_job(text,boolean,boolean,text[],text)'::regprocedure);

  v_core := replace(v_def,
    'CREATE OR REPLACE FUNCTION app.dequeue_job(p_worker text, p_can_transcribe boolean DEFAULT true, p_can_subprocess boolean DEFAULT true, p_kinds text[] DEFAULT NULL::text[], p_requested_by text DEFAULT NULL::text)',
    'CREATE OR REPLACE FUNCTION app.dequeue_job_core(p_worker text, p_can_transcribe boolean, p_can_subprocess boolean, p_kinds text[], p_requested_by text, p_can_engine boolean)');
  if v_core = v_def then raise exception '1078: the dequeue_job header did not match'; end if;

  -- The claim itself.
  v_def := v_core;
  v_core := replace(v_core,
    E'    and (p_requested_by is null or j.requested_by = p_requested_by)\n',
    E'    and (p_requested_by is null or j.requested_by = p_requested_by)\n'
    || E'    -- 1078: a message the person sent to an engine other than the team is claimed only by a worker that says it can answer one.\n'
    || E'    and (\n'
    || E'      p_can_engine\n'
    || E'      or not exists (\n'
    || E'        select 1 from public.inbound_commands ce\n'
    || E'         where ce.job_id = j.job_id and ce.engine <> ''team''\n'
    || E'      )\n'
    || E'    )\n');
  if v_core = v_def then raise exception '1078: the claim predicate anchor did not land'; end if;

  -- The fair-share count asks "how many offices have work THIS caller could take", so it must not count work this caller may not take.
  v_def := v_core;
  v_core := replace(v_core,
    E'    and (p_requested_by is null or q.requested_by = p_requested_by)\n',
    E'    and (p_requested_by is null or q.requested_by = p_requested_by)\n'
    || E'    and (p_can_engine or not exists (select 1 from public.inbound_commands qe where qe.job_id = q.job_id and qe.engine <> ''team''))\n');
  if v_core = v_def then raise exception '1078: the fair-share anchor did not land'; end if;

  execute v_core;
end
$splice$;

revoke all on function app.dequeue_job_core(text, boolean, boolean, text[], text, boolean) from public, anon, authenticated;
comment on function app.dequeue_job_core(text, boolean, boolean, text[], text, boolean) is
  'The claim (formerly app.dequeue_job). p_can_engine = true only from a worker that carries the Hermes engine seam; without it a message sent to Hermes is not claimed (1078).';

-- The signature every worker built so far calls. Same arguments, same result, same privileges. It can only ever be the claim of a worker
-- that did not say it could answer an engine, so it is a one-line wrapper: nothing else may live here.
create or replace function app.dequeue_job(
  p_worker text,
  p_can_transcribe boolean default true,
  p_can_subprocess boolean default true,
  p_kinds text[] default null,
  p_requested_by text default null)
returns table(job_id uuid, kind text, correlation_id uuid, project_id uuid, idempotency_key text, attempt integer, pinned_config jsonb, office_id uuid)
language sql
set search_path = 'pg_catalog', 'app', 'public'
as $$
  select * from app.dequeue_job_core(p_worker, p_can_transcribe, p_can_subprocess, p_kinds, p_requested_by, false)
$$;

comment on function app.dequeue_job(text, boolean, boolean, text[], text) is
  'The claim as a worker that predates the Hermes seam makes it: p_can_engine = false (1078). A message sent to Hermes is not claimed here. Do not give this a body of its own.';
