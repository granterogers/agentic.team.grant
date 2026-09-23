/*
  0562 — an obligation is not a job (#312, #315, #316, #317)

  ## The conflation, measured

  `jobs.state = 'complete'` means ONE job finished executing. Nothing has ever
  meant "what Grant asked for has been done". Every recent fix needed the
  second idea and had to reconstruct it from descendants:

    #312  the conversation could not see its own child work
    #315  "stop that" had no handle, because the parent was already terminal
    #316  a repeat could not be recognised, because "already being pursued"
          is a property of the tree and not of any job in it
    #317  "what did they come back with" had to walk descendants by hand

  Four special cases bolted onto `conversation_before`, each rebuilding the
  same missing concept.

  ## Canonical ground truth

      real parent/child pairs                         56
      child finished AFTER the parent                 53   (95%)
      of those, wrote something                       53
      of those, delivered to anybody                  21

  So a parent finishing before its children is not an edge case — it is what
  ALWAYS happens. The office answers, completes, and leaves work running
  behind it.

  And the aggregation mechanism already exists:

      branch_groups                    40
      of them real traffic              0
      real children outside any group  1055

  `app.fan_in_over` is wired at `instruction.ts:2490` behind
  `branchesStarted.length >= 2`. Real traffic:

      convened specialists   parents
      0                      5138
      1                         2
      2 or more                 0

  **No real turn has ever convened two specialists**, so the gate has never
  been reachable, and the only two real hand-offs each had one specialist
  whose answer had no delivery path. The mechanism is not broken; it covers a
  shape that does not occur while the shape that does occur is uncovered.

  ## Derived, never stored

  CLAUDE.md: do not store a fact you can already read — `public.relations` is
  the entry, and 0303/0304 are what a denormalised copy costs. Every input
  here is a column on `jobs` or a row in `blockers`, so the state is computed
  and cannot rot.

  Deriving also removes a whole failure class by construction: there is no
  aggregation counter to get stuck, so **a terminal child cannot leave an
  obligation waiting forever**. That is one of the things this was asked to be
  sabotage-proof against, and it is answered by the shape rather than by a
  guard.

  ## The states, and why they are in this order

    cancelled          the root was cancelled. A child that completes after
                       that does NOT revive it — #315's lifecycle, and the
                       reason this test comes first.
    waiting_on_user    something live is blocked on Grant. Checked before
                       `working` because "still going" and "it needs you" are
                       different answers and only one of them is his to act
                       on. #317: waiting_on_you existed canonically and
                       reached him nowhere.
    working            anything at all is still live. Before any settled
                       verdict, so ONE child completing can never mark a
                       multi-child obligation fulfilled.
    failed             nothing is live and nothing succeeded.
    partially_complete some of it landed and some did not. A real state, not
                       a rounding of failed: he asked for two things and got
                       one, and saying "failed" would lose the one.
    fulfilled          everything that was started finished.

  `jobs.state` is untouched. Nothing here writes.
*/

create type public.obligation_state as enum (
  'working', 'waiting_on_user', 'partially_complete', 'fulfilled', 'failed', 'cancelled'
);

/*
  Every job in the tree rooted at one turn. Separate from the state function
  so the conversation readers can share the walk rather than each writing
  their own — four of them already had.
*/
create or replace function app.obligation_tree(p_root uuid)
returns table (job_id uuid, state job_state, kind text, is_root boolean)
language sql
stable
security definer
set search_path to ''
as $function$
  with recursive tree as (
    select j.job_id, j.state, j.kind, true as is_root
      from public.jobs j where j.job_id = p_root
    union all
    select k.job_id, k.state, k.kind, false
      from public.jobs k join tree t on k.parent_job_id = t.job_id
  )
  select * from tree
$function$;

comment on function app.obligation_tree(uuid) is
  'Every job descended from one turn, the turn included. The shared walk the '
  'conversation readers each used to write for themselves. 0562.';

