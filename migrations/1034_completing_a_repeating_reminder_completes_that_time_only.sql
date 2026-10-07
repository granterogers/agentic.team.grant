-- 1034: completing a repeating reminder completes THAT TIME ONLY; stopping the series is a separate, explicit act.
--
-- The owner's decision (7 October 2026), reversing 1027 section 5. 1027 made ticking a reminder SERIES off END it ("Ticking
-- it off ends it"): a person who ticked "review my finances" on a Monday, which is the most natural thing to do with a
-- reminder that has just arrived, silently cancelled every Monday after it. A reminder is something you act on and tick;
-- the series is something you stop on purpose.
--
-- A reminder SERIES is one row: a repeat (`repeat_every`), a reminder time (`remind_at`) and NO due date. That is unchanged.
-- What "complete" means for such a row is what changes:
--
--   * The row STAYS OPEN (state does not become 'done') and keeps its next `remind_at`. It is still on his list as a
--     recurring reminder; every reader of tasks (my_tasks, counts, buckets, overdue, search, studio_tasks) sees an open task.
--   * Completing records the OCCURRENCE as done, durably, in three columns (the smallest representation that answers
--     every case; a per-occurrence ledger would be a second copy of what `remind_at` and these three already say):
--         last_fired_for     the scheduled time of the most recent occurrence that was DELIVERED
--         last_completed_for the scheduled time of the most recent occurrence he completed
--         last_completed_at  when he did it
--     An occurrence is "waiting to be completed" exactly when last_fired_for is later than last_completed_for.
--   * Completing, by which occurrence it meets:
--       (a) one is announced and its delivery has not settled yet (remind_job_id is set): that occurrence is completed
--           and the duty's settle step advances the series when the delivery lands, as it always does;
--       (b) the latest DELIVERED occurrence has not been completed: it is completed, and the series has already advanced
--           so nothing moves;
--       (c) nothing is waiting, so the upcoming occurrence had NOT fired: it is SKIPPED, recorded as completed, and the
--           series moves to the occurrence after it (strictly after now, on the office wall clock). It never fires.
--     Whichever it is, no row is created and nothing is delivered twice: the next occurrence is the same row's next time.
--   * The decision is taken in a BEFORE UPDATE trigger on the state, not in each writer: ten functions write
--     tasks.state ("fix a failure at the state, not at each writer"). The trigger holds the row open and records the
--     completion; app.hq_task_state (the door the page and the conversation use) says truthfully which of (a) (b) (c) it was.
--   * Stopping a series is `app.reminder_series_stop`: the row becomes 'cancelled' through hq_task_state, so the product's
--     own undo offer applies, it is never due again, and a name that matches no series or two is refused by the caller
--     without a mutation. The cadence (repeat_every, remind_at) is deliberately left on the cancelled row: it is what makes
--     the undo offer able to put the series back (a cleared repeat would restore an ordinary one-off). A series that comes
--     back from cancelled or done is moved forward if its time has passed, so an undone stop does not fire a stale
--     reminder at once.
--   * A repeating TASK (a repeat WITH a due date) is unchanged by decision: ticking it off makes the next occurrence
--     (app.tasks_repeat_on_done), because a task with a due date is done when it is done and the next one is due a period on.
--
-- This file replaces functions 1027 created, and adds nothing 1027 depends on.

begin;

alter table public.tasks add column if not exists last_fired_for timestamptz;
alter table public.tasks add column if not exists last_completed_for timestamptz;
alter table public.tasks add column if not exists last_completed_at timestamptz;
comment on column public.tasks.last_fired_for is
  'A reminder SERIES (repeat, remind_at, no due date): the scheduled time of the most recent occurrence that was delivered (1034). Set by app.reminder_finish.';
comment on column public.tasks.last_completed_for is
  'A reminder SERIES: the scheduled time of the most recent occurrence he completed or skipped (1034). An occurrence waits to be completed when last_fired_for is later than this.';
