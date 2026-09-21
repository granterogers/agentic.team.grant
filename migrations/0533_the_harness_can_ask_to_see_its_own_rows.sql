/*
  0533 — the harness can ask to see its own rows, and only the harness

  0530 taught app.my_tasks to hide a task whose job is a harness job. That is
  right, and it immediately made one of verify:mytasks' own subjects
  unobservable: the suite raises a blocker, the blocker makes a task, the task
  carries the suite's job, and the check asserting it reaches My Tasks with
  `for_job` set went red against a product that is behaving correctly.

  #45's rule is that a suite testing something which FILTERS harness traffic
  must use a real subject. Here it cannot: the subject is made by the suite's
  own job, and giving that job a real-looking requester would be manufacturing
  exactly the debris 0531 swept.

  So the reader gains the parameter, the way app.impediments_tally did (0297)
  for the same reason. Three properties make it safe:

    * it defaults to false, so every existing caller is unchanged;
    * the PUBLIC wrapper does not take it and is re-created here unchanged, so
      nothing with a browser can ask for harness rows -- PostgREST is the only
      thing that can reach a wrapper;
    * the suite asserts BOTH directions, which is the point. With the flag the
      row is there with for_job set; without it, it is gone. A reader
      parameter with only the positive check would be an untested filter.

  The wrapper is re-created because the app function's argument list changed,
  and `create or replace` then leaves two overloads and an ambiguous call --
  the error 0530 hit an hour ago.
*/

drop function if exists app.my_tasks(text, integer, text, text);

CREATE OR REPLACE FUNCTION app.my_tasks(p_bucket text DEFAULT 'today'::text, p_limit integer DEFAULT 200, p_query text DEFAULT NULL::text, p_sort text DEFAULT 'smart'::text, p_include_harness boolean DEFAULT false)
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
       and (p_include_harness or not app.harness_task(t.is_fixture, t.job_id))
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

create or replace function public.my_tasks(
  p_bucket text default 'today'::text, p_limit integer default 200,
  p_query text default null::text, p_sort text default 'smart'::text)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$ select app.my_tasks(p_bucket, p_limit, p_query, p_sort) $$;

comment on function app.my_tasks(text, integer, text, text, boolean) is
  'Grant''s personal list. p_include_harness is for the harness only and is not exposed publicly (0533).';
