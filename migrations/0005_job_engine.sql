-- 0005 — Job engine: state, transitions, idempotency, parent/child
--
-- Master spec §6 and ADR-0008. The critical property is resumability: the
-- container will restart, and it must be safe. "Every transition is a committed
-- database write — recovery is 'read state, continue'."
--
-- The transition allow-list is enforced HERE as well as in TypeScript. A rule
-- that lives only in application code is a rule a direct SQL write walks past,
-- and this database is reachable by a migration, a psql session and the
-- Management API.

-- ---------------------------------------------------------------------------
-- The fourteen states (ADR-0008)
--
-- An enum rather than a text column with a CHECK: an unknown state becomes
-- impossible to store rather than merely invalid, and the ordering is fixed in
-- one place. Postgres allows ADD VALUE later, so this is not a wall.
-- ---------------------------------------------------------------------------
create type public.job_state as enum (
  'queued',
  'running',
  'waiting_external',
  'waiting_user',
  'output_created',
  'quality_review',
  'committing',
  'committed',
  'notifying',
  'complete',
  'retrying',
  'paused',
  'cancelled',
  'failed'
);

comment on type public.job_state is
  'The fourteen job states of master spec §6. Nine were described in the '
  'subordinate design docs; see ADR-0008 for why the extra five are load-'
  'bearing rather than decorative.';

-- ---------------------------------------------------------------------------
-- The transition allow-list, as data
--
-- Held in a table rather than a CASE expression so it is queryable, diffable,
-- and can be compared against src/jobs/states.ts by a test. Two copies of a
-- rule that disagree silently is the failure this avoids.
-- ---------------------------------------------------------------------------
create table app.job_transitions_allowed (
  from_state public.job_state not null,
  to_state   public.job_state not null,
  primary key (from_state, to_state),
  constraint no_self_transition check (from_state <> to_state)
);

insert into app.job_transitions_allowed (from_state, to_state) values
  -- Dequeue, or abandon before starting.
  ('queued', 'running'), ('queued', 'cancelled'), ('queued', 'paused'), ('queued', 'failed'),

  -- The main working state: it may block, produce output, or die.
  ('running', 'waiting_external'), ('running', 'waiting_user'),
  ('running', 'output_created'), ('running', 'retrying'),
  ('running', 'paused'), ('running', 'cancelled'), ('running', 'failed'),

  -- Blocked states return to running, or are given up on.
  ('waiting_external', 'running'), ('waiting_external', 'retrying'),
  ('waiting_external', 'paused'), ('waiting_external', 'cancelled'),
  ('waiting_external', 'failed'),
  ('waiting_user', 'running'), ('waiting_user', 'paused'),
  ('waiting_user', 'cancelled'), ('waiting_user', 'failed'),

  -- §10: the quality gate cannot be bypassed, so there is deliberately NO
  -- output_created -> committing edge. The only route to committing is review.
  ('output_created', 'quality_review'), ('output_created', 'retrying'),
  ('output_created', 'paused'), ('output_created', 'cancelled'),
  ('output_created', 'failed'),

  -- Review may reject, sending work back rather than committing it.
  ('quality_review', 'committing'), ('quality_review', 'running'),
  ('quality_review', 'retrying'), ('quality_review', 'paused'),
  ('quality_review', 'cancelled'), ('quality_review', 'failed'),

  -- The transactional boundary. No cancel: a cancel racing the commit would
  -- make `committed` unreliable, and `committed` is the one thing recovery reads.
  ('committing', 'committed'), ('committing', 'retrying'), ('committing', 'failed'),

  -- Committed work is never cancelled — it happened. Undo is a compensating
  -- event (§6), not a state change.
  ('committed', 'notifying'), ('committed', 'failed'),

  -- Delivery failure is still committed work: retry delivery, never the job.
  ('notifying', 'complete'), ('notifying', 'retrying'), ('notifying', 'failed'),

  -- Retry and resume re-enter the QUEUE, not `running`, so capacity limits are
  -- re-applied at dequeue (§6) instead of being walked past by a retry storm.
  ('retrying', 'queued'), ('retrying', 'cancelled'),
  ('retrying', 'failed'), ('retrying', 'paused'),
  ('paused', 'queued'), ('paused', 'cancelled'), ('paused', 'failed');

-- complete, cancelled and failed appear only as destinations. Terminal.

