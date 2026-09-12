-- 0280 — tasks across the whole portfolio
--
-- Issue #173, tracked from #169. Grant:
--
--   > The Chief of Staff should eventually be capable of answering: **"What
--   > should I be doing next?"** — considering priorities and dependencies
--   > across multiple projects.
--
-- ## What already exists, so nothing is rebuilt
--
-- `public.tasks` is a complete schema and has been since #11: state, priority,
-- due_on, starts_on, assignee, parent, milestone, done_at, added_by. It has
-- `hq_task_add`, `hq_task_update`, `hq_task_state` as a full write path since
-- #106, calendar sync since #94/ADR-0020, and undo since #118.
--
-- **It has zero rows.** This is not a migration of existing data; it is a
-- feature nobody has been able to use, because every task must belong to a
-- project and there was nowhere to see them together.
--
-- ## Two changes, and the first is one line
--
-- **A task may belong to no project.** `project_id` was NOT NULL, so "renew the
-- domain" and "reply to Ben" had nowhere to go — and a task system that cannot
-- hold the things that are not filed anywhere is one people keep a second list
-- beside. That second list is where the real work ends up.
--
-- **One read model over all of them.** `app.hq_portfolio_tasks()` aggregates
-- rather than duplicates: a task lives in one row and appears in two views, so
-- ticking it in a project ticks it in the portfolio because they are the same
-- row. #173 is explicit that duplication is the failure here.
--
-- ## Overdue, stale and blocked are computed, never stored
--
-- A stored `is_overdue` is wrong the moment midnight passes, and this office
-- has already shipped a stale-flag bug of exactly that shape — the studio's
-- relative times (#153). They are derived on read, in Grant's timezone rather
-- than UTC, because "due today" at 23:00 in London is not "due tomorrow".
--
-- ## Confirmed versus suggested
--
-- #173: *"Distinguish between confirmed tasks and agent-suggested tasks."*
--
-- `added_by` already exists and defaults to 'grant', so the distinction needs
-- no new column: anything an agent added is a suggestion until he has seen it.
-- That matters more once #139 (an agent proposing work) and #130's
-- `tasks_extracted` shape land, because both produce tasks nobody has agreed to.

begin;

-- ---------------------------------------------------------------------------
-- A task that belongs to no project
-- ---------------------------------------------------------------------------

alter table public.tasks alter column project_id drop not null;

comment on column public.tasks.project_id is
  '#173. Nullable: not everything Grant has to do belongs to a dashboard '
  'project. A task system that cannot hold "renew the domain" is one he keeps '
  'a second list beside, and the second list is where the real work ends up.';

/*
  A parent must be on the same project, INCLUDING when both are on none.

  `hq_task_update` compares `project_id = v_project`, which is NULL when both
  sides are null -- so a null-project task could never be given a null-project
  parent, and the refusal would have read as "that parent is not a task on the
  same dashboard project", which is true of nothing and explains nothing.
  `is not distinct from` is the comparison that means what the sentence means.
*/
create or replace function app.hq_task_update(
  p_task_id text, p_title text default null, p_detail text default null,
  p_due_on date default null, p_starts_on date default null, p_assignee text default null,
  p_parent text default null, p_milestone boolean default null, p_priority integer default null,
  p_clear text[] default array[]::text[])
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
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
  begin
    v_id := p_task_id::uuid;
  exception when others then
    return jsonb_build_object('error', format('%L is not a task id', p_task_id));
  end;

  -- Existence and project are now two questions, not one: a task legitimately
  -- has no project, so a null project_id no longer means "no such task".
  select true, t.project_id into v_found, v_project
    from public.tasks t where t.task_id = v_id;
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
    if not exists (select 1 from public.tasks where task_id = v_parent
                    and project_id is not distinct from v_project) then
      return jsonb_build_object('error',
        case when v_project is null
             then 'that parent belongs to a project and this task does not'
             else 'that parent is not a task on the same dashboard project' end);
    end if;
    -- The cycle. A -> B -> A is invisible to a single-level comparison, so
    -- walk the proposed parent's own ancestry and refuse if this task is in it.
    if exists (
      with recursive up as (
        select task_id, parent_task_id from public.tasks where task_id = v_parent
        union all
        select t.task_id, t.parent_task_id
          from public.tasks t join up on t.task_id = up.parent_task_id
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
    from public.tasks t where t.task_id = v_id;

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
   where task_id = v_id;

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
    from public.tasks t where t.task_id = v_id;
  return v;
end;
$function$;

-- ---------------------------------------------------------------------------
-- One list, across everything
-- ---------------------------------------------------------------------------

/**
 * Every open task Grant has, wherever it lives.
 *
 * Aggregates rather than duplicates: one row per task, carrying its project
 * when it has one. Ticking it in a project ticks it here because it is the
 * same row — #173 names duplication as the failure to avoid.
 *
 * `overdue`, `stale` and `waiting` are computed on read and never stored. A
 * stored overdue flag is wrong the moment midnight passes, and the timezone is
 * his rather than UTC because "due today" at 23:00 in London is not tomorrow.
 */
create or replace function app.hq_portfolio_tasks(p_limit int default 200)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with today as (
    select (app.now_utc() at time zone app.grant_timezone())::date as d
  ),
  open_tasks as (
    select t.task_id, t.title, t.detail, t.state, t.priority, t.due_on, t.starts_on,
           t.is_milestone, t.parent_task_id, t.blocked_on, t.added_by,
           t.updated_at, t.created_at, t.project_id,
           p.slug as project_slug, p.name as project_name,
           s.slug as owner_slug, s.name as owner_name,
           /*
             An agent put it there, so Grant has not agreed to it. `added_by`
             already carried this and nothing had ever read it -- which is why
             #139's proposals and #130's extracted tasks have somewhere to land
             without a new column.
           */
           (t.added_by is distinct from 'grant') as suggested
      from public.tasks t
      left join public.projects p on p.project_id = t.project_id
      left join public.staff s on s.staff_id = t.assignee_staff
     where not t.is_fixture
       and t.state in ('todo', 'doing', 'blocked')
       -- A task on an archived project is not work; the project was put away.
       and (t.project_id is null or p.status = 'active')
  ),
  ranked as (
    select o.*,
           (o.due_on is not null and o.due_on < (select d from today)) as overdue,
           /*
             Nothing has happened to it in a fortnight and nothing is stopping
             it. `blocked` is excluded deliberately: a blocked task is not
             neglected, it is waiting, and flagging it as stale would bury the
             ones that genuinely are.
           */
           (o.state in ('todo', 'doing')
            and o.updated_at < app.now_utc() - interval '14 days') as stale,
           (o.state = 'blocked') as waiting,
           (o.assignee_slug_missing) as unowned
      from (select oo.*, (oo.owner_slug is null) as assignee_slug_missing from open_tasks oo) o
  )
  select jsonb_build_object(
    'at', app.now_utc(),
    'today', (select d from today),
    'counts', jsonb_build_object(
      'open',     (select count(*) from ranked),
      'overdue',  (select count(*) from ranked where overdue),
      'waiting',  (select count(*) from ranked where waiting),
      'stale',    (select count(*) from ranked where stale),
      'unowned',  (select count(*) from ranked where unowned),
      'suggested',(select count(*) from ranked where suggested),
      'no_project',(select count(*) from ranked where project_id is null)),
    'tasks', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', r.task_id, 'title', r.title, 'detail', nullif(r.detail, ''),
               'state', r.state, 'priority', r.priority,
               'due_on', r.due_on, 'starts_on', r.starts_on,
               'milestone', r.is_milestone, 'parent', r.parent_task_id,
               'blocked_on', nullif(r.blocked_on, ''),
               'project', r.project_slug, 'project_name', r.project_name,
               'owner', r.owner_slug, 'owner_name', r.owner_name,
               'overdue', r.overdue, 'stale', r.stale,
               'waiting', r.waiting, 'unowned', r.unowned,
               'suggested', r.suggested,
               'added_by', r.added_by)
             /*
               What to do next, as an ordering rather than an opinion.

               Overdue first, then a date approaching, then what he marked
               important, then a milestone, then oldest. Dated work outranks
               undated work because a date is a commitment somebody else may be
               waiting on -- priority alone would let a P1 with no date sit
               above something due this morning.
             */
             order by r.overdue desc,
                      (r.due_on is null), r.due_on asc nulls last,
                      r.priority asc, r.is_milestone desc, r.created_at asc)
             , '[]'::jsonb)
        from (select * from ranked
               order by overdue desc, (due_on is null), due_on asc nulls last,
                        priority asc, is_milestone desc, created_at asc
               limit greatest(coalesce(p_limit, 200), 1)) r
    )
  )
$$;

comment on function app.hq_portfolio_tasks is
  '#173. One row per task across every project and none. overdue/stale/waiting '
  'are computed on read in Grant''s timezone -- a stored overdue flag is wrong '
  'the moment midnight passes.';

create or replace function public.hq_portfolio_tasks(p_limit int default 200)
returns jsonb language sql stable security definer set search_path = public, pg_catalog
as $$ select app.hq_portfolio_tasks(p_limit) $$;

grant execute on function app.hq_portfolio_tasks(int) to ai_team_app;

commit;
