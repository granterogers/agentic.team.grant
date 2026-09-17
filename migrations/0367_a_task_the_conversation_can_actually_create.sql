-- A task writer a JOB can call, and the slug writer on top of it.
--
-- Issue #237 / #234. Found by running a session rather than by reading code:
--
--   Grant: "Yes, do it. Create the task."
--   The office: "Sure, I'll create it. I need a few details first:
--                1. Title  2. Due date  3. Owner  4. Parent task (if any)"
--   public.tasks afterwards: EMPTY.
--
-- Three separate defects sit in that exchange, and this migration is the first
-- of them. `task.create` is in `tool_permissions`, ENABLED, granted to all
-- eight agents and described in every capability brief -- and there was no path
-- from a conversation to `app.hq_task_add` at all. The nine actions an agent
-- can request are all NotebookLM artefacts. It is the `web.search` defect of
-- 0298 with the sign flipped: the claim has a real function behind it and
-- nothing routes to it, so 0298's own check passes.
--
-- ## Why a second entry point rather than calling the existing one
--
-- `app.hq_task_add(p_project text, ...)` resolves a project by SLUG and
-- filters `not is_fixture`. Both are right for the door a PERSON types into:
-- a name that resolves to a harness project is a typo, not an instruction.
-- Neither is right for a job that already holds `jobs.project_id` -- it has
-- resolved the project already, and asking it to convert a uuid to a slug so
-- another function can convert it back is a round trip that can only lose.
--
-- It also makes the harness possible. CLAUDE.md's #45 rule: a suite testing
-- something that FILTERS fixtures cannot use fixture subjects, and a session
-- harness that used real projects would leave permanent debris in Grant's
-- project list -- twenty-five such projects already exist and can never be
-- deleted. A uuid-taking writer lets the proof use fixtures and lets the
-- slug-taking writer keep refusing them.
--
-- One implementation, two doors. The slug function becomes a thin resolver.

create or replace function app.task_add(
  p_project   uuid,
  p_title     text,
  p_detail    text default null,
  p_due_on    date default null,
  p_assignee  text default null,
  p_milestone boolean default false,
  p_added_by  text default 'grant',
  p_job       uuid default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_staff uuid;
  v_title text := btrim(coalesce(p_title, ''));
  v       jsonb;
begin
  if v_title = '' then
    return jsonb_build_object('error', 'a task needs a title');
  end if;

  if p_project is not null
     and not exists (select 1 from public.projects
                      where project_id = p_project
                        and coalesce(status, '') <> 'archived') then
    return jsonb_build_object('error', 'that project does not exist or is archived');
  end if;

  -- A module belongs to a project (#71, 0286): a milestone filed nowhere can
  -- never appear on any board, so it is refused rather than written and lost.
  if coalesce(p_milestone, false) and p_project is null then
    return jsonb_build_object('error',
      'a module belongs to a dashboard project - say which one');
  end if;

  -- `assignee_staff` is a uuid and every interface holds slugs. An unknown
  -- slug is refused rather than silently leaving the task unassigned: an
  -- assignment that quietly did not happen is worse than one that was rejected.
  if coalesce(btrim(p_assignee), '') <> '' then
    select staff_id into v_staff from public.staff where slug = btrim(p_assignee);
    if v_staff is null then
      return jsonb_build_object('error', format('nobody here is called %L', btrim(p_assignee)));
    end if;
  end if;

  insert into public.tasks
    (project_id, title, detail, due_on, assignee_staff, added_by, is_milestone, job_id)
  values (p_project, v_title, coalesce(btrim(p_detail), ''), p_due_on, v_staff,
          coalesce(nullif(btrim(p_added_by), ''), 'grant'),
          coalesce(p_milestone, false), p_job)
  returning jsonb_build_object(
    'id', task_id, 'title', title, 'state', state, 'due_on', due_on,
    'milestone', is_milestone,
    'project', (select p.slug from public.projects p where p.project_id = p_project)
  ) into v;

  return v;
end;
$fn$;

comment on function app.task_add(uuid, text, text, date, text, boolean, text, uuid) is
  'Create a task against a project already resolved to an id. The door a JOB uses; '
  'app.hq_task_add is the door a person types into and resolves a slug onto this.';

-- And the slug door, rewritten to resolve and delegate. Its two guards stay
-- exactly where they were: a name must not resolve to a fixture, and a name
-- that resolves to nothing is a typo rather than a task filed nowhere.
create or replace function app.hq_task_add(
  p_project   text,
  p_title     text,
  p_detail    text default null,
  p_due_on    date default null,
  p_assignee  text default null,
  p_milestone boolean default false
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_project uuid;
begin
  if coalesce(btrim(p_project), '') <> '' then
    select project_id into v_project
      from public.projects
     where slug = btrim(p_project)
       and coalesce(status, '') <> 'archived'
       and not is_fixture;
    if v_project is null then
      return jsonb_build_object('error', format('no dashboard project called %L', p_project));
    end if;
  end if;

  return app.task_add(v_project, p_title, p_detail, p_due_on, p_assignee, p_milestone);
end;
$fn$;

-- PostgREST only exposes `public`, so the job door needs a wrapper too -- the
-- handler reaches it over the Management API rather than through PostgREST,
-- but every other RPC in this schema has one and a missing wrapper is invisible
-- until something with a browser calls it.
create or replace function public.task_add(
  p_project   uuid,
  p_title     text,
  p_detail    text default null,
  p_due_on    date default null,
  p_assignee  text default null,
  p_milestone boolean default false,
  p_added_by  text default 'grant',
  p_job       uuid default null
) returns jsonb
language sql
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
  select app.task_add(p_project, p_title, p_detail, p_due_on, p_assignee,
                      p_milestone, p_added_by, p_job)
$fn$;

grant execute on function public.task_add(uuid, text, text, date, text, boolean, text, uuid)
  to service_role;
