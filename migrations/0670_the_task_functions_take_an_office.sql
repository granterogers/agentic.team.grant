-- 0670 - the task functions take an office and check every row against it (multi-user P3, wave 2/4, pilot cluster).
--
-- Before: app.my_tasks(), app.my_task_add(...), app.hq_task_state(...) and their public wrappers read and wrote
-- `public.tasks` for whoever called, and the compatibility bridge guessed which office a new row belonged to. A second
-- person's list would have been the first person's list. Now each takes `p_office uuid` FIRST, with no default, and every
-- statement that touches tasks or projects carries `office_id = p_office`. A task of another office is
-- indistinguishable from a task that does not exist: the same sentence, the same shape.
--
-- app.task_add / app.task_parent_ok / app.undo_offer are the shared helpers beneath them. Their old signatures are
-- dropped here when nothing else in the database calls them; app.undo_offer keeps its old form (other writers still use
-- it, on the bridge) beside the new office-explicit one, and is dropped when its last caller moves.

----------------------------------------------------------------------------------------------------------------------
-- shared helpers
----------------------------------------------------------------------------------------------------------------------
create function app.undo_offer(p_office uuid, p_kind text, p_description text, p_reversal jsonb, p_minutes integer default 2)
returns uuid
language plpgsql
security definer
set search_path to ''
as $f$
declare v_id uuid;
begin
  perform app.require_office(p_office);
  -- An undo of an undo is not a feature.
  if coalesce(current_setting('app.undoing', true), '') = '1' then return null; end if;
  if p_reversal is null or p_reversal = '{}'::jsonb then return null; end if;
  insert into public.undoable_actions
    (office_id, correlation_id, kind, description, reversal, status, undo_deadline)
  values (p_office, gen_random_uuid(), p_kind, p_description, p_reversal, 'available',
          app.now_utc() + make_interval(mins => p_minutes))
  returning action_id into v_id;
  return v_id;
end
$f$;
revoke all on function app.undo_offer(uuid, text, text, jsonb, integer) from public, anon, authenticated, service_role;

create or replace function app.task_parent_ok(p_office uuid, p_parent uuid, p_child uuid default null)
returns text
language sql
stable
security definer
set search_path to ''
as $f$
  select case
    when p_parent is null then null
    when not exists (select 1 from public.tasks t where t.task_id = p_parent and t.office_id = p_office)
      then 'no task by that id to put this under'
    when not exists (select 1 from public.tasks t
                      where t.task_id = p_parent and t.office_id = p_office and t.assigned_to_human)
      then 'that is the team''s own work, not one of your tasks'
    when p_child is not null and p_parent = p_child
      then 'a task cannot be its own subtask'
    when exists (select 1 from public.tasks t
                  where t.task_id = p_parent and t.office_id = p_office and t.parent_task_id is not null)
      then 'that is already a subtask, and subtasks do not nest'
    when p_child is not null and exists (select 1 from public.tasks c
                                          where c.parent_task_id = p_child and c.office_id = p_office)
      then 'that task has subtasks of its own, so it cannot become one'
    else null
  end
$f$;
revoke all on function app.task_parent_ok(uuid, uuid, uuid) from public, anon, authenticated, service_role;

