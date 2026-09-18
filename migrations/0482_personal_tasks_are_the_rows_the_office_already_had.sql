/*
  0482 — personal tasks are the rows the office already had (#259, ADR-0041).

  #259 asks for a first-class Personal Tasks system and opens by telling
  whoever builds it to audit what exists and avoid a competing abstraction.
  The audit is in ADR-0041 and the answer is that `public.tasks` already
  carries almost all of it — including `assigned_to_human`, which is exactly
  the distinction the Issue's second invariant turns on, and which has NEVER
  been true for a single row and is read by nothing in the repository.

  So this adds the four things that were genuinely missing, and the readers and
  writers that make the column mean something.

  ## What is added to the table

  | column | why |
  |---|---|
  | `labels` | the Issue's labels/categories. An array, not a join table: `contact_labels` exists because a contact label is a curated object with a colour Grant edits, and a task label is a word. |
  | `remind_at` | a reminder is a TIME, and `due_on` is a DATE. "Remind me Friday at nine" cannot be said in a date column, and rounding it to a day is how a reminder becomes a thing nobody trusts. |
  | `repeat_every` | recurrence, as an interval. |
  | `repeat_from` | and the half that matters: `due` repeats a weekly review every Monday whatever happens; `done` repeats "water the plants" three days after you last did it. Getting this wrong makes a recurring task either nag or drift, and every task app that only has one is wrong for half its users. |

  ## And the buckets

  `app.my_tasks(bucket)` answers the seven views #259 names. They are a CASE in
  one function rather than seven functions, because they are seven filters over
  one list and seven functions is seven places for the `assigned_to_human`
  filter to be forgotten — which is the one failure ADR-0041 names as
  asymmetric: a missing personal task is an annoyance, and the office's own
  work in Grant's list is what stops him trusting the list.
*/

-- ---------------------------------------------------------------------------
-- The four columns
-- ---------------------------------------------------------------------------

alter table public.tasks
  add column if not exists labels text[] not null default '{}',
  add column if not exists remind_at timestamptz,
  add column if not exists repeat_every interval,
  add column if not exists repeat_from text;

do $c$
begin
  if not exists (select 1 from pg_constraint where conname = 'tasks_repeat_is_complete') then
    alter table public.tasks add constraint tasks_repeat_is_complete
      check (
        (repeat_every is null and repeat_from is null)
        or (repeat_every is not null and repeat_from in ('due', 'done'))
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tasks_repeat_needs_an_anchor') then
    -- A task that repeats FROM its due date has to have one. Without this the
    -- next occurrence is computed from null and the task quietly stops
    -- recurring, which is indistinguishable from a feature nobody built.
    alter table public.tasks add constraint tasks_repeat_needs_an_anchor
      check (repeat_from is distinct from 'due' or due_on is not null);
  end if;
end $c$;

comment on column public.tasks.labels is
  'Words Grant sorts by (#259). Lower-cased and de-duplicated by app.my_task_set.';
comment on column public.tasks.remind_at is
  'When to say something. A TIME, because due_on is a date and a reminder is not.';
comment on column public.tasks.repeat_from is
  'due = the schedule is fixed; done = the interval starts when it was last finished.';

create index if not exists tasks_mine_due on public.tasks (due_on)
  where assigned_to_human and state <> 'done';
create index if not exists tasks_mine_remind on public.tasks (remind_at)
  where assigned_to_human and remind_at is not null and state <> 'done';

-- ---------------------------------------------------------------------------
-- The reader
-- ---------------------------------------------------------------------------

create or replace function app.my_tasks(p_bucket text default 'today', p_limit integer default 200)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  with mine as (
    select t.*,
           p.name as project_name,
           p.slug as project_slug
      from public.tasks t
      left join public.projects p on p.project_id = t.project_id
     /*
       THE BOUNDARY, in one place.

       ADR-0041: one table means one filter to get wrong, and the failure is
       asymmetric — the office's own work appearing in Grant's personal list is
       what stops him trusting the list. Every bucket below filters this CTE,
       so there is exactly one place this can be forgotten.
     */
     where t.assigned_to_human
       and not coalesce(t.is_fixture, false)
  ), picked as (
    select * from mine m
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
       -- Overdue first, then by date, then by priority. A list ordered by
       -- priority alone buries a thing due today under an important thing due
       -- next month, which is the complaint every task app eventually gets.
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
           'overdue', k.state <> 'done' and k.due_on is not null
                      and k.due_on < (app.now_utc() at time zone 'UTC')::date,
           'done_at', k.done_at
         )), '[]'::jsonb)
    from picked k
$function$;

create or replace function public.my_tasks(p_bucket text default 'today', p_limit integer default 200)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$ select app.my_tasks(p_bucket, p_limit) $function$;

