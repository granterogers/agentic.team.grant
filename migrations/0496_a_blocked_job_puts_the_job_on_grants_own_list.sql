/*
  THE HUMAN-ACTION BRIDGE (#259).

  The Issue's example, in its own words: an agent job `Integrate Google Drive`
  becomes BLOCKED -- HUMAN ACTION REQUIRED and creates `Authorize Google Drive`
  for the user; completing that Personal Task may satisfy the dependency and
  allow the Agent Job to resume.

  Everything needed for this already exists and none of it was joined up.
  `public.blockers` records a job that cannot go on without a person.
  `app.hq_answer_blocker` resolves one and lets the job go. `public.tasks`
  carries `assigned_to_human` and `job_id`. What was missing is the sentence
  between them: a blocker that needs Grant to DO something never appeared on
  the list he actually looks at. It appeared on the Governance page, which is
  where he goes to read about the office rather than to work.

  ## No new noun, and no second door

  ADR-0041 settled that a Personal Task is a `tasks` row rather than a second
  table. This follows it: the bridge is one nullable column, two triggers and
  an extracted function. There is no `human_actions` table, no second resume
  path, and no second definition of what "the job may go now" means.

  `app.let_job_go` is that extracted definition. `hq_answer_blocker` had it
  inline; a second copy in the task path would be two writers of one field,
  which 0472 is the migration about. So the function is SPLICED out of the live
  definition rather than transcribed -- CLAUDE.md records the cost of
  rewriting a function from memory twice, and `pg_get_functiondef` emits no
  trailing semicolon, which it records three times.

  ## Which answer completing a task sends

  `hq_answer_blocker` refuses an answer outside `approval_options`, so the
  bridge has to name one. It does NOT guess: the option is chosen when the
  task is created and STORED on the task in `satisfies_answer`, so it is
  visible, auditable and arguable rather than decided invisibly at the moment
  Grant ticks a box.

  The default is `approval_options[1]`, and that is a stated assumption with
  evidence rather than a hope: every blocker in the table lists the
  affirmative first (`Go ahead,Not now`; `Just this once,...`;
  `approve,decline`). If a caller ever lists a refusal first, the task will
  carry that word on its face where somebody can see it is wrong -- which a
  hidden rule would not.

  ## Both directions, because one is a dead task on his list

  Completing the task resolves the blocker. AND resolving the blocker anywhere
  else -- the Governance page, Telegram, a standing authorization -- completes
  the task. Without the second half, answering in the office would leave
  `Authorize Google Drive` sitting on his list for ever with nothing to do,
  which is the feedback-loop half the Issue asks for by name.

  No backticks in any comment in this file.
*/

-- ---------------------------------------------------------------- the link --

alter table public.tasks
  add column if not exists satisfies_blocker uuid references public.blockers(blocker_id),
  add column if not exists satisfies_answer text;

comment on column public.tasks.satisfies_blocker is
  'The blocker this personal task exists to clear (#259). Completing the task '
  'answers it and lets the agent job go.';
comment on column public.tasks.satisfies_answer is
  'Which of the blocker approval_options completing this task sends. Stored '
  'rather than decided at completion time, so the choice is visible.';

create index if not exists tasks_satisfies_blocker
  on public.tasks (satisfies_blocker) where satisfies_blocker is not null;

-- ------------------------------------------------- one definition of resume --