comment on column public.tasks.last_completed_at is
  'A reminder SERIES: when he last completed an occurrence (1034). The series itself stays open.';

-- ---------------------------------------------------------------------------------------------------------------------
-- the one place that works out the next occurrence of a series, on the office wall clock
-- ---------------------------------------------------------------------------------------------------------------------

create function app.reminder_next_at(p_office uuid, p_at timestamptz, p_every interval, p_after timestamptz)
returns timestamptz
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_tz text := app.office_timezone(p_office);
  v_next timestamp;
  v_n integer := 0;
begin
  if p_every is null or p_every <= interval '0' or p_at is null then return null; end if;
  v_next := p_at at time zone v_tz;
  loop
    v_next := v_next + p_every;            -- local wall clock: 09:00 stays 09:00 across a change of clocks
    v_n := v_n + 1;
    exit when (v_next at time zone v_tz) > p_after or v_n >= 1000;
  end loop;
  if (v_next at time zone v_tz) <= p_after then
    v_next := (p_after at time zone v_tz) + p_every;   -- the bound was hit: never leave it in the past
  end if;
  return v_next at time zone v_tz;
end;
$function$;
revoke all on function app.reminder_next_at(uuid, timestamptz, interval, timestamptz) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- completing an occurrence, decided at the state
-- ---------------------------------------------------------------------------------------------------------------------

create function app.tasks_series_survives_completion()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_now timestamptz := app.now_utc();
begin
  -- Only a reminder SERIES: a repeat, a reminder time and no due date. Everything else is an ordinary task.
  if new.repeat_every is null or new.repeat_every <= interval '0'
     or new.due_on is not null or new.remind_at is null then
    return new;
  end if;

  if new.state = 'done' and old.state not in ('done', 'cancelled') then
    -- Complete THIS occurrence; the series does not end. Whatever the writer set, the row stays as it was.
    new.state := old.state;
    new.done_at := old.done_at;
    new.completed_by := old.completed_by;
    new.last_completed_at := v_now;
    if old.remind_job_id is not null then
      -- (a) announced, delivery not settled: that occurrence is the one completed; settle will advance the series.
      new.last_completed_for := old.remind_at;
    elsif old.last_fired_for is not null
          and (old.last_completed_for is null or old.last_completed_for < old.last_fired_for) then
      -- (b) the latest delivered occurrence was waiting; the series has already moved on.
      new.last_completed_for := old.last_fired_for;
    else
      -- (c) nothing is waiting: the upcoming occurrence has not fired. Skip it and move to the one after.
      new.last_completed_for := old.remind_at;
      new.remind_at := app.reminder_next_at(new.office_id, old.remind_at, new.repeat_every, v_now);
      new.reminded_at := null;
      new.remind_job_id := null;
      new.remind_sends := 0;
    end if;
  elsif old.state in ('done', 'cancelled') and new.state not in ('done', 'cancelled')
        and new.remind_at <= v_now then
    -- A series that comes back (an undone stop, a reopened row) does not start in the past: no stale reminder at once.
    new.remind_at := app.reminder_next_at(new.office_id, new.remind_at, new.repeat_every, v_now);
    new.reminded_at := null;
    new.remind_job_id := null;
    new.remind_sends := 0;
  end if;
  return new;
end;
$function$;
revoke all on function app.tasks_series_survives_completion() from public, anon, authenticated, service_role;

-- Named to sort BEFORE tasks_touch, which sets done_at from the state: the state is settled first.
create trigger tasks_a_series_survives_completion
  before update of state on public.tasks
  for each row execute function app.tasks_series_survives_completion();