----------------------------------------------------------------------------------------------------------------------
-- app.task_add: the writer the worker and the dashboard share
----------------------------------------------------------------------------------------------------------------------
create function app.task_add(
  p_office uuid, p_project uuid, p_title text, p_detail text default null, p_due_on date default null,
  p_assignee text default null, p_milestone boolean default false, p_added_by text default null, p_job uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $f$
declare
  v_staff uuid;
  v_title text := btrim(coalesce(p_title, ''));
  v_by    text := coalesce(nullif(btrim(p_added_by), ''), app.office_actor(p_office));
  v       jsonb;
begin
  perform app.require_office(p_office);
  if v_title = '' then
    return jsonb_build_object('error', 'a task needs a title');
  end if;

  if p_project is not null
     and not exists (select 1 from public.projects
                      where project_id = p_project and office_id = p_office
                        and coalesce(status, '') <> 'archived') then
    return jsonb_build_object('error', 'that project does not exist or is archived');
  end if;

  -- A job that is not this office's cannot be the author of this office's task.
  if p_job is not null and not exists (select 1 from public.jobs where job_id = p_job and office_id = p_office) then
    return jsonb_build_object('error', 'that job does not exist');
  end if;

  if coalesce(p_milestone, false) and p_project is null then
    return jsonb_build_object('error',
      'a module belongs to a dashboard project - say which one');
  end if;

  if coalesce(btrim(p_assignee), '') <> '' then
    select staff_id into v_staff from public.staff where slug = btrim(p_assignee);
    if v_staff is null then
      return jsonb_build_object('error', format('nobody here is called %L', btrim(p_assignee)));
    end if;
  end if;

  if p_job is not null and app.harness_job(p_job) then
    v_by := 'verify:' || v_by;
  end if;

  /* 0592: see app.my_task_add - one job, one task per title, whatever the attempt. */
  if p_job is not null then
    select jsonb_build_object(
      'id', t.task_id, 'title', t.title, 'state', t.state, 'due_on', t.due_on,
      'milestone', t.is_milestone, 'fixture', t.is_fixture,
      'project', (select p.slug from public.projects p where p.project_id = t.project_id and p.office_id = p_office),
      'existing', true)
      into v
      from public.tasks t
     where t.office_id = p_office
       and t.job_id = p_job
       and lower(btrim(t.title)) = lower(v_title)
       and t.state <> 'cancelled'
       and t.satisfies_blocker is null
     order by t.created_at limit 1;
    if v is not null then
      return v;
    end if;
  end if;

  insert into public.tasks
    (office_id, project_id, title, detail, due_on, assignee_staff, added_by, is_milestone, job_id)
  values (p_office, p_project, v_title, coalesce(btrim(p_detail), ''), p_due_on, v_staff,
          v_by, coalesce(p_milestone, false), p_job)
  returning jsonb_build_object(
    'id', task_id, 'title', title, 'state', state, 'due_on', due_on,
    'milestone', is_milestone, 'fixture', is_fixture,
    'project', (select p.slug from public.projects p where p.project_id = p_project and p.office_id = p_office)
  ) into v;

  return v;
end
$f$;
revoke all on function app.task_add(uuid, uuid, text, text, date, text, boolean, text, uuid) from public, anon, authenticated, service_role;

----------------------------------------------------------------------------------------------------------------------
-- hq_task_add
----------------------------------------------------------------------------------------------------------------------
create function app.hq_task_add(
  p_office uuid, p_project text, p_title text, p_detail text default null, p_due_on date default null,
  p_assignee text default null, p_milestone boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $f$
declare
  v_project uuid;
begin
  perform app.require_office(p_office);
  if coalesce(btrim(p_project), '') <> '' then
    select project_id into v_project
      from public.projects
     where office_id = p_office
       and slug = btrim(p_project)
       and coalesce(status, '') <> 'archived'
       and not is_fixture;
    if v_project is null then
      return jsonb_build_object('error', format('no dashboard project called %L', p_project));
    end if;
  end if;

  return app.task_add(p_office, v_project, p_title, p_detail, p_due_on, p_assignee, p_milestone, null, null);
end
$f$;
revoke all on function app.hq_task_add(uuid, text, text, text, date, text, boolean) from public, anon, authenticated, service_role;

----------------------------------------------------------------------------------------------------------------------
-- hq_task_state
----------------------------------------------------------------------------------------------------------------------
create function app.hq_task_state(
  p_office uuid, p_task_id text, p_state text, p_reason text default null, p_by text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $f$
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

  select state, blocked_on, title, project_id into v_was, v_was_why, v_title, v_project
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

  select state into v_now from public.tasks where task_id = v_id and office_id = p_office;
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
$f$;
revoke all on function app.hq_task_state(uuid, text, text, text, text) from public, anon, authenticated, service_role;

----------------------------------------------------------------------------------------------------------------------
-- hq_task_update
----------------------------------------------------------------------------------------------------------------------
create function app.hq_task_update(
  p_office uuid, p_task_id text, p_title text default null, p_detail text default null, p_due_on date default null,
  p_starts_on date default null, p_assignee text default null, p_parent text default null,
  p_milestone boolean default null, p_priority integer default null, p_clear text[] default array[]::text[])
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $f$
declare
  v_id      uuid;
  v_project uuid;
  v_found   boolean;
  v_staff   uuid;
  v_parent  uuid;
  v_title   text;
  v         jsonb;
  v_was     record;
  v_back    jsonb;
  v_clear   text[] := array[]::text[];
  v_undo    uuid;
begin
  perform app.require_office(p_office);
  begin
    v_id := p_task_id::uuid;
  exception when others then
    return jsonb_build_object('error', format('%L is not a task id', p_task_id));
  end;

  select true, t.project_id into v_found, v_project
    from public.tasks t where t.task_id = v_id and t.office_id = p_office;
  if not coalesce(v_found, false) then
    return jsonb_build_object('error', 'no task with that id');
  end if;

  if p_title is not null then
    v_title := btrim(p_title);
    if v_title = '' then
      return jsonb_build_object('error', 'a task needs a title -- rename it to something, or leave it');
    end if;
  end if;

  if coalesce(btrim(p_assignee), '') <> '' then
    select staff_id into v_staff from public.staff where slug = btrim(p_assignee);
    if v_staff is null then
      return jsonb_build_object('error', format('nobody here is called %L', btrim(p_assignee)));
    end if;
  end if;

  if coalesce(btrim(p_parent), '') <> '' then
    begin
      v_parent := btrim(p_parent)::uuid;
    exception when others then
      return jsonb_build_object('error', format('%L is not a task id', p_parent));
    end;
    if v_parent = v_id then
      return jsonb_build_object('error', 'a task cannot be its own parent');
    end if;
    if not exists (select 1 from public.tasks where task_id = v_parent and office_id = p_office
                    and project_id is not distinct from v_project) then
      return jsonb_build_object('error',
        case when v_project is null
             then 'that parent belongs to a project and this task does not'
             else 'that parent is not a task on the same dashboard project' end);
    end if;
    if exists (
      with recursive up as (
        select task_id, parent_task_id from public.tasks where task_id = v_parent and office_id = p_office
        union all
        select t.task_id, t.parent_task_id
          from public.tasks t join up on t.task_id = up.parent_task_id
         where t.office_id = p_office
      )
      select 1 from up where task_id = v_id
    ) then
      return jsonb_build_object('error',
        'that would make a loop -- the task you picked is already under this one');
    end if;
  end if;

  select t.title, t.detail, t.due_on, t.starts_on, t.parent_task_id,
         t.is_milestone, t.priority,
         (select s.slug from public.staff s where s.staff_id = t.assignee_staff) as assignee
    into v_was
    from public.tasks t where t.task_id = v_id and t.office_id = p_office;

  update public.tasks
     set title             = coalesce(v_title, title),
         detail            = case when 'detail' = any(p_clear) then ''
                                  else coalesce(btrim(p_detail), detail) end,
         due_on            = case when 'due_on' = any(p_clear) then null
                                  else coalesce(p_due_on, due_on) end,
         starts_on         = case when 'starts_on' = any(p_clear) then null
                                  else coalesce(p_starts_on, starts_on) end,
         assignee_staff    = case when 'assignee' = any(p_clear) then null
                                  else coalesce(v_staff, assignee_staff) end,
         parent_task_id    = case when 'parent' = any(p_clear) then null
                                  else coalesce(v_parent, parent_task_id) end,
         is_milestone      = coalesce(p_milestone, is_milestone),
         priority          = coalesce(p_priority, priority),
         updated_at        = app.now_utc()
   where task_id = v_id and office_id = p_office;

  if coalesce(v_was.detail, '') = '' then v_clear := array_append(v_clear, 'detail'); end if;
  if v_was.due_on     is null   then v_clear := array_append(v_clear, 'due_on'); end if;
  if v_was.starts_on  is null   then v_clear := array_append(v_clear, 'starts_on'); end if;
  if v_was.assignee   is null   then v_clear := array_append(v_clear, 'assignee'); end if;
  if v_was.parent_task_id is null then v_clear := array_append(v_clear, 'parent'); end if;

  v_back := jsonb_build_object(
    'p_task_id',   p_task_id,
    'p_title',     v_was.title,
    'p_detail',    nullif(coalesce(v_was.detail, ''), ''),
    'p_due_on',    v_was.due_on,
    'p_starts_on', v_was.starts_on,
    'p_assignee',  v_was.assignee,
    'p_parent',    v_was.parent_task_id,
    'p_milestone', v_was.is_milestone,
    'p_priority',  v_was.priority,
    'p_clear',     to_jsonb(v_clear));

  v_undo := app.undo_offer(
    p_office,
    'task.update',
    format('Edited %s', left(v_was.title, 60)),
    jsonb_build_object('action', 'task_update', 'args', v_back));

  select jsonb_build_object(
           'id', t.task_id, 'title', t.title, 'detail', t.detail,
           'state', t.state, 'due_on', t.due_on, 'starts_on', t.starts_on,
           'milestone', t.is_milestone, 'priority', t.priority,
           'parent', t.parent_task_id, 'undo', v_undo,
           'assignee', (select s.slug from public.staff s where s.staff_id = t.assignee_staff)
         )
    into v
    from public.tasks t where t.task_id = v_id and t.office_id = p_office;
  return v;
end
$f$;
revoke all on function app.hq_task_update(uuid, text, text, text, date, date, text, text, boolean, integer, text[]) from public, anon, authenticated, service_role;

----------------------------------------------------------------------------------------------------------------------
-- the personal list: my_tasks, my_tasks_counts, my_task_add, my_task_set, my_task_delete, my_task_reparent
----------------------------------------------------------------------------------------------------------------------
create function app.my_tasks(p_office uuid, p_bucket text DEFAULT 'today'::text, p_limit integer DEFAULT 200, p_query text DEFAULT NULL::text, p_sort text DEFAULT 'smart'::text, p_include_harness boolean DEFAULT false)
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
            and (m.due_on <= (app.now_utc() at time zone 'UTC')::date
                 or m.remind_at <= app.now_utc())
       when 'upcoming' then m.state not in ('done', 'cancelled')
            and m.due_on > (app.now_utc() at time zone 'UTC')::date
       when 'overdue' then m.state not in ('done', 'cancelled')
            and m.due_on < (app.now_utc() at time zone 'UTC')::date
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
                         where c.office_id = p_office and c.parent_task_id = k.task_id and c.state <> 'done'),
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
                        where c.office_id = p_office and c.parent_task_id = k.task_id
                        limit 20),
           'done_at', k.done_at
         )), '[]'::jsonb)
    from picked k
