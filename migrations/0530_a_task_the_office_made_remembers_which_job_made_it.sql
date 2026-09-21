/*
  0530 — a task the office made remembers which job made it

  Nineteen tasks reading "Review what came out of zelmirath9vjm8c5b" and
  "Reconcile the velkanth3fd7tsss register" were sitting on Grant's personal
  list, plus two called "draft.create — report outdated items". Every one of
  them was written by a verification suite.

  THE WITNESS COULD NOT SEE THEM. public.tasks.is_fixture is GENERATED from
  added_by, and app.my_task_add hardcodes added_by = 'grant' -- correctly, for
  a personal task -- so a task the harness created through the real product
  path is indistinguishable from one Grant typed. check:leaks has counted
  "fixture tasks" since it was written and reported 0 the whole time. This is
  the fifth table to prove that a debris class with no witness comes back, and
  the sixth instance of a generated column being unable to see what only its
  job knows (0342, 0351, 0355).

  A LIST WITH THE OFFICE'S TEST TRAFFIC ON IT IS A LIST GRANT STOPS TRUSTING,
  which ADR-0041 names as the asymmetric failure of one shared table.

  The fix is not a longer pattern of names. Enumerating the shapes a suite's
  title can take is the mistake with more words, and the next suite picks a
  noun nobody listed. What actually distinguishes them is provenance, and the
  office already has the answer: the JOB. So:

    1. app.my_task_add gains p_job, and the office passes the job it is
       running. A personal task Grant types still carries no job, because the
       public wrapper does not take one and must not -- a browser may not
       claim to be a job.
    2. app.harness_task(is_fixture, job_id) DERIVES the answer the way 0355
       derives it for jobs, rather than storing a copy that 0303/0304 exist to
       warn against.
    3. The four readers Grant looks at ask it. One predicate, four callers --
       ADR-0041's whole argument is that this boundary lives in one place.

  The columns are passed rather than the task id so the predicate costs
  nothing per row: it is a where-clause expression, not a lookup.

  A SECOND THING FALLS OUT OF IT, and it is the reason to do this in the
  column rather than in check:leaks. app.undo_tasks_from_job keys on job_id,
  so until now a personal task the office created could not be undone: the
  reversal had nothing to match. Recording the job is what makes "take that
  back" possible at all.

  The sweep at the end removes the twenty-one that are already there. The two
  from blockers are derivable and would be hidden by the predicate anyway;
  they are removed rather than hidden, because a blocker task is also a
  blocker, and nineteen of them predate the job column entirely and can only
  be swept by hand, once, with their ids recorded here.
*/

/*
  DROP FIRST. `create or replace` does not replace a function whose argument
  list changed -- it creates a second overload, and the public wrapper's call
  then cannot choose between them. CLAUDE.md records this; the first attempt at
  this migration hit it anyway, and was refused with "is not unique" naming the
  wrapper's line rather than this one.
*/
drop function if exists app.my_task_add(text, text, date, timestamptz, integer, text, text[], text);

CREATE OR REPLACE FUNCTION app.my_task_add(p_title text, p_detail text DEFAULT ''::text, p_due_on date DEFAULT NULL::date, p_remind_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_priority integer DEFAULT 100, p_project text DEFAULT NULL::text, p_labels text[] DEFAULT NULL::text[], p_parent text DEFAULT NULL::text, p_job uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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
     assigned_to_human, added_by, labels, parent_task_id, job_id)
  values (v_project, v_title, coalesce(p_detail, ''), 'todo',
          greatest(coalesce(p_priority, 100), 1), p_due_on, p_remind_at,
          true, 'grant',
          coalesce((select array(select distinct lower(btrim(x))
                                   from unnest(p_labels) x
                                  where btrim(x) <> '' order by 1)), '{}'::text[]),
          v_parent, p_job)
  returning task_id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'title', v_title,
    'project', coalesce(p_project, ''), 'parent', v_parent);
end;
$function$
;