-- ---------------------------------------------------------------------------
-- Jobs
-- ---------------------------------------------------------------------------
create table public.jobs (
  job_id            uuid            primary key default gen_random_uuid(),

  -- §6's parent/child structure: an initiative owns child tasks with
  -- dependencies. Self-referential rather than a separate initiatives table,
  -- because a child may itself own children and the depth is not knowable now.
  parent_job_id     uuid            references public.jobs (job_id),

  correlation_id    uuid            not null,
  project_id        uuid            references public.projects (project_id),

  state             public.job_state not null default 'queued',

  -- §6: "Idempotency key per job, derived from semantic inputs, so
  -- re-enqueueing identical logical work collides rather than duplicates."
  -- Derivation lives in application code; the database enforces the collision.
  idempotency_key   text            not null,

  kind              text            not null,
  intent_class      text,
  requested_by      text            not null,
  recipient_agent   text,
  priority          smallint        not null default 100,

  -- §6, configuration pinning: recorded at job start so a running job's
  -- behaviour is explicable later even after configuration moves on.
  pinned_config     jsonb           not null default '{}'::jsonb,

  -- Why it is where it is. `state_reason` is what "long-running work must not
  -- look stuck" reads (§6), alongside the state itself.
  state_reason      text,
  waiting_on        text,

  attempt           integer         not null default 0,
  max_attempts      integer         not null default 5,

  -- Set when a worker takes the job, cleared when it lets go. The recovery
  -- sweep uses these to tell "a worker is on this" from "a worker died on this".
  leased_by         text,
  leased_until      timestamptz,

  created_at        timestamptz     not null default app.now_utc(),
  updated_at        timestamptz     not null default app.now_utc(),
  started_at        timestamptz,
  finished_at       timestamptz,

  constraint jobs_kind_format
    check (kind ~ '^[a-z0-9]+(_[a-z0-9]+)*(\.[a-z0-9]+(_[a-z0-9]+)*)*$'),
  constraint jobs_idempotency_key_present
    check (length(idempotency_key) between 8 and 200),
  constraint jobs_priority_bounded
    check (priority between 0 and 1000),
  constraint jobs_attempt_within_max
    check (attempt >= 0 and attempt <= max_attempts),
  constraint jobs_no_self_parent
    check (parent_job_id is null or parent_job_id <> job_id),
  constraint jobs_lease_is_paired
    check ((leased_by is null) = (leased_until is null)),
  -- A terminal job is finished, and says when. A live one has not finished.
  constraint jobs_finished_iff_terminal
    check (
      (state in ('complete', 'cancelled', 'failed')) = (finished_at is not null)
    ),
  constraint jobs_intent_class_known
    check (
      intent_class is null or intent_class in (
        'thought', 'question', 'discussion', 'suggestion',
        'light_investigation', 'assignment', 'direct_command'
      )
    )
);

comment on table public.jobs is
  'Durable job state. Every transition is a committed write, so recovery is '
  '"read state, continue" rather than reconstruction (§6).';

comment on column public.jobs.pinned_config is
  'Agent prompt version, orchestration policy, provider routing, autonomy and '
  'tool-policy versions as of job start (§6). Recorded so a job''s behaviour '
  'stays explicable after configuration moves on.';

-- ---------------------------------------------------------------------------
-- The constraint that makes duplicate work impossible
--
-- Partial on non-terminal states, deliberately. Two readings were possible:
--
--   (a) globally unique — the same logical work can never be enqueued twice,
--       ever. This breaks legitimate re-runs: a research job over the same
--       source fingerprint could never be re-run after a year.
--   (b) unique among LIVE jobs — a duplicate collides while the original is
--       still in play, and is allowed once that original has reached a terminal
--       state.
--
-- (b) is what §5 asks for: "when uncertain, link to or reuse the existing job
-- rather than silently creating duplicate substantive work." The concern is
-- concurrent duplication across interfaces, not re-running work later on
-- purpose.
-- ---------------------------------------------------------------------------
create unique index jobs_one_live_per_idempotency_key
  on public.jobs (idempotency_key)
  where state not in ('complete', 'cancelled', 'failed');

-- Dequeue reads this: oldest highest-priority queued job first.
create index jobs_dequeue_idx on public.jobs (priority, created_at)
  where state = 'queued';

-- The recovery sweep reads this: everything a worker might have died holding.
create index jobs_in_flight_idx on public.jobs (state, leased_until)
  where state in (
    'running', 'output_created', 'quality_review',
    'committing', 'committed', 'notifying'
  );

create index jobs_correlation_idx on public.jobs (correlation_id);
create index jobs_parent_idx on public.jobs (parent_job_id) where parent_job_id is not null;
create index jobs_project_state_idx on public.jobs (project_id, state);

-- ---------------------------------------------------------------------------
-- Transition history
--
-- §6 requires transitions "constrained and logged". This is the log. It is
-- separate from `events`: the ledger records what the organisation DID, this
-- records how a job MOVED. Conflating them would bury business history under
-- machine chatter.
-- ---------------------------------------------------------------------------
create table public.job_state_transitions (
  transition_id uuid             primary key default gen_random_uuid(),
  job_id        uuid             not null references public.jobs (job_id),
  from_state    public.job_state,
  to_state      public.job_state not null,
  reason        text,
  actor         text             not null default current_user,
  occurred_at   timestamptz      not null default app.now_utc(),
  attempt       integer          not null default 0
);

