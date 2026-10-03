-- The team could not see a project's tasks, so it answered "I don't see any" about a project full of them (#408).
--
-- Documents were retrieved per project and the person's own to-do list was read when the question was about it; the
-- project's TASKS were read by nothing at all. A model asked "what travel tasks are overdue" had no tasks in front of
-- it and said so, truthfully. `app.my_tasks` is the wrong reader for this on purpose: it is the person's personal list
-- (`assigned_to_human`) across every project, and an agent working on a project needs the project's work, whoever it
-- is assigned to.
--
-- This is that reader. One office, one project, bounded, ordered by what a person would ask about first (stuck, then
-- late, then soonest, then undated, then recently done), and compact: a title, a state, a date, who has it. It never
-- takes "every project": the caller names one and the project must be the asking office's.
--
-- The answer is a count PLUS a bounded list, because a list on its own cannot support "there are 31 open" and a count
-- on its own cannot support "the venue deposit is due Friday". `shown` says how much of the list was cut, so a model
-- that is handed 40 of 61 is told it was handed 40 of 61.

begin;

create or replace function app.project_work_brief(
  p_office uuid,
  p_project uuid,
  p_limit integer default 40,
  p_include_harness boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_office uuid := app.require_office(p_office);
  v_name text;
  v_today date := (app.now_utc() at time zone 'UTC')::date;
  v_limit integer := greatest(1, least(coalesce(p_limit, 40), 80));
  v_counts jsonb;
  v_rows jsonb;
begin
  select p.name into v_name
    from public.projects p
   where p.project_id = p_project and p.office_id = v_office;
  if not found then
    -- Not an oracle: another office's project and a project that does not exist answer the same way.
    return null;
  end if;

  with t as (
    select tk.*
      from public.tasks tk
     where tk.office_id = v_office
       and tk.project_id = p_project
       and tk.state <> 'cancelled'
       and (p_include_harness or not app.harness_task(tk.is_fixture, tk.job_id))
  )
  select jsonb_build_object(
           'open', count(*) filter (where state not in ('done')),
           'done', count(*) filter (where state = 'done'),
           'overdue', count(*) filter (where state not in ('done') and due_on < v_today),
           'blocked', count(*) filter (where state = 'blocked'),
           'total', count(*))
    into v_counts
    from t;

  with t as (
    select tk.*
      from public.tasks tk
     where tk.office_id = v_office
       and tk.project_id = p_project
       and tk.state <> 'cancelled'
       and (p_include_harness or not app.harness_task(tk.is_fixture, tk.job_id))
  ), ranked as (
    select t.*,
           row_number() over (
             order by (t.state = 'done'),
                      (t.state = 'blocked') desc,
                      (t.due_on < v_today) desc nulls last,
                      t.due_on nulls last,
                      case when t.state = 'done' then t.done_at end desc nulls last,
                      t.priority, t.seq) as ord
      from t
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'title', r.title,
           'state', r.state,
           'due_on', r.due_on,
           'starts_on', r.starts_on,
           'late', (r.state <> 'done' and r.due_on < v_today),
           'who', case when r.assigned_to_human then 'you'
                       else (select s.name from public.staff s where s.staff_id = r.assignee_staff) end,
           'milestone', r.is_milestone,
           'under', (select pt.title from public.tasks pt
                      where pt.task_id = r.parent_task_id and pt.office_id = v_office),
           'labels', to_jsonb(r.labels),
           'blocked_on', r.blocked_on,
           'note', nullif(left(r.detail, 160), '')
         ) order by r.ord), '[]'::jsonb)
    into v_rows
    from ranked r
   where r.ord <= v_limit;

  return jsonb_build_object(
    'project_id', p_project,
    'name', v_name,
    'today', v_today,
    'counts', v_counts,
    'shown', jsonb_array_length(v_rows),
    'tasks', v_rows);
end;
$$;

revoke all on function app.project_work_brief(uuid, uuid, integer, boolean) from public, anon, authenticated;

commit;
