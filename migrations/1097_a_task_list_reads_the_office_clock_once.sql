begin;

-- app.studio_tasks looked up the office's time zone for every task (a lateral subquery in the join), and that lookup
-- costs about 50 ms each time. A project's tasks share one office, so the zone is read once and joined to every row.
-- On the slowest office the list was 2.6 s, and the zone lookup was almost all of it. The rows and their order are the
-- same; checked against the function it replaces for every project of two offices. It replaces app.studio_tasks only.
-- Not applied until approved.

create or replace function app.studio_tasks(p_project_id uuid)
  returns jsonb
  language sql
  stable security definer
  set search_path to ''
as $function$
  with harness as materialized (
    select distinct tk.job_id from public.tasks tk where tk.project_id = p_project_id and tk.job_id is not null
  ), judged as materialized (
    select h.job_id, app.harness_job(h.job_id) as is_harness from harness h
  ), zone as materialized (
    -- The zone of the office that owns the project: the same clock my_tasks reads (1027). Read once.
    select app.office_timezone((select p.office_id from public.projects p where p.project_id = p_project_id)) as tz
  )
  select coalesce(jsonb_agg(jsonb_build_object(
            'id', tk.task_id,
            'title', tk.title,
            'note', tk.detail,
            'who', st.slug,
            'state', case
              when tk.state = 'done' then 'done'
              when tk.state = 'doing' then 'doing'
              when tk.due_on is not null
               and tk.due_on <= (app.now_utc() at time zone z.tz)::date + 7
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
    left join judged j on j.job_id = tk.job_id
    cross join zone z
   -- The same test as app.harness_task(is_fixture, job_id), with the job's answer taken from judged.
   where tk.project_id = p_project_id
     and not coalesce(tk.is_fixture, false)
     and not coalesce(j.is_harness, false)
$function$;

commit;