/*
  Spliced from the live `hq_answer_blocker` rather than transcribed.

  The body below is the exact text that function carries today for letting a
  job go, including its reasoning about why `waiting_user -> queued` is not an
  edge. Copying it by hand is how `app.pause_job` lost four behaviours in one
  go (0457), and this is the same shape of change.
*/
create or replace function app.let_job_go(p_job uuid, p_why text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_was text;
begin
  if p_job is null then return; end if;
  select state::text into v_was from public.jobs where job_id = p_job;
  if v_was is null then return; end if;
  /*
    A resolved blocker whose job is still parked in waiting_user is a job
    nothing will ever pick up. But waiting_user -> queued is not an edge, and
    0290 says why it should not be: queued means nobody has looked at this yet.
    So: park it, then queue it. Both transitions are written to
    job_state_transitions by the trigger, and the ledger reads as what
    happened.
  */
  if v_was in ('waiting_user', 'waiting_external') then
    update public.jobs
       set state = 'paused', state_reason = p_why, updated_at = app.now_utc()
     where job_id = p_job;
    v_was := 'paused';
  end if;
  if v_was = 'paused' then
    update public.jobs
       set state = 'queued', state_reason = p_why, updated_at = app.now_utc()
     where job_id = p_job;
  end if;
end;
$fn$;

comment on function app.let_job_go(uuid, text) is
  'The one definition of "this job may run again", so the blocker answer path '
  'and the personal-task path cannot come to disagree (#259, 0472s rule).';

-- ------------------------------------------- a blocked job reaches his list --

create or replace function app.blocker_makes_a_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_answer text;
begin
  /*
    Only a blocker that actually STOPS the job. A blocker raised while work
    continues is a question, and a question belongs on the Governance page
    rather than on a to-do list -- putting every one of them on his list is
    how a list stops being read.
  */
  if new.work_can_continue then return new; end if;
  if new.job_id is null then return new; end if;

  v_answer := new.approval_options[1];
  if v_answer is null then return new; end if;

  insert into public.tasks
    (project_id, title, detail, state, assigned_to_human, job_id,
     satisfies_blocker, satisfies_answer, added_by, priority)
  values
    (new.project_id,
     new.requested_action,
     /*
       The task says WHY, because a task called "Authorize Google Drive" with
       no context is one he will look at in a week and not know the cost of
       leaving. The blockers own words, not a summary of them.
     */
     new.why_needed ||
       case when coalesce(new.consequences_of_delay, '') = '' then ''
            else ' If it waits: ' || new.consequences_of_delay end,
     'todo', true, new.job_id,
     new.blocker_id, v_answer,
     coalesce(new.originating_agent, 'the office'),
     2)
  on conflict do nothing;
  return new;
end;
$fn$;

drop trigger if exists blockers_make_a_task on public.blockers;
create trigger blockers_make_a_task
  after insert on public.blockers
  for each row execute function app.blocker_makes_a_task();

-- ------------------------------------------------ ticking it lets the job go --

create or replace function app.task_answers_blocker()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  b public.blockers%rowtype;
begin
  if new.satisfies_blocker is null then return new; end if;
  if new.state <> 'done' or coalesce(old.state, '') = 'done' then return new; end if;

  select * into b from public.blockers where blocker_id = new.satisfies_blocker;
  if b.blocker_id is null then return new; end if;
  /*
    Idempotent. He may tick a task whose blocker somebody already answered --
    from Telegram, from the Governance page, or through a standing
    authorization -- and that is not an error, it is two people agreeing.
  */
  if b.state <> 'open' then return new; end if;

  update public.blockers
     set state = 'resolved',
         resolved_at = app.now_utc(),
         resolution = coalesce(new.satisfies_answer, 'done') ||
                      ' — the linked personal task was completed'
   where blocker_id = b.blocker_id;

  perform app.let_job_go(b.job_id, 'the personal task for this was done');
  return new;
end;
$fn$;

drop trigger if exists tasks_answer_blocker on public.tasks;
create trigger tasks_answer_blocker
  after update of state on public.tasks
  for each row execute function app.task_answers_blocker();

-- ------------------------------------- and answering it clears his list too --

create or replace function app.blocker_closes_its_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.state = 'open' or old.state <> 'open' then return new; end if;
  /*
    The other direction, and the half that is easy to leave out. Answering on
    the Governance page without this leaves "Authorize Google Drive" on his
    list for ever with nothing left to do -- a task that cannot be completed
    by doing anything, which teaches him to ignore the list.
  */
  update public.tasks
     set state = 'done', done_at = app.now_utc()
   where satisfies_blocker = new.blocker_id and state <> 'done';
  return new;
end;
$fn$;

drop trigger if exists blockers_close_their_task on public.blockers;
create trigger blockers_close_their_task
  after update of state on public.blockers
  for each row execute function app.blocker_closes_its_task();

-- ------------------------------------------------------------------- driven --

/*
  Driven, in both directions, because a migration that applies cleanly is not
  a function that works -- 0390 declared four defects in one feature and every
  one would have surfaced weeks later as a press that did nothing.
*/
do $drive$
declare
  v_project uuid;
  v_job uuid;
  v_blocker uuid;
  v_task uuid;
  v_state text;
  v_n int;
begin
  insert into public.projects (name, slug, status)
  values ('fixture bridge probe', 'fixture-bridge-probe', 'active')
  returning project_id into v_project;

  insert into public.jobs (kind, state, project_id, requested_by, correlation_id,
                           idempotency_key, pinned_config)
  values ('office.instruction', 'waiting_user', v_project, 'teamhq:grant',
          gen_random_uuid(), 'bridge-probe-' || gen_random_uuid()::text, '{}'::jsonb)
  returning job_id into v_job;

  insert into public.blockers
    (project_id, job_id, requested_action, why_needed, consequences_of_delay,
     approval_options, originating_agent, work_can_continue)
  values (v_project, v_job, 'Authorize Google Drive',
          'The office cannot read the folder until you sign in once.',
          'The weekly digest will have nothing in it.',
          array['I have done it', 'Not now']::text[], 'marcus', false)
  returning blocker_id into v_blocker;

  -- 1. the blocker put a task on his list
  select task_id into v_task from public.tasks where satisfies_blocker = v_blocker;
  if v_task is null then
    raise exception 'a blocked job did not reach his list';
  end if;
  select count(*) into v_n from public.tasks
   where task_id = v_task and assigned_to_human and title = 'Authorize Google Drive'
     and satisfies_answer = 'I have done it';
  if v_n <> 1 then raise exception 'the task is not a personal task for that action'; end if;

  -- 2. ticking it resolves the blocker AND lets the job go
  update public.tasks set state = 'done', done_at = app.now_utc() where task_id = v_task;
  select state::text into v_state from public.blockers where blocker_id = v_blocker;
  if v_state <> 'resolved' then raise exception 'ticking the task left the blocker %', v_state; end if;
  select state::text into v_state from public.jobs where job_id = v_job;
  if v_state <> 'queued' then raise exception 'the job did not go: %', v_state; end if;

  /*
    3. the other direction: answering elsewhere clears his list.

    A FRESH job, because the first one is queued now and queued ->
    waiting_user is not a legal transition -- the state machine refused the
    first version of this probe, correctly, and forcing it would have been the
    test arguing with a safety rule.
  */
  insert into public.jobs (kind, state, project_id, requested_by, correlation_id,
                           idempotency_key, pinned_config)
  values ('office.instruction', 'waiting_user', v_project, 'teamhq:grant',
          gen_random_uuid(), 'bridge-probe-2-' || gen_random_uuid()::text, '{}'::jsonb)
  returning job_id into v_job;
  insert into public.blockers
    (project_id, job_id, requested_action, why_needed, consequences_of_delay,
     approval_options, originating_agent, work_can_continue)
  values (v_project, v_job, 'Rotate the API key',
          'The stored key expired.', 'Nothing will run.',
          array['Done', 'Not now']::text[], 'marcus', false)
  returning blocker_id into v_blocker;
  select task_id into v_task from public.tasks where satisfies_blocker = v_blocker;
  if v_task is null then raise exception 'the second blocker made no task'; end if;
  update public.blockers set state = 'resolved', resolved_at = app.now_utc()
   where blocker_id = v_blocker;
  select state into v_state from public.tasks where task_id = v_task;
  if v_state <> 'done' then
    raise exception 'answering elsewhere left a dead task on his list: %', v_state;
  end if;

  -- 4. CONTROL: a blocker that does NOT stop the job makes no task
  insert into public.blockers
    (project_id, job_id, requested_action, why_needed, consequences_of_delay,
     approval_options, originating_agent, work_can_continue)
  values (v_project, v_job, 'A question that does not stop anything',
          'Curiosity.', 'None.', array['Go ahead', 'Not now']::text[], 'marcus', true)
  returning blocker_id into v_blocker;
  select count(*) into v_n from public.tasks where satisfies_blocker = v_blocker;
  if v_n <> 0 then raise exception 'a question that stops nothing reached his to-do list'; end if;

  raise notice 'the bridge works in both directions, and a mere question does not cross it';
  raise exception 'rolling the probe back';
exception
  when others then
    if sqlerrm <> 'rolling the probe back' then raise; end if;
end
$drive$;