/*
  The public wrapper is re-created verbatim and DELIBERATELY unchanged: eight
  arguments, no job. PostgREST is the only thing that can reach it, so a value
  it accepted would be a job id chosen by a browser. Re-created because the
  app function was replaced with a different argument list, and an overload is
  how a call becomes ambiguous (CLAUDE.md, twice).
*/
create or replace function public.my_task_add(
  p_title text, p_detail text default ''::text, p_due_on date default null::date,
  p_remind_at timestamptz default null::timestamptz, p_priority integer default 100,
  p_project text default null::text, p_labels text[] default null::text[],
  p_parent text default null::text)
returns jsonb
language sql
security definer
set search_path to 'public', 'pg_catalog'
as $$
  select app.my_task_add(p_title, p_detail, p_due_on, p_remind_at, p_priority,
                         p_project, p_labels, p_parent)
$$;

/*
  Derived, never stored. The asymmetry that makes it safe is 0304's: a witness
  that can only ever EXCLUDE cannot hide a genuine task. is_fixture true means
  harness; a harness job means harness; anything else is Grant's.
*/
create or replace function app.harness_task(p_is_fixture boolean, p_job uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  select coalesce(p_is_fixture, false)
      or (p_job is not null and app.harness_job(p_job))
$$;

comment on function app.harness_task(boolean, uuid) is
  'Is this task harness traffic? Derived from the row flag and the job that made it (0530).';

CREATE OR REPLACE FUNCTION app.my_tasks(p_bucket text DEFAULT 'today'::text, p_limit integer DEFAULT 200, p_query text DEFAULT NULL::text, p_sort text DEFAULT 'smart'::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with mine as (
    select t.*,
           p.name as project_name,
           p.slug as project_slug
      from public.tasks t
      left join public.projects p on p.project_id = t.project_id
     /*
       THE BOUNDARY, in one place.

       ADR-0041: one table means one filter to get wrong, and the failure is
       asymmetric -- the office's own work appearing in Grant's personal list
       is what stops him trusting the list. Every bucket below filters this
       CTE, so there is exactly one place this can be forgotten.
     */
     where t.assigned_to_human
       and not app.harness_task(t.is_fixture, t.job_id)
  ), matched as (
    /*
      The search NARROWS a bucket rather than replacing it.

      A task app where typing in the box throws away "overdue" is one where you
      cannot answer "what am I late on about the pricing". It reads the title,
      the notes and the labels -- the three places a person would look -- and
      an empty box changes nothing, so the behaviour with no search is exactly
      what it was before this migration.
    */
    select * from mine m
     where coalesce(btrim(p_query), '') = ''
        or position(lower(btrim(p_query)) in lower(coalesce(m.title, ''))) > 0
        or position(lower(btrim(p_query)) in lower(coalesce(m.detail, ''))) > 0
        or exists (select 1 from unnest(coalesce(m.labels, '{}'::text[])) l
                    where position(lower(btrim(p_query)) in lower(l)) > 0)
  ), picked as (
    select * from matched m
     where case lower(coalesce(p_bucket, 'today'))
       -- Nothing scheduled and no project: the pile you have not sorted yet.
       when 'inbox' then m.state <> 'done' and m.due_on is null and m.project_id is null
       when 'today' then m.state <> 'done'
            and (m.due_on <= (app.now_utc() at time zone 'UTC')::date
                 or m.remind_at <= app.now_utc())
       when 'upcoming' then m.state <> 'done'
            and m.due_on > (app.now_utc() at time zone 'UTC')::date
       when 'overdue' then m.state <> 'done'
            and m.due_on < (app.now_utc() at time zone 'UTC')::date
       when 'unscheduled' then m.state <> 'done' and m.due_on is null
       when 'done' then m.state = 'done'
       when 'all' then true
       else m.state <> 'done'
     end
     order by
       /*
         `smart` is the default and is what this reader has always done:
         overdue first, then by date, then by priority. A list ordered by
         priority alone buries a thing due today under an important thing due
         next month, which is the complaint every task app eventually gets --
         so priority-first is OFFERED and is not the default.

         An unrecognised sort falls to `smart` rather than erroring. A list
         that refuses to render because a query string was wrong is worse than
         one that renders in the order it always did.
       */
       case when lower(coalesce(p_sort, 'smart')) = 'priority' then m.priority end nulls last,
       case when lower(coalesce(p_sort, 'smart')) = 'title' then lower(m.title) end nulls last,
       case when lower(coalesce(p_sort, 'smart')) = 'created' then m.created_at end desc nulls last,
       (m.due_on is null),
       m.due_on,
       m.priority,
       m.created_at
     limit greatest(coalesce(p_limit, 200), 1)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', k.task_id,
           'title', k.title,
           'detail', k.detail,
           'state', k.state,
           'priority', k.priority,
           'due_on', k.due_on,
           'starts_on', k.starts_on,
           'remind_at', k.remind_at,
           'labels', to_jsonb(k.labels),
           'repeats', case when k.repeat_every is null then null
                      else jsonb_build_object('every', k.repeat_every::text,
                                              'from', k.repeat_from) end,
           'project', case when k.project_id is null then null
                      else jsonb_build_object('slug', k.project_slug, 'name', k.project_name) end,
           -- What the office is waiting on, if this exists because a job is
           -- blocked (#259's human-action bridge).
           'for_job', k.job_id,
           'parent', k.parent_task_id,
           -- How many open children this task has, so a parent can say so
           -- rather than a subtask being a relationship nothing renders.
           'children', (select count(*) from public.tasks c
                         where c.parent_task_id = k.task_id and c.state <> 'done'),
           'overdue', k.state <> 'done' and k.due_on is not null
                      and k.due_on < (app.now_utc() at time zone 'UTC')::date,
           /*
             0515. The children themselves, not only how many. One level,
             because 0514 refuses to nest further, and capped so a parent
             with fifty is a project rather than a payload.
           */
           'subtasks', (select coalesce(jsonb_agg(jsonb_build_object(
                             'id', c.task_id, 'title', c.title,
                             'state', c.state,
                             'done', c.state = 'done',
                             'due_on', c.due_on)
                             order by (c.state = 'done'), c.due_on nulls last,
                                      c.priority, c.created_at), '[]'::jsonb)
                         from public.tasks c
                        where c.parent_task_id = k.task_id
                        limit 20),
           'done_at', k.done_at
         )), '[]'::jsonb)
    from picked k
$function$
;

CREATE OR REPLACE FUNCTION app.my_tasks_counts()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with mine as (
    select t.* from public.tasks t
     where t.assigned_to_human and not app.harness_task(t.is_fixture, t.job_id)
  ), today as (select (app.now_utc() at time zone 'UTC')::date as d)
  select jsonb_build_object(
    'inbox', (select count(*) from mine m where m.state <> 'done'
               and m.due_on is null and m.project_id is null),
    'today', (select count(*) from mine m, today
               where m.state <> 'done'
                 and (m.due_on <= today.d or m.remind_at <= app.now_utc())),
    'upcoming', (select count(*) from mine m, today
                  where m.state <> 'done' and m.due_on > today.d),
    'overdue', (select count(*) from mine m, today
                 where m.state <> 'done' and m.due_on < today.d),
    'unscheduled', (select count(*) from mine m where m.state <> 'done' and m.due_on is null),
    'done', (select count(*) from mine m where m.state = 'done'),
    'all', (select count(*) from mine m)
  )
$function$
;

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
           'parent', tk.parent_task_id,
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
$function$
;

CREATE OR REPLACE FUNCTION app.my_task_recent(p_within interval DEFAULT '00:30:00'::interval)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case when t.task_id is null then null else jsonb_build_object(
           'id', t.task_id,
           'title', t.title,
           'due_on', t.due_on,
           'priority', t.priority,
           'created_at', t.created_at) end
    from (
      select *
        from public.tasks
       where assigned_to_human
         and state not in ('done', 'cancelled')
         and not app.harness_task(is_fixture, job_id)
         and created_at >= app.now_utc() - p_within
       /*
         `seq`, then the clock. The sequence is assigned at INSERT so it is
         correct even inside one statement; `created_at` is kept as the second
         key only so a row that predates the column still sorts sensibly.
       */
       order by seq desc nulls last, created_at desc
       limit 1
    ) t
$function$
;
