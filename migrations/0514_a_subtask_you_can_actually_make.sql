/*
  0514 — a subtask you can actually make (#259).

  `tasks.parent_task_id` has existed since #11 and `app.my_tasks` reports a
  `children` count for every row, so the studio can already say "3 left" on a
  parent. Nothing could ever create one: neither `my_task_add` nor
  `my_task_set` takes a parent, so no door a person has could set the column.
  A relationship the reader renders and no writer can make is the same defect
  as a dial with no reader, read from the other end.

  ## One level, and that is a decision rather than a shortcut

  A parent may not itself have a parent. Three reasons, in the order they
  matter:

  1. **The delete cascade.** `tasks_parent_task_id_fkey` is ON DELETE CASCADE,
     and 0513's `my_task_delete` counts the children it is about to take and
     says so. With arbitrary depth that count is a lie unless it recurses, and
     a number that is wrong about how much is about to disappear is worse than
     no number.
  2. **The phone.** A list with nesting deeper than one level is unreadable at
     390px, and #278 has just finished proving what happens when a screen is
     asked to show more than it can.
  3. **Providers.** Vikunja supports one level of related "subtask" cleanly and
     other providers vary; a domain that allows more than every provider can
     represent forces a lossy mapping later, which is exactly what #259's
     "unsupported external fields must never cause internal information to be
     discarded" is about.

  Refused with a sentence rather than by a constraint, so the person is told
  what to do instead.

  ## And it has to be MINE

  A personal subtask of the team's own work would put a canonical task on both
  sides of the boundary #259's second invariant draws. The parent must be a
  personal task, and so must the child.
*/

/*
  The old signature goes FIRST.

  `create or replace function` does not replace a function whose argument list
  changed — it creates a second overload, and the very next call is
  "function app.my_task_add(unknown) is not unique". CLAUDE.md records this
  and records that the PUBLIC wrapper is the half people forget, so both are
  named here by their exact identity arguments.
*/
drop function if exists public.my_task_add(text, text, date, timestamptz, integer, text, text[]);
drop function if exists app.my_task_add(text, text, date, timestamptz, integer, text, text[]);

-- ---------------------------------------------------------------------------
-- The shared rule, so two writers cannot disagree about it
-- ---------------------------------------------------------------------------

create or replace function app.task_parent_ok(p_parent uuid, p_child uuid default null)
returns text
language sql
stable
security definer
set search_path = ''
as $fn$
  /*
    Returns null when the parent is usable, and the sentence to refuse with
    otherwise. One function because `my_task_add` and `my_task_set` both need
    it, and CLAUDE.md records what two writers checking the same field
    separately costs — 0282/0293, and then a third instance with nothing
    loosened at all.
  */
  select case
    when p_parent is null then null
    when not exists (select 1 from public.tasks t where t.task_id = p_parent)
      then 'no task by that id to put this under'
    when not exists (select 1 from public.tasks t
                      where t.task_id = p_parent and t.assigned_to_human)
      then 'that is the team''s own work, not one of your tasks'
    when p_child is not null and p_parent = p_child
      then 'a task cannot be its own subtask'
    when exists (select 1 from public.tasks t
                  where t.task_id = p_parent and t.parent_task_id is not null)
      then 'that is already a subtask, and subtasks do not nest'
    when p_child is not null and exists (select 1 from public.tasks c
                                          where c.parent_task_id = p_child)
      then 'that task has subtasks of its own, so it cannot become one'
    else null
  end
$fn$;

grant execute on function app.task_parent_ok(uuid, uuid) to ai_team_app, service_role;

-- ---------------------------------------------------------------------------
-- Creating one
-- ---------------------------------------------------------------------------