/*
  How many are in each bucket, in ONE round trip.

  The page draws seven tabs and every one of them wants a count. Seven calls to
  `my_tasks` to count seven lists is seven HTTPS round trips to the Management
  API (ADR-0007), which is most of a pass's latency — and CLAUDE.md records a
  setup that was six seconds of a twenty-second empty pass for exactly this
  reason.
*/
create or replace function app.my_tasks_counts()
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  with mine as (
    select t.* from public.tasks t
     where t.assigned_to_human and not coalesce(t.is_fixture, false)
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
$function$;

create or replace function public.my_tasks_counts()
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$ select app.my_tasks_counts() $function$;

-- ---------------------------------------------------------------------------
-- The writers
-- ---------------------------------------------------------------------------

/*
  Adding one.

  Separate from `app.task_add` rather than a flag on it, because the two have
  different required arguments: a project task needs a project and a personal
  task must NOT need one — an inbox is the pile with no project, and #259's
  whole first bucket depends on that being representable.

  Named arguments are the rule above about four (CLAUDE.md: a function with
  eight arguments will be called with seven), and this has seven.
*/
create or replace function app.my_task_add(
  p_title text,
  p_detail text default '',
  p_due_on date default null,
  p_remind_at timestamptz default null,
  p_priority integer default 100,
  p_project text default null,
  p_labels text[] default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare v_title text := btrim(coalesce(p_title, '')); v_project uuid; v_id uuid;
begin
  if v_title = '' then
    return jsonb_build_object('ok', false, 'error', 'a task needs a title');
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
  end if;

  insert into public.tasks
    (project_id, title, detail, state, priority, due_on, remind_at,
     assigned_to_human, added_by, labels)
  values (v_project, v_title, coalesce(p_detail, ''), 'todo',
          greatest(coalesce(p_priority, 100), 1), p_due_on, p_remind_at,
          true, 'grant',
          coalesce((select array(select distinct lower(btrim(x))
                                   from unnest(p_labels) x
                                  where btrim(x) <> '' order by 1)), '{}'::text[]))
  returning task_id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'title', v_title,
    'project', coalesce(p_project, ''));
end;
$function$;

create or replace function public.my_task_add(
  p_title text, p_detail text default '', p_due_on date default null,
  p_remind_at timestamptz default null, p_priority integer default 100,
  p_project text default null, p_labels text[] default null
) returns jsonb
language sql
security definer
set search_path to ''
as $function$
  select app.my_task_add(p_title, p_detail, p_due_on, p_remind_at, p_priority,
                         p_project, p_labels)
$function$;

/*
  The fields the existing writers do not know about.

  NOT three more arguments on `app.hq_task_update`, which already takes ten.
  This one is narrow and every argument is optional, with null meaning "leave
  it": clearing a reminder goes through `p_clear` so that "do not change it"
  and "remove it" are different requests, which is the same shape
  `hq_task_update` already uses and for the same reason.
*/
create or replace function app.my_task_set(
  p_task_id text,
  p_labels text[] default null,
  p_remind_at timestamptz default null,
  p_repeat_every interval default null,
  p_repeat_from text default null,
  p_clear text[] default '{}'
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare v_id uuid; v_clear text[] := coalesce(p_clear, '{}'::text[]);
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

  update public.tasks set
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
            'labels', to_jsonb(labels),
            'remind_at', remind_at,
            'repeats', case when repeat_every is null then null
                       else jsonb_build_object('every', repeat_every::text,
                                               'from', repeat_from) end)
            from public.tasks where task_id = v_id);
end;
$function$;

create or replace function public.my_task_set(
  p_task_id text, p_labels text[] default null, p_remind_at timestamptz default null,
  p_repeat_every interval default null, p_repeat_from text default null,
  p_clear text[] default '{}'
) returns jsonb
language sql
security definer
set search_path to ''
as $function$
  select app.my_task_set(p_task_id, p_labels, p_remind_at, p_repeat_every,
                         p_repeat_from, p_clear)
$function$;

-- ---------------------------------------------------------------------------
-- Recurrence happens on completion
-- ---------------------------------------------------------------------------

