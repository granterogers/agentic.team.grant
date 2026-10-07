-- 1027: one office clock for tasks and reminders; a repeating reminder survives its own completion; the personal editor
-- no longer edits the team's tasks (deep systems audit 6 October 2026: R1 / R3 / Z1 / T1).
--
-- What was true before this file (REPLICA-PROVEN by scripts/isolated/e2e-tasks.ts and scripts/isolated/tk-reminders.ts):
--
--   * Z1. The word "today" meant two things. app.studio_tasks bucketed "due soon" in app.grant_timezone() (one deployment
--     setting, Europe/Athens), while app.my_tasks, app.my_tasks_counts and app.reminders_due bucketed Today / Overdue in
--     UTC. For somebody in Athens that is about three hours a day of a task reading overdue (or not) on one screen and the
--     opposite on the next; for any second person it is wrong all day. public.offices already carries a per-office
--     `timezone` (0654, not null, default 'UTC', Grant's office seeded from grant.timezone), and nothing task-shaped read it.
--   * R3. app.tasks_repeat_on_done derived the next reminder as `remind_at + (new due - old due)` and was null whenever
--     due_on was null, so a recurring reminder that had only a reminder time lost it on its next occurrence. The arithmetic
--     was also on timestamptz in the session zone (UTC), so a daily 09:00 reminder in Athens drifted an hour across the
--     October change of clocks. Its "today" for catching up and for repeat-from-done was the UTC date.
--   * T1. app.my_task_set required only that the task existed in the office, so the personal editor could rename or
--     re-date the team's own task, although app.my_task_delete refuses the same row (ADR-0041: the two lists are separate).
--
-- What changes, and nothing else:
--
--   1. app.office_timezone(office) is the ONE reader of an office's zone: public.offices.timezone when it names a real zone,
--      otherwise UTC. A missing or invalid zone is UTC, never somebody else's zone. (The TypeScript readers ask this same
--      function; the operator's documented default of Europe/Athens lives in the operator office's own row.)
--   2. my_tasks, my_tasks_counts, reminders_due and studio_tasks ask it for "today". Same predicates, one clock. For the
--      operator's office (Athens) studio_tasks is unchanged; the other three move from UTC to Athens.
--   3. tasks_repeat_on_done computes the next occurrence in the office's wall clock: a task with a due date keeps its
--      distance from it, a reminder-only task advances remind_at by the repeat interval in local time (DST-correct), and a
--      schedule that has fallen behind catches up rather than producing a backlog. A zero or negative interval no longer
--      loops. Done-from-done starts the clock on the office's local day.
--   4. my_task_set refuses a task that is not on the person's own list, by name, and says why.
--
--   5. A reminder is marked reminded only when its delivery SENT (C3), re-said up to three times when the delivery
--      failed, and a reminder SERIES (a repeat with a reminder time and no due date) moves to its next occurrence in
--      place when it is delivered, without being ticked off. (Ticking it off ENDED it here; the owner reversed that on 7
--      October 2026 and 1034 replaces it: completing completes that time only, stopping the series is explicit.)
--      A repeating TASK (it has a due date)
--      is unchanged: ticking it off makes the next occurrence. See section 5 below. It reads app.job_delivery_state
--      from 1029 at run time (a function body is resolved when called, so the order of the two files does not matter,
--      and a database without 1029 makes app.reminders_settle raise, which the handler answers by marking as before).
--
-- Not done here, deliberately: month-based repeats.

begin;

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. the one reader of an office's zone
-- ---------------------------------------------------------------------------------------------------------------------

create function app.office_timezone(p_office uuid)
returns text
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce(
    (select o.timezone
       from public.offices o
      where o.office_id = p_office
        and exists (select 1 from pg_catalog.pg_timezone_names n where n.name = o.timezone)),
    'UTC')
$function$;