$function$;

create function app.my_tasks_counts(p_office uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with mine as (
    select t.* from public.tasks t
     where t.office_id = app.require_office(p_office) and t.assigned_to_human and not app.harness_task(t.is_fixture, t.job_id)
  ), today as (select (app.now_utc() at time zone 'UTC')::date as d)
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

create function app.my_task_add(p_office uuid, p_title text, p_detail text DEFAULT ''::text, p_due_on date DEFAULT NULL::date, p_remind_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_priority integer DEFAULT 100, p_project text DEFAULT NULL::text, p_labels text[] DEFAULT NULL::text[], p_parent text DEFAULT NULL::text, p_job uuid DEFAULT NULL::uuid)
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
  perform app.require_office(p_office);
  if v_title = '' then
    return jsonb_build_object('ok', false, 'error', 'a task needs a title');
  end if;
  if p_job is not null and not exists (select 1 from public.jobs where job_id = p_job and office_id = p_office) then
    return jsonb_build_object('ok', false, 'error', 'that job does not exist');
  end if;

  if coalesce(p_parent, '') <> '' then
    begin
      v_parent := p_parent::uuid;
    exception when others then
      return jsonb_build_object('ok', false, 'error', 'that is not a task id to put this under');
    end;
    v_why := app.task_parent_ok(p_office, v_parent);
    if v_why is not null then
      return jsonb_build_object('ok', false, 'error', v_why);
    end if;
  end if;

  if coalesce(p_project, '') <> '' then
    select project_id into v_project from public.projects
     where office_id = p_office and slug = p_project and status <> 'archived';
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
    select t.project_id into v_project from public.tasks t where t.task_id = v_parent and t.office_id = p_office;
  end if;

  /*
    0592: ONE JOB, ONE TASK PER TITLE, HOWEVER MANY ATTEMPTS.

    The handler writes the task before the answer is checked, and a refused
    answer retries the whole job, so every attempt wrote it again: four
    identical rows from one message on 24 September. The writer is the one
    place every caller passes through, so the idempotency lives here. Keyed on
    the job that made it and the title, never on the title alone, so two
    messages asking for the same thing still make two tasks.
  */
  if p_job is not null then
    select t.task_id, t.project_id into v_id, v_project from public.tasks t
     where t.office_id = p_office
       and t.job_id = p_job
       and lower(btrim(t.title)) = lower(v_title)
       and t.state <> 'cancelled'
       -- A question's own to-do is not this job's work (R45 re-proof): raiseBlocker
       -- files each approval question as a task with the step's title, so without
       -- this an approved step returned the QUESTION and put nothing on his list.
       and t.satisfies_blocker is null
     order by t.created_at limit 1;
    if v_id is not null then
      return jsonb_build_object('ok', true, 'id', v_id, 'title', v_title,
        'project', coalesce(p_project, ''), 'parent', v_parent, 'existing', true);
    end if;

    /*
      AND THE SAME MESSAGE TWICE IS ONE TASK (ledger R18).

      A re-sent message or a double submit arrives as a second command with
      its own dedupe key, so it is a second job and the rule above cannot see
      it. Driven on production: "Add a task to ring the plumber about the
      boiler tomorrow" sent twice three seconds apart made two identical
      tasks, both confirmed. An open task with the same title that THIS
      CONVERSATION's own jobs made in the last ten minutes is the one he
      already asked for; it is returned, marked, and the handler says so.
      Ten minutes and the same conversation, because "add it again" an hour
      later, or from another chat, is a request rather than an accident.
    */
    select t.task_id into v_id
      from public.tasks t
      join public.inbound_commands c on c.job_id = t.job_id and c.office_id = p_office
      join public.inbound_commands me on me.job_id = p_job and me.office_id = p_office
     where t.office_id = p_office
       and t.assigned_to_human
       and t.state not in ('done', 'cancelled')
       and t.satisfies_blocker is null
       and lower(btrim(t.title)) = lower(v_title)
       and t.created_at >= app.now_utc() - interval '10 minutes'
       and c.origin_channel = me.origin_channel
       and split_part(c.origin_ref, ':', 1) = split_part(me.origin_ref, ':', 1)
       and coalesce(c.subject, c.actor) = coalesce(me.subject, me.actor)
     order by t.created_at desc limit 1;
    if v_id is not null then
      return jsonb_build_object('ok', true, 'id', v_id, 'title', v_title,
        'project', coalesce(p_project, ''), 'parent', v_parent,
        'existing', true, 'repeated', true);
    end if;
  end if;

  insert into public.tasks
    (office_id, project_id, title, detail, state, priority, due_on, remind_at,
     assigned_to_human, added_by, labels, parent_task_id, job_id)
  values (p_office, v_project, v_title, coalesce(p_detail, ''), 'todo',
          greatest(coalesce(p_priority, 100), 1), p_due_on, p_remind_at,
          true,
          /*
            Harness traffic names itself, here, once - the rule app.task_add
            already follows (ledger R25). Every personal task a harness job
            made read added_by 'grant', so is_fixture was false and every
            reader that filters on it - reminders_due and tasks_to_push among
            them - treated a test session's task as Grant's.
          */
          case when p_job is not null and app.harness_job(p_job) then 'verify:' || app.office_actor(p_office) else app.office_actor(p_office) end,
          coalesce((select array(select distinct lower(btrim(x))
                                   from unnest(p_labels) x
                                  where btrim(x) <> '' order by 1)), '{}'::text[]),
          v_parent, p_job)
  returning task_id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'title', v_title,
    'project', coalesce(p_project, ''), 'parent', v_parent);
