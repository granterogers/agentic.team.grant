-- 0803 - the task sync, reminders and calendar links take an office (multi-user P3, wave 2, cluster i-integrations2, part 4 of 5).
--
-- Before: a sync round (Vikunja, the calendar) offered EVERY office's human tasks and every office's tombstones to
-- the provider it was talking to; task_pushed / task_push_failed wrote a link row for any task id; task_delete_pushed
-- cleared a tombstone by task id alone; reminders_due listed every office's due reminders and reminders_sent marked
-- any task id reminded (so one office could silence another's reminder); calendar_link_set filed a Google Calendar
-- event id against any task id, and calendar_link_clear deleted any task's link; undo_tasks_from_job deleted the
-- 'todo' tasks of any job id it was handed.
--
-- Now each takes `p_office uuid` FIRST, no default. A sync round runs for ONE office: it offers that office's tasks
-- and tombstones, and a push, failure, delete or link is matched against a task inside that office. A task of
-- another office is indistinguishable from a task that does not exist: the same sentence (or, for the two that
-- raised on a missing task, the same error).
--
-- Global key, reported: task_links_one_per_external is unique on (provider, external_id), so two offices can never
-- both hold a task linked to the same external id; the second push is refused with the same words as any failed push.
-- (The Vikunja token is deployment-level, so in practice only the operator's office syncs it.)
--
-- Callers inside the database: app.hq_undo (the 'tasks_from_job' reversal) is spliced to pass its office.

create function app.tasks_to_push(p_office uuid, p_provider text, p_limit integer default 200)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
begin
  perform app.require_office(p_office);
  return (
  with mine as (
    select t.*, l.external_id, l.external_project_id, l.synced_revision
      from public.tasks t
      left join public.task_links l
        on l.task_id = t.task_id and l.provider = p_provider
     where t.office_id = p_office
       and t.assigned_to_human
       -- 0597: a harness task never leaves the office (see app.reminders_due).
       and not app.harness_task(t.is_fixture, t.job_id)
       -- Never pushed, or moved since it was.
       and (l.task_id is null or t.revision > coalesce(l.synced_revision, 0))
     order by t.updated_at
     limit greatest(coalesce(p_limit, 200), 1)
  )
  select jsonb_build_object(
    'provider', p_provider,
    'upserts', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', m.task_id, 'revision', m.revision,
        'title', m.title, 'detail', m.detail,
        'state', m.state, 'done', m.state = 'done',
        'priority', m.priority, 'due_on', m.due_on, 'starts_on', m.starts_on,
        'remind_at', m.remind_at, 'labels', to_jsonb(m.labels),
        'parent', m.parent_task_id,
        'project', (select p.slug from public.projects p where p.project_id = m.project_id and p.office_id = p_office),
        'external_id', m.external_id,
        'external_project_id', m.external_project_id) order by m.updated_at), '[]'::jsonb)
      from mine m),
    /*
      Deletions travel in the same answer as the upserts, because a provider
      that learns about them separately will eventually apply them in the
      wrong order and resurrect a task Grant deleted.
    */
    'deletes', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', d.task_id, 'title', d.title, 'links', d.links)), '[]'::jsonb)
      from public.task_tombstones d
     where d.office_id = p_office
       and d.cleared_at is null
       and d.links @> jsonb_build_array(jsonb_build_object('provider', p_provider)))
  )
  );
end;
$function$;
revoke all on function app.tasks_to_push(uuid, text, integer) from public, anon, authenticated, service_role;

