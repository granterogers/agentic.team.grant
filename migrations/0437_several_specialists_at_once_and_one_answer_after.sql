-- Parallel branches, and a fan-in that cannot be faked (#262).
--
-- The office already chooses specialists, consults them and hands work between
-- them. What it has no word for is "these four pieces are independent, do them
-- at the same time, and then answer from what they actually found".
--
-- ## Not a workflow engine, and the shape says so
--
-- A branch IS a job. Same table, same state machine, same permissions, same
-- lease, same cost ceiling, independently visible and cancellable. This adds
-- two small tables that say which jobs belong to one question and which of
-- them the answer is allowed to wait for. Everything else is `public.jobs`
-- doing what it already does.
--
-- ## The rule that makes this worth having
--
--   > "Do not let the final answer claim a branch participated unless
--   > canonical state proves that branch ran."
--
-- So the synthesis step is not given the objective and a list of names. It is
-- given `app.branch_outputs`, which returns the bodies of the outputs that
-- exist, and `app.fan_in_ready`, which says what is still missing. A branch
-- that failed is reported as failed, in the prompt, in words -- because a
-- synthesis that quietly drops a branch reads exactly like one that never had
-- it, and #233 exists because the office used to narrate collaboration it had
-- not done.
--
-- ## Permissions never combine
--
-- Nothing here grants anything. Each child runs as its own agent and
-- `app.staff_may_use` decides, exactly as for any other job. The synthesis
-- consumes OUTPUTS, which are text, and text carries no reach. Stated because
-- a fan-in is the obvious place for somebody to think the parent should be
-- allowed to do what its children could.
--
-- ## Ceilings
--
-- `agents.max_specialists_per_job` already exists and is 3. Rather than
-- inventing a second number, the branch count is capped by that, read at
-- fan-out time so Grant can change it in Settings. The office's free-first
-- principle is the reason the cap is low and the reason it is read rather than
-- compiled in.

create table if not exists public.branch_groups (
  group_id uuid primary key default gen_random_uuid(),
  parent_job_id uuid not null references public.jobs(job_id) on delete cascade,
  /** What the whole fan-out is for, in one sentence a person can read. */
  objective text not null check (btrim(objective) <> ''),
  /** The job that will answer. Set at fan-out; it waits for the branches. */
  synthesis_job_id uuid references public.jobs(job_id) on delete set null,
  /** After this, waiting for a slow branch costs more than it is worth. */
  deadline timestamptz,
  created_at timestamptz not null default app.now_utc(),
  constraint branch_groups_one_per_parent unique (parent_job_id)
);

create table if not exists public.job_branches (
  branch_id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.branch_groups(group_id) on delete cascade,
  job_id uuid not null references public.jobs(job_id) on delete cascade,
  /** Whose branch it is. A slug, so the synthesis can say who found what. */
  agent text not null references public.staff(slug),
  /** What this branch was asked, which is what makes a missing one legible. */
  purpose text not null check (btrim(purpose) <> ''),
  /*
    Required branches are the ones the answer cannot be given without.

    Everything else is optional, and the default is optional deliberately: the
    Issue asks to avoid all-or-nothing semantics unless the parent explicitly
    requires every branch, and a default of `true` would make every fan-out
    hostage to its slowest member.
  */
  required boolean not null default false,
  created_at timestamptz not null default app.now_utc(),
  constraint job_branches_one_per_job unique (job_id),
  constraint job_branches_one_agent_per_group unique (group_id, agent)
);

create index if not exists job_branches_by_group on public.job_branches (group_id);

comment on table public.branch_groups is
  'One question split into concurrent specialist branches (#262). A branch is '
  'an ordinary job; this says which jobs belong to one question.';
comment on table public.job_branches is
  'A specialist branch of a fan-out (#262). `required` false by default: the '
  'answer should not be hostage to its slowest member.';

/*
  Register the branches of one question, and enqueue the answer.

  ## Why this takes jobs rather than creating them

  The first version of this function created the children itself, and it was
  duplicating something the office already does. `speaker()` already convenes
  several specialists and `instruction.ts` already enqueues one child each,
  with `addressed_to` set so the child takes the addressed-directly branch and
  the chain terminates at one by construction. **The office has fanned out for
  weeks.** What it has never had is the other half: something that waits for
  those children and answers from what they actually found.

  So this is fan-IN, and it takes the branch jobs that already exist. Creating
  them here as well would be a second way to convene somebody, and the handler
  would have to know which one it had used.

  `p_branches` is `[{"job_id": "...", "agent": "...", "purpose": "...",
  "required": false}]`.

  Refuses rather than truncates when asked for more branches than the ceiling
  allows: silently dropping the fourth specialist would make the answer look
  complete and be missing a domain, which is the failure this Issue is about.
*/
create or replace function app.fan_in_over(
  p_parent uuid, p_objective text, p_branches jsonb,
  p_synthesis_kind text default 'office.synthesise',
  p_deadline timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_group uuid; v_cap integer; v_count integer; v_branch jsonb;
  v_synth uuid; v_seen jsonb := '[]'::jsonb;
begin
  if not exists (select 1 from public.jobs where job_id = p_parent) then
    return jsonb_build_object('error', 'no such parent job');
  end if;
  if exists (select 1 from public.branch_groups where parent_job_id = p_parent) then
    -- Idempotent: a retried parent must not ask for a second answer.
    return jsonb_build_object('ok', true, 'already', true,
      'group', (select group_id from public.branch_groups where parent_job_id = p_parent));
  end if;

  v_count := coalesce(jsonb_array_length(p_branches), 0);
  if v_count < 2 then
    return jsonb_build_object('error',
      'a fan-in over fewer than two branches is just a job');
  end if;
  /*
    `system_config.value` is JSONB, not text.

    The first version wrote `nullif(value, '')::integer` and every call raised
    22P02 from inside a SECURITY DEFINER function — an empty string is not
    valid JSON, so the comparison itself threw before the cast was reached.
    `#>> '{}'` is how you get the scalar out, and CLAUDE.md's rule applies:
    query `information_schema` for the TYPE before writing the expression.
  */
  select coalesce(nullif(value #>> '{}', '')::integer, 3) into v_cap
    from public.system_config where key = 'agents.max_specialists_per_job';
  v_cap := coalesce(v_cap, 3);
  if v_count > v_cap then
    return jsonb_build_object('error',
      format('%s branches and the office allows %s at once', v_count, v_cap), 'cap', v_cap);
  end if;

  /*
    Every branch is checked BEFORE anything is written.

    The first version validated inside the insert loop, so a bad third branch
    returned an error and left a group with two branches in it — a refusal that
    changed something, which is the shape of a teardown that matches nothing.
    A function that says no must leave nothing behind.
  */
  for v_branch in select * from jsonb_array_elements(p_branches) loop
    if not exists (select 1 from public.staff where slug = v_branch ->> 'agent') then
      return jsonb_build_object('error',
        format('%L is nobody on the roster', v_branch ->> 'agent'));
    end if;
    if not exists (select 1 from public.jobs
                    where job_id = (v_branch ->> 'job_id')::uuid
                      and parent_job_id = p_parent) then
      -- A branch that is not a child of this parent is somebody else's work,
      -- and a group that could claim it would make the collaboration record a
      -- claim rather than a fact.
      return jsonb_build_object('error',
        format('job %L is not a child of this one', v_branch ->> 'job_id'));
    end if;
  end loop;

  insert into public.branch_groups (parent_job_id, objective, deadline)
  values (p_parent, p_objective, p_deadline)
  returning group_id into v_group;

  for v_branch in select * from jsonb_array_elements(p_branches) loop
    insert into public.job_branches (group_id, job_id, agent, purpose, required)
    values (v_group, (v_branch ->> 'job_id')::uuid, v_branch ->> 'agent',
            coalesce(nullif(btrim(coalesce(v_branch ->> 'purpose', '')), ''),
                     'part of the question'),
            coalesce((v_branch ->> 'required')::boolean, false));
    v_seen := v_seen || jsonb_build_object('job_id', v_branch ->> 'job_id',
                                           'agent', v_branch ->> 'agent');
  end loop;

  /*
    The answer is a child too, queued immediately.

    It does not wait in the database; it wakes, asks `fan_in_ready`, and pauses
    itself with `dependency_wait` when the branches are not in yet (#263). That
    is cheaper than a scheduler and it means a person looking at the job can
    see, in words, which branch it is waiting for.
  */
  v_synth := app.enqueue_child(p_parent, p_synthesis_kind,
    jsonb_build_object('group', v_group, 'objective', p_objective), interval '0', true, null);
  update public.branch_groups set synthesis_job_id = v_synth where group_id = v_group;

  return jsonb_build_object('ok', true, 'group', v_group,
    'branches', v_seen, 'synthesis', v_synth);
end;
$function$;

/*
  Is the answer allowed to be written yet, and what is missing?

  Deliberately returns the whole picture rather than a boolean: the synthesis
  needs to SAY which branch failed, and a caller given only "ready" would have
  to ask again to find out.
*/
create or replace function app.fan_in_ready(p_group uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  with b as (
    select br.agent, coalesce(s.name, br.agent) as name, br.purpose, br.required,
           j.state::text as state, j.job_id,
           exists (select 1 from public.outputs o where o.job_id = j.job_id) as answered
      from public.job_branches br
      join public.jobs j on j.job_id = br.job_id
      left join public.staff s on s.slug = br.agent
     where br.group_id = p_group
  ),
  g as (select deadline from public.branch_groups where group_id = p_group)
  select jsonb_build_object(
    'group', p_group,
    'total', (select count(*) from b),
    'done', (select count(*) from b where state = 'complete'),
    'failed', (select count(*) from b where state in ('failed', 'cancelled')),
    'running', (select count(*) from b where state not in ('complete', 'failed', 'cancelled')),
    'past_deadline', (select deadline is not null and deadline < app.now_utc() from g),
    /*
      Ready when every REQUIRED branch has settled and either every branch has,
      or the deadline has passed. A required branch that failed still counts as
      settled: the answer must then say the domain is missing rather than wait
      for ever.
    */
    'ready', (
      select not exists (
        select 1 from b where b.required
          and b.state not in ('complete', 'failed', 'cancelled'))
        and (
          not exists (select 1 from b where b.state not in ('complete', 'failed', 'cancelled'))
          or (select deadline is not null and deadline < app.now_utc() from g))),
    'waiting_for', coalesce((
      select jsonb_agg(jsonb_build_object('agent', b.agent, 'name', b.name,
                                          'purpose', b.purpose,
                                          'required', b.required, 'state', b.state)
             order by b.required desc, b.agent)
        from b where b.state not in ('complete', 'failed', 'cancelled')), '[]'::jsonb),
    /*
      The lost branches carry the person's NAME as well as the slug, because
      the gate that stops a synthesis crediting them matches on what a model
      would write. A model writes "Ruby", never "growth-director".
    */
    'lost', coalesce((
      select jsonb_agg(jsonb_build_object('agent', b.agent, 'name', b.name,
                                          'purpose', b.purpose,
                                          'required', b.required, 'state', b.state)
             order by b.agent)
        from b where b.state in ('failed', 'cancelled')), '[]'::jsonb)
  );
$function$;

/*
  What the branches actually produced.

  The output BODY, joined to the branch, so the synthesis is built from
  canonical state rather than from a list of names. A branch with no output
  does not appear, whatever its job state says -- which is the anti-fabrication
  rule in one join: the synthesis cannot cite what is not here.
*/
create or replace function app.branch_outputs(p_group uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select coalesce(jsonb_agg(v order by ord), '[]'::jsonb)
    from (
      select jsonb_build_object(
               'agent', br.agent,
               'name', coalesce(s.name, br.agent),
               'purpose', br.purpose,
               'required', br.required,
               'job_id', br.job_id,
               'body', o.body,
               'confidence', o.confidence,
               'evidence', o.evidence,
               'sources', o.sources) as v,
             br.created_at as ord
        from public.job_branches br
        join public.jobs j on j.job_id = br.job_id
        left join public.staff s on s.slug = br.agent
        join lateral (
          select o.body, o.confidence::text as confidence, o.evidence::text as evidence,
                 o.sources
            from public.outputs o where o.job_id = br.job_id
           order by o.created_at desc limit 1
        ) o on true
       where br.group_id = p_group
    ) q;
$function$;

/*
  Stop the whole thing.

  Cancellation propagates DOWN and never up: cancelling the question cancels
  the branches that have not finished, and cancelling one branch does not touch
  the others. A branch that already finished is left alone -- it did the work
  and its output is evidence, whatever happened to the question afterwards.
*/
create or replace function app.cancel_group(p_group uuid, p_why text default 'the question was withdrawn')
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare v_stopped integer := 0; v_job uuid;
begin
  for v_job in
    select j.job_id from public.job_branches br
      join public.jobs j on j.job_id = br.job_id
     where br.group_id = p_group
       and j.state::text not in ('complete', 'failed', 'cancelled', 'committing',
                                 'committed', 'notifying')
    union
    select g.synthesis_job_id from public.branch_groups g
     where g.group_id = p_group and g.synthesis_job_id is not null
       and (select state::text from public.jobs where job_id = g.synthesis_job_id)
             not in ('complete', 'failed', 'cancelled', 'committing', 'committed', 'notifying')
  loop
    begin
      update public.jobs set state = 'cancelled', state_reason = left(p_why, 500)
       where job_id = v_job;
      v_stopped := v_stopped + 1;
    exception when others then
      -- A state that refuses cancellation is a job mid-commit. Leave it.
      null;
    end;
  end loop;
  return jsonb_build_object('ok', true, 'stopped', v_stopped);
end;
$function$;

create or replace function public.fan_in_ready(p_group uuid)
returns jsonb language sql security definer set search_path to ''
as $function$ select app.fan_in_ready(p_group) $function$;

/*
  Cancelling the question cancels the branches, by trigger.

  The Issue asks that parent cancellation stop eligible child work safely, and
  the alternative to a trigger is remembering to call something from every
  place a job can be cancelled -- which is the studio, the worker, a suite and
  whatever comes next. `check:callers` caught `cancel_group` with nothing
  naming it, which is exactly the shape of that mistake before it happens.

  It cannot recurse: only a PARENT owns a group, and the children this cancels
  own none, so each of their updates fires the trigger once and stops.

  It fires only on the transition INTO cancelled, so an already-cancelled job
  being touched does not re-sweep.
*/
create or replace function app.cancelling_a_question_cancels_its_branches()
returns trigger language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
begin
  if new.state = 'cancelled' and old.state <> 'cancelled'
     and exists (select 1 from public.branch_groups where parent_job_id = new.job_id) then
    perform app.cancel_group(
      (select group_id from public.branch_groups where parent_job_id = new.job_id),
      coalesce(nullif(btrim(coalesce(new.state_reason, '')), ''), 'the question was withdrawn'));
  end if;
  return new;
end;
$function$;

drop trigger if exists jobs_cancel_cascades_to_branches on public.jobs;
create trigger jobs_cancel_cascades_to_branches
  after update of state on public.jobs
  for each row execute function app.cancelling_a_question_cancels_its_branches();
