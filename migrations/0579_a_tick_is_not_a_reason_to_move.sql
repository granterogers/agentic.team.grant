-- Ticking a to-do moved it, and the page had nothing to hold it still with.
--
-- WHAT GRANT SAW. Tick a task in the miniature; the row leaves the place it
-- was in. `app.studio_tasks` orders by state first -- doing, blocked, todo,
-- then everything else -- so completing a task sends it to the END of its
-- list, and with the module folded to six rows it simply vanishes and every
-- row below it slides up. §7: "Completion should update visual state, update
-- canonical backend state, update counts -- but retain the task's position."
--
-- WHY THE FIX IS A COLUMN AND NOT A NEW ORDER HERE. The page cannot hold a row
-- still without something stable to sort by, and the payload had nothing: an
-- id is a uuid, which CLAUDE.md already records as a coin flip wearing an
-- ORDER BY, and `due_on` is null on half of them. `created_at` is the order
-- Grant put them in, it is already on the table, and it cannot move when a
-- state does.
--
-- The ordering in this function is deliberately UNTOUCHED. It is what the
-- other readers of this payload already expect, and a sort is cheap to apply
-- twice while a changed contract is not. The page sorts for itself, once, in
-- the to-dos domain, so the miniature and the expanded list cannot disagree.

create or replace function app.studio_tasks(p_project_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
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
           'parent', tk.parent_task_id,
           -- When it joined the project. The one key here that a tick cannot
           -- move, which is the whole reason it is here: it is what lets the
           -- page keep a completed row where Grant left it.
           'created', tk.created_at,
           -- Grant's own, on the project it belongs to (#259). Marked
           -- rather than hidden: the project is where he decides, and a
           -- list that mixes his errands with the team's work without
           -- saying which is which is the same defect as showing them twice.
           'mine', tk.assigned_to_human,
           'labels', to_jsonb(tk.labels)
         ) order by
           case tk.state when 'doing' then 0 when 'blocked' then 1
                         when 'todo' then 2 else 3 end,
           tk.due_on nulls last), '[]'::jsonb)
    from public.tasks tk
    left join public.staff st on st.staff_id = tk.assignee_staff
   where tk.project_id = p_project_id and not app.harness_task(tk.is_fixture, tk.job_id)
$function$;

comment on function app.studio_tasks(uuid) is
  'A project''s tasks for the studio. Carries created_at as "created" so a '
  'surface can order by something a tick cannot move (#7).';
