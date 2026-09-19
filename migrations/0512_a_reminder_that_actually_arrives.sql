/*
  0512 — a reminder that actually arrives (#259).

  `remind_at` has existed since 0482. The editor sets it, `app.my_tasks` reads
  it into the Today bucket, the studio renders it — and **nothing in `src/` has
  ever read the column**. A person could say "remind me Friday at nine",
  watch the office confirm it, see the time on the card, and receive nothing on
  Friday.

  That is the defect class CLAUDE.md names by hand: *"A dial with no reader is
  worse than no dial, because it looks like a decision."* It is the same shape
  as `autonomy_settings` before #15 — complete, correct, and unread.

  ## What is added

  | | |
  |---|---|
  | `tasks.reminded_at` | when this task's reminder was sent, so a pass is idempotent and a second tick cannot say it twice |
  | `app.reminders_due(p_grace)` | a pure READ of what is due — no writes, so the handler decides |
  | `app.reminders_sent(uuid[])` | the mark, called after the body is composed |

  ## Read and mark are SEPARATE, deliberately

  The obvious shape is one `update … returning`, which is atomic and cannot
  double-send. It also loses a reminder for ever the moment the job fails
  after the mark — and a job can fail after a handler returns, because the
  output insert has gates in front of it.

  So the read is pure and the mark is a second call the handler makes once it
  has a body. Two ticks cannot overlap (the duty's idempotency key is one job
  per period), so the realistic failure is at-least-once: a crash between
  compose and mark re-reminds next tick. **A reminder said twice is a small
  annoyance; a reminder never said is the whole feature not working**, and
  0304's rule about asymmetric witnesses is the same argument — pick the
  direction that can only ever be safe.

  ## Changing your mind clears the mark

  `my_task_set` nulls `reminded_at` whenever `remind_at` moves. Without it,
  re-scheduling a reminder that has already fired would never fire again —
  a feature that works exactly once per task, which is worse than one that
  never works because it looks fine in a test.

  A recurring task needs nothing: `tasks_repeat_on_done` inserts a NEW row and
  the column defaults to null.
*/

alter table public.tasks
  add column if not exists reminded_at timestamptz;

comment on column public.tasks.reminded_at is
  'When the office actually said something about this reminder. Null means '
  'unsent. Cleared by app.my_task_set whenever remind_at moves, so a '
  're-scheduled reminder fires again (0512).';

create index if not exists tasks_reminder_pending on public.tasks (remind_at)
  where remind_at is not null and reminded_at is null and state <> 'done';

-- ---------------------------------------------------------------------------
-- What is due. A pure read.
-- ---------------------------------------------------------------------------

create or replace function app.reminders_due(p_grace interval default interval '14 days')
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  /*
    `p_grace` is the floor, not the ceiling: a reminder whose time passed
    while the office was down should still arrive, and one from a fortnight
    ago should not — by then the due date has done the work and a stale
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
                      and t.due_on < (app.now_utc() at time zone 'UTC')::date
         ) order by t.remind_at), '[]'::jsonb)
    from public.tasks t
    left join public.projects p on p.project_id = t.project_id
   where t.assigned_to_human
     and t.state <> 'done'
     and t.state <> 'cancelled'
     and not coalesce(t.is_fixture, false)
     and t.remind_at is not null
     and t.reminded_at is null
     and t.remind_at <= app.now_utc()
     and t.remind_at >= app.now_utc() - p_grace
$fn$;

comment on function app.reminders_due(interval) is
  'Personal-task reminders whose time has come and which have not been said '
  'yet. Reads only: app.reminders_sent does the marking, so a handler that '
  'dies before it has a body re-reminds rather than losing one (0512).';

-- ---------------------------------------------------------------------------
-- The mark.
-- ---------------------------------------------------------------------------

create or replace function app.reminders_sent(p_ids uuid[])
returns integer
language sql
volatile
security definer
set search_path = ''
as $fn$
  with marked as (
    update public.tasks
       set reminded_at = app.now_utc()
     where task_id = any(coalesce(p_ids, array[]::uuid[]))
       and reminded_at is null
    returning task_id
  )
  select count(*)::int from marked
$fn$;

grant execute on function app.reminders_due(interval) to ai_team_app, service_role;
grant execute on function app.reminders_sent(uuid[]) to ai_team_app, service_role;

-- ---------------------------------------------------------------------------
-- Moving the reminder un-sends it.
-- ---------------------------------------------------------------------------

do $splice$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'my_task_set';
  if v_def is null then
    raise exception '0512: app.my_task_set is missing, so there is nothing to splice';
  end if;

  /*
    Spliced from the LIVE definition, because this function is 200 lines and
    CLAUDE.md records what rewriting one from memory costs: `app.pause_job`
    lost four behaviours in a single retype.
  */
  v_def := replace(v_def,
    '    remind_at = case when ''remind_at'' = any (v_clear) then null',
    '    reminded_at = case when ''remind_at'' = any (v_clear) or p_remind_at is not null'
    || ' then null else reminded_at end,' || chr(10) ||
    '    remind_at = case when ''remind_at'' = any (v_clear) then null');

  if position('reminded_at = case' in v_def) = 0 then
    raise exception '0512: the remind_at assignment was not found, so the splice did nothing';
  end if;
  execute v_def;
