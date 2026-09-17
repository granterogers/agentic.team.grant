-- A task can be edited (#106).
--
-- #11 gave `public.tasks` a write path -- create, and move between the five
-- states. That was enough to be useful and it was not the whole of what the
-- table already supported. Renaming a task, moving its date, handing it to
-- somebody, making it a subtask, marking it a milestone: every column was
-- there and nothing could reach any of them.
--
-- ## Null means "leave it", and `p_clear` means "take it away"
--
-- The same shape as `hq_project_look` (0253) and for the same reason: one
-- argument cannot mean both. Removing a due date is a normal edit -- it is what
-- "this is not happening this week after all" looks like -- and without
-- `p_clear` there is no way to say it.
--
-- ## What it refuses, and why each refusal exists
--
-- - **An unknown assignee slug.** `assignee_staff` is a UUID and the interface
--   holds slugs; `hq_task_add` already resolves that and refuses an unknown
--   one rather than silently leaving the task unassigned. Doing it differently
--   here would be two answers to one question.
-- - **A parent that is the task itself, or one of its own descendants.** A
--   cycle in `parent_task_id` is not caught by the foreign key and makes every
--   recursive read hang. Checked with a recursive walk rather than a
--   single-level comparison, because A->B->A needs two steps to see.
-- - **A parent in another dashboard project.** Subtasks belong to the same
--   piece of work; a cross-project parent is a tree that cannot be drawn.
-- - **Changing `state` here.** `hq_task_state` owns that, because it also
--   maintains `done_at` and enforces the reason a blocked task needs. Two
--   functions writing one column is how the constraint gets violated by the
--   one that forgot.
--
-- ## It moves the diary
--
-- `app.calendar_task_plan()` hashes title, date, detail and project, so an edit
-- to any of them correctly produces an `update` rather than a create. That path
-- had only ever been exercised by unit tests. Nothing here needs to know: the
-- plan is computed from the table.

CREATE OR REPLACE FUNCTION app.hq_task_update(
  p_task_id     text,
  p_title       text default null,
  p_detail      text default null,
  p_due_on      date default null,
  p_starts_on   date default null,
  p_assignee    text default null,
  p_parent      text default null,
  p_milestone   boolean default null,
  p_priority    int default null,
  p_clear       text[] default array[]::text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_id      uuid;
  v_project uuid;
  v_staff   uuid;
  v_parent  uuid;
  v_title   text;
  v         jsonb;
begin
  begin
    v_id := p_task_id::uuid;
  exception when others then
    return jsonb_build_object('error', format('%L is not a task id', p_task_id));
  end;

  select project_id into v_project from public.tasks where task_id = v_id;
  if v_project is null then
    return jsonb_build_object('error', 'no task with that id');
  end if;

  if p_title is not null then
    v_title := btrim(p_title);
    if v_title = '' then
      return jsonb_build_object('error', 'a task needs a title -- rename it to something, or leave it');
    end if;
  end if;

  if coalesce(btrim(p_assignee), '') <> '' then
    select staff_id into v_staff from public.staff where slug = btrim(p_assignee);
    if v_staff is null then
      return jsonb_build_object('error', format('nobody here is called %L', btrim(p_assignee)));
    end if;
  end if;

  if coalesce(btrim(p_parent), '') <> '' then
    begin
      v_parent := btrim(p_parent)::uuid;
    exception when others then
      return jsonb_build_object('error', format('%L is not a task id', p_parent));
    end;
    if v_parent = v_id then
      return jsonb_build_object('error', 'a task cannot be its own parent');
    end if;
    if not exists (select 1 from public.tasks where task_id = v_parent
                    and project_id = v_project) then
      return jsonb_build_object('error',
        'that parent is not a task on the same dashboard project');
    end if;
    -- The cycle. A -> B -> A is invisible to a single-level comparison, so
    -- walk the proposed parent's own ancestry and refuse if this task is in it.
    if exists (
      with recursive up as (
        select task_id, parent_task_id from public.tasks where task_id = v_parent
        union all
        select t.task_id, t.parent_task_id
          from public.tasks t join up on t.task_id = up.parent_task_id
      )
      select 1 from up where task_id = v_id
    ) then
      return jsonb_build_object('error',
        'that would make a loop -- the task you picked is already under this one');
    end if;
  end if;

  update public.tasks
     set title             = coalesce(v_title, title),
         detail            = case when 'detail' = any(p_clear) then ''
                                  else coalesce(btrim(p_detail), detail) end,
         due_on            = case when 'due_on' = any(p_clear) then null
                                  else coalesce(p_due_on, due_on) end,
         starts_on         = case when 'starts_on' = any(p_clear) then null
                                  else coalesce(p_starts_on, starts_on) end,
         assignee_staff    = case when 'assignee' = any(p_clear) then null
                                  else coalesce(v_staff, assignee_staff) end,
         parent_task_id    = case when 'parent' = any(p_clear) then null
                                  else coalesce(v_parent, parent_task_id) end,
         is_milestone      = coalesce(p_milestone, is_milestone),
         priority          = coalesce(p_priority, priority),
         updated_at        = app.now_utc()
   where task_id = v_id;

  select jsonb_build_object(
           'id', t.task_id, 'title', t.title, 'detail', t.detail,
           'state', t.state, 'due_on', t.due_on, 'starts_on', t.starts_on,
           'milestone', t.is_milestone, 'priority', t.priority,
           'parent', t.parent_task_id,
           'assignee', (select s.slug from public.staff s where s.staff_id = t.assignee_staff)
         )
    into v
    from public.tasks t where t.task_id = v_id;
  return v;
end;
$function$;

-- PostgREST only exposes `public`.
CREATE OR REPLACE FUNCTION public.hq_task_update(
  p_task_id text, p_title text default null, p_detail text default null,
  p_due_on date default null, p_starts_on date default null,
  p_assignee text default null, p_parent text default null,
  p_milestone boolean default null, p_priority int default null,
  p_clear text[] default array[]::text[]
)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
AS $function$ select app.hq_task_update(p_task_id, p_title, p_detail, p_due_on,
  p_starts_on, p_assignee, p_parent, p_milestone, p_priority, p_clear) $function$;

REVOKE ALL ON FUNCTION public.hq_task_update(text, text, text, date, date, text, text, boolean, int, text[]) FROM public;
GRANT EXECUTE ON FUNCTION public.hq_task_update(text, text, text, date, date, text, text, boolean, int, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION app.hq_task_update(text, text, text, date, date, text, text, boolean, int, text[]) TO service_role;
