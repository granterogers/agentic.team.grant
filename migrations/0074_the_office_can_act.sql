-- 0074 — The office can act, and follows through
--
-- Grant asked the Chief of Staff, in Telegram, to *"generate an audio overview
-- in our Google notebook for this project"*. He got a paragraph describing what
-- an audio overview might contain.
--
-- That is the most expensive kind of bug: everything worked. The bot received
-- the message, the router picked a speaker, retrieval ran, the model answered
-- well, and both surfaces delivered it. The only thing missing was the part
-- Grant asked for. `office.instruction` could talk and could not do — the
-- notebook handlers existed and nothing connected an English sentence to them.
--
-- This migration is the database half of connecting them. Three pieces:
--
--   1. `jobs.not_before` — a job that must not run yet. An audio overview takes
--      minutes, so the job that collects it has to be able to say "not for
--      ninety seconds" instead of spinning through its attempts against a
--      notebook that is still rendering.
--
--   2. `jobs.announce` — a job whose output is not worth a message. A poll that
--      finds the artifact still generating produces a real output and must not
--      page anyone; announcing every tick would make the pager useless within
--      one artifact.
--
--   3. `public.artifacts` — where a finished artifact lands. Grant: *"see if
--      you can pull them into our store project and display the results as a
--      link within both Slack and Telegram."* This is the store.
--
-- ## Why artifacts are not documents
--
-- The obvious move was a `documents` row with a URL in it, and it is wrong
-- twice. An audio overview has no text, so it would be a document whose content
-- is a description of itself — and §10's citations are built on document
-- content meaning something. Worse, `documents` is keyed
-- (connector, external_parent_ref, external_ref) and the notebook SYNC owns
-- that keyspace for connector 'notebooklm': an artifact written there is an
-- artifact the next sync is entitled to reconcile away.

begin;

-- ---------------------------------------------------------------------------
-- 1. A job that must not run yet
-- ---------------------------------------------------------------------------

alter table public.jobs
  add column not_before timestamptz,
  add column announce   boolean not null default true;

comment on column public.jobs.not_before is
  'Earliest this may be dequeued. Null means now. This is a delay, not a '
  'schedule: there is no recurrence and no calendar here, only "an artifact '
  'takes minutes and polling it immediately learns nothing".';

comment on column public.jobs.announce is
  'False for a job whose output is real but not worth telling anyone about - a '
  'poll tick that found the work still running. The notifier reads this; a '
  'handler that discovers mid-run that it has nothing to announce sets it.';

-- The dequeue index is partial on `state = 'queued'` and now has a second
-- predicate to satisfy. Left as-is: a delayed job is a tiny minority of the
-- queue and the extra filter is evaluated on a handful of rows.

create or replace function app.dequeue_job(p_worker text)
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

comment on function app.dequeue_job(text) is
  'Capacity-limited dequeue, oldest highest-priority first, skipping jobs '
  'whose not_before has not arrived. The advisory lock is load-bearing: SKIP '
  'LOCKED stops two workers taking the same job but not two workers each '
  'taking a different job past the limit.';

-- ---------------------------------------------------------------------------
-- 2. A job spawning the next step of its own work
-- ---------------------------------------------------------------------------
--
-- The child inherits correlation and project from the parent and nothing else.
-- Inheriting the idempotency key would collide with the parent while the parent
-- is still live (`jobs_one_live_per_idempotency_key`), which is exactly the
-- constraint working: a follow-up is not the same logical work.

create or replace function app.enqueue_child(
  p_parent  uuid,
  p_kind    text,
  p_payload jsonb    default '{}'::jsonb,
  p_delay   interval default interval '0',
  p_announce boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_parent public.jobs;
  v_id uuid;
begin
  select * into v_parent from public.jobs where job_id = p_parent;
  if not found then
    raise exception 'no job % to hang a child on', p_parent using errcode = '23503';
  end if;

  insert into public.jobs
    (parent_job_id, correlation_id, project_id, idempotency_key, kind,
     requested_by, priority, pinned_config, not_before, announce)
  values (
    p_parent, v_parent.correlation_id, v_parent.project_id,
    format('child-%s-%s', left(p_kind, 40), gen_random_uuid()),
    p_kind, v_parent.requested_by, v_parent.priority,
    coalesce(p_payload, '{}'::jsonb),
    case when p_delay <= interval '0' then null else now() + p_delay end,
    p_announce
  )
  returning job_id into v_id;

  return v_id;
end;
$$;

comment on function app.enqueue_child is
  'One step of work spawning the next. The child carries the parent''s '
  'correlation and project so a conversation stays one thread, and its own '
  'idempotency key so it does not collide with the parent that is still live.';

-- ---------------------------------------------------------------------------
-- 3. Where a finished artifact lands
-- ---------------------------------------------------------------------------

create table public.artifacts (
  artifact_id     uuid        primary key default gen_random_uuid(),

  project_id      uuid        not null references public.projects (project_id),
  -- The notebook it was made in, and the id it has there. Both, because an
  -- artifact id is not addressable without its notebook (act.py's `poll`).
  notebook_ref    text        not null,
  external_ref    text,

  kind            text        not null,
  title           text,
  url             text,

  -- generating | ready | failed | abandoned
  state           text        not null default 'generating',
  detail          text,

  -- Which job asked for it, so the trail from "Grant said" to "this file"
  -- is one join rather than a guess.
  requested_by_job uuid       references public.jobs (job_id),
  -- The artifact ids present in the notebook BEFORE this generation started.
  -- Google's generators return a task id, not an artifact id, and the artifact
  -- appears in the listing minutes later with an id unrelated to the task. The
  -- only reliable way to say which one is ours is to know which ones were not.
  preexisting     jsonb       not null default '[]'::jsonb,

  created_at      timestamptz not null default app.now_utc(),
  updated_at      timestamptz not null default app.now_utc(),
  ready_at        timestamptz,

  constraint artifacts_state_known
    check (state in ('generating', 'ready', 'failed', 'abandoned')),
  -- A ready artifact has somewhere to go. The whole point of the row is the
  -- link; "ready" with nothing to open is the failure this catches.
  constraint artifacts_ready_has_a_link
    check (state <> 'ready' or (url is not null and ready_at is not null))
);

create index artifacts_by_project on public.artifacts (project_id, created_at desc);
create index artifacts_pending on public.artifacts (state) where state = 'generating';
create unique index artifacts_one_per_external_ref
  on public.artifacts (notebook_ref, external_ref) where external_ref is not null;

create trigger artifacts_touch_updated_at
  before update on public.artifacts
  for each row execute function app.touch_updated_at();

comment on table public.artifacts is
  'What NotebookLM produced for a project, and the link to open it. Grant: '
  '"see if you can pull them into our store project and display the results as '
  'a link within both Slack and Telegram." Separate from `documents` because an '
  'audio overview has no text to cite and because the sync owns the document '
  'keyspace for connector ''notebooklm''.';

alter table public.artifacts enable row level security;
alter table public.artifacts force  row level security;
create policy artifacts_app on public.artifacts
  for all to ai_team_app using (true) with check (true);

-- What the front end and the office read.
create or replace function app.project_artifacts(p_project uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select coalesce(jsonb_agg(a order by a.created_at desc), '[]'::jsonb)
    from (
      select artifact_id, kind, title, url, state, detail, created_at, ready_at
        from public.artifacts
       where project_id = p_project
       order by created_at desc
       limit 50
    ) a
$$;

create or replace function public.project_artifacts(p_project uuid)
returns jsonb language sql stable security definer set search_path = public, pg_catalog
as $$ select app.project_artifacts(p_project) $$;

commit;
