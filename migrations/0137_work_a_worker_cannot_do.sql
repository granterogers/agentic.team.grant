-- Work a worker cannot do, refused at the queue rather than at the failure.
--
-- 0125 taught `dequeue_job` one thing about the Edge worker: it cannot
-- transcribe, so it must not claim an untranscribed voice note. That was
-- correct and it was too narrow. Since Actions were switched off, the Edge
-- worker is the ONLY worker, and Deno has no subprocesses — so every job whose
-- handler shells out to Python is a job it will claim, attempt, and fail.
--
-- Five notebook kinds are in that position today. Nothing reported it, because
-- a failing job looks like a failing job.
--
-- ## Why a table and not another boolean in the function body
--
-- I have already broken this function once by rewriting its body from memory
-- (0128). The lesson taken from that is not "be more careful": it is that a
-- list which grows should not live inside a function that must be re-authored
-- to change it. So the list is a table, the predicate is a join, and adding a
-- kind is an INSERT.
--
-- ## What "needs a subprocess" means
--
-- Exactly one thing: the handler cannot complete without spawning a local
-- process. Not "is slow", not "talks to the internet" — an HTTP call is
-- something every runtime can make. It is a statement about the runtime, so a
-- worker answers it about itself rather than being configured with it.
--
-- ## Why the job waits rather than failing
--
-- A job that waits is a job that runs the moment a capable worker exists. A
-- job that fails is one Grant has to notice and re-ask for. Waiting is also
-- the honest signal: a queue with sixteen notebook jobs in it says "this
-- system has no runtime that can read the notebook" far better than a report
-- saying so would.

begin;

-- ---------------------------------------------------------------------------
-- What each kind needs
-- ---------------------------------------------------------------------------

create table if not exists public.job_kind_needs (
  kind              text primary key,
  needs_subprocess  boolean not null default false,
  why               text not null,
  created_at        timestamptz not null default app.now_utc()
);

comment on table public.job_kind_needs is
  'Job kinds that cannot run on every runtime. A kind absent from this table '
  'runs anywhere, which is the right default: the exceptions are few and '
  'naming them is cheaper than naming everything else.';

alter table public.job_kind_needs enable row level security;
alter table public.job_kind_needs force row level security;

create policy job_kind_needs_app_read on public.job_kind_needs
  for select to ai_team_app using (true);

insert into public.job_kind_needs (kind, needs_subprocess, why) values
  ('notebook.generate', true,
   'The live notebook adapter shells out to scripts/notebook/read.py — there '
   'is no TypeScript client, deliberately (§7 contains the risk rather than '
   'reimplementing an undocumented RPC).'),
  ('notebook.add_source', true, 'Same adapter, same subprocess.'),
  ('notebook.push_document', true, 'Same adapter, same subprocess.'),
  ('notebook.collect', true, 'Same adapter, same subprocess.'),
  ('notebook.ask', true, 'Same adapter, same subprocess.'),
  ('office.sync', true,
   'Discovery reads every notebook through the same Python adapter. This is '
   'the duty behind §22 scenario A''s "detected within the sync interval".')
on conflict (kind) do update
  set needs_subprocess = excluded.needs_subprocess,
      why = excluded.why;

-- ---------------------------------------------------------------------------
-- The dequeue, with one more predicate
-- ---------------------------------------------------------------------------
--
-- Body copied verbatim from 0128 — which copied it verbatim from 0074 — with
-- the new predicate inserted and nothing else touched. Same discipline, same
-- reason.