/*
  A repeating task that is finished leaves a done row and makes the next one.

  A trigger rather than a step in a writer, because `hq_task_state` is not the
  only thing that can finish a task — the human-action bridge and, later, an
  inbound Vikunja completion both do — and CLAUDE.md records what it costs when
  two doors write one field and only one of them does the bookkeeping (0472,
  the tick box that granted a tool and told nobody).

  The done row is KEPT rather than rolled forward. "Did I do it last week" is a
  question a recurring task has to be able to answer, and a single row whose
  date moves cannot.
*/
create or replace function app.tasks_repeat_on_done()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare v_due date; v_remind timestamptz;
begin
  if new.state <> 'done' or coalesce(old.state, '') = 'done' then return new; end if;
  if new.repeat_every is null then return new; end if;

  -- `due` keeps the schedule; `done` starts the clock again now. Both from the
  -- anchor the row already has, so a task finished late does not silently
  -- reschedule itself into the past.
  v_due := case
             when new.repeat_from = 'done'
               then ((app.now_utc() + new.repeat_every) at time zone 'UTC')::date
             else new.due_on + new.repeat_every
           end;
  -- A schedule that has fallen behind catches up rather than creating a
  -- backlog of one occurrence per missed period.
  while v_due < (app.now_utc() at time zone 'UTC')::date loop
    v_due := v_due + new.repeat_every;
  end loop;

  v_remind := case
                when new.remind_at is null or new.due_on is null then null
                -- `date - date` is an INTEGER of days, and timestamptz plus
                -- integer is not an operator. The reminder keeps its distance
                -- from the due date, so it has to be days as an interval.
                else new.remind_at + ((v_due - new.due_on) * interval '1 day')
              end;

  insert into public.tasks
    (project_id, title, detail, state, priority, due_on, remind_at,
     assigned_to_human, added_by, labels, repeat_every, repeat_from, parent_task_id)
  values (new.project_id, new.title, new.detail, 'todo', new.priority, v_due, v_remind,
          new.assigned_to_human, new.added_by, new.labels,
          new.repeat_every, new.repeat_from, new.parent_task_id);

  -- The finished one stops repeating, or every completion makes another.
  update public.tasks set repeat_every = null, repeat_from = null
   where task_id = new.task_id;
  return new;
end;
$function$;

drop trigger if exists tasks_repeat_on_done on public.tasks;
create trigger tasks_repeat_on_done
  after update of state on public.tasks
  for each row execute function app.tasks_repeat_on_done();

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.my_tasks(text, integer) from public;
revoke all on function public.my_tasks_counts() from public;
revoke all on function public.my_task_add(text, text, date, timestamptz, integer, text, text[]) from public;
revoke all on function public.my_task_set(text, text[], timestamptz, interval, text, text[]) from public;
grant execute on function public.my_tasks(text, integer) to service_role;
grant execute on function public.my_tasks_counts() to service_role;
grant execute on function public.my_task_add(text, text, date, timestamptz, integer, text, text[]) to service_role;
grant execute on function public.my_task_set(text, text[], timestamptz, interval, text, text[]) to service_role;

-- ---------------------------------------------------------------------------
-- Drive it. A migration that applies cleanly is not a function that works, and
-- 0390 shipped four defects in one feature by not doing this.
-- ---------------------------------------------------------------------------

do $drive$
declare
  v_add jsonb; v_set jsonb; v_id uuid; v_next int; v_counts jsonb;
begin
  v_add := app.my_task_add(
    p_title => 'Drive check 0482',
    p_detail => 'Removed inside this migration',
    p_due_on => (app.now_utc() at time zone 'UTC')::date - 1,
    p_priority => 10);
  if coalesce(v_add ->> 'ok', 'false') <> 'true' then
    raise exception '0482: could not add a personal task — %', v_add;
  end if;
  v_id := (v_add ->> 'id')::uuid;

  if not exists (select 1 from jsonb_array_elements(app.my_tasks('overdue', 500)) e
                  where (e ->> 'id')::uuid = v_id) then
    raise exception '0482: an overdue personal task is not in the overdue bucket';
  end if;
  if exists (select 1 from jsonb_array_elements(app.my_tasks('upcoming', 500)) e
              where (e ->> 'id')::uuid = v_id) then
    raise exception '0482: an overdue task is also reported as upcoming';
  end if;

  v_counts := app.my_tasks_counts();
  if (v_counts ->> 'overdue')::int < 1 then
    raise exception '0482: the counts disagree with the list';
  end if;

  v_set := app.my_task_set(v_id::text, array['Errand', 'errand', '  '],
                           null, '7 days'::interval, 'due');
  if coalesce(v_set ->> 'ok', 'false') <> 'true' then
    raise exception '0482: could not set the new fields — %', v_set;
  end if;
  if v_set -> 'labels' <> '["errand"]'::jsonb then
    raise exception '0482: labels are not lower-cased and de-duplicated — %', v_set -> 'labels';
  end if;

  -- And the recurrence, which is the one behaviour a reading cannot confirm.
  update public.tasks set state = 'done', done_at = app.now_utc() where task_id = v_id;
  select count(*) into v_next from public.tasks
   where title = 'Drive check 0482' and state = 'todo';
  if v_next <> 1 then
    raise exception '0482: finishing a repeating task made % follow-ups, not 1', v_next;
  end if;
  if exists (select 1 from public.tasks
              where task_id = v_id and repeat_every is not null) then
    raise exception '0482: the finished occurrence still repeats';
  end if;

  raise notice '0482: add, buckets, counts, labels and recurrence all drove clean';
  delete from public.tasks where title = 'Drive check 0482';
end $drive$;