create index job_transitions_job_idx
  on public.job_state_transitions (job_id, occurred_at);

comment on table public.job_state_transitions is
  'Every state change, appended. Separate from `events`: this is how a job '
  'moved, not what the organisation did.';

-- ---------------------------------------------------------------------------
-- Enforce the allow-list in the database
--
-- The same rule lives in src/jobs/states.ts. Both exist because each covers a
-- gap the other cannot: TypeScript catches the mistake at the call site with a
-- useful stack, and this catches the direct SQL write that never went through
-- TypeScript at all. A test asserts the two agree, so they cannot drift.
-- ---------------------------------------------------------------------------
create or replace function app.enforce_job_transition()
  returns trigger
  language plpgsql
  set search_path = pg_catalog, app, public
as $$
begin
  if new.state = old.state then
    return new;
  end if;

  if not exists (
    select 1 from app.job_transitions_allowed
    where from_state = old.state and to_state = new.state
  ) then
    raise exception
      'illegal job transition % -> % for job %',
      old.state, new.state, old.job_id
      using errcode = '23514',
            hint = format(
              'Allowed from %s: %s',
              old.state,
              coalesce(
                (select string_agg(to_state::text, ', ' order by to_state)
                 from app.job_transitions_allowed where from_state = old.state),
                '(none — terminal)'
              )
            );
  end if;

  -- Log it. Doing this in the trigger rather than in application code is what
  -- makes "every transition is a committed database write" true by
  -- construction: there is no code path that can move a job without logging it.
  insert into public.job_state_transitions (job_id, from_state, to_state, reason, attempt)
  values (new.job_id, old.state, new.state, new.state_reason, new.attempt);

  -- Keep the timestamps honest rather than trusting callers to.
  if new.state = 'running' and old.started_at is null then
    new.started_at := now();
  end if;
  if new.state in ('complete', 'cancelled', 'failed') then
    new.finished_at := coalesce(new.finished_at, now());
  else
    new.finished_at := null;
  end if;

  return new;
end
$$;

create trigger jobs_enforce_transition
  before update of state on public.jobs
  for each row execute function app.enforce_job_transition();

-- The first transition into a job's initial state is logged too, so history
-- starts at creation rather than at the first move.
create or replace function app.log_job_creation()
  returns trigger
  language plpgsql
  set search_path = pg_catalog, public
as $$
begin
  insert into public.job_state_transitions (job_id, from_state, to_state, reason, attempt)
  values (new.job_id, null, new.state, new.state_reason, new.attempt);
  return null;
end
$$;

create trigger jobs_log_creation
  after insert on public.jobs
  for each row execute function app.log_job_creation();

create trigger jobs_touch_updated_at
  before update on public.jobs
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Transition history is append-only too
--
-- It is evidence about recovery. Evidence that can be rewritten is not
-- evidence, and this is cheap to guarantee.
-- ---------------------------------------------------------------------------
create trigger job_transitions_reject_update
  before update on public.job_state_transitions
  for each row execute function app.reject_ledger_mutation();

create trigger job_transitions_reject_delete
  before delete on public.job_state_transitions
  for each row execute function app.reject_ledger_mutation();

create trigger job_transitions_reject_truncate
  before truncate on public.job_state_transitions
  for each statement execute function app.reject_ledger_mutation();

-- ---------------------------------------------------------------------------
-- Now that jobs exist, close the forward reference left open in 0003
-- ---------------------------------------------------------------------------
alter table public.events
  add constraint events_related_job_fk
  foreign key (related_job_id) references public.jobs (job_id);

-- ---------------------------------------------------------------------------
-- Grants and RLS
-- ---------------------------------------------------------------------------
alter table public.jobs                  enable row level security;
alter table public.jobs                  force  row level security;
alter table public.job_state_transitions enable row level security;
alter table public.job_state_transitions force  row level security;

create policy jobs_app_read on public.jobs
  for select to ai_team_app using (true);
create policy jobs_app_insert on public.jobs
  for insert to ai_team_app with check (true);
create policy jobs_app_update on public.jobs
  for update to ai_team_app using (true) with check (true);

create policy job_transitions_app_read on public.job_state_transitions
  for select to ai_team_app using (true);
create policy job_transitions_app_insert on public.job_state_transitions
  for insert to ai_team_app with check (true);

grant select, insert, update on public.jobs to ai_team_app;
grant select, insert on public.job_state_transitions to ai_team_app;
grant select on app.job_transitions_allowed to ai_team_app;
grant usage on schema app to ai_team_app;

-- Not granted: DELETE on jobs. A job is cancelled, never deleted — the ledger
-- references it forever.