revoke all on function app.office_timezone(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. the readers that decide what "today" is
-- ---------------------------------------------------------------------------------------------------------------------

create or replace function app.studio_tasks(p_project_id uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path to ''
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
    -- The zone of the office that owns the project: the same clock my_tasks reads (1027).
    cross join lateral (
      select app.office_timezone((select p.office_id from public.projects p where p.project_id = p_project_id)) as tz
    ) z
   where tk.project_id = p_project_id and not app.harness_task(tk.is_fixture, tk.job_id)
$function$;

create or replace function app.my_tasks(p_office uuid, p_bucket text default 'today'::text, p_limit integer default 200, p_query text default null::text, p_sort text default 'smart'::text, p_include_harness boolean default false)
 returns jsonb
 language sql
 stable security definer
 set search_path to ''
as $function$
  with today as (
    -- The office's own calendar day (1027). It was UTC here and Athens in studio_tasks.
    select (app.now_utc() at time zone app.office_timezone(p_office))::date as d
  ), mine as (
    select t.*,
           p.name as project_name,
           p.slug as project_slug
      from public.tasks t
      left join public.projects p on p.project_id = t.project_id and p.office_id = p_office
     /*
       THE BOUNDARY, in one place.

       ADR-0041: one table means one filter to get wrong, and the failure is
       asymmetric -- the office's own work appearing in Grant's personal list
       is what stops him trusting the list. Every bucket below filters this
       CTE, so there is exactly one place this can be forgotten.
     */
     where t.office_id = app.require_office(p_office)
       and t.assigned_to_human
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
       when 'inbox' then m.state not in ('done', 'cancelled') and m.due_on is null and m.project_id is null
       when 'today' then m.state not in ('done', 'cancelled')
            and (m.due_on <= (select d from today)
                 or m.remind_at <= app.now_utc())
       when 'upcoming' then m.state not in ('done', 'cancelled')
            and m.due_on > (select d from today)
       when 'overdue' then m.state not in ('done', 'cancelled')
            and m.due_on < (select d from today)
       when 'unscheduled' then m.state not in ('done', 'cancelled') and m.due_on is null
       when 'done' then m.state = 'done'
       when 'all' then m.state <> 'cancelled'
       else m.state not in ('done', 'cancelled')
     end
     order by
       /*
         `smart` is the default and is what this reader has always done:
         overdue first, then by date, then by priority. A list ordered by
         priority alone buries a thing due today under an important thing due
         next month, which is the complaint every task app eventually gets --
         so priority-first is OFFERED and is not the default.

         An unrecognised sort falls to `smart` rather than erroring. A list that
         refuses to render because a query string was wrong is worse than
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
                         where c.office_id = p_office and c.parent_task_id = k.task_id and c.state <> 'done'),
           'overdue', k.state <> 'done' and k.due_on is not null
                      and k.due_on < (select d from today),
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
                        where c.office_id = p_office and c.parent_task_id = k.task_id
                        limit 20),
           'done_at', k.done_at
         )), '[]'::jsonb)
    from picked k
$function$;

create or replace function app.my_tasks_counts(p_office uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path to ''
as $function$
  with mine as (
    select t.* from public.tasks t
     where t.office_id = app.require_office(p_office) and t.assigned_to_human and not app.harness_task(t.is_fixture, t.job_id)
  ), today as (select (app.now_utc() at time zone app.office_timezone(p_office))::date as d)
  select jsonb_build_object(
    'inbox', (select count(*) from mine m where m.state not in ('done', 'cancelled')
               and m.due_on is null and m.project_id is null),
    'today', (select count(*) from mine m, today
               where m.state not in ('done', 'cancelled')
                 and (m.due_on <= today.d or m.remind_at <= app.now_utc())),
    'upcoming', (select count(*) from mine m, today
                  where m.state not in ('done', 'cancelled') and m.due_on > today.d),
    'overdue', (select count(*) from mine m, today
                 where m.state not in ('done', 'cancelled') and m.due_on < today.d),
    'unscheduled', (select count(*) from mine m where m.state not in ('done', 'cancelled') and m.due_on is null),
    'done', (select count(*) from mine m where m.state = 'done'),
    'all', (select count(*) from mine m where m.state <> 'cancelled')
  )
$function$;

create or replace function app.reminders_due(p_office uuid, p_grace interval default '14 days'::interval)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
begin
  perform app.require_office(p_office);
  return (
  /*
    `p_grace` is the floor, not the ceiling: a reminder whose time passed
    while the office was down should still arrive, and one from a fortnight
    ago should not -- by then the due date has done the work and a stale
    midnight ping is noise. Fourteen days is long enough to survive any
    outage this office has had and short enough that a backlog cannot
    announce itself as a wall of text.
  */
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.task_id,
           'title', t.title,
           'remind_at', t.remind_at,
           'due_on', t.due_on,
           'project', p.name,
           'overdue', t.due_on is not null
                      and t.due_on < (app.now_utc() at time zone app.office_timezone(p_office))::date
         ) order by t.remind_at), '[]'::jsonb)
    from public.tasks t
    left join public.projects p on p.project_id = t.project_id and p.office_id = p_office
   where t.office_id = p_office
     and t.assigned_to_human
     and t.state <> 'done'
     and t.state <> 'cancelled'
     /*
       0597: a HARNESS task is never reminded. is_fixture alone missed every
       personal task a harness job made, because app.my_task_add writes
       added_by 'grant' whoever asked; app.harness_task also reads the job.
     */
     and not app.harness_task(t.is_fixture, t.job_id)
     and t.remind_at is not null
     and t.reminded_at is null
     -- announced by a duty run whose delivery has not ended yet (1027): not announced a second time
     and t.remind_job_id is null
     and t.remind_at <= app.now_utc()
     -- A reminder SERIES is exempt from the floor (1027): after an outage longer than the grace it would otherwise
     -- never fire and never move on, and a series that has stopped for good is worse than one stale message.
     and (t.remind_at >= app.now_utc() - p_grace
          or (t.repeat_every is not null and t.due_on is null))
  );