-- ---------------------------------------------------------------------------------------------------------------------
-- the repeating TASK trigger no longer has a reminder-series branch: a series is never done
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
    A REMINDER SERIES (a repeat with a reminder time and no due date) is never made 'done' (1034): completing it
    completes the current occurrence only and the row stays open (app.tasks_series_survives_completion), and the series
    advances in place when its reminder is delivered. This guard is a second line behind that trigger: if a row that is a
    series ever arrives here done, it must not also make a next occurrence row.
  */
  if new.due_on is null and new.remind_at is not null then
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
-- ending an occurrence of a reminder: delivered (the series advances and the occurrence is recorded as fired) or given up
-- ---------------------------------------------------------------------------------------------------------------------

drop function app.reminder_finish(uuid);
create function app.reminder_finish(p_task uuid, p_delivered boolean default true)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  t public.tasks%rowtype;
  v_now timestamptz := app.now_utc();
begin
  select * into t from public.tasks where task_id = p_task for update;
  if not found then return; end if;
  if t.state in ('done', 'cancelled') then
    -- Ended by the person (a one-off ticked off, or a series he STOPPED): nothing is advanced.
    update public.tasks set remind_job_id = null where task_id = p_task;
    return;
  end if;
  if t.repeat_every is not null and t.due_on is null and t.remind_at is not null
     and t.repeat_every > interval '0' then
    update public.tasks
       set last_fired_for = case when p_delivered then t.remind_at else last_fired_for end,
           remind_at = app.reminder_next_at(t.office_id, t.remind_at, t.repeat_every, v_now),
           reminded_at = null, remind_job_id = null, remind_sends = 0
     where task_id = p_task;
  else
    update public.tasks set reminded_at = v_now, remind_job_id = null where task_id = p_task;
  end if;
end;
$function$;
revoke all on function app.reminder_finish(uuid, boolean) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- the duty's settle step: an occurrence completed while its delivery was lost is not said again
-- ---------------------------------------------------------------------------------------------------------------------

create or replace function app.reminders_settle(p_office uuid)
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
    select t.task_id, t.remind_sends, t.remind_job_id, j.state as job_state,
           (t.last_completed_for is not distinct from t.remind_at) as completed
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
    elsif v_state = 'failed' and r.remind_sends < v_max and not r.completed then
      update public.tasks set remind_job_id = null where task_id = r.task_id;
      v_reopened := v_reopened + 1;
    elsif v_state = 'failed' then
      -- Bounded: the third failed send ends the occurrence; an occurrence he already completed is not said again at all.
      -- It did not arrive, so it is not recorded as fired. The delivery rows stay failed and are listed by
      -- app.undelivered, which is how it surfaces.
      perform app.reminder_finish(r.task_id, false);
      v_gave_up := v_gave_up + 1;
    else
      v_waiting := v_waiting + 1;
    end if;
  end loop;
  return jsonb_build_object('delivered', v_delivered, 'reopened', v_reopened, 'gave_up', v_gave_up, 'waiting', v_waiting);
end;
$function$;

-- Legacy path (a database that cannot track delivery): same contract, delivered is assumed.
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
    perform app.reminder_finish(v_id, true);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$function$;

-- A completed occurrence is never fired, whatever else is true of the row.
create or replace function app.reminders_due(p_office uuid, p_grace interval default '14 days'::interval)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
begin
  perform app.require_office(p_office);
  return (
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
     and not app.harness_task(t.is_fixture, t.job_id)
     and t.remind_at is not null
     and t.reminded_at is null
     and t.remind_job_id is null
     and t.remind_at <= app.now_utc()
     -- an occurrence he completed (1034) is not fired
     and t.last_completed_for is distinct from t.remind_at
     and (t.remind_at >= app.now_utc() - p_grace
          or (t.repeat_every is not null and t.due_on is null))
  );
end;
$function$;

-- ---------------------------------------------------------------------------------------------------------------------
-- the door the page and the conversation use to tick a task: it says truthfully what completing a series did
-- ---------------------------------------------------------------------------------------------------------------------

