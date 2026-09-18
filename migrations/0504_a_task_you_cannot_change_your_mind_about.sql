/*
  The rest of CRUD, plus finding one (#259).

  #259 asks for "search/filter/sort" and for priority, notes and due dates as
  first-class parts of a personal task. Most of that existed and could not be
  reached:

  - `app.my_task_add` already takes `p_detail`, `p_priority`, `p_project` and
    `p_labels`. The quick-add sends three of seven.
  - `app.my_tasks` already RETURNS `detail`, `priority` and `parent`.
  - `app.my_task_set` takes labels, reminder and repeat, and **nothing else**.

  So a task's title, its notes, its priority, its due date and its project were
  write-once: set at creation and unchangeable for ever. That is not a missing
  feature so much as a missing letter — the U of CRUD, half absent, on the one
  screen in the product whose whole job is that you change your mind.

  Nothing here invents a noun. ADR-0041 settled that a Personal Task is a
  `tasks` row; these are the columns that row has had all along.

  ## Two parameters on the reader, not a second reader

  `p_query` and `p_sort`. A search is not a bucket — you want to find a thing
  whether it is due today or was done last month — so it narrows whichever
  bucket you are in rather than replacing the buckets, and the natural place to
  search from is All.

  ## Dropped before replaced

  Both functions gain parameters, and `create or replace` does not replace a
  function whose argument list changed — it creates a second overload and every
  call becomes ambiguous. CLAUDE.md records it; the public wrapper is the half
  that silently keeps the old signature, so both are dropped by exact
  signature and both are rewritten.
*/

drop function if exists public.my_tasks(text, integer);
drop function if exists app.my_tasks(text, integer);

create or replace function app.my_tasks(
  p_bucket text default 'today',
  p_limit integer default 200,
  p_query text default null,
  p_sort text default 'smart')
returns jsonb
language sql
stable security definer
set search_path to ''
as $fn$
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
       and not coalesce(t.is_fixture, false)
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
           'done_at', k.done_at
         )), '[]'::jsonb)
    from picked k
$fn$;

create or replace function public.my_tasks(
  p_bucket text default 'today',
  p_limit integer default 200,
  p_query text default null,
  p_sort text default 'smart')
returns jsonb
language sql
stable security definer
set search_path to 'public', 'pg_catalog'
as $fn$ select app.my_tasks(p_bucket, p_limit, p_query, p_sort) $fn$;

grant execute on function app.my_tasks(text, integer, text, text) to service_role;
grant execute on function public.my_tasks(text, integer, text, text) to service_role;

/* ------------------------------------------------------ changing your mind */

drop function if exists public.my_task_set(text, text[], timestamptz, interval, text, text[]);
drop function if exists app.my_task_set(text, text[], timestamptz, interval, text, text[]);

create or replace function app.my_task_set(
  p_task_id text,
  p_labels text[] default null,
  p_remind_at timestamptz default null,
  p_repeat_every interval default null,
  p_repeat_from text default null,
  p_clear text[] default '{}'::text[],
  p_title text default null,
  p_detail text default null,
  p_priority integer default null,
  p_due_on date default null,
  p_project text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_id uuid;
  v_clear text[] := coalesce(p_clear, '{}'::text[]);
  v_project uuid;
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
begin
  begin
    v_id := p_task_id::uuid;
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'that is not a task id');
  end;
  if not exists (select 1 from public.tasks where task_id = v_id) then
    return jsonb_build_object('ok', false, 'error', 'no task by that id');
  end if;
  if p_repeat_from is not null and p_repeat_from not in ('due', 'done') then
    return jsonb_build_object('ok', false,
      'error', 'a repeat runs from its due date or from when it was last done');
  end if;
  /*
    A title may be CHANGED and may not be emptied.

    `tasks.title` is not null, and an update that silently kept the old title
    when the box was cleared would look like the save failing. Said instead.
  */
  if p_title is not null and v_title is null then
    return jsonb_build_object('ok', false, 'error', 'a task needs a title');
  end if;
  /*
    The vocabulary `my_task_add` already uses, read rather than invented.

    `tasks.priority` is an integer where LOWER is more important and 100 is the
    default; the rows in the table today are 20 and 100. A first draft of this
    validated 1..5, which is a different scale with the same name -- 0311 spent
    a migration undoing two words for one thing, and this would have been two
    meanings for one column. `my_task_add` floors at 1 and so does this.
  */
  if p_priority is not null and p_priority < 1 then
    return jsonb_build_object('ok', false,
      'error', 'priority is a number from 1 upwards, where 1 is the most important');
  end if;

  /*
    The project is named by SLUG, the way `my_task_add` takes it and the way
    Grant's vocabulary works -- a uuid is not something anybody types. An
    unknown slug is refused by name rather than silently leaving the task where
    it was, which is 0350's delete that matched nothing and reported success.
  */
  if p_project is not null and btrim(p_project) <> '' then
    select project_id into v_project from public.projects
     where slug = lower(btrim(p_project)) and status = 'active';
    if v_project is null then
      return jsonb_build_object('ok', false,
        'error', format('there is no active project called %s', btrim(p_project)));
    end if;
  end if;

  update public.tasks set
    title = coalesce(v_title, title),
    /*
      `tasks.detail` is NOT NULL with a default of '', so clearing it is '' and
      not null. CLAUDE.md records the cost of the same column's shape once
      already: a sentinel satisfies the constraint and makes every `coalesce`
      against it dead code.
    */
    detail = case when 'detail' = any (v_clear) then ''
                  else coalesce(nullif(btrim(coalesce(p_detail, '')), ''), detail) end,
    priority = coalesce(p_priority, priority),
    due_on = case when 'due_on' = any (v_clear) then null
                  else coalesce(p_due_on, due_on) end,
    project_id = case when 'project' = any (v_clear) then null
                      else coalesce(v_project, project_id) end,
    labels = case
               when 'labels' = any (v_clear) then '{}'::text[]
               when p_labels is null then labels
               else (select array(select distinct lower(btrim(x)) from unnest(p_labels) x
                                   where btrim(x) <> '' order by 1))
             end,
    remind_at = case when 'remind_at' = any (v_clear) then null
                     else coalesce(p_remind_at, remind_at) end,
    repeat_every = case when 'repeat' = any (v_clear) then null
                        else coalesce(p_repeat_every, repeat_every) end,
    repeat_from = case when 'repeat' = any (v_clear) then null
                       when p_repeat_every is not null then coalesce(p_repeat_from, 'due')
                       else coalesce(p_repeat_from, repeat_from) end,
    updated_at = app.now_utc()
   where task_id = v_id;

  return (select jsonb_build_object('ok', true, 'id', v_id,
            'title', t.title,
            'detail', t.detail,
            'priority', t.priority,
            'due_on', t.due_on,
            'project', (select slug from public.projects where project_id = t.project_id),
            'labels', to_jsonb(t.labels),
            'remind_at', t.remind_at,
            'repeats', case when t.repeat_every is null then null
                       else jsonb_build_object('every', t.repeat_every::text,
                                               'from', t.repeat_from) end)
            from public.tasks t where t.task_id = v_id);