end;
$function$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. the next occurrence of a repeating task, in the office's own wall clock
-- ---------------------------------------------------------------------------------------------------------------------

create or replace function app.tasks_repeat_on_done()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_tz text;
  v_today date;
  v_due date;
  v_remind timestamptz;
begin
  if new.state <> 'done' or coalesce(old.state, '') = 'done' then return new; end if;
  if new.repeat_every is null then return new; end if;
  -- A zero or negative interval would loop for ever below, and means nothing as a repeat.
  if new.repeat_every <= interval '0' then return new; end if;

  /*
    A REMINDER SERIES (a repeat with a reminder time and no due date) is advanced IN PLACE by
    app.reminder_finish when the reminder is delivered, and ticking it off ENDS it. If this trigger also made a next
    occurrence the same occurrence would advance twice (once in place, once as a new row). Only a task with a due date
    is a repeating TASK, and only that kind makes its next occurrence here.
  */
  if new.due_on is null and new.remind_at is not null then
    update public.tasks set repeat_every = null, repeat_from = null
     where task_id = new.task_id and office_id = new.office_id;
    return new;
  end if;

  v_tz := app.office_timezone(new.office_id);
  v_today := (app.now_utc() at time zone v_tz)::date;

  -- `due` keeps the schedule; `done` starts the clock again now. Both from the
  -- anchor the row already has, so a task finished late does not silently
  -- reschedule itself into the past. "Now" is the office's local day (1027).
  v_due := case
             when new.repeat_from = 'done'
               then (v_today + new.repeat_every)::date
             else (new.due_on + new.repeat_every)::date
           end;
  -- A schedule that has fallen behind catches up rather than creating a
  -- backlog of one occurrence per missed period.
  while v_due < v_today loop
    v_due := (v_due + new.repeat_every)::date;
  end loop;

  if new.remind_at is null then
    v_remind := null;
  else
    -- Here the task has a due date (a reminder with none was handled above). The reminder keeps its distance from
    -- the due date, measured on the office's wall clock so a 09:00 reminder is still 09:00 after the clocks change.
    -- (`date - date` is an integer of days.)
    v_remind := ((new.remind_at at time zone v_tz) + ((v_due - new.due_on) * interval '1 day')) at time zone v_tz;
  end if;

  insert into public.tasks
    (office_id, project_id, title, detail, state, priority, due_on, remind_at,
     assigned_to_human, added_by, labels, repeat_every, repeat_from, parent_task_id)
  values (new.office_id, new.project_id, new.title, new.detail, 'todo', new.priority, v_due, v_remind,
          new.assigned_to_human, new.added_by, new.labels,
          new.repeat_every, new.repeat_from, new.parent_task_id);

  -- The finished one stops repeating, or every completion makes another.
  update public.tasks set repeat_every = null, repeat_from = null
   where task_id = new.task_id and office_id = new.office_id;
  return new;
end;
$function$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. the personal editor edits the personal list
-- ---------------------------------------------------------------------------------------------------------------------