end
$splice$;

-- ---------------------------------------------------------------------------
-- The duty. Quarter-hourly, because a reminder an hour late is not a reminder.
-- ---------------------------------------------------------------------------

/*
  The Chief of Staff owns it, because `telegram.only_chief_speaks` is true and
  a reminder is the one duty whose entire point is to say something.
*/
insert into public.responsibilities
  (slug, description, job_kind, period_minutes, enabled, created_by, staff_id)
values
  ('task-reminders',
   'Say something when a personal task reminder falls due (#259).',
   'tasks.remind', 15, true, 'migration',
   (select staff_id from public.staff where slug = 'chief-of-staff'))
on conflict (slug) do update
   set job_kind = excluded.job_kind,
       period_minutes = excluded.period_minutes,
       description = excluded.description,
       enabled = true;

-- ---------------------------------------------------------------------------
-- Drive it, both halves and both controls.
-- ---------------------------------------------------------------------------

do $drive$
declare
  v_id   uuid;
  v_due  jsonb;
  v_n    int;
begin
  insert into public.tasks (title, assigned_to_human, added_by, remind_at, state)
  values ('Reminder probe 0512', true, 'migration', app.now_utc() - interval '5 minutes', 'todo')
  returning task_id into v_id;

  v_due := app.reminders_due();
  if not (v_due @> jsonb_build_array(jsonb_build_object('id', v_id))) then
    raise exception '0512: a reminder that fell due five minutes ago is not reported: %', v_due;
  end if;

  -- Reading twice must report it twice: the read may not mark.
  if not (app.reminders_due() @> jsonb_build_array(jsonb_build_object('id', v_id))) then
    raise exception '0512: the read marked something — it must not';
  end if;

  v_n := app.reminders_sent(array[v_id]);
  if v_n <> 1 then
    raise exception '0512: marking one reminder returned %', v_n;
  end if;
  if app.reminders_due() @> jsonb_build_array(jsonb_build_object('id', v_id)) then
    raise exception '0512: a reminder said once is still due';
  end if;
  if app.reminders_sent(array[v_id]) <> 0 then
    raise exception '0512: marking twice marked twice — the pass is not idempotent';
  end if;

  -- Moving the reminder un-sends it.
  perform app.my_task_set(v_id::text, p_remind_at => app.now_utc() - interval '1 minute');
  if not (app.reminders_due() @> jsonb_build_array(jsonb_build_object('id', v_id))) then
    raise exception '0512: re-scheduling a fired reminder did not make it due again';
  end if;

  -- CONTROL: a reminder in the future is not due.
  perform app.reminders_sent(array[v_id]);
  perform app.my_task_set(v_id::text, p_remind_at => app.now_utc() + interval '2 hours');
  if app.reminders_due() @> jsonb_build_array(jsonb_build_object('id', v_id)) then
    raise exception 'CONTROL FAILED: a reminder two hours away is reported as due';
  end if;

  -- CONTROL: and one whose moment passed a month ago is not resurrected.
  perform app.my_task_set(v_id::text, p_remind_at => app.now_utc() - interval '40 days');
  if app.reminders_due() @> jsonb_build_array(jsonb_build_object('id', v_id)) then
    raise exception 'CONTROL FAILED: a forty-day-old reminder is still being announced';
  end if;

  delete from public.tasks where task_id = v_id;
  raise notice '0512: reminders read, marked once, re-armed on change, and bounded';
end
$drive$;