end;
$function$;

create function app.my_task_set(p_office uuid, p_task_id text, p_labels text[] DEFAULT NULL::text[], p_remind_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_repeat_every interval DEFAULT NULL::interval, p_repeat_from text DEFAULT NULL::text, p_clear text[] DEFAULT '{}'::text[], p_title text DEFAULT NULL::text, p_detail text DEFAULT NULL::text, p_priority integer DEFAULT NULL::integer, p_due_on date DEFAULT NULL::date, p_project text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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

create function app.my_task_delete(p_office uuid, p_task_id text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_id       uuid;
  v_title    text;
  v_children int;
begin
  perform app.require_office(p_office);
  begin
    v_id := p_task_id::uuid;
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'that is not a task id');
  end;

  select t.title into v_title
    from public.tasks t
   where t.task_id = v_id and t.office_id = p_office and t.assigned_to_human;

  /*
    0517. Which of the two it is, rather than both at once. Said about a
    task that is already gone, the combined sentence implied the row might
    be the office's.
  */
  if v_title is null
     and not exists (select 1 from public.tasks t where t.task_id = v_id and t.office_id = p_office) then
    return jsonb_build_object('ok', false, 'gone', true,
      'error', 'that task is already gone');
  end if;
  if v_title is null then
    /*
      Named rather than silent, and scoped to MINE. The office's own project
      tasks are not Grant's to delete from this door — #259's second invariant
      is that the two are separate, and a delete that reached across it would
      be the one place the separation stopped mattering.
    */
    return jsonb_build_object('ok', false,
      'error', 'no personal task by that id — the team''s own work is not deleted from here');
  end if;

  select count(*)::int into v_children
    from public.tasks c where c.parent_task_id = v_id and c.office_id = p_office;

  delete from public.tasks where task_id = v_id and office_id = p_office;

  return jsonb_build_object(
    'ok', true, 'deleted', v_title,
    -- Said out loud, because the foreign key takes them and a subtask that
    -- disappears without being mentioned is data loss that looks like a bug.
    'children_deleted', v_children,
    'reason', p_reason);
end
$function$;

create function app.my_task_reparent(p_office uuid, p_task_id text, p_parent text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_id uuid;
  v_parent uuid;
  v_why text;
begin
  perform app.require_office(p_office);
  begin
    v_id := p_task_id::uuid;
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'that is not a task id');
  end;
  if not exists (select 1 from public.tasks t
                  where t.task_id = v_id and t.office_id = p_office and t.assigned_to_human) then
    return jsonb_build_object('ok', false, 'error', 'no personal task by that id');
  end if;

  if coalesce(p_parent, '') <> '' then
    begin
      v_parent := p_parent::uuid;
    exception when others then
      return jsonb_build_object('ok', false, 'error', 'that is not a task id to put this under');
    end;
    v_why := app.task_parent_ok(p_office, v_parent, v_id);
    if v_why is not null then
      return jsonb_build_object('ok', false, 'error', v_why);
    end if;
  end if;

  update public.tasks set parent_task_id = v_parent where task_id = v_id and office_id = p_office;
  return jsonb_build_object('ok', true, 'id', v_id, 'parent', v_parent);
end
$function$;

----------------------------------------------------------------------------------------------------------------------
-- undo: the dashboard's press, checked against the office that did the thing
----------------------------------------------------------------------------------------------------------------------
-- hq_undo is a dispatcher over every reversible writer. This migration converts it for the task branches; each later
-- cluster re-creates its own branch by splicing the live definition (and asserts the splice landed).
create function app.hq_undo(p_office uuid, p_action_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $f$
declare
  v_id       uuid;
  v_action   public.undoable_actions;
  v_outcome  public.undo_status;
  v_args     jsonb;
  v_did      jsonb;
begin
  perform app.require_office(p_office);
  begin
    v_id := p_action_id::uuid;
  exception when others then
    return jsonb_build_object('error', 'that is not an action id');
  end;

  -- An action of another office and an action that does not exist are the same thing to this caller.
  select * into v_action from public.undoable_actions where action_id = v_id and office_id = p_office;
  if not found then
    return jsonb_build_object('error', 'there is nothing here to undo');
  end if;

  v_outcome := app.request_undo(v_id, app.office_actor(p_office), 'studio');

  if v_outcome <> 'undone' then
    return jsonb_build_object('ok', false, 'outcome', v_outcome,
      'note', case v_outcome
        when 'expired'      then 'That offer has lapsed.'
        when 'not_undoable' then 'That one cannot be undone.'
        else 'Already undone.' end);
  end if;

  perform set_config('app.undoing', '1', true);

  v_args := v_action.reversal -> 'args';
  case v_action.reversal ->> 'action'
    when 'rename_project' then
      v_did := app.hq_rename_project(v_args ->> 'p_slug', v_args ->> 'p_name');
    when 'task_state' then
      v_did := app.hq_task_state(p_office, v_args ->> 'p_task_id', v_args ->> 'p_state',
                                 v_args ->> 'p_reason');
    when 'task_update' then
      v_did := app.hq_task_update(
        p_office,
        v_args ->> 'p_task_id', v_args ->> 'p_title', v_args ->> 'p_detail',
        (v_args ->> 'p_due_on')::date, (v_args ->> 'p_starts_on')::date,
        v_args ->> 'p_assignee', v_args ->> 'p_parent',
        (v_args ->> 'p_milestone')::boolean, (v_args ->> 'p_priority')::int,
        coalesce(
          (select array_agg(x #>> '{}') from jsonb_array_elements(v_args -> 'p_clear') x),
          array[]::text[]));
    when 'project_look' then
      v_did := app.hq_project_look(
        v_args ->> 'p_slug', v_args ->> 'p_icon', v_args ->> 'p_hue', null,
        coalesce(
          (select array_agg(x #>> '{}') from jsonb_array_elements(v_args -> 'p_clear') x),
          array[]::text[]));
    when 'dashboard_layout_set' then
      v_did := app.hq_dashboard_layout_set(v_args ->> 'p_slug', v_args -> 'p_panels');
    when 'dashboard_layout_reset' then
      v_did := app.hq_dashboard_layout_reset(v_args ->> 'p_slug');
    when 'unarchive_project' then
      v_did := app.unarchive_project(v_args ->> 'p_slug');
    when 'reattach' then
      v_did := app.hq_reattach((v_args ->> 'p_attachment_id')::uuid, v_args ->> 'p_reason');
    when 'contact_label_rename' then
      v_did := app.hq_contact_label_rename((v_args ->> 'p_label_id')::uuid,
                                           v_args ->> 'p_name');
    when 'contact_labels_set' then
      v_did := app.hq_contact_labels_set((v_args ->> 'p_contact_id')::uuid,
                                         v_args -> 'p_labels');
    when 'contact_fields_set' then
      v_did := app.hq_contact_fields_set((v_args ->> 'p_contact_id')::uuid,
                                         v_args -> 'p_fields');
    when 'tasks_from_job' then
      v_did := app.undo_tasks_from_job((v_args ->> 'p_job')::uuid);
    when 'contact_update' then
      v_did := app.hq_contact_update((v_args ->> 'p_contact_id')::uuid,
                                     v_args ->> 'p_name', v_args ->> 'p_role',
                                     v_args ->> 'p_org', v_args ->> 'p_email',
                                     v_args ->> 'p_phone', v_args ->> 'p_website',
                                     v_args ->> 'p_instagram', v_args ->> 'p_where',
                                     v_args ->> 'p_note', v_args ->> 'p_kind',
                                     v_args ->> 'p_stage', v_args ->> 'p_next',
                                     v_args ->> 'p_next_due');
    when 'contact_archive' then
      v_did := app.hq_contact_archive((v_args ->> 'p_contact_id')::uuid,
                                      (v_args ->> 'p_put_away')::boolean);
    when 'contact_photo_set' then
      v_did := app.hq_contact_photo_set((v_args ->> 'p_contact_id')::uuid,
                                        v_args ->> 'p_path');
    when 'document_rename' then
      v_did := app.rename_document((v_args ->> 'p_document')::uuid,
                                   v_args ->> 'p_title');
    when 'document_move' then
      v_did := app.hq_document_move((v_args ->> 'p_document_id')::uuid,
                                    (v_args ->> 'p_project_id')::uuid);
    when 'document_restore' then
      v_did := app.hq_document_restore((v_args ->> 'p_document_id')::uuid,
                                       v_args ->> 'p_state');
    else
      raise exception 'no way to perform the reversal %', v_action.reversal ->> 'action'
        using errcode = 'feature_not_supported';
  end case;

  if v_did ? 'error' then
    raise exception 'could not undo: %', v_did ->> 'error'
      using errcode = 'raise_exception';
  end if;

  return jsonb_build_object('ok', true, 'outcome', 'undone',
    'kind', v_action.kind, 'note', format('Undone — %s', v_action.description));
end
$f$;
revoke all on function app.hq_undo(uuid, text) from public, anon, authenticated, service_role;

----------------------------------------------------------------------------------------------------------------------
-- the public doors: service role only, the office FIRST, no default
----------------------------------------------------------------------------------------------------------------------
create function public.hq_task_add(p_office uuid, p_project text, p_title text, p_detail text default null,
  p_due_on date default null, p_assignee text default null, p_milestone boolean default false)
returns jsonb language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_task_add(p_office, p_project, p_title, p_detail, p_due_on, p_assignee, p_milestone) $f$;

create function public.hq_task_state(p_office uuid, p_task_id text, p_state text, p_reason text default null, p_by text default null)
returns jsonb language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_task_state(p_office, p_task_id, p_state, p_reason, p_by) $f$;

create function public.hq_task_update(p_office uuid, p_task_id text, p_title text default null, p_detail text default null,
  p_due_on date default null, p_starts_on date default null, p_assignee text default null, p_parent text default null,
  p_milestone boolean default null, p_priority integer default null, p_clear text[] default array[]::text[])
returns jsonb language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_task_update(p_office, p_task_id, p_title, p_detail, p_due_on, p_starts_on, p_assignee, p_parent,
  p_milestone, p_priority, p_clear) $f$;

create function public.my_task_add(p_office uuid, p_title text, p_detail text default '', p_due_on date default null,
  p_remind_at timestamptz default null, p_priority integer default 100, p_project text default null,
  p_labels text[] default null, p_parent text default null)
returns jsonb language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.my_task_add(p_office, p_title, p_detail, p_due_on, p_remind_at, p_priority, p_project, p_labels, p_parent) $f$;

create function public.my_task_delete(p_office uuid, p_task_id text, p_reason text default null)
returns jsonb language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.my_task_delete(p_office, p_task_id, p_reason) $f$;

create function public.my_task_reparent(p_office uuid, p_task_id text, p_parent text default null)
returns jsonb language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.my_task_reparent(p_office, p_task_id, p_parent) $f$;

create function public.my_task_set(p_office uuid, p_task_id text, p_labels text[] default null,
  p_remind_at timestamptz default null, p_repeat_every interval default null, p_repeat_from text default null,
  p_clear text[] default '{}', p_title text default null, p_detail text default null, p_priority integer default null,
  p_due_on date default null, p_project text default null)
returns jsonb language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.my_task_set(p_office, p_task_id, p_labels, p_remind_at, p_repeat_every, p_repeat_from, p_clear,
  p_title, p_detail, p_priority, p_due_on, p_project) $f$;

create function public.my_tasks(p_office uuid, p_bucket text default 'today', p_limit integer default 200,
  p_query text default null, p_sort text default 'smart')
returns jsonb language sql stable security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.my_tasks(p_office, p_bucket, p_limit, p_query, p_sort) $f$;

create function public.my_tasks_counts(p_office uuid)
returns jsonb language sql stable security definer set search_path to ''
as $f$ select app.my_tasks_counts(p_office) $f$;

create function public.hq_undo(p_office uuid, p_action_id text)
returns jsonb language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_undo(p_office, p_action_id) $f$;

do $g$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('hq_task_add','hq_task_state','hq_task_update','my_task_add','my_task_delete',
                                'my_task_reparent','my_task_set','my_tasks','my_tasks_counts','hq_undo')
              and (pg_get_function_arguments(p.oid)) like 'p_office uuid%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $g$;

----------------------------------------------------------------------------------------------------------------------
-- the Vikunja pull: tasks arrive into ONE office
----------------------------------------------------------------------------------------------------------------------
create function app.task_pulled(p_office uuid, p_provider text, p_external_id text, p_fields jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_provider text := btrim(coalesce(p_provider, ''));
  v_ext      text := btrim(coalesce(p_external_id, ''));
  v_link     public.task_links%rowtype;
  v_task     public.tasks%rowtype;
  v_title    text := nullif(btrim(coalesce(p_fields ->> 'title', '')), '');
  v_rev      text := nullif(btrim(coalesce(p_fields ->> 'external_revision', '')), '');
  v_id       uuid;
  v_conflict boolean := false;
  v_changed  text[] := '{}';
begin
  perform app.require_office(p_office);
  if v_provider = '' or v_ext = '' then
    return jsonb_build_object('error', 'a pulled task needs a provider and an external id');
  end if;

  /*
    THE TOMBSTONE IS CHECKED FIRST, and against the EXTERNAL id.

    A task Grant deleted here can still be sitting in the provider, and the
    provider will offer it back on every pull for ever. Checking the canonical
    id would not help: by the time a pull arrives the link may already be gone.
  */
  if exists (
    select 1 from public.task_tombstones d
     where d.office_id = p_office
       and d.cleared_at is null
       and d.links @> jsonb_build_array(
             jsonb_build_object('provider', v_provider, 'external_id', v_ext))
  ) then
    return jsonb_build_object(
      'ok', false, 'deleted', true,
      'note', 'that task was deleted here - remove it at the provider rather than recreating it');
  end if;

  select l.* into v_link from public.task_links l
    join public.tasks lt on lt.task_id = l.task_id and lt.office_id = p_office
   where l.provider = v_provider and l.external_id = v_ext;

  -- ------------------------------------------------------------------ new --
  if not found then
    if v_title is null then
      return jsonb_build_object('error', 'a new task needs a title');
    end if;
    v_id := (app.my_task_add(
      p_office  => p_office,
      p_title   => left(v_title, 500),
      p_detail  => coalesce(p_fields ->> 'detail', ''),
      p_due_on  => nullif(p_fields ->> 'due_on', '')::date,
      p_priority => nullif(p_fields ->> 'priority', '')::int
    ) ->> 'id')::uuid;
    if v_id is null then
      return jsonb_build_object('error', 'the task could not be created here');
    end if;
    if coalesce((p_fields ->> 'done')::boolean, false) then
      update public.tasks set state = 'done', done_at = app.now_utc() where task_id = v_id and office_id = p_office;
    end if;
    select * into v_task from public.tasks where task_id = v_id and office_id = p_office;
    insert into public.task_links
      (task_id, provider, external_id, external_project_id, external_revision,
       synced_revision, pulled_at, sync_state)
    values (v_id, v_provider, v_ext, nullif(p_fields ->> 'external_project_id', ''),
            v_rev, v_task.revision, app.now_utc(), 'ok');
    return jsonb_build_object('ok', true, 'created', true, 'id', v_id,
                              'title', v_task.title, 'revision', v_task.revision);
  end if;

  -- ------------------------------------------------------------- existing --
  select * into v_task from public.tasks where task_id = v_link.task_id and office_id = p_office;
  if not found then
    -- The link outlived its task. Nothing to update and nothing to resurrect.
    delete from public.task_links where task_id = v_link.task_id and provider = v_provider;
    return jsonb_build_object('ok', false, 'deleted', true,
      'note', 'that task no longer exists here');
  end if;

  /*
    BOTH SIDES MOVED. Canonical is kept and the disagreement is recorded.

    `synced_revision` is the canonical revision as of the last successful
    sync in EITHER direction, so "greater than" means somebody changed the
    task here since the provider was last in step with it.
  */
  if v_task.revision > coalesce(v_link.synced_revision, 0) then
    v_conflict := true;
  end if;

  if not v_conflict then
    /*
      `is distinct from` on every column, so applying the same payload twice
      does not move `revision` — the trigger fires on any UPDATE, including
      one that changes nothing.
    */
    if v_title is not null and v_title is distinct from v_task.title then
      update public.tasks set title = left(v_title, 500) where task_id = v_task.task_id and office_id = p_office;
      v_changed := v_changed || array['title'];
    end if;
    if (p_fields ? 'detail')
       and coalesce(p_fields ->> 'detail', '') is distinct from coalesce(v_task.detail, '') then
      update public.tasks set detail = coalesce(p_fields ->> 'detail', '')
       where task_id = v_task.task_id and office_id = p_office;
      v_changed := v_changed || array['detail'];
    end if;
    if (p_fields ? 'due_on')
       and nullif(p_fields ->> 'due_on', '')::date is distinct from v_task.due_on then
      update public.tasks set due_on = nullif(p_fields ->> 'due_on', '')::date
       where task_id = v_task.task_id and office_id = p_office;
      v_changed := v_changed || array['due_on'];
    end if;
    if (p_fields ? 'priority')
       and nullif(p_fields ->> 'priority', '')::int is not null
       and nullif(p_fields ->> 'priority', '')::int is distinct from v_task.priority then
      update public.tasks set priority = nullif(p_fields ->> 'priority', '')::int
       where task_id = v_task.task_id and office_id = p_office;
      v_changed := v_changed || array['priority'];
    end if;
    if (p_fields ? 'done') then
      if coalesce((p_fields ->> 'done')::boolean, false) and v_task.state <> 'done' then
        update public.tasks set state = 'done', done_at = app.now_utc()
         where task_id = v_task.task_id and office_id = p_office;
        v_changed := v_changed || array['done'];
      elsif not coalesce((p_fields ->> 'done')::boolean, false) and v_task.state = 'done' then
        update public.tasks set state = 'todo', done_at = null
         where task_id = v_task.task_id and office_id = p_office;
        v_changed := v_changed || array['reopened'];
      end if;
    end if;
  end if;

  select * into v_task from public.tasks where task_id = v_link.task_id and office_id = p_office;
  update public.task_links
     set external_revision = coalesce(v_rev, external_revision),
         external_project_id = coalesce(nullif(p_fields ->> 'external_project_id', ''),
                                        external_project_id),
         pulled_at = app.now_utc(),
         /*
           A conflict does NOT advance the watermark. The canonical value is
           still ahead of the provider, so it must still be offered for push —
           which is what resolves the conflict on the next round, in the
           direction the invariant requires.
         */
         synced_revision = case when v_conflict then synced_revision else v_task.revision end,
         sync_state = case when v_conflict then 'conflict' else 'ok' end,
         sync_error = case when v_conflict
                           then 'both sides changed this since the last sync - the copy here was kept'
                           else null end,
         updated_at = app.now_utc()
   where task_id = v_link.task_id and provider = v_provider;

  return jsonb_build_object('ok', true, 'id', v_task.task_id, 'title', v_task.title,
                            'conflict', v_conflict, 'changed', to_jsonb(v_changed),
                            'revision', v_task.revision);
end;
$function$;
revoke all on function app.task_pulled(uuid, text, text, jsonb) from public, anon, authenticated, service_role;
drop function app.task_pulled(text, text, jsonb);

----------------------------------------------------------------------------------------------------------------------
-- the old signatures go: nothing may call a task function without saying whose
----------------------------------------------------------------------------------------------------------------------
drop function public.hq_task_add(text, text, text, date, text, boolean);
drop function public.hq_task_state(text, text, text, text);
drop function public.hq_task_update(text, text, text, date, date, text, text, boolean, integer, text[]);
drop function public.my_task_add(text, text, date, timestamptz, integer, text, text[], text);
drop function public.my_task_delete(text, text);
drop function public.my_task_reparent(text, text);
drop function public.my_task_set(text, text[], timestamptz, interval, text, text[], text, text, integer, date, text);
drop function public.my_tasks(text, integer, text, text);
drop function public.my_tasks_counts();
drop function public.hq_undo(text);
drop function public.task_add(uuid, text, text, date, text, boolean, text, uuid);
drop function app.hq_task_add(text, text, text, date, text, boolean);
drop function app.hq_task_state(text, text, text, text);
drop function app.hq_task_update(text, text, text, date, date, text, text, boolean, integer, text[]);
drop function app.my_task_add(text, text, date, timestamptz, integer, text, text[], text, uuid);
drop function app.my_task_delete(text, text);
drop function app.my_task_reparent(text, text);
drop function app.my_task_set(text, text[], timestamptz, interval, text, text[], text, text, integer, date, text);
drop function app.my_tasks(text, integer, text, text, boolean);
drop function app.my_tasks_counts();
drop function app.hq_undo(text);
drop function app.task_add(uuid, text, text, date, text, boolean, text, uuid);
drop function app.task_parent_ok(uuid, uuid);