create or replace function app.my_task_set(p_office uuid, p_task_id text, p_labels text[] default null::text[], p_remind_at timestamp with time zone default null::timestamp with time zone, p_repeat_every interval default null::interval, p_repeat_from text default null::text, p_clear text[] default '{}'::text[], p_title text default null::text, p_detail text default null::text, p_priority integer default null::integer, p_due_on date default null::date, p_project text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_id uuid;
  v_clear text[] := coalesce(p_clear, '{}'::text[]);
  v_project uuid;
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
begin
  perform app.require_office(p_office);
  begin
    v_id := p_task_id::uuid;
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'that is not a task id');
  end;
  if not exists (select 1 from public.tasks where task_id = v_id and office_id = p_office) then
    return jsonb_build_object('ok', false, 'error', 'no task by that id');
  end if;
  /*
    1027 (T1). The same boundary my_task_delete keeps: the team's own work is
    not edited from the personal door (ADR-0041). Said by name, so a refusal
    for this reason cannot be mistaken for a missing task.
  */
  if not exists (select 1 from public.tasks
                  where task_id = v_id and office_id = p_office and assigned_to_human) then
    return jsonb_build_object('ok', false,
      'error', 'no personal task by that id — the team''s own work is not edited from here');
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
     where office_id = p_office and slug = lower(btrim(p_project)) and status = 'active';
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
    reminded_at = case when 'remind_at' = any (v_clear) or p_remind_at is not null then null else reminded_at end,
    -- A reminder set again is a new reminder: one that was in flight is forgotten, or the delivery of the OLD one
    -- would end the NEW time when it settled (1027, section 5).
    remind_job_id = case when 'remind_at' = any (v_clear) or p_remind_at is not null then null else remind_job_id end,
    remind_sends = case when 'remind_at' = any (v_clear) or p_remind_at is not null then 0 else remind_sends end,
    remind_at = case when 'remind_at' = any (v_clear) then null
                     else coalesce(p_remind_at, remind_at) end,
    repeat_every = case when 'repeat' = any (v_clear) then null
                        else coalesce(p_repeat_every, repeat_every) end,
    repeat_from = case when 'repeat' = any (v_clear) then null
                       when p_repeat_every is not null then coalesce(p_repeat_from, 'due')
                       else coalesce(p_repeat_from, repeat_from) end,
    updated_at = app.now_utc()
   where task_id = v_id and office_id = p_office;

  return (select jsonb_build_object('ok', true, 'id', v_id,
            'title', t.title,
            'detail', t.detail,
            'priority', t.priority,
            'due_on', t.due_on,
            'project', (select slug from public.projects where project_id = t.project_id and office_id = p_office),
            'labels', to_jsonb(t.labels),
            'remind_at', t.remind_at,
            'repeats', case when t.repeat_every is null then null
                       else jsonb_build_object('every', t.repeat_every::text,
                                               'from', t.repeat_from) end)
            from public.tasks t where t.task_id = v_id and t.office_id = p_office);
end;
$function$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. a reminder is marked reminded when it was DELIVERED, and a reminder SERIES keeps firing without being ticked off
-- ---------------------------------------------------------------------------------------------------------------------
--
-- Before: the tasks.remind handler set reminded_at in the same tick that composed the message (C3), so a reminder whose
-- delivery was refused by a gate, rate-limited or lost was marked as sent and never said again. And a repeating
-- reminder moved on only when somebody ticked it off, so "remind me every Monday to review my finances" fired once and
-- then stopped unless he ticked it.
--
-- Now, in two steps across two ticks, because delivery finishes after the job that announced:
--   announce  app.reminders_announced records WHICH duty job said it (remind_job_id) and counts the send.
--   settle    app.reminders_settle (the next tick, before it reads what is due) asks app.job_delivery_state (1029):
--               sent     -> app.reminder_finish: a one-off is marked reminded; a SERIES moves remind_at forward IN PLACE
--               failed   -> clear remind_job_id so it is due again and is said again, up to 3 sends; after the third the
--                           office stops (a one-off is marked reminded, a series moves on) and the delivery layer's own
--                           terminal `failed` row is what surfaces it (app.undelivered)
--               pending  -> wait; none -> pending while the job is live, failed once the job has ended
--
-- A REMINDER SERIES is a repeating task with remind_at and NO due_on. One row throughout: remind_at moves to the next
-- occurrence strictly after now on the office wall clock (DST-correct), reminded_at is cleared and the task stays open.
-- A long outage fires ONCE and moves past now (the loop is bounded), never a backlog. Ticking it off or deleting it ENDS
-- the series (the trigger above does not make a next occurrence for it). A task with a due date is a repeating TASK and
-- keeps its meaning: ticking it off makes the next occurrence.

alter table public.tasks add column if not exists remind_job_id uuid;
alter table public.tasks add column if not exists remind_sends integer not null default 0;
comment on column public.tasks.remind_job_id is
  'The tasks.remind duty job whose message announced this reminder while its delivery has not ended (1027). Null when nothing is in flight. app.reminders_settle reads app.job_delivery_state of it on a later tick.';
comment on column public.tasks.remind_sends is
  'How many times the current occurrence of this reminder has been announced (1027). Bounds the re-send of a reminder whose delivery failed; reset when the occurrence ends.';