create or replace function app.my_task_add(
  p_title text,
  p_detail text default '',
  p_due_on date default null,
  p_remind_at timestamptz default null,
  p_priority integer default 100,
  p_project text default null,
  p_labels text[] default null,
  p_parent text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_title text := btrim(coalesce(p_title, ''));
  v_project uuid;
  v_id uuid;
  v_parent uuid;
  v_why text;
begin
  if v_title = '' then
    return jsonb_build_object('ok', false, 'error', 'a task needs a title');
  end if;

  if coalesce(p_parent, '') <> '' then
    begin
      v_parent := p_parent::uuid;
    exception when others then
      return jsonb_build_object('ok', false, 'error', 'that is not a task id to put this under');
    end;
    v_why := app.task_parent_ok(v_parent);
    if v_why is not null then
      return jsonb_build_object('ok', false, 'error', v_why);
    end if;
  end if;

  if coalesce(p_project, '') <> '' then
    select project_id into v_project from public.projects
     where slug = p_project and status <> 'archived';
    if v_project is null then
      -- Named, rather than silently filed with no project: a task that quietly
      -- lands in the inbox when Grant said which project it belongs to is a
      -- task he will look for in the wrong place.
      return jsonb_build_object('ok', false,
        'error', format('no active project called %s', p_project));
    end if;
  elsif v_parent is not null then
    /*
      A subtask inherits its parent's project unless told otherwise. Without
      this a subtask of a project task lands in the Inbox, away from the
      parent it belongs to, which is how a relationship becomes a filing
      error.
    */
    select t.project_id into v_project from public.tasks t where t.task_id = v_parent;
  end if;

  insert into public.tasks
    (project_id, title, detail, state, priority, due_on, remind_at,
     assigned_to_human, added_by, labels, parent_task_id)
  values (v_project, v_title, coalesce(p_detail, ''), 'todo',
          greatest(coalesce(p_priority, 100), 1), p_due_on, p_remind_at,
          true, 'grant',
          coalesce((select array(select distinct lower(btrim(x))
                                   from unnest(p_labels) x
                                  where btrim(x) <> '' order by 1)), '{}'::text[]),
          v_parent)
  returning task_id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'title', v_title,
    'project', coalesce(p_project, ''), 'parent', v_parent);
end;
$function$;

create or replace function public.my_task_add(
  p_title text,
  p_detail text default '',
  p_due_on date default null,
  p_remind_at timestamptz default null,
  p_priority integer default 100,
  p_project text default null,
  p_labels text[] default null,
  p_parent text default null)
returns jsonb
language sql volatile security definer
set search_path to 'public', 'pg_catalog'
as $fn$
  select app.my_task_add(p_title, p_detail, p_due_on, p_remind_at, p_priority,
                         p_project, p_labels, p_parent)
$fn$;

grant execute on function app.my_task_add(text, text, date, timestamptz, integer, text, text[], text)
  to ai_team_app, service_role;
grant execute on function public.my_task_add(text, text, date, timestamptz, integer, text, text[], text)
  to service_role;

-- ---------------------------------------------------------------------------
-- Moving one under, or out from under, another
-- ---------------------------------------------------------------------------

create or replace function app.my_task_reparent(p_task_id text, p_parent text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_id uuid;
  v_parent uuid;
  v_why text;
begin
  begin
    v_id := p_task_id::uuid;
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'that is not a task id');
  end;
  if not exists (select 1 from public.tasks t
                  where t.task_id = v_id and t.assigned_to_human) then
    return jsonb_build_object('ok', false, 'error', 'no personal task by that id');
  end if;

  if coalesce(p_parent, '') <> '' then
    begin
      v_parent := p_parent::uuid;
    exception when others then
      return jsonb_build_object('ok', false, 'error', 'that is not a task id to put this under');
    end;
    v_why := app.task_parent_ok(v_parent, v_id);
    if v_why is not null then
      return jsonb_build_object('ok', false, 'error', v_why);
    end if;
  end if;

  update public.tasks set parent_task_id = v_parent where task_id = v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'parent', v_parent);
end
$fn$;