create or replace function app.obligation_state(p_root uuid)
returns public.obligation_state
language sql
stable
security definer
set search_path to ''
as $function$
  with t as (select * from app.obligation_tree(p_root)),
  counted as (
    select
      (select state from t where is_root) as root_state,
      count(*) filter (where state not in ('complete', 'cancelled', 'failed')) as live,
      count(*) filter (where state = 'complete') as done,
      count(*) filter (where state = 'failed') as failed,
      count(*) filter (where state = 'cancelled') as cancelled,
      (select count(*) from t
        join public.blockers b on b.job_id = t.job_id
       where b.state = 'open'
         and t.state not in ('complete', 'cancelled', 'failed')) as blocked
      from t
  )
  select case
    /*
      The root being cancelled settles it, whatever finished afterwards. A
      child that completes after a cancellation is work Grant called off, and
      reporting the obligation as fulfilled because it landed anyway is the
      stale-result defect #315 was written for.
    */
    when root_state = 'cancelled' then 'cancelled'::public.obligation_state
    when blocked > 0 then 'waiting_on_user'::public.obligation_state
    when live > 0 then 'working'::public.obligation_state
    when done = 0 then 'failed'::public.obligation_state
    when failed > 0 or cancelled > 0 then 'partially_complete'::public.obligation_state
    else 'fulfilled'::public.obligation_state
  end
  from counted
$function$;

comment on function app.obligation_state(uuid) is
  'What has become of what Grant actually asked for, across the whole job '
  'tree — as opposed to jobs.state, which says only that one job stopped '
  'executing. Derived, never stored, so there is no counter to get stuck and '
  'a terminal child cannot leave an obligation waiting for ever. 0562.';

/*
  Every lifecycle shape, driven inside a rollback. The list is the one this
  was asked to cover, and each is a different answer rather than a variation
  of one.
*/
do $drive$
declare
  v_p uuid; v_root uuid; v_a uuid; v_b uuid; v_c uuid; v_off uuid; v_say text := '';
