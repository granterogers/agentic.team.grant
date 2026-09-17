-- Tasks reach the diary (#94, ADR-0020).
--
-- Grant marked this high priority himself, and it is the only item in a
-- thirty-item review that he ranked.
--
-- Reading the diary was already finished: `google_services` carries a calendar
-- row whose scopes are `calendar.events` AND `calendar.readonly`, so the WRITE
-- scope is already granted and needs no fresh consent; `public.calendar_events`
-- holds six real events; and a handler refreshes them hourly. What was missing
-- is the other direction.
--
-- ## The one rule that makes this safe
--
-- The office has write access to a real human calendar. Every event this
-- creates carries `extendedProperties.private.hqTaskId`, and every update and
-- delete is matched on THAT and on a row in the link table below -- never on a
-- title, a date or a search. An implementation that found "its" events by
-- matching titles would eventually match a meeting Grant typed himself, and
-- there is no version of that which is acceptable.
--
-- ## Off until he turns it on
--
-- `calendar.sync_tasks` defaults to false. Writing into someone's real diary is
-- not something to start because a feature shipped.

-- ---------------------------------------------------------------------------
-- What we put there
-- ---------------------------------------------------------------------------
create table if not exists public.task_calendar_links (
  task_id      uuid primary key references public.tasks(task_id) on delete cascade,
  calendar_id  text        not null,
  event_id     text        not null,
  -- A hash of exactly what was pushed. An unchanged task costs no API call, and
  -- the worker runs sixteen times a day against a list that mostly does not
  -- move.
  pushed_hash  text        not null,
  pushed_at    timestamptz not null default app.now_utc(),
  constraint task_calendar_links_event_present check (length(btrim(event_id)) > 0),
  constraint task_calendar_links_calendar_present check (length(btrim(calendar_id)) > 0)
);

comment on table public.task_calendar_links is
  'One row per task the office has written into Google Calendar (ADR-0020). '
  'The event_id here plus extendedProperties.private.hqTaskId on the event are '
  'the only two ways this feature identifies its own work. Deleting a row '
  'orphans an event rather than removing it.';

create index if not exists task_calendar_links_pushed
  on public.task_calendar_links (pushed_at desc);

-- ---------------------------------------------------------------------------
-- What the worker should do on this pass
-- ---------------------------------------------------------------------------
--
-- Three lists in one call, because the alternative is three round trips and a
-- window between them in which the answer changes:
--
--   create  a dated, open, non-fixture task with no link
--   update  a linked task whose hash has moved
--   remove  a linked task that is now done, cancelled, undated, or gone
--
-- The hash is computed HERE rather than in TypeScript so that the decision
-- about what counts as a change lives beside the query that uses it. Title,
-- date and detail: those are what reach the event. A change of assignee does
-- not move the diary.
create or replace function app.calendar_task_plan()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with wanted as (
    select t.task_id,
           t.title,
           t.detail,
           t.due_on,
           p.name as project,
           md5(coalesce(t.title, '') || '|' || coalesce(t.due_on::text, '') || '|' ||
               coalesce(t.detail, '') || '|' || coalesce(p.name, '')) as hash
      from public.tasks t
      join public.projects p on p.project_id = t.project_id
     where t.due_on is not null
       and t.state in ('todo', 'doing', 'blocked')
       and not t.is_fixture
       and not p.is_fixture
  )
  select jsonb_build_object(
    'create', coalesce((
      select jsonb_agg(jsonb_build_object(
               'task_id', w.task_id, 'title', w.title, 'detail', w.detail,
               'due_on', w.due_on, 'project', w.project, 'hash', w.hash))
        from wanted w
        left join public.task_calendar_links l on l.task_id = w.task_id
       where l.task_id is null), '[]'::jsonb),
    'update', coalesce((
      select jsonb_agg(jsonb_build_object(
               'task_id', w.task_id, 'title', w.title, 'detail', w.detail,
               'due_on', w.due_on, 'project', w.project, 'hash', w.hash,
               'calendar_id', l.calendar_id, 'event_id', l.event_id))
        from wanted w
        join public.task_calendar_links l on l.task_id = w.task_id
       where l.pushed_hash is distinct from w.hash), '[]'::jsonb),
    -- A link whose task is no longer wanted. The task row may still exist
    -- (done, cancelled, or its date removed) or may be gone entirely, and the
    -- cascade takes care of the second case before we ever see it.
    'remove', coalesce((
      select jsonb_agg(jsonb_build_object(
               'task_id', l.task_id, 'calendar_id', l.calendar_id, 'event_id', l.event_id))
        from public.task_calendar_links l
        left join wanted w on w.task_id = l.task_id
       where w.task_id is null), '[]'::jsonb)
  )
$$;

-- Record that an event now exists for a task.
create or replace function app.calendar_link_set(
  p_task_id uuid, p_calendar_id text, p_event_id text, p_hash text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.task_calendar_links (task_id, calendar_id, event_id, pushed_hash, pushed_at)
  values (p_task_id, p_calendar_id, p_event_id, p_hash, app.now_utc())
  on conflict (task_id) do update
     set calendar_id = excluded.calendar_id,
         event_id    = excluded.event_id,
         pushed_hash = excluded.pushed_hash,
         pushed_at   = excluded.pushed_at;
$$;

-- And that it no longer does. Called only after the delete at Google has been
-- confirmed, so a failed delete leaves the link and is retried next pass rather
-- than being forgotten with the event still sitting in his diary.
create or replace function app.calendar_link_clear(p_task_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.task_calendar_links where task_id = p_task_id;
$$;

-- PostgREST only exposes `public`.
create or replace function public.calendar_task_plan()
returns jsonb language sql stable security definer set search_path = public, pg_catalog
as $$ select app.calendar_task_plan() $$;

create or replace function public.calendar_link_set(
  p_task_id uuid, p_calendar_id text, p_event_id text, p_hash text)
returns void language sql security definer set search_path = public, pg_catalog
as $$ select app.calendar_link_set(p_task_id, p_calendar_id, p_event_id, p_hash) $$;

create or replace function public.calendar_link_clear(p_task_id uuid)
returns void language sql security definer set search_path = public, pg_catalog
as $$ select app.calendar_link_clear(p_task_id) $$;