create or replace function public.my_task_reparent(p_task_id text, p_parent text default null)
returns jsonb
language sql volatile security definer
set search_path to 'public', 'pg_catalog'
as $fn$ select app.my_task_reparent(p_task_id, p_parent) $fn$;

grant execute on function app.my_task_reparent(text, text) to ai_team_app, service_role;
grant execute on function public.my_task_reparent(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Drive every branch, including the four refusals.
-- ---------------------------------------------------------------------------

do $drive$
declare
  v_parent uuid;
  v_child  uuid;
  v_other  uuid;
  v_theirs uuid;
  v_out    jsonb;
begin
  v_out := app.my_task_add('Subtask probe 0514 parent');
  v_parent := (v_out ->> 'id')::uuid;

  v_out := app.my_task_add('Subtask probe 0514 child', p_parent => v_parent::text);
  if coalesce((v_out ->> 'ok')::boolean, false) is not true then
    raise exception '0514: a subtask was refused: %', v_out;
  end if;
  v_child := (v_out ->> 'id')::uuid;
  if (select parent_task_id from public.tasks where task_id = v_child) <> v_parent then
    raise exception '0514: the parent was accepted and not stored';
  end if;

  -- The reader already counts children; prove it sees this one.
  if (select (e ->> 'children')::int
        from jsonb_array_elements(app.my_tasks('all', 200, 'Subtask probe 0514 parent')) e
       limit 1) <> 1 then
    raise exception '0514: the parent does not report its child';
  end if;

  -- REFUSAL: subtasks do not nest.
  v_out := app.my_task_add('Subtask probe 0514 grandchild', p_parent => v_child::text);
  if coalesce((v_out ->> 'ok')::boolean, true) is not false
     or position('do not nest' in coalesce(v_out ->> 'error', '')) = 0 then
    raise exception '0514: a subtask of a subtask was allowed: %', v_out;
  end if;

  -- REFUSAL: a task cannot be its own subtask.
  v_out := app.my_task_reparent(v_parent::text, v_parent::text);
  if coalesce((v_out ->> 'ok')::boolean, true) is not false
     or position('its own subtask' in coalesce(v_out ->> 'error', '')) = 0 then
    raise exception '0514: a task became its own subtask: %', v_out;
  end if;

  -- REFUSAL: a task with children cannot become one.
  v_out := app.my_task_add('Subtask probe 0514 other');
  v_other := (v_out ->> 'id')::uuid;
  v_out := app.my_task_reparent(v_parent::text, v_other::text);
  if coalesce((v_out ->> 'ok')::boolean, true) is not false
     or position('subtasks of its own' in coalesce(v_out ->> 'error', '')) = 0 then
    raise exception '0514: a parent was demoted under another task: %', v_out;
  end if;

  -- REFUSAL: the boundary. The team's own work is not a parent for my task.
  insert into public.tasks (title, assigned_to_human, added_by, state)
  values ('Subtask probe 0514 theirs', false, 'migration', 'todo') returning task_id into v_theirs;
  v_out := app.my_task_add('Subtask probe 0514 across', p_parent => v_theirs::text);
  if coalesce((v_out ->> 'ok')::boolean, true) is not false
     or position('team' in coalesce(v_out ->> 'error', '')) = 0 then
    raise exception '0514: a personal subtask was hung off the team''s work: %', v_out;
  end if;

  -- CONTROL: taking a subtask back out works, and is the way out of a mistake.
  v_out := app.my_task_reparent(v_child::text, null);
  if coalesce((v_out ->> 'ok')::boolean, false) is not true
     or (select parent_task_id from public.tasks where task_id = v_child) is not null then
    raise exception 'CONTROL FAILED: a subtask could not be taken back out: %', v_out;
  end if;

  delete from public.tasks where title like 'Subtask probe 0514%';
  raise notice '0514: subtasks create, inherit, refuse four ways, and come back out';
end
$drive$;