begin
  select project_id into v_p from public.projects
   where status = 'active' and not is_fixture
     and project_id <> app.unnamed_project() order by updated_at desc limit 1;
  if v_p is null then raise notice '0562: no real project; skipped'; return; end if;

  -- a parent with no children, still running
  insert into public.jobs (correlation_id, project_id, idempotency_key, kind,
                           requested_by, priority, state)
  values (extensions.gen_random_uuid(), v_p, 'drive-0562-root', 'office.instruction',
          'teamhq:grant', 10, 'queued')
  returning job_id into v_root;
  if app.obligation_state(v_root) <> 'working' then
    raise exception '0562: a queued turn with no children is not working: %',
      app.obligation_state(v_root);
  end if;
  v_say := v_say || 'alone+queued=working; ';

  -- the parent answers. No children: that is the whole obligation.
  update public.jobs set state = 'running' where job_id = v_root;
  update public.jobs set state = 'output_created' where job_id = v_root;
  update public.jobs set state = 'quality_review' where job_id = v_root;
  update public.jobs set state = 'committing' where job_id = v_root;
  update public.jobs set state = 'committed' where job_id = v_root;
  update public.jobs set state = 'notifying' where job_id = v_root;
  update public.jobs set state = 'complete', finished_at = app.now_utc()
   where job_id = v_root;
  if app.obligation_state(v_root) <> 'fulfilled' then
    raise exception '0562: a lone completed turn is not fulfilled: %',
      app.obligation_state(v_root);
  end if;
  v_say := v_say || 'alone+complete=fulfilled; ';

  /*
    THE SHAPE THAT ACTUALLY HAPPENS: the parent is already complete and a
    child is still running. `jobs.state` says complete and the obligation is
    plainly not.
  */
  insert into public.jobs (correlation_id, project_id, idempotency_key, kind,
                           requested_by, priority, state, parent_job_id)
  values (extensions.gen_random_uuid(), v_p, 'drive-0562-a', 'office.instruction',
          'teamhq:grant', 10, 'queued', v_root)
  returning job_id into v_a;
  if app.obligation_state(v_root) <> 'working' then
    raise exception '0562: a live child under a complete parent reads as %',
      app.obligation_state(v_root);
  end if;
  v_say := v_say || 'complete parent + live child = working; ';

  -- a second child, so one finishing cannot settle it
  insert into public.jobs (correlation_id, project_id, idempotency_key, kind,
                           requested_by, priority, state, parent_job_id)
  values (extensions.gen_random_uuid(), v_p, 'drive-0562-b', 'office.instruction',
          'teamhq:grant', 10, 'queued', v_root)
  returning job_id into v_b;

  update public.jobs set state = 'running' where job_id = v_a;
  update public.jobs set state = 'output_created' where job_id = v_a;
  update public.jobs set state = 'quality_review' where job_id = v_a;
  update public.jobs set state = 'committing' where job_id = v_a;
  update public.jobs set state = 'committed' where job_id = v_a;
  update public.jobs set state = 'notifying' where job_id = v_a;
  update public.jobs set state = 'complete', finished_at = app.now_utc() where job_id = v_a;
  if app.obligation_state(v_root) <> 'working' then
    raise exception '0562: ONE child finishing settled a two-child obligation: %',
      app.obligation_state(v_root);
  end if;
  v_say := v_say || 'one of two done = still working; ';

  -- the other one is blocked on Grant, which is a different answer
  insert into public.blockers (project_id, job_id, requested_action, why_needed,
                               consequences_of_delay, approval_options,
                               originating_agent, work_can_continue, state)
  values (v_p, v_b, 'which supplier', 'cannot choose for you',
          'the comparison stays half done', array['the first', 'the second'],
          'chief-of-staff', false, 'open');
  if app.obligation_state(v_root) <> 'waiting_on_user' then
    raise exception '0562: an open blocker did not surface as waiting_on_user: %',
      app.obligation_state(v_root);
  end if;
  v_say := v_say || 'open blocker = waiting_on_user; ';

  /*
    He answers and it finishes. Everything that ran, succeeded.

    Ordered this way because `failed` is TERMINAL — an earlier draft made this
    child fail and then tried to complete it, and `enforce_job_transition`
    refused, correctly. A shape that needs a fresh job gets one rather than
    resurrecting a dead one.
  */
  update public.blockers set state = 'resolved', resolved_at = app.now_utc()
   where job_id = v_b;
  update public.jobs set state = 'running' where job_id = v_b;
  update public.jobs set state = 'output_created' where job_id = v_b;
  update public.jobs set state = 'quality_review' where job_id = v_b;
  update public.jobs set state = 'committing' where job_id = v_b;
  update public.jobs set state = 'committed' where job_id = v_b;
  update public.jobs set state = 'notifying' where job_id = v_b;
  update public.jobs set state = 'complete', finished_at = app.now_utc() where job_id = v_b;
  if app.obligation_state(v_root) <> 'fulfilled' then
    raise exception '0562: all complete is not fulfilled: %', app.obligation_state(v_root);
  end if;
  v_say := v_say || 'all done = fulfilled; ';

  -- a third child that FAILS: some of it landed and some did not
  insert into public.jobs (correlation_id, project_id, idempotency_key, kind,
                           requested_by, priority, state, parent_job_id)
  values (extensions.gen_random_uuid(), v_p, 'drive-0562-c', 'office.instruction',
          'teamhq:grant', 10, 'queued', v_root)
  returning job_id into v_c;
  update public.jobs set state = 'failed', finished_at = app.now_utc() where job_id = v_c;
  if app.obligation_state(v_root) <> 'partially_complete' then
    raise exception '0562: one failure among successes is not partially_complete: %',
      app.obligation_state(v_root);
  end if;
  v_say := v_say || 'mixed = partially_complete; ';

  /*
    CANCELLED OUTRANKS A LATE SUCCESS. A child completing after the root was
    called off must not report the obligation as fulfilled — that is exactly
    the stale result #315 exists to prevent.
  */
  insert into public.jobs (correlation_id, project_id, idempotency_key, kind,
                           requested_by, priority, state)
  values (extensions.gen_random_uuid(), v_p, 'drive-0562-off', 'office.instruction',
          'teamhq:grant', 10, 'queued')
  returning job_id into v_off;
  insert into public.jobs (correlation_id, project_id, idempotency_key, kind,
                           requested_by, priority, state, parent_job_id)
  values (extensions.gen_random_uuid(), v_p, 'drive-0562-offkid', 'office.instruction',
          'teamhq:grant', 10, 'queued', v_off)
  returning job_id into v_c;
  update public.jobs set state = 'cancelled', finished_at = app.now_utc()
   where job_id = v_off;
  /* The child lands anyway, AFTER the cancellation. */
  update public.jobs set state = 'running' where job_id = v_c;
  update public.jobs set state = 'output_created' where job_id = v_c;
  update public.jobs set state = 'quality_review' where job_id = v_c;
  update public.jobs set state = 'committing' where job_id = v_c;
  update public.jobs set state = 'committed' where job_id = v_c;
  update public.jobs set state = 'notifying' where job_id = v_c;
  update public.jobs set state = 'complete', finished_at = app.now_utc() where job_id = v_c;
  if app.obligation_state(v_off) <> 'cancelled' then
    raise exception '0562: a cancelled obligation whose child landed reads as %',
      app.obligation_state(v_off);
  end if;
  v_say := v_say || 'cancelled outranks a late success';

  raise exception '0562 drive: %', v_say using errcode = 'RS001';
exception when sqlstate 'RS001' then
  raise notice '0562 drive rolled back, as intended';
end
$drive$;
