-- Durable checkpoints inside a job (#263).
--
-- The office already has durable jobs, enforced state transitions, leasing,
-- recovery, retries and exact-once delivery. What it does not have is a way
-- for a job that finished steps one to seven of ten to carry on at step eight.
-- A retry means DO THE JOB AGAIN, and for a job that spent a model call and
-- wrote a file that is both expensive and unsafe.
--
-- ## Two columns that have never held anything
--
-- `job_state.paused` and `jobs.waiting_on` were declared and never used: zero
-- jobs have ever been paused and `waiting_on` has never been non-null. The
-- transitions are already legal (running -> paused, paused -> queued), so this
-- is the work that makes a declared state real rather than a new state machine
-- beside it -- which the Issue forbids in those words.
--
-- ## The exact-once rule, which is the whole design
--
--   > "A resume must NEVER repeat an already-committed external action merely
--   > because the process restarted."
--
-- So a step is recorded in TWO writes, not one. `step_begin` writes that the
-- step started and what KIND of effect it is about to have; `step_done` writes
-- that it finished and what it produced. A step found already finished is
-- skipped. A step found STARTED AND NOT FINISHED is the interesting case, and
-- what happens depends on the kind:
--
--   * `none` or `local` -- nothing outside the office happened, or only
--     something the office can see and correct. Safe to run again.
--   * `external` -- a message may have been sent, a page may have been created,
--     a form may have been submitted. Nobody can tell from here, so the job
--     PARKS for reconciliation rather than guessing, which is the Issue's own
--     instruction and §7's existing rule about ambiguous notebook writes.
--
-- ## Stale checkpoints are refused, not guessed through
--
-- Every row carries the schema version and code version that produced it. A
-- resume under a different schema version does not skip the step and does not
-- redo it: it parks, because "the code changed" is exactly when silently
-- continuing is worst.
--
-- ## What is NOT stored
--
-- No reasoning, and the line is not where it first looks. A step's `outcome`
-- may hold what the Issue lists -- ids, counts, references, structured plan
-- state, and a tool's OUTPUT or a reference to it -- and a drafted report is a
-- tool output, not a thought. Storing it is the whole value: it is what stops
-- a resume spending the model call again.
--
-- What must never go in is the model's private reasoning, and the reason is
-- that this table is inspectable by anyone who can read the database.

create table if not exists public.job_steps (
  step_id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(job_id) on delete cascade,
  /*
    The caller's own stable identifier, not an index.

    An ordinal alone breaks the moment a step is inserted in the middle: every
    checkpoint after it then claims to be a different step. A name survives
    that, and the ordinal is kept beside it only so the UI can show the order.
  */
  step text not null,
  ordinal integer not null,
  began_at timestamptz not null default app.now_utc(),
  finished_at timestamptz,
  /*
    Operational state to carry forward: ids, counts, references, structured
    plan state, and a tool's output or a reference to it. A drafted report
    belongs here -- it is an output, and keeping it is what stops a resume
    paying for the model twice.

    What must never go here is the model's private reasoning, because this
    table is inspectable by anyone who can read the database.
  */
  outcome jsonb,
  /*
    What this step did OUTSIDE the office, if anything. A message ref, a page
    id, a document id. The thing a resume must not do twice.
  */
  effect_ref text,
  effect_kind text not null default 'none'
    check (effect_kind in ('none', 'local', 'external')),
  schema_version integer not null,
  code_version text not null,
  constraint job_steps_one_per_job unique (job_id, step),
  constraint job_steps_finished_says_when
    check (finished_at is null or finished_at >= began_at)
);

create index if not exists job_steps_by_job on public.job_steps (job_id, ordinal);

comment on table public.job_steps is
  'What a job has already done, so a resume continues rather than repeats '
  '(#263). Two writes per step -- began and finished -- because a step found '
  'started and not finished with an external effect cannot be safely retried '
  'and must park for reconciliation.';
comment on column public.job_steps.outcome is
  'Operational state and tool outputs, or references to them: ids, counts, '
  'plan state, a drafted artifact. Never the model''s private reasoning -- '
  'this table is readable by anyone with database access.';

/*
  A finished step is immutable, and an unfinished one may only be finished.

  Without this a resume could quietly rewrite what an earlier attempt recorded
  and the exact-once property would be a convention rather than a guarantee.
*/
create or replace function app.job_steps_are_written_once()
returns trigger language plpgsql as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'a step that happened cannot be unhappened (job %, step %)',
      old.job_id, old.step using errcode = '23514';
  end if;
  if old.finished_at is not null then
    raise exception 'step % of job % already finished at %; it cannot be changed',
      old.step, old.job_id, old.finished_at using errcode = '23514';
  end if;
  if new.step <> old.step or new.job_id <> old.job_id or new.effect_kind <> old.effect_kind then
    raise exception 'a step may be finished, not redefined (job %, step %)',
      old.job_id, old.step using errcode = '23514';
  end if;
  return new;
end;
$function$;

drop trigger if exists job_steps_written_once on public.job_steps;
create trigger job_steps_written_once
  before update or delete on public.job_steps
  for each row execute function app.job_steps_are_written_once();

/*
  Why a job stopped, and what would let it go on.

  `resumable` is stated rather than assumed: the Issue says so in those words,
  and a credential that was revoked deliberately is not something a tick should
  quietly retry.
*/
create table if not exists public.job_pauses (
  pause_id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(job_id) on delete cascade,
  at timestamptz not null default app.now_utc(),
  reason text not null check (reason in (
    'awaiting_approval', 'awaiting_human_action', 'credential_required',
    'rate_limited', 'provider_unavailable', 'resource_unavailable',
    'scheduled_wait', 'worker_interrupted', 'dependency_wait',
    'needs_reconciliation', 'checkpoint_stale')),
  /** What a person reads. Never a stack trace and never a credential. */
  detail text not null check (btrim(detail) <> ''),
  /** The condition, in words, so the pause is answerable by a human. */
  resume_when text not null check (btrim(resume_when) <> ''),
  resumable boolean not null,
  /** When waiting stops being worth it. Null means no expiry. */
  expires_at timestamptz,
  resumed_at timestamptz,
  resumed_why text
);

create index if not exists job_pauses_open on public.job_pauses (job_id)
  where resumed_at is null;

comment on table public.job_pauses is
  'Why a job stopped part way and what would let it continue (#263). One open '
  'row per paused job; `resumable` false means a tick must not retry it.';

/*
  Begin a step, and say what the caller should do.

  The four answers are the whole contract:
    do        -- nothing recorded, or an earlier attempt that is safe to repeat
    skip      -- already finished; here is what it produced
    park      -- an external effect may have happened and nobody can tell
    stale     -- the checkpoint was written by a different version of the code
*/
create or replace function app.step_begin(
  p_job uuid, p_step text, p_ordinal integer, p_effect_kind text,
  p_schema integer, p_code text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare v public.job_steps%rowtype;
begin
  if coalesce(btrim(p_step), '') = '' then
    return jsonb_build_object('error', 'a step needs a name');
  end if;
  if p_effect_kind not in ('none', 'local', 'external') then
    return jsonb_build_object('error', format('%L is not a kind of effect', p_effect_kind));
  end if;

  select * into v from public.job_steps where job_id = p_job and step = p_step;

  if not found then
    insert into public.job_steps
      (job_id, step, ordinal, effect_kind, schema_version, code_version)
    values (p_job, p_step, p_ordinal, p_effect_kind, p_schema, p_code);
    return jsonb_build_object('do', true, 'first', true);
  end if;

  -- A checkpoint from different code is not a checkpoint this run may reason
  -- about, finished or not.
  if v.schema_version <> p_schema then
    return jsonb_build_object('stale', true,
      'was', v.schema_version, 'now', p_schema,
      'why', format('step %L was recorded by schema %s and this is %s',
                    p_step, v.schema_version, p_schema));
  end if;

  if v.finished_at is not null then
    return jsonb_build_object('skip', true, 'outcome', coalesce(v.outcome, '{}'::jsonb),
                              'effect_ref', v.effect_ref, 'at', v.finished_at);
  end if;

  if v.effect_kind = 'external' then
    return jsonb_build_object('park', true,
      'why', format('step %L started at %s and never finished, and it acts outside the '
                    'office -- whether it committed cannot be known from here',
                    p_step, v.began_at));
  end if;

  -- Safe to run again: nothing outside the office happened.
  update public.job_steps set began_at = app.now_utc()
   where step_id = v.step_id;
  return jsonb_build_object('do', true, 'again', true);
end;
$function$;

create or replace function app.step_done(
  p_job uuid, p_step text, p_outcome jsonb default '{}'::jsonb, p_effect_ref text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare v public.job_steps%rowtype;
begin
  select * into v from public.job_steps where job_id = p_job and step = p_step;
  if not found then
    return jsonb_build_object('error', format('step %L was never begun on this job', p_step));
  end if;
  if v.finished_at is not null then
    -- Idempotent on purpose: finishing twice is a retry, not an error.
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  update public.job_steps
     set finished_at = app.now_utc(),
         outcome = coalesce(p_outcome, '{}'::jsonb),
         effect_ref = nullif(btrim(coalesce(p_effect_ref, '')), '')
   where step_id = v.step_id;
  return jsonb_build_object('ok', true);
end;
$function$;

/*
  Stop, and say why.

  Sets the state the office already had a word for and has never used, records
  the reason where a person can read it, and puts `not_before` in the future so
  a scheduled wait does not spin.
*/
create or replace function app.pause_job(
  p_job uuid, p_reason text, p_detail text, p_resume_when text,
  p_resumable boolean default true, p_until timestamptz default null,
  p_expires_at timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare v_state text;
begin
  select state::text into v_state from public.jobs where job_id = p_job;
  if v_state is null then
    return jsonb_build_object('error', 'no such job');
  end if;
  if v_state = 'paused' then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  insert into public.job_pauses
    (job_id, reason, detail, resume_when, resumable, expires_at)
  values (p_job, p_reason, p_detail, p_resume_when, coalesce(p_resumable, true), p_expires_at);

  update public.jobs
     set state = 'paused',
         state_reason = left(p_reason || ': ' || p_detail, 500),
         waiting_on = left(p_resume_when, 500),
         not_before = coalesce(p_until, not_before),
         leased_by = null,
         leased_until = null
   where job_id = p_job;

  return jsonb_build_object('ok', true, 'was', v_state);
end;
$function$;

create or replace function app.resume_job(p_job uuid, p_why text default 'the condition was met')
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare v_state text; v_resumable boolean;
begin
  select state::text into v_state from public.jobs where job_id = p_job;
  if v_state is null then
    return jsonb_build_object('error', 'no such job');
  end if;
  if v_state <> 'paused' then
    return jsonb_build_object('error', format('that job is %s, not paused', v_state));
  end if;
  select resumable into v_resumable from public.job_pauses
   where job_id = p_job and resumed_at is null order by at desc limit 1;
  if v_resumable is false then
    return jsonb_build_object('error',
      'that pause was recorded as not automatically resumable; it needs a person');
  end if;

  update public.job_pauses
     set resumed_at = app.now_utc(), resumed_why = left(coalesce(p_why, ''), 400)
   where job_id = p_job and resumed_at is null;

  update public.jobs
     set state = 'queued', state_reason = left(coalesce(p_why, 'resumed'), 500),
         waiting_on = null, not_before = null
   where job_id = p_job;

  return jsonb_build_object('ok', true);
end;
$function$;

/*
  What the job has done and why it stopped, for the page and for a person.

  The Issue's own list: current step, completed steps, why it paused, what
  human action is required. Deliberately says nothing about reasoning.
*/
create or replace function app.job_progress(p_job uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select jsonb_build_object(
    'job', p_job,
    'state', (select state::text from public.jobs where job_id = p_job),
    'steps', coalesce((
      select jsonb_agg(jsonb_build_object(
               'step', s.step,
               'ordinal', s.ordinal,
               'done', s.finished_at is not null,
               'began_at', s.began_at,
               'finished_at', s.finished_at,
               /*
                 Named for what it MEANS to a resume, not for what happened.

                 The first version called this `acted_outside`, and the first
                 real job showed a `store` step carrying
                 `document:bcf9fa85-…` next to `acted_outside: false` — which
                 reads as a contradiction and is not one. The question a
                 person needs answered is not "did anything happen" (the
                 effect column says that) but "if this had been interrupted,
                 could it have been retried": `local` can, `external` cannot.
               */
               'unrepeatable', s.effect_kind = 'external',
               'effect', s.effect_ref)
             order by s.ordinal, s.began_at)
        from public.job_steps s where s.job_id = p_job), '[]'::jsonb),
    'paused', (
      select jsonb_build_object(
               'reason', p.reason, 'detail', p.detail, 'resume_when', p.resume_when,
               'resumable', p.resumable, 'since', p.at, 'expires_at', p.expires_at)
        from public.job_pauses p
       where p.job_id = p_job and p.resumed_at is null
       order by p.at desc limit 1)
  );
$function$;

/*
  The paused jobs a tick may safely start again.

  Only `scheduled_wait`, `rate_limited` and `provider_unavailable`: the others
  are waiting on a person or a credential and retrying them on a timer is how a
  pause becomes a spin. Expired pauses are excluded rather than resumed --
  waiting stopped being worth it, and something should say so.
*/
create or replace function app.resumable_now()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'job_id', j.job_id, 'kind', j.kind, 'reason', p.reason,
           'since', p.at) order by p.at), '[]'::jsonb)
    from public.jobs j
    join public.job_pauses p on p.job_id = j.job_id and p.resumed_at is null
   where j.state = 'paused'
     and p.resumable
     and p.reason in ('scheduled_wait', 'rate_limited', 'provider_unavailable')
     and (p.expires_at is null or p.expires_at > app.now_utc())
     and (j.not_before is null or j.not_before <= app.now_utc());
$function$;

create or replace function public.job_progress(p_job uuid)
returns jsonb language sql security definer set search_path to ''
as $function$ select app.job_progress(p_job) $function$;