end;
$fn$;

create or replace function public.my_task_set(
  p_task_id text,
  p_labels text[] default null,
  p_remind_at timestamptz default null,
  p_repeat_every interval default null,
  p_repeat_from text default null,
  p_clear text[] default '{}'::text[],
  p_title text default null,
  p_detail text default null,
  p_priority integer default null,
  p_due_on date default null,
  p_project text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
begin
  return app.my_task_set(p_task_id, p_labels, p_remind_at, p_repeat_every,
                         p_repeat_from, p_clear, p_title, p_detail,
                         p_priority, p_due_on, p_project);
end;
$fn$;

grant execute on function app.my_task_set(
  text, text[], timestamptz, interval, text, text[], text, text, integer, date, text)
  to service_role;
grant execute on function public.my_task_set(
  text, text[], timestamptz, interval, text, text[], text, text, integer, date, text)
  to service_role;

/*
  Driven here rather than only in the suite, because a migration that applies
  cleanly is not a function that works -- 0390 declared a function that could
  not work for four independent reasons, none visible from reading it.
*/
do $drive$
declare v_id uuid; v_r jsonb;
begin
  /*
    `added_by`, not `requested_by`, and `todo`, not `open`. Both guessed in the
    first draft and both refused on the first run -- the column-name trap,
    which one `information_schema` query settles and reading does not.
  */
  insert into public.tasks (title, assigned_to_human, added_by, state)
  values ('0504 proof', true, 'grant', 'todo')
  returning task_id into v_id;

  v_r := app.my_task_set(v_id::text, p_title => 'Renamed by 0504',
                         p_detail => 'Some notes.', p_priority => 20,
                         p_due_on => '2026-12-01'::date);
  if coalesce((v_r ->> 'ok')::boolean, false) is not true
     or v_r ->> 'title' <> 'Renamed by 0504'
     or (v_r ->> 'priority')::int <> 20 then
    raise exception 'my_task_set did not change what it claims to: %', v_r;
  end if;

  v_r := app.my_task_set(v_id::text, p_priority => 0);
  if coalesce((v_r ->> 'ok')::boolean, true) is not false then
    raise exception 'an impossible priority was accepted';
  end if;
  -- CONTROL: the floor must not be refusing every priority.
  v_r := app.my_task_set(v_id::text, p_priority => 20);
  if coalesce((v_r ->> 'ok')::boolean, false) is not true
     or (v_r ->> 'priority')::int <> 20 then
    raise exception 'CONTROL FAILED: a legitimate priority was refused: %', v_r;
  end if;

  v_r := app.my_task_set(v_id::text, p_project => 'no-such-project-0504');
  if coalesce((v_r ->> 'ok')::boolean, true) is not false then
    raise exception 'an unknown project was accepted silently';
  end if;

  if jsonb_array_length(app.my_tasks('all', 200, 'Renamed by 0504')) < 1 then
    raise exception 'the search cannot find a task by its title';
  end if;
  if jsonb_array_length(app.my_tasks('all', 200, 'zzz-nothing-matches-this')) <> 0 then
    raise exception 'CONTROL FAILED: the search matches something it should not';
  end if;

  delete from public.tasks where task_id = v_id;
end
$drive$;