create function app.task_pushed(p_office uuid, p_task_id uuid, p_provider text, p_external_id text, p_revision integer, p_external_project_id text default null::text, p_external_revision text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_catalog'
as $function$
begin
  perform app.require_office(p_office);
  if not exists (select 1 from public.tasks where task_id = p_task_id and office_id = p_office) then
    return jsonb_build_object('ok', false, 'error', 'no such task');
  end if;
  begin
    insert into public.task_links
      (task_id, provider, external_id, external_project_id, external_revision,
       synced_revision, pushed_at, sync_state, sync_error, updated_at)
    values (p_task_id, p_provider, p_external_id, p_external_project_id, p_external_revision,
            p_revision, app.now_utc(), 'ok', null, app.now_utc())
    on conflict (task_id, provider) do update
       set external_id = excluded.external_id,
           external_project_id = excluded.external_project_id,
           external_revision = excluded.external_revision,
           /*
             GREATEST, not the incoming value. A push that lands out of order
             must not walk the watermark backwards and make a newer revision
             look unpushed for ever.
           */
           synced_revision = greatest(coalesce(public.task_links.synced_revision, 0),
                                      coalesce(excluded.synced_revision, 0)),
           pushed_at = excluded.pushed_at,
           sync_state = 'ok',
           sync_error = null,
           updated_at = app.now_utc();
  exception when unique_violation then
    -- Another task already holds that external id (the key is global, reported): the same words as any failed push.
    return jsonb_build_object('ok', false, 'error', 'that push could not be recorded');
  end;
  return jsonb_build_object('ok', true, 'task', p_task_id, 'provider', p_provider);
end
$function$;
revoke all on function app.task_pushed(uuid, uuid, text, text, integer, text, text) from public, anon, authenticated, service_role;

create function app.task_push_failed(p_office uuid, p_task_id uuid, p_provider text, p_error text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_catalog'
as $function$
begin
  perform app.require_office(p_office);
  if not exists (select 1 from public.tasks where task_id = p_task_id and office_id = p_office) then
    return jsonb_build_object('ok', false, 'error', 'no such task');
  end if;
  insert into public.task_links
    (task_id, provider, external_id, sync_state, sync_error, updated_at)
  values (p_task_id, p_provider, 'pending:' || p_task_id::text, 'error',
          coalesce(nullif(btrim(p_error), ''), 'the provider refused, and said nothing'),
          app.now_utc())
  on conflict (task_id, provider) do update
     set sync_state = 'error',
         sync_error = excluded.sync_error,
         updated_at = app.now_utc();
  return jsonb_build_object('ok', true, 'recorded', p_error);
end
$function$;
revoke all on function app.task_push_failed(uuid, uuid, text, text) from public, anon, authenticated, service_role;

create function app.task_delete_pushed(p_office uuid, p_task_id uuid, p_provider text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_left jsonb;
begin
  perform app.require_office(p_office);
  select jsonb_agg(e) into v_left
    from public.task_tombstones d,
         lateral jsonb_array_elements(d.links) e
   where d.task_id = p_task_id and d.office_id = p_office and e ->> 'provider' <> p_provider;

  update public.task_tombstones
     set links = coalesce(v_left, '[]'::jsonb),
         cleared_at = case when coalesce(v_left, '[]'::jsonb) = '[]'::jsonb
                           then app.now_utc() else null end
   where task_id = p_task_id and office_id = p_office;
  return jsonb_build_object('ok', true, 'owed_to', coalesce(v_left, '[]'::jsonb));
end
$function$;
revoke all on function app.task_delete_pushed(uuid, uuid, text) from public, anon, authenticated, service_role;

create function app.reminders_due(p_office uuid, p_grace interval default '14 days'::interval)
 returns jsonb
 language plpgsql
 stable
 security definer
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
                      and t.due_on < (app.now_utc() at time zone 'UTC')::date
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
     and t.remind_at <= app.now_utc()
     and t.remind_at >= app.now_utc() - p_grace
  );
end;
$function$;
revoke all on function app.reminders_due(uuid, interval) from public, anon, authenticated, service_role;

create function app.reminders_sent(p_office uuid, p_ids uuid[])
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
       set reminded_at = app.now_utc()
     where task_id = any(coalesce(p_ids, array[]::uuid[]))
       and office_id = p_office
       and reminded_at is null
    returning task_id
  )
  select count(*)::int into v_n from marked;
  return v_n;
end;
$function$;
revoke all on function app.reminders_sent(uuid, uuid[]) from public, anon, authenticated, service_role;

create function app.undo_tasks_from_job(p_office uuid, p_job uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_removed int;
  v_kept    int;
begin
  perform app.require_office(p_office);
  if p_job is null then
    return jsonb_build_object('error', 'there is no job to undo');
  end if;

  select count(*) into v_kept
    from public.tasks t
   where t.job_id = p_job
     and t.office_id = p_office
     and (t.state <> 'todo' or t.updated_at > t.created_at + interval '1 second');

  with gone as (
    delete from public.tasks t
     where t.job_id = p_job
       and t.office_id = p_office
       and t.state = 'todo'
       -- `tasks_touch` sets updated_at on every UPDATE, so this is how a row
       -- Grant has edited says so. A second of slack because the insert and
       -- the trigger are not the same instant.
       and t.updated_at <= t.created_at + interval '1 second'
    returning 1
  )
  select count(*) into v_removed from gone;

  return jsonb_build_object('removed', v_removed, 'kept', v_kept,
    'note', case when v_kept = 0 then 'all of them'
                 else format('%s left alone - you had already changed %s of them', v_kept, v_kept)
            end);
end;
$function$;
revoke all on function app.undo_tasks_from_job(uuid, uuid) from public, anon, authenticated, service_role;

create function app.calendar_link_set(p_office uuid, p_task_id uuid, p_calendar_id text, p_event_id text, p_hash text)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  perform app.require_office(p_office);
  -- A task that is another office's raises exactly what a task that does not exist raises.
  if not exists (select 1 from public.tasks where task_id = p_task_id and office_id = p_office) then
    raise exception 'no such task' using errcode = 'P0002';
  end if;
  insert into public.task_calendar_links (task_id, calendar_id, event_id, pushed_hash, pushed_at)
  values (p_task_id, p_calendar_id, p_event_id, p_hash, app.now_utc())
  on conflict (task_id) do update
     set calendar_id = excluded.calendar_id,
         event_id    = excluded.event_id,
         pushed_hash = excluded.pushed_hash,
         pushed_at   = excluded.pushed_at;
end;
$function$;
revoke all on function app.calendar_link_set(uuid, uuid, text, text, text) from public, anon, authenticated, service_role;

create function app.calendar_link_clear(p_office uuid, p_task_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  perform app.require_office(p_office);
  delete from public.task_calendar_links l
   where l.task_id = p_task_id
     and exists (select 1 from public.tasks t where t.task_id = l.task_id and t.office_id = p_office);
end;
$function$;
revoke all on function app.calendar_link_clear(uuid, uuid) from public, anon, authenticated, service_role;

-- The one caller inside the database: the 'tasks_from_job' reversal. Spliced from the live definition, asserted to
-- have landed, tolerant of a hq_undo another cluster has already rewritten.
do $m$
declare v text;
begin
  v := pg_get_functiondef('app.hq_undo(uuid,text)'::regprocedure);
  if position('app.undo_tasks_from_job((v_args' in v) > 0 then
    v := replace(v, 'app.undo_tasks_from_job((v_args', 'app.undo_tasks_from_job(p_office, (v_args');
    if position('app.undo_tasks_from_job((v_args' in v) > 0 or position('app.undo_tasks_from_job(p_office, (v_args' in v) = 0 then
      raise exception 'hq_undo splice did not land';
    end if;
    execute v;
  end if;
end $m$;

-- the old signatures go
drop function public.calendar_link_set(uuid, text, text, text);
drop function public.calendar_link_clear(uuid);
drop function app.calendar_link_set(uuid, text, text, text);
drop function app.calendar_link_clear(uuid);
drop function app.tasks_to_push(text, integer);
drop function app.task_pushed(uuid, text, text, integer, text, text);
drop function app.task_push_failed(uuid, text, text);
drop function app.task_delete_pushed(uuid, text);
drop function app.reminders_due(interval);
drop function app.reminders_sent(uuid[]);
drop function app.undo_tasks_from_job(uuid);
