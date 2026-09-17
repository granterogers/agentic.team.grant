-- The task row carries what an editor needs (#106).
--
-- `app.studio_tasks` returns a task as the page DRAWS it: `due` is already
-- formatted as "Due 1 October" and `state` is collapsed to one of four display
-- words. That is right for a list and useless for a form -- a date input cannot
-- take "Due 1 October", and an editor that has to parse a rendered string back
-- into a date is a bug waiting for a locale.
--
-- So the row also carries the raw values, under names that cannot be confused
-- with the rendered ones: `due_on` beside `due`, `state_raw` beside `state`.
-- Both, not instead: every existing reader keeps working and the editor gets
-- what it needs without a second fetch per task.
--
-- `parent` and `milestone` come too, because subtasks and milestones are what
-- the columns were for and nothing has ever been able to see them.

CREATE OR REPLACE FUNCTION app.studio_tasks(p_project_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', tk.task_id,
           'title', tk.title,
           'note', tk.detail,
           'who', st.slug,
           'state', case
             when tk.state = 'done' then 'done'
             when tk.state = 'doing' then 'doing'
             when tk.due_on is not null
              and tk.due_on <= (app.now_utc() at time zone app.grant_timezone())::date + 7
               then 'due' else null end,
           'due', case when tk.due_on is null then null
                       else format('Due %s', to_char(tk.due_on, 'FMDD FMMonth')) end,
           'blocked', tk.blocked_on,

           -- The raw half, for the editor. Named so it cannot be mistaken for
           -- the rendered half sitting next to it.
           'state_raw', tk.state,
           'due_on', tk.due_on,
           'starts_on', tk.starts_on,
           'priority', tk.priority,
           'milestone', tk.is_milestone,
           'parent', tk.parent_task_id
         ) order by
           case tk.state when 'doing' then 0 when 'blocked' then 1
                         when 'todo' then 2 else 3 end,
           tk.due_on nulls last), '[]'::jsonb)
    from public.tasks tk
    left join public.staff st on st.staff_id = tk.assignee_staff
   where tk.project_id = p_project_id and not tk.is_fixture
$function$;