create or replace function app.hq_task_state(p_office uuid, p_task_id text, p_state text, p_reason text DEFAULT NULL::text, p_by text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_id       uuid;
  v          jsonb;
  v_was      text;
  v_was_why  text;
  v_title    text;
  v_undo     uuid;
  v_now      text;
  v_project  uuid;
  v_refusal  text;
  v_series   boolean;
  v_remind_before timestamptz;
  v_remind_after  timestamptz;
begin
  perform app.require_office(p_office);
  begin
    v_id := p_task_id::uuid;
  exception when others then
    return jsonb_build_object('error', 'that is not a task id');
  end;

  if p_state not in ('todo', 'doing', 'blocked', 'done', 'cancelled') then
    return jsonb_build_object('error', format(
      '%L is not a state — it is one of todo, doing, blocked, done, cancelled', p_state));
  end if;

  if p_state = 'blocked' and coalesce(btrim(p_reason), '') = '' then
    return jsonb_build_object('error',
      'say what it is blocked on — a blocked task with no reason cannot be unblocked by anyone but the person who blocked it');
  end if;

  select state, blocked_on, title, project_id,
         (repeat_every is not null and repeat_every > interval '0' and due_on is null and remind_at is not null),
         remind_at
    into v_was, v_was_why, v_title, v_project, v_series, v_remind_before
    from public.tasks where task_id = v_id and office_id = p_office;
  if v_was is null then
    return jsonb_build_object('error', 'no such task');
  end if;
  -- A principal that is not a person decides only what is its own: a test member does not change a real task.
  if btrim(coalesce(p_by, '')) <> '' then
    v_refusal := app.authority_refusal(btrim(p_by), (select b.job_id from public.tasks t join public.blockers b on b.blocker_id = t.satisfies_blocker where t.task_id = v_id and t.office_id = p_office and b.office_id = p_office), v_project);
    if v_refusal is not null then
      return jsonb_build_object('error', v_refusal);
    end if;
  end if;

  update public.tasks
     set state      = p_state,
         done_at    = case when p_state = 'done' then coalesce(done_at, app.now_utc()) else null end,
         blocked_on = case when p_state = 'blocked' then btrim(p_reason) else '' end,
         completed_by = case when p_state = 'done' then nullif(btrim(coalesce(p_by, '')), '') else null end
   where task_id = v_id and office_id = p_office
  returning jsonb_build_object('id', task_id, 'title', title, 'state', state) into v;

  select state, remind_at into v_now, v_remind_after from public.tasks where task_id = v_id and office_id = p_office;

  /*
    1034. Completing a reminder SERIES completes that occurrence only: the row is still open, which is the answer and not a
    refusal. Say which of the three it was: the occurrence was waiting (recorded), or it had not fired and is skipped.
  */
  if p_state = 'done' and v_series and v_now is distinct from 'done' and v_now is distinct from 'cancelled' then
    return jsonb_build_object(
      'id', v_id, 'title', v_title, 'state', v_now,
      'series', true,
      'occurrence', case when v_remind_after is distinct from v_remind_before then 'skipped' else 'recorded' end,
      'skipped_at', case when v_remind_after is distinct from v_remind_before then v_remind_before else null end,
      'next_at', v_remind_after,
      'undo', null);
  end if;

  if v_now is distinct from p_state then
    return jsonb_build_object('error',
      'that was not taken: the question this to-do stands for was not answered by somebody the office can name, so it is still open');
  end if;

  if p_state is distinct from v_was
     and not exists (select 1 from public.tasks where task_id = v_id and office_id = p_office and satisfies_blocker is not null) then
    v_undo := app.undo_offer(
      p_office,
      'task.state',
      format('%s marked %s', left(v_title, 60), p_state),
      jsonb_build_object('action', 'task_state',
                         'args', jsonb_build_object(
                           'p_task_id', p_task_id, 'p_state', v_was,
                           'p_reason', nullif(v_was_why, ''))));
  end if;

  return coalesce(v, jsonb_build_object('error', 'no such task')) || jsonb_build_object('undo', v_undo);
end
$function$;

-- ---------------------------------------------------------------------------------------------------------------------
-- the series he has, and the explicit act that ends one
-- ---------------------------------------------------------------------------------------------------------------------

-- The open reminder series on his own list, for naming one ("stop the Monday finance reminder") without guessing.
create function app.reminder_series(p_office uuid, p_include_harness boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_tz text;
begin
  perform app.require_office(p_office);
  v_tz := app.office_timezone(p_office);
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', t.task_id,
             'title', t.title,
             'every', t.repeat_every::text,
             'next_at', t.remind_at,
             'weekday', to_char(t.remind_at at time zone v_tz, 'FMDay'),
             'last_done_at', t.last_completed_at,
             'project', p.name
           ) order by t.remind_at), '[]'::jsonb)
      from public.tasks t
      left join public.projects p on p.project_id = t.project_id and p.office_id = p_office
     where t.office_id = p_office
       and t.assigned_to_human
       and t.state not in ('done', 'cancelled')
       and t.repeat_every is not null and t.repeat_every > interval '0'
       and t.due_on is null and t.remind_at is not null
       and (p_include_harness or not app.harness_task(t.is_fixture, t.job_id))
  );