-- The one place that ENDS an occurrence of a reminder: delivered, or given up on.
create function app.reminder_finish(p_task uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  t public.tasks%rowtype;
  v_tz text;
  v_next timestamp;
  v_now timestamptz := app.now_utc();
  v_n integer := 0;
begin
  select * into t from public.tasks where task_id = p_task for update;
  if not found then return; end if;
  if t.state in ('done', 'cancelled') then
    -- Ended by the person: a series stops here, nothing is advanced.
    update public.tasks set remind_job_id = null where task_id = p_task;
    return;
  end if;
  if t.repeat_every is not null and t.due_on is null and t.remind_at is not null
     and t.repeat_every > interval '0' then
    v_tz := app.office_timezone(t.office_id);
    v_next := t.remind_at at time zone v_tz;
    loop
      v_next := v_next + t.repeat_every;            -- local wall clock: 09:00 stays 09:00 across a change of clocks
      v_n := v_n + 1;
      exit when (v_next at time zone v_tz) > v_now or v_n >= 1000;
    end loop;
    if (v_next at time zone v_tz) <= v_now then
      v_next := (v_now at time zone v_tz) + t.repeat_every;   -- the bound was hit: never leave it in the past
    end if;
    update public.tasks
       set remind_at = v_next at time zone v_tz, reminded_at = null, remind_job_id = null, remind_sends = 0
     where task_id = p_task;
  else
    update public.tasks set reminded_at = v_now, remind_job_id = null where task_id = p_task;
  end if;
end;
$function$;
revoke all on function app.reminder_finish(uuid) from public, anon, authenticated, service_role;

-- Said by a duty job: the reminders it named are in flight. Marked LAST, after the body is composed.
create function app.reminders_announced(p_office uuid, p_ids uuid[], p_job uuid)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare v_n integer;
begin
  perform app.require_office(p_office);
  with marked as (
    update public.tasks
       set remind_job_id = p_job, remind_sends = remind_sends + 1
     where task_id = any(coalesce(p_ids, array[]::uuid[]))
       and office_id = p_office
       and reminded_at is null
       and remind_job_id is null
    returning task_id
  )
  select count(*)::int into v_n from marked;
  return v_n;
end;
$function$;
revoke all on function app.reminders_announced(uuid, uuid[], uuid) from public, anon, authenticated, service_role;

-- Delivered: end the occurrence (a one-off is marked, a series moves on). Same contract as before for a caller:
-- the number of THIS office's reminders ended, a foreign or missing id counts for nothing.
create or replace function app.reminders_sent(p_office uuid, p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare v_id uuid; v_n integer := 0;
begin
  perform app.require_office(p_office);
  for v_id in
    select task_id from public.tasks
     where task_id = any(coalesce(p_ids, array[]::uuid[]))
       and office_id = p_office
       and reminded_at is null
  loop
    perform app.reminder_finish(v_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$function$;

-- Run at the start of a tasks.remind tick: end what has been delivered, re-open what was lost, wait for the rest.
create function app.reminders_settle(p_office uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  r record;
  v_state text;
  v_max constant integer := 3;
  v_delivered integer := 0;
  v_reopened integer := 0;
  v_gave_up integer := 0;
  v_waiting integer := 0;
begin
  perform app.require_office(p_office);
  for r in
    select t.task_id, t.remind_sends, t.remind_job_id, j.state as job_state
      from public.tasks t
      left join public.jobs j on j.job_id = t.remind_job_id and j.office_id = t.office_id
     where t.office_id = p_office and t.remind_job_id is not null
     order by t.remind_at
     limit 500
  loop
    v_state := app.job_delivery_state(p_office, r.remind_job_id);
    -- Nothing was ever claimed: still to come while the job is live, a loss once it has ended.
    if v_state = 'none' and coalesce(r.job_state, 'failed') in ('complete', 'failed', 'cancelled') then
      v_state := 'failed';
    end if;
    if v_state = 'sent' then
      perform app.reminder_finish(r.task_id);
      v_delivered := v_delivered + 1;
    elsif v_state = 'failed' and r.remind_sends < v_max then
      update public.tasks set remind_job_id = null where task_id = r.task_id;
      v_reopened := v_reopened + 1;
    elsif v_state = 'failed' then
      -- Bounded: the third failed send ends the occurrence. The delivery rows stay failed and are listed by
      -- app.undelivered, which is how it surfaces.
      perform app.reminder_finish(r.task_id);
      v_gave_up := v_gave_up + 1;
    else
      v_waiting := v_waiting + 1;
    end if;
  end loop;
  return jsonb_build_object('delivered', v_delivered, 'reopened', v_reopened, 'gave_up', v_gave_up, 'waiting', v_waiting);
end;
$function$;
revoke all on function app.reminders_settle(uuid) from public, anon, authenticated, service_role;

commit;