create or replace function app.dequeue_job(
  p_worker text,
  p_can_transcribe boolean default true,
  p_can_subprocess boolean default true
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

comment on function app.dequeue_job(text, boolean, boolean) is
  'Capacity-limited dequeue, oldest highest-priority first, skipping jobs '
  'whose not_before has not arrived and — when the caller says it cannot — '
  'untranscribed voice notes and any kind in job_kind_needs that wants a '
  'local subprocess. The advisory lock is load-bearing: SKIP LOCKED stops two '
  'workers taking the same job but not two workers each taking a different '
  'job past the limit.';

grant execute on function app.dequeue_job(text, boolean, boolean) to ai_team_app, service_role;

-- The two-argument form goes, so nothing can call the old shape and silently
-- get the old behaviour. Dropped AFTER the new one exists: a default argument
-- makes `dequeue_job(text, boolean)` ambiguous otherwise.
drop function if exists public.dequeue_job(text, boolean);
drop function if exists app.dequeue_job(text, boolean);

create or replace function public.dequeue_job(
  p_worker text,
  p_can_transcribe boolean default true,
  p_can_subprocess boolean default true
)
returns table (
  job_id uuid, kind text, correlation_id uuid, project_id uuid,
  idempotency_key text, attempt integer, pinned_config jsonb
)
language sql security definer set search_path = public, pg_catalog
as $$ select * from app.dequeue_job(p_worker, p_can_transcribe, p_can_subprocess) $$;

revoke all on function public.dequeue_job(text, boolean, boolean) from public;
grant execute on function public.dequeue_job(text, boolean, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- What is stuck, and why
-- ---------------------------------------------------------------------------
--
-- So that "no runtime here can do this" is a number on a page rather than a
-- thing somebody has to go and work out from the queue.

create or replace function app.hq_stranded_work()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with stuck as (
    select j.kind, count(*)::int as waiting, min(j.created_at) as oldest
      from public.jobs j
      join public.job_kind_needs n on n.kind = j.kind and n.needs_subprocess
     where j.state = 'queued'
     group by j.kind
  )
  select jsonb_build_object(
    'total', coalesce((select sum(waiting) from stuck), 0),
    'oldest', (select min(oldest) from stuck),
    'kinds', coalesce(
      (select jsonb_agg(jsonb_build_object('kind', kind, 'waiting', waiting)
                        order by waiting desc) from stuck),
      '[]'::jsonb),
    'why', 'These need a runtime that can run a local process. The only worker '
           'is a Supabase Edge Function, and Deno has none. They wait rather '
           'than fail, so they run the moment one exists.'
  );
$$;

grant execute on function app.hq_stranded_work() to ai_team_app;

create or replace function public.hq_stranded_work()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$ select app.hq_stranded_work() $$;

-- ---------------------------------------------------------------------------
-- Prove the dequeue still dequeues
-- ---------------------------------------------------------------------------
--
-- 0128's assertion, kept: a function rewritten without being exercised is how
-- the queue died for two hours.

do $$
declare
  v_job uuid;
  v_count integer;
  v_leased text;
begin
  -- 1. A REAL dequeue, so a function that raises fails this migration instead
  --    of the queue. 0128 shipped a body that raised on every call and nothing
  --    noticed for two hours.
  create temporary table _dq_probe as
    select * from app.dequeue_job('migration-0137-probe', true, true);
  select count(*) into v_count from _dq_probe;

  -- Give the lease back the way a dead worker does. Setting state = 'queued'
  -- directly is refused by the transition guard, and the guard is right: the
  -- designed way back is an expired lease, which every drain recovers.
  update public.jobs
     set leased_until = now() - interval '1 hour',
         state_reason = 'lease released by the 0137 dequeue probe'
   where leased_by = 'migration-0137-probe';
  perform app.recover_stalled_jobs();
  raise notice 'dequeue probe: took and returned % job(s)', v_count;

  -- The behaviour this migration ADDS — that a worker with no subprocess
  -- passes over `office.sync` — is asserted in `verify:jobs`, not here.
  --
  -- Not for want of trying: it needs a fixture job, and a job cannot be
  -- removed again. `job_state_transitions` is append-only by policy (§6) and
  -- refuses DELETE, `jobs` has a foreign key from it, and the state machine
  -- refuses running -> queued. Every one of those guards is correct, and
  -- together they mean a migration cannot create a job and tidy up after
  -- itself. The verification suite can, because it owns a fixture lifecycle.
end
$$;

commit;