end;
$function$;
revoke all on function app.reminder_series(uuid, boolean) from public, anon, authenticated, service_role;

-- Stop a recurring reminder. The row is CANCELLED through the one door that offers undo for a cancel; it is then never
-- due again (reminders_due and reminder_finish both skip a cancelled row). Refuses what is not an open reminder series.
create function app.reminder_series_stop(p_office uuid, p_task_id text, p_by text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_id uuid;
  t public.tasks%rowtype;
  v jsonb;
begin
  perform app.require_office(p_office);
  begin
    v_id := p_task_id::uuid;
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'that is not a task id');
  end;
  select * into t from public.tasks where task_id = v_id and office_id = p_office and assigned_to_human;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'no personal reminder by that id');
  end if;
  if t.state in ('done', 'cancelled') then
    return jsonb_build_object('ok', false, 'gone', true, 'title', t.title,
      'error', 'that reminder has already ended');
  end if;
  if t.repeat_every is null or t.repeat_every <= interval '0' or t.due_on is not null or t.remind_at is null then
    return jsonb_build_object('ok', false, 'title', t.title,
      'error', 'that is not a recurring reminder, so there is nothing to stop');
  end if;
  v := app.hq_task_state(p_office, p_task_id, 'cancelled', null, p_by);
  if v ? 'error' then
    return jsonb_build_object('ok', false, 'title', t.title, 'error', v ->> 'error');
  end if;
  return jsonb_build_object('ok', true, 'stopped', true, 'id', v_id, 'title', t.title,
    'every', t.repeat_every::text, 'undo', v -> 'undo');
end;
$function$;
revoke all on function app.reminder_series_stop(uuid, text, text) from public, anon, authenticated, service_role;

create function public.reminder_series_stop(p_office uuid, p_task_id text, p_by text default null)
returns jsonb
language sql
security definer
set search_path to 'public', 'pg_catalog'
as $function$ select app.reminder_series_stop(p_office, p_task_id, p_by) $function$;
revoke all on function public.reminder_series_stop(uuid, text, text) from public, anon, authenticated;
grant execute on function public.reminder_series_stop(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- the list says it: a series, and when he last completed an occurrence
-- ---------------------------------------------------------------------------------------------------------------------

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
           -- 1034: a reminder SERIES (a repeat, a reminder time, no due date) stays open when an occurrence is
           -- completed; `last_done_at` is when he last completed one, so the list can say so.
           'repeats', case when k.repeat_every is null then null
                      else jsonb_build_object('every', k.repeat_every::text,
                                              'from', k.repeat_from,
                                              'series', (k.due_on is null and k.remind_at is not null),
                                              'last_done_at', k.last_completed_at) end,
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

commit;
