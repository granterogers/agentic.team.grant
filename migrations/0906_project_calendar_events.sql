-- 0906 (written as 0897; renumbered 6 Oct 2026 because the Public Sample Office applied its own 0897 to production first,
-- contents unchanged apart from the numbers in comments) - every dashboard project has its own calendar (UX overnight,
-- project calendars: backend).
--
-- A dashboard project is a row in public.projects. This gives each one a calendar:
--
--   public.project_events           events NATIVE to a project. Created in Team HQ (or by an agent, or over Telegram,
--                                   Slack, ChatGPT, Claude), they belong to one project from birth and synchronise toward
--                                   Google Calendar when Google is connected: create, edit and delete, both directions.
--   public.calendar_event_projects  the assignment of an EXISTING Google event (a row of the read cache,
--                                   public.calendar_events) to a project. The event stays external, owned by Google; only
--                                   the filing is ours.
--
-- Three scopes for reading (app.hq_project_events):
--   project  this project's native events, plus the Google events assigned to it
--   all      every project's native events, plus every assigned Google event (never a fixture or archived project)
--   google   everything in the Google cache INCLUDING the unassigned ones, plus the native events that live in Google
--
-- Every write carries its channel of origin (teamhq, chatgpt, claude, telegram, slack, google_sync ...) as a word of a
-- shape, not an enumeration (a list of channels is a list somebody forgets to extend), and records an Activity event
-- (event.created, event.updated, event.deleted, event.assigned, event.unassigned) with the channel in its detail.
--
-- WHY A TOMBSTONE. Deleting an event that already lives in Google must reach Google BEFORE the row goes, or the next
-- refresh would find the Google copy and the event would come back from the dead. So a linked event is marked
-- deleted_at and left pending until the sync handler (calendar.sync_events) has deleted it remotely and purged it.
-- An event that never reached Google has nothing to propagate and is deleted outright.
--
-- WHY AN AUTHORITY COLUMN. Grant pressing Add in his own dashboard is his own act. An agent proposing an event is not,
-- and calendar.write is a level-2 tool: the handler asks the approval policy (governOutward) before writing outward for
-- a row whose last writer was an agent. The column records which kind of writer last touched the row.
--
-- Spliced from nothing: new tables and new functions only; no existing function is changed. The one existing table
-- touched is calendar_events, which gains a composite unique key so the assignment can be office-consistent by FK.

-- ---------------------------------------------------------------------------------------------------------------------
-- the cache gains the key an office-consistent foreign key needs
-- ---------------------------------------------------------------------------------------------------------------------
alter table public.calendar_events
  add constraint calendar_events_key_office unique (calendar_id, event_id, office_id);

-- ---------------------------------------------------------------------------------------------------------------------
-- public.project_events
-- ---------------------------------------------------------------------------------------------------------------------
create table public.project_events (
  event_id            uuid primary key default gen_random_uuid(),
  office_id           uuid not null references public.offices(office_id),
  project_id          uuid not null,
  title               text not null check (btrim(title) <> '' and length(title) <= 300),
  notes               text check (notes is null or length(notes) <= 8000),
  location            text check (location is null or length(location) <= 500),
  starts_at           timestamptz not null,
  ends_at             timestamptz not null,
  all_day             boolean not null default false,
  origin_channel      text not null check (origin_channel ~ '^[a-z][a-z0-9_]{1,31}$'),
  created_by          text not null check (btrim(created_by) <> ''),
  -- person: a person's own act (pushed to Google outright). agent: an agent's proposal (asks the approval policy first).
  authority           text not null default 'person' check (authority in ('person', 'agent')),
  external_calendar_id text,
  external_event_id    text,
  external_etag        text,
  -- Google's own `updated` stamp as of the last time the two sides agreed. The pull compares the cache to this.
  external_updated_at  timestamptz,
  last_synced_at       timestamptz,
  sync_state          text not null default 'local' check (sync_state in ('local', 'pending', 'synced', 'error')),
  sync_error          text check (sync_error is null or length(sync_error) <= 1000),
  deleted_at          timestamptz,
  created_at          timestamptz not null default app.now_utc(),
  updated_at          timestamptz not null default app.now_utc(),
  constraint project_events_ends_after_start check (ends_at >= starts_at),
  constraint project_events_link_is_whole check ((external_calendar_id is null) = (external_event_id is null)),
  constraint project_events_project_same_office
    foreign key (project_id, office_id) references public.projects(project_id, office_id) on delete cascade
);
create unique index project_events_one_per_google_event
  on public.project_events (external_calendar_id, external_event_id) where external_event_id is not null;
create index project_events_project_when on public.project_events (project_id, starts_at) where deleted_at is null;
create index project_events_office_when on public.project_events (office_id, starts_at) where deleted_at is null;
create index project_events_to_sync on public.project_events (office_id) where sync_state = 'pending';
comment on table public.project_events is
  'Events native to a dashboard project; synchronised toward Google Calendar by the calendar.sync_events handler. A linked event is tombstoned (deleted_at) until the deletion has reached Google. Written only by app.hq_event_*.';

create trigger a1_office_write_once
  before update on public.project_events
  for each row execute function app.office_id_is_write_once();

create or replace function app.project_events_touch()
returns trigger
language plpgsql
set search_path to ''
as $f$
begin
  -- Only a change of CONTENT moves updated_at. The sync handler marks a row synced without changing what it says, and
  -- that must not look like a newer edit when the conflict policy compares timestamps.
  if new.title is distinct from old.title or new.notes is distinct from old.notes
     or new.location is distinct from old.location or new.starts_at is distinct from old.starts_at
     or new.ends_at is distinct from old.ends_at or new.all_day is distinct from old.all_day
     or new.deleted_at is distinct from old.deleted_at or new.project_id is distinct from old.project_id then
    new.updated_at := app.now_utc();
  end if;
  return new;
end
$f$;
create trigger project_events_touch
  before update on public.project_events
  for each row execute function app.project_events_touch();

alter table public.project_events enable row level security;
revoke all on table public.project_events from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- public.calendar_event_projects
-- ---------------------------------------------------------------------------------------------------------------------
create table public.calendar_event_projects (
  office_id      uuid not null references public.offices(office_id),
  calendar_id    text not null,
  event_id       text not null,
  project_id     uuid not null,
  assigned_by    text not null check (btrim(assigned_by) <> ''),
  origin_channel text not null check (origin_channel ~ '^[a-z][a-z0-9_]{1,31}$'),
  assigned_at    timestamptz not null default app.now_utc(),
  primary key (calendar_id, event_id),
  constraint calendar_event_projects_event_same_office
    foreign key (calendar_id, event_id, office_id)
    references public.calendar_events(calendar_id, event_id, office_id) on delete cascade,
  constraint calendar_event_projects_project_same_office
    foreign key (project_id, office_id) references public.projects(project_id, office_id) on delete cascade
);
create index calendar_event_projects_project on public.calendar_event_projects (project_id);
comment on table public.calendar_event_projects is
  'Which project an EXISTING Google event is filed under. The event stays Google''s; deleting the cached copy (the event left Google) takes the filing with it. Written only by app.hq_event_assign / hq_event_unassign.';

create trigger a1_office_write_once
  before update on public.calendar_event_projects
  for each row execute function app.office_id_is_write_once();

alter table public.calendar_event_projects enable row level security;
revoke all on table public.calendar_event_projects from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- small predicates
-- ---------------------------------------------------------------------------------------------------------------------
-- Is Google Calendar connected for this office? The same row the Connections panel reads (recordGoogleHealth writes it on
-- every Google duty): 'ok' means the last token exchange worked.
create function app.google_calendar_connected(p_office uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $f$
  select exists (
    select 1 from public.connection_health h
     where h.office_id = p_office and h.service = 'google_calendar' and h.credential = 'oauth_client'
       and h.state = 'ok')
$f$;
revoke all on function app.google_calendar_connected(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- app.hq_project_events - the reader
-- ---------------------------------------------------------------------------------------------------------------------
create function app.hq_project_events(
  p_office uuid, p_slug text default null, p_from text default null, p_to text default null,
  p_scope text default 'project')
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $f$
declare
  v_scope   text := coalesce(nullif(btrim(p_scope), ''), 'project');
  v_project uuid;
  v_from    timestamptz;
  v_to      timestamptz;
  v_events  jsonb;
begin
  perform app.require_office(p_office);
  if v_scope not in ('project', 'all', 'google') then
    return jsonb_build_object('error', format('%L is not a scope - it is one of project, all, google', p_scope));
  end if;
  begin
    v_from := coalesce(nullif(btrim(p_from), '')::timestamptz, app.now_utc() - interval '30 days');
    v_to   := coalesce(nullif(btrim(p_to), '')::timestamptz, v_from + interval '90 days');
  exception when others then
    return jsonb_build_object('error', 'from and to must be dates or timestamps (for example 2026-10-01 or 2026-10-01T09:00:00Z)');
  end;
  if v_to <= v_from then
    return jsonb_build_object('error', 'the window must end after it starts');
  end if;
  if v_to - v_from > interval '400 days' then
    return jsonb_build_object('error', 'the window is longer than 400 days - ask for a shorter one');
  end if;

  if v_scope = 'project' then
    select project_id into v_project from public.projects where slug = p_slug and office_id = p_office;
    if v_project is null then
      return jsonb_build_object('error', format('no project called %L', p_slug));
    end if;
  end if;

  select coalesce(jsonb_agg(u.j order by u.s, u.t, u.i), '[]'::jsonb) into v_events
    from (
      -- native events
      select jsonb_build_object(
               'id', e.event_id::text, 'source', 'team_hq', 'title', e.title,
               'starts_at', e.starts_at, 'ends_at', e.ends_at, 'all_day', e.all_day,
               'notes', e.notes, 'location', e.location,
               'project_slug', p.slug, 'project_name', p.name,
               'sync', e.sync_state, 'sync_error', e.sync_error,
               'external_url', c.html_link, 'origin_channel', e.origin_channel,
               'editable', true) as j,
             e.starts_at as s, e.title as t, e.event_id::text as i
        from public.project_events e
        join public.projects p on p.project_id = e.project_id and p.office_id = e.office_id
        left join public.calendar_events c
          on c.calendar_id = e.external_calendar_id and c.event_id = e.external_event_id and c.office_id = e.office_id
       where e.office_id = p_office
         and e.deleted_at is null
         and e.ends_at >= v_from and e.starts_at < v_to
         and case v_scope
               when 'project' then e.project_id = v_project
               when 'all'     then not p.is_fixture and p.status <> 'archived'
               else e.sync_state <> 'local' and not p.is_fixture
             end
      union all
      -- Google events (the cache), assigned or not. One that is the twin of a native event is shown ONCE, as the native.
      select jsonb_build_object(
               'id', 'g:' || c.calendar_id || ':' || c.event_id, 'source', 'google',
               'title', coalesce(nullif(btrim(c.summary), ''), '(no title)'),
               'starts_at', c.starts_at, 'ends_at', c.ends_at, 'all_day', c.all_day,
               'notes', c.excerpt, 'location', c.location,
               'project_slug', case when p.is_fixture then null else p.slug end,
               'project_name', case when p.is_fixture then null else p.name end,
               'sync', 'external', 'sync_error', null,
               'external_url', c.html_link, 'origin_channel', 'google_sync',
               'editable', false) as j,
             c.starts_at as s, coalesce(c.summary, '') as t, c.calendar_id || ':' || c.event_id as i
        from public.calendar_events c
        left join public.calendar_event_projects a
          on a.calendar_id = c.calendar_id and a.event_id = c.event_id and a.office_id = c.office_id
        left join public.projects p on p.project_id = a.project_id and p.office_id = a.office_id
       where c.office_id = p_office
         and c.status <> 'cancelled'
         and c.ends_at >= v_from and c.starts_at < v_to
         and not exists (
               select 1 from public.project_events e
                where e.office_id = c.office_id and e.external_calendar_id = c.calendar_id
                  and e.external_event_id = c.event_id)
         and case v_scope
               when 'project' then a.project_id = v_project
               when 'all'     then a.project_id is not null and not p.is_fixture and p.status <> 'archived'
               else true
             end
       order by 2, 3, 4
       limit 2000
    ) u;

  return jsonb_build_object(
    'ok', true, 'scope', v_scope, 'project', p_slug, 'from', v_from, 'to', v_to,
    'google_connected', app.google_calendar_connected(p_office),
    'events', v_events);
end
$f$;
revoke all on function app.hq_project_events(uuid, text, text, text, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- app.hq_event_add
-- ---------------------------------------------------------------------------------------------------------------------
create function app.hq_event_add(
  p_office uuid, p_slug text, p_title text, p_starts_at timestamptz, p_ends_at timestamptz default null,
  p_all_day boolean default false, p_notes text default null, p_location text default null,
  p_channel text default 'teamhq', p_authority text default 'person')
returns jsonb
language plpgsql
security definer
set search_path to ''
as $f$
declare
  v_project uuid;
  v_pname   text;
  v_title   text := btrim(coalesce(p_title, ''));
  v_all     boolean := coalesce(p_all_day, false);
  v_start   timestamptz := p_starts_at;
  v_end     timestamptz := p_ends_at;
  v_channel text := coalesce(nullif(btrim(p_channel), ''), 'teamhq');
  v_auth    text := coalesce(nullif(btrim(p_authority), ''), 'person');
  v_state   text;
  v_id      uuid;
  v_actor   text;
begin
  perform app.require_office(p_office);
  if v_title = '' then return jsonb_build_object('error', 'an event needs a title'); end if;
  if length(v_title) > 300 then return jsonb_build_object('error', 'the title is longer than 300 characters'); end if;
  if v_start is null then return jsonb_build_object('error', 'an event needs a start'); end if;
  if v_channel !~ '^[a-z][a-z0-9_]{1,31}$' then
    return jsonb_build_object('error', format('%L is not a channel name - lowercase words and underscores, such as teamhq or telegram', p_channel));
  end if;
  if v_auth not in ('person', 'agent') then
    return jsonb_build_object('error', format('%L is not an authority - it is person or agent', p_authority));
  end if;
  if length(coalesce(p_notes, '')) > 8000 then return jsonb_build_object('error', 'the notes are longer than 8000 characters'); end if;
  if length(coalesce(p_location, '')) > 500 then return jsonb_build_object('error', 'the location is longer than 500 characters'); end if;

  select project_id, name into v_project, v_pname
    from public.projects where slug = p_slug and office_id = p_office and status <> 'archived';
  if v_project is null then
    return jsonb_build_object('error', format('no active project called %L', p_slug));
  end if;

  if v_all then
    -- All-day: whole UTC days, the end exclusive (as Google writes it). No end means a single day.
    v_start := date_trunc('day', v_start at time zone 'UTC') at time zone 'UTC';
    v_end := case when v_end is null then v_start + interval '1 day'
                  else date_trunc('day', v_end at time zone 'UTC') at time zone 'UTC' end;
    if v_end <= v_start then
      return jsonb_build_object('error', 'an all-day event must end after the day it starts (the end day is exclusive: a one-day event ends the next day)');
    end if;
  else
    v_end := coalesce(v_end, v_start + interval '1 hour');
    if v_end < v_start then
      return jsonb_build_object('error', 'the event ends before it starts');
    end if;
  end if;

  v_state := case when app.google_calendar_connected(p_office) then 'pending' else 'local' end;
  v_actor := app.office_actor(p_office);

  insert into public.project_events
    (office_id, project_id, title, notes, location, starts_at, ends_at, all_day, origin_channel, created_by,
     authority, sync_state)
  values (p_office, v_project, v_title, nullif(btrim(coalesce(p_notes, '')), ''), nullif(btrim(coalesce(p_location, '')), ''),
          v_start, v_end, v_all, v_channel, v_actor, v_auth, v_state)
  returning event_id into v_id;

  perform app.append_event(
    p_office, extensions.gen_random_uuid(), case when v_auth = 'agent' then 'agent' else 'user' end, v_actor,
    v_channel, 'event.created', true, v_project, null,
    jsonb_build_object('event_id', v_id, 'title', v_title, 'starts_at', v_start, 'all_day', v_all,
                       'channel', v_channel, 'sync', v_state),
    format('%s, on the %s calendar (via %s)', left(v_title, 200), v_pname, v_channel),
    '[]'::jsonb, null, null, 'app.hq_event_delete(event_id)');

  return jsonb_build_object('ok', true, 'id', v_id::text, 'project', p_slug, 'sync', v_state,
                            'starts_at', v_start, 'ends_at', v_end, 'all_day', v_all);
end
$f$;
revoke all on function app.hq_event_add(uuid, text, text, timestamptz, timestamptz, boolean, text, text, text, text)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- app.hq_event_update - a patch: a null argument leaves the field alone; '' clears notes or location
-- ---------------------------------------------------------------------------------------------------------------------
create function app.hq_event_update(
  p_office uuid, p_event uuid, p_title text default null, p_starts_at timestamptz default null,
  p_ends_at timestamptz default null, p_all_day boolean default null, p_notes text default null,
  p_location text default null, p_channel text default 'teamhq', p_authority text default 'person')
returns jsonb
language plpgsql
security definer
set search_path to ''
as $f$
declare
  r         public.project_events%rowtype;
  v_title   text;
  v_all     boolean;
  v_start   timestamptz;
  v_end     timestamptz;
  v_notes   text;
  v_loc     text;
  v_channel text := coalesce(nullif(btrim(p_channel), ''), 'teamhq');
  v_auth    text := coalesce(nullif(btrim(p_authority), ''), 'person');
  v_state   text;
  v_before  jsonb;
  v_actor   text;
begin
  perform app.require_office(p_office);
  if v_channel !~ '^[a-z][a-z0-9_]{1,31}$' then
    return jsonb_build_object('error', format('%L is not a channel name - lowercase words and underscores, such as teamhq or telegram', p_channel));
  end if;
  if v_auth not in ('person', 'agent') then
    return jsonb_build_object('error', format('%L is not an authority - it is person or agent', p_authority));
  end if;

  select * into r from public.project_events where event_id = p_event and office_id = p_office for update;
  if not found or r.deleted_at is not null then
    return jsonb_build_object('error', 'no such event');
  end if;

  v_title := case when p_title is null then r.title else btrim(p_title) end;
  if v_title = '' then return jsonb_build_object('error', 'an event needs a title'); end if;
  if length(v_title) > 300 then return jsonb_build_object('error', 'the title is longer than 300 characters'); end if;
  v_notes := case when p_notes is null then r.notes else nullif(btrim(p_notes), '') end;
  v_loc   := case when p_location is null then r.location else nullif(btrim(p_location), '') end;
  -- Clearing notes is a real edit that must reach Google, so it is stored as '' (never set stays null and is never sent).
  if p_notes is not null and btrim(p_notes) = '' and r.notes is not null then v_notes := ''; end if;
  if length(coalesce(v_notes, '')) > 8000 then return jsonb_build_object('error', 'the notes are longer than 8000 characters'); end if;
  if length(coalesce(v_loc, '')) > 500 then return jsonb_build_object('error', 'the location is longer than 500 characters'); end if;

  v_all   := coalesce(p_all_day, r.all_day);
  v_start := coalesce(p_starts_at, r.starts_at);
  v_end   := coalesce(p_ends_at, case when p_starts_at is not null and p_ends_at is null then null else r.ends_at end);
  if v_all then
    v_start := date_trunc('day', v_start at time zone 'UTC') at time zone 'UTC';
    v_end := case when v_end is null then v_start + interval '1 day'
                  else date_trunc('day', v_end at time zone 'UTC') at time zone 'UTC' end;
    if v_end <= v_start then
      return jsonb_build_object('error', 'an all-day event must end after the day it starts (the end day is exclusive: a one-day event ends the next day)');
    end if;
  else
    -- Moving the start without an end keeps the event's length.
    v_end := coalesce(v_end, v_start + (r.ends_at - r.starts_at));
    if v_end < v_start then
      return jsonb_build_object('error', 'the event ends before it starts');
    end if;
  end if;

  if (v_title, v_notes, v_loc, v_start, v_end, v_all)
       is not distinct from (r.title, r.notes, r.location, r.starts_at, r.ends_at, r.all_day) then
    return jsonb_build_object('ok', true, 'id', r.event_id::text, 'changed', false, 'sync', r.sync_state);
  end if;

  v_before := jsonb_build_object('title', r.title, 'starts_at', r.starts_at, 'ends_at', r.ends_at, 'all_day', r.all_day);
  v_state := case when r.external_event_id is not null or app.google_calendar_connected(p_office)
                  then 'pending' else 'local' end;
  v_actor := app.office_actor(p_office);

  update public.project_events
     set title = v_title, notes = v_notes, location = v_loc, starts_at = v_start, ends_at = v_end, all_day = v_all,
         authority = v_auth, sync_state = v_state, sync_error = null
   where event_id = p_event and office_id = p_office;

  perform app.append_event(
    p_office, extensions.gen_random_uuid(), case when v_auth = 'agent' then 'agent' else 'user' end, v_actor,
    v_channel, 'event.updated', false, r.project_id, v_before,
    jsonb_build_object('event_id', p_event, 'title', v_title, 'starts_at', v_start, 'ends_at', v_end,
                       'all_day', v_all, 'channel', v_channel, 'sync', v_state),
    format('%s (via %s)', left(v_title, 200), v_channel), '[]'::jsonb, null, null, null);

  return jsonb_build_object('ok', true, 'id', p_event::text, 'changed', true, 'sync', v_state,
                            'starts_at', v_start, 'ends_at', v_end, 'all_day', v_all);
end
$f$;
revoke all on function app.hq_event_update(uuid, uuid, text, timestamptz, timestamptz, boolean, text, text, text, text)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- app.hq_event_delete - hard delete when the event never reached Google, a tombstone when it did
-- ---------------------------------------------------------------------------------------------------------------------
create function app.hq_event_delete(
  p_office uuid, p_event uuid, p_channel text default 'teamhq', p_authority text default 'person')
returns jsonb
language plpgsql
security definer
set search_path to ''
as $f$
declare
  r         public.project_events%rowtype;
  v_channel text := coalesce(nullif(btrim(p_channel), ''), 'teamhq');
  v_auth    text := coalesce(nullif(btrim(p_authority), ''), 'person');
  v_actor   text;
  v_mode    text;
begin
  perform app.require_office(p_office);
  if v_channel !~ '^[a-z][a-z0-9_]{1,31}$' then
    return jsonb_build_object('error', format('%L is not a channel name - lowercase words and underscores, such as teamhq or telegram', p_channel));
  end if;
  if v_auth not in ('person', 'agent') then
    return jsonb_build_object('error', format('%L is not an authority - it is person or agent', p_authority));
  end if;
  select * into r from public.project_events where event_id = p_event and office_id = p_office for update;
  if not found or r.deleted_at is not null then
    return jsonb_build_object('error', 'no such event');
  end if;
  v_actor := app.office_actor(p_office);

  if r.external_event_id is null then
    delete from public.project_events where event_id = p_event and office_id = p_office;
    v_mode := 'deleted';
  else
    -- It lives in Google: say so there first. Pending whether or not Google is reachable right now, because the
    -- deletion is owed either way and the row must not vanish before it has been paid.
    update public.project_events
       set deleted_at = app.now_utc(), authority = v_auth, sync_state = 'pending', sync_error = null
     where event_id = p_event and office_id = p_office;
    v_mode := 'tombstoned';
  end if;

  perform app.append_event(
    p_office, extensions.gen_random_uuid(), case when v_auth = 'agent' then 'agent' else 'user' end, v_actor,
    v_channel, 'event.deleted', false, r.project_id,
    jsonb_build_object('event_id', p_event, 'title', r.title, 'starts_at', r.starts_at),
    jsonb_build_object('channel', v_channel, 'mode', v_mode),
    format('%s (via %s)', left(r.title, 200), v_channel), '[]'::jsonb, null, null, null);

  return jsonb_build_object('ok', true, 'id', p_event::text, 'mode', v_mode);
end
$f$;
revoke all on function app.hq_event_delete(uuid, uuid, text, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- app.hq_event_assign / hq_event_unassign - file an EXISTING Google event under a project
-- ---------------------------------------------------------------------------------------------------------------------
create function app.hq_event_assign(
  p_office uuid, p_calendar_id text, p_event_id text, p_slug text, p_channel text default 'teamhq')
returns jsonb
language plpgsql
security definer
set search_path to ''
as $f$
declare
  v_project uuid;
  v_pname   text;
  v_title   text;
  v_prior   uuid;
  v_channel text := coalesce(nullif(btrim(p_channel), ''), 'teamhq');
  v_actor   text;
begin
  perform app.require_office(p_office);
  if v_channel !~ '^[a-z][a-z0-9_]{1,31}$' then
    return jsonb_build_object('error', format('%L is not a channel name - lowercase words and underscores, such as teamhq or telegram', p_channel));
  end if;
  select summary into v_title from public.calendar_events
   where calendar_id = p_calendar_id and event_id = p_event_id and office_id = p_office;
  if not found then
    return jsonb_build_object('error', 'no such Google event in the calendar the office has read');
  end if;
  if exists (select 1 from public.project_events e
              where e.office_id = p_office and e.external_calendar_id = p_calendar_id and e.external_event_id = p_event_id) then
    return jsonb_build_object('error', 'that event was made in Team HQ and already belongs to a project; edit it there instead');
  end if;
  select project_id, name into v_project, v_pname
    from public.projects where slug = p_slug and office_id = p_office and status <> 'archived';
  if v_project is null then
    return jsonb_build_object('error', format('no active project called %L', p_slug));
  end if;
  v_actor := app.office_actor(p_office);

  select project_id into v_prior from public.calendar_event_projects
   where calendar_id = p_calendar_id and event_id = p_event_id and office_id = p_office;
  if v_prior is not distinct from v_project then
    return jsonb_build_object('ok', true, 'project', p_slug, 'changed', false);
  end if;

  insert into public.calendar_event_projects (office_id, calendar_id, event_id, project_id, assigned_by, origin_channel)
  values (p_office, p_calendar_id, p_event_id, v_project, v_actor, v_channel)
  on conflict (calendar_id, event_id) do update
     set project_id = excluded.project_id, assigned_by = excluded.assigned_by,
         origin_channel = excluded.origin_channel, assigned_at = app.now_utc()
   where public.calendar_event_projects.office_id = excluded.office_id;

  perform app.append_event(
    p_office, extensions.gen_random_uuid(), 'user', v_actor, v_channel, 'event.assigned', true, v_project,
    jsonb_build_object('project_id', v_prior),
    jsonb_build_object('calendar_id', p_calendar_id, 'event_id', p_event_id, 'title', v_title, 'channel', v_channel),
    format('%s, filed under %s (via %s)', left(coalesce(v_title, 'an event'), 200), v_pname, v_channel),
    '[]'::jsonb, null, null, 'app.hq_event_unassign(calendar_id, event_id)');

  return jsonb_build_object('ok', true, 'id', 'g:' || p_calendar_id || ':' || p_event_id, 'project', p_slug, 'changed', true);
end
$f$;
revoke all on function app.hq_event_assign(uuid, text, text, text, text) from public, anon, authenticated, service_role;

create function app.hq_event_unassign(
  p_office uuid, p_calendar_id text, p_event_id text, p_channel text default 'teamhq')
returns jsonb
language plpgsql
security definer
set search_path to ''
as $f$
declare
  v_project uuid;
  v_title   text;
  v_channel text := coalesce(nullif(btrim(p_channel), ''), 'teamhq');
  v_actor   text;
begin
  perform app.require_office(p_office);
  if v_channel !~ '^[a-z][a-z0-9_]{1,31}$' then
    return jsonb_build_object('error', format('%L is not a channel name - lowercase words and underscores, such as teamhq or telegram', p_channel));
  end if;
  delete from public.calendar_event_projects
   where calendar_id = p_calendar_id and event_id = p_event_id and office_id = p_office
  returning project_id into v_project;
  if v_project is null then
    return jsonb_build_object('error', 'that Google event is not assigned to a project');
  end if;
  select summary into v_title from public.calendar_events
   where calendar_id = p_calendar_id and event_id = p_event_id and office_id = p_office;
  v_actor := app.office_actor(p_office);
  perform app.append_event(
    p_office, extensions.gen_random_uuid(), 'user', v_actor, v_channel, 'event.unassigned', false, v_project,
    jsonb_build_object('calendar_id', p_calendar_id, 'event_id', p_event_id),
    jsonb_build_object('channel', v_channel), format('%s, taken off the project (via %s)', left(coalesce(v_title, 'an event'), 200), v_channel),
    '[]'::jsonb, null, null, null);
  return jsonb_build_object('ok', true, 'id', 'g:' || p_calendar_id || ':' || p_event_id);
end
$f$;
revoke all on function app.hq_event_unassign(uuid, text, text, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- the sync handler's functions (kind calendar.sync_events). All office-scoped; none reachable from the gateway.
-- ---------------------------------------------------------------------------------------------------------------------

-- Events made while Google was not connected sit at 'local'. Once it is connected they are owed to Google.
create function app.project_events_promote_local(p_office uuid)
returns integer
language plpgsql
security definer
set search_path to ''
as $f$
declare n integer;
begin
  perform app.require_office(p_office);
  if not app.google_calendar_connected(p_office) then return 0; end if;
  update public.project_events set sync_state = 'pending'
   where office_id = p_office and sync_state = 'local' and deleted_at is null;
  get diagnostics n = row_count;
  return n;
end
$f$;
revoke all on function app.project_events_promote_local(uuid) from public, anon, authenticated, service_role;

-- What is owed to Google, one entry per event, with the operation it needs.
create function app.project_events_sync_work(p_office uuid, p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $f$
begin
  perform app.require_office(p_office);
  return coalesce((
    select jsonb_agg(w.j order by w.u)
      from (
        select jsonb_build_object(
                 'event_id', e.event_id, 'op', case when e.deleted_at is not null then 'delete'
                                                    when e.external_event_id is null then 'create' else 'update' end,
                 'title', e.title, 'notes', e.notes, 'location', e.location,
                 'starts_at', e.starts_at, 'ends_at', e.ends_at, 'all_day', e.all_day,
                 'external_calendar_id', e.external_calendar_id, 'external_event_id', e.external_event_id,
                 'external_etag', e.external_etag, 'external_updated_at', e.external_updated_at, 'authority', e.authority,
                 'project_slug', p.slug, 'project_name', p.name,
                 'updated_at', e.updated_at, 'origin_channel', e.origin_channel) as j,
               e.updated_at as u
          from public.project_events e
          join public.projects p on p.project_id = e.project_id and p.office_id = e.office_id
         where e.office_id = p_office and e.sync_state = 'pending'
         order by e.updated_at
         limit greatest(1, least(coalesce(p_limit, 50), 200))
      ) w), '[]'::jsonb);
end
$f$;
revoke all on function app.project_events_sync_work(uuid, integer) from public, anon, authenticated, service_role;

-- A push succeeded. `p_seen_updated_at` is the row's updated_at when the work was read: if the row has been edited since,
-- the external ids are kept but the row stays pending, so a person's edit made mid-sync is never marked synced unseen.
create function app.project_event_sync_done(
  p_office uuid, p_event uuid, p_op text, p_seen_updated_at timestamptz,
  p_calendar_id text default null, p_external_id text default null, p_etag text default null,
  p_remote_updated timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $f$
declare r public.project_events%rowtype;
begin
  perform app.require_office(p_office);
  select * into r from public.project_events where event_id = p_event and office_id = p_office for update;
  if not found then return jsonb_build_object('ok', true, 'gone', true); end if;
  if p_op = 'delete' then
    delete from public.project_events where event_id = p_event and office_id = p_office;
    return jsonb_build_object('ok', true, 'purged', true);
  end if;
  if p_op not in ('create', 'update') then
    return jsonb_build_object('error', format('%L is not a sync operation', p_op));
  end if;
  update public.project_events
     set external_calendar_id = coalesce(p_calendar_id, external_calendar_id),
         external_event_id = coalesce(p_external_id, external_event_id),
         external_etag = coalesce(p_etag, external_etag),
         external_updated_at = coalesce(p_remote_updated, external_updated_at),
         last_synced_at = app.now_utc(),
         sync_state = case when r.updated_at = p_seen_updated_at and r.deleted_at is null then 'synced' else 'pending' end,
         sync_error = case when r.updated_at = p_seen_updated_at and r.deleted_at is null then null else r.sync_error end
   where event_id = p_event and office_id = p_office;
  return jsonb_build_object('ok', true, 'synced', r.updated_at = p_seen_updated_at and r.deleted_at is null);
end
$f$;
revoke all on function app.project_event_sync_done(uuid, uuid, text, timestamptz, text, text, text, timestamptz)
  from public, anon, authenticated, service_role;

-- A push failed. A transient failure (rate limit, 5xx, network) stays pending with the reason noted; a permanent one is
-- parked at 'error' until somebody edits the event (an edit puts it back to pending).
create function app.project_event_sync_failed(p_office uuid, p_event uuid, p_error text, p_retryable boolean)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $f$
begin
  perform app.require_office(p_office);
  update public.project_events
     set sync_state = case when coalesce(p_retryable, false) then 'pending' else 'error' end,
         sync_error = left(coalesce(nullif(btrim(p_error), ''), 'the sync failed'), 1000)
   where event_id = p_event and office_id = p_office and sync_state = 'pending';
  return jsonb_build_object('ok', true, 'retry', coalesce(p_retryable, false));
end
$f$;
revoke all on function app.project_event_sync_failed(uuid, uuid, text, boolean) from public, anon, authenticated, service_role;

-- What Google changed, applied to the linked native events. Last writer wins by timestamp, and an override either way is
-- recorded (sync_error on the row, an Activity event naming the channel google_sync).
--   p_calendar   the calendar the cache was refreshed for this run
--   p_cache_fresh  true only when that refresh actually ran and succeeded; the absence of a cached row means "deleted in
--                  Google" only then, and only for an event inside the window the refresh covers
create function app.project_events_pull(p_office uuid, p_calendar text, p_cache_fresh boolean)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $f$
declare
  r         record;
  v_updated integer := 0;
  v_deleted integer := 0;
  v_kept    integer := 0;
  v_actor   text := 'google_sync';
begin
  perform app.require_office(p_office);
  for r in
    select e.*, c.event_id as c_id, c.summary as c_summary, c.location as c_location, c.starts_at as c_start,
           c.ends_at as c_end, c.all_day as c_all, c.status as c_status, c.remote_updated_at as c_remote
      from public.project_events e
      left join public.calendar_events c
        on c.calendar_id = e.external_calendar_id and c.event_id = e.external_event_id and c.office_id = e.office_id
     where e.office_id = p_office and e.external_event_id is not null and e.deleted_at is null
       and e.external_calendar_id = p_calendar
     for update of e
  loop
    if r.c_id is null then
      -- Not in the cache. Deleted in Google only when the cache was just refreshed and this event sits inside what it covers.
      if coalesce(p_cache_fresh, false) and r.sync_state = 'synced'
         and r.starts_at >= app.now_utc() - interval '23 hours' and r.starts_at < app.now_utc() + interval '13 days'
         and coalesce(r.last_synced_at, r.created_at) < app.now_utc() - interval '2 minutes' then
        update public.project_events
           set deleted_at = app.now_utc(), sync_state = 'synced', sync_error = 'deleted in Google'
         where event_id = r.event_id and office_id = p_office;
        perform app.append_event(p_office, extensions.gen_random_uuid(), 'system', v_actor, 'google_sync', 'event.deleted', false,
          r.project_id, jsonb_build_object('event_id', r.event_id, 'title', r.title),
          jsonb_build_object('channel', 'google_sync', 'mode', 'deleted in Google'),
          format('%s (deleted in Google)', left(r.title, 200)), '[]'::jsonb, null, null, null);
        v_deleted := v_deleted + 1;
      end if;
    elsif r.c_status = 'cancelled' then
      update public.project_events
         set deleted_at = app.now_utc(), sync_state = 'synced',
             sync_error = case when r.sync_state = 'pending' then 'deleted in Google; a pending local edit was overridden' else 'deleted in Google' end
       where event_id = r.event_id and office_id = p_office;
      perform app.append_event(p_office, extensions.gen_random_uuid(), 'system', v_actor, 'google_sync', 'event.deleted', false,
        r.project_id, jsonb_build_object('event_id', r.event_id, 'title', r.title),
        jsonb_build_object('channel', 'google_sync', 'mode', 'deleted in Google', 'overrode_pending', r.sync_state = 'pending'),
        format('%s (deleted in Google)', left(r.title, 200)), '[]'::jsonb, null, null, null);
      v_deleted := v_deleted + 1;
    elsif r.c_remote is not null and r.c_remote > coalesce(r.external_updated_at, '-infinity'::timestamptz) then
      -- Google changed since the sides last agreed.
      if r.sync_state = 'pending' and r.updated_at >= r.c_remote then
        -- the local edit is newer: it will be pushed and overwrite Google's. Say so.
        update public.project_events
           set sync_error = 'a newer change in Google was overridden by this later local edit'
         where event_id = r.event_id and office_id = p_office;
        perform app.append_event(p_office, extensions.gen_random_uuid(), 'system', v_actor, 'google_sync', 'event.updated', false,
          r.project_id, null,
          jsonb_build_object('event_id', r.event_id, 'channel', 'google_sync', 'winner', 'team_hq'),
          format('%s: the later Team HQ edit wins over a Google change', left(r.title, 200)), '[]'::jsonb, null, null, null);
        v_kept := v_kept + 1;
      else
        update public.project_events
           set title = coalesce(nullif(btrim(r.c_summary), ''), r.title), location = r.c_location,
               starts_at = r.c_start, ends_at = r.c_end, all_day = r.c_all,
               external_updated_at = r.c_remote, last_synced_at = app.now_utc(),
               sync_state = 'synced', authority = 'person',
               sync_error = case when r.sync_state = 'pending' then 'a pending local edit was overridden by a newer change in Google' else null end
         where event_id = r.event_id and office_id = p_office;
        perform app.append_event(p_office, extensions.gen_random_uuid(), 'system', v_actor, 'google_sync', 'event.updated', false,
          r.project_id, jsonb_build_object('title', r.title, 'starts_at', r.starts_at, 'ends_at', r.ends_at),
          jsonb_build_object('event_id', r.event_id, 'channel', 'google_sync', 'winner', 'google',
                             'overrode_pending', r.sync_state = 'pending'),
          format('%s (changed in Google)', left(coalesce(nullif(btrim(r.c_summary), ''), r.title), 200)),
          '[]'::jsonb, null, null, null);
        v_updated := v_updated + 1;
      end if;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'updated', v_updated, 'deleted', v_deleted, 'local_won', v_kept);
end
$f$;
revoke all on function app.project_events_pull(uuid, text, boolean) from public, anon, authenticated, service_role;

-- Google refused an UPDATE with "not found": the event was deleted there. Google's deletion wins (the same rule the pull
-- applies when the cache says cancelled), and it is recorded.
create function app.project_event_gone(p_office uuid, p_event uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $f$
declare r public.project_events%rowtype;
begin
  perform app.require_office(p_office);
  select * into r from public.project_events where event_id = p_event and office_id = p_office for update;
  if not found or r.deleted_at is not null then return jsonb_build_object('ok', true, 'already', true); end if;
  update public.project_events
     set deleted_at = app.now_utc(), sync_state = 'synced',
         sync_error = 'deleted in Google; a pending local edit was overridden'
   where event_id = p_event and office_id = p_office;
  perform app.append_event(p_office, extensions.gen_random_uuid(), 'system', 'google_sync', 'google_sync', 'event.deleted', false,
    r.project_id, jsonb_build_object('event_id', r.event_id, 'title', r.title),
    jsonb_build_object('channel', 'google_sync', 'mode', 'deleted in Google', 'overrode_pending', true),
    format('%s (deleted in Google)', left(r.title, 200)), '[]'::jsonb, null, null, null);
  return jsonb_build_object('ok', true);
end
$f$;
revoke all on function app.project_event_gone(uuid, uuid) from public, anon, authenticated, service_role;

-- A tombstone whose deletion has reached Google (or which Google itself deleted) is finished: drop the row.
create function app.project_events_purge(p_office uuid)
returns integer
language plpgsql
security definer
set search_path to ''
as $f$
declare n integer;
begin
  perform app.require_office(p_office);
  delete from public.project_events
   where office_id = p_office and deleted_at is not null and sync_state = 'synced';
  get diagnostics n = row_count;
  return n;
end
$f$;
revoke all on function app.project_events_purge(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- the registry says what delivers the capability (0298)
-- ---------------------------------------------------------------------------------------------------------------------
update public.tool_permissions
   set delivered_by = 'job kinds google.write_calendar_tasks and calendar.sync_events'
 where tool = 'calendar.write' and enabled;

-- ---------------------------------------------------------------------------------------------------------------------
-- public wrappers (PostgREST only exposes public)
-- ---------------------------------------------------------------------------------------------------------------------
create function public.hq_project_events(p_office uuid, p_slug text default null, p_from text default null,
                                         p_to text default null, p_scope text default 'project')
returns jsonb language sql stable security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_project_events(p_office, p_slug, p_from, p_to, p_scope) $f$;

create function public.hq_event_add(p_office uuid, p_slug text, p_title text, p_starts_at timestamptz,
                                    p_ends_at timestamptz default null, p_all_day boolean default false,
                                    p_notes text default null, p_location text default null,
                                    p_channel text default 'teamhq', p_authority text default 'person')
returns jsonb language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_event_add(p_office, p_slug, p_title, p_starts_at, p_ends_at, p_all_day, p_notes, p_location,
                               p_channel, p_authority) $f$;

create function public.hq_event_update(p_office uuid, p_event uuid, p_title text default null,
                                       p_starts_at timestamptz default null, p_ends_at timestamptz default null,
                                       p_all_day boolean default null, p_notes text default null,
                                       p_location text default null, p_channel text default 'teamhq',
                                       p_authority text default 'person')
returns jsonb language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_event_update(p_office, p_event, p_title, p_starts_at, p_ends_at, p_all_day, p_notes, p_location,
                                  p_channel, p_authority) $f$;

create function public.hq_event_delete(p_office uuid, p_event uuid, p_channel text default 'teamhq',
                                       p_authority text default 'person')
returns jsonb language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_event_delete(p_office, p_event, p_channel, p_authority) $f$;

create function public.hq_event_assign(p_office uuid, p_calendar_id text, p_event_id text, p_slug text,
                                       p_channel text default 'teamhq')
returns jsonb language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_event_assign(p_office, p_calendar_id, p_event_id, p_slug, p_channel) $f$;

create function public.hq_event_unassign(p_office uuid, p_calendar_id text, p_event_id text,
                                         p_channel text default 'teamhq')
returns jsonb language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_event_unassign(p_office, p_calendar_id, p_event_id, p_channel) $f$;

-- Whoever reaches a public wrapper is the gateway (service role), exactly as for the sibling wrappers.
do $grants$
declare w text;
begin
  for w in
    select p.oid::regprocedure::text
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('hq_project_events', 'hq_event_add', 'hq_event_update', 'hq_event_delete',
                         'hq_event_assign', 'hq_event_unassign')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', w);
    execute format('grant execute on function %s to service_role', w);
  end loop;
end
$grants$;

-- ---------------------------------------------------------------------------------------------------------------------
-- the duty: every fifteen minutes, wherever the calendar duty already runs (the offices that have a person's Google)
-- ---------------------------------------------------------------------------------------------------------------------
-- Marcus, for the reason he owns calendar-refresh and calendar-task-sync (0109, 0242). Fifteen minutes because a person
-- who adds an event in Team HQ expects Google to have it quickly; the pass costs nothing when nothing is pending (one
-- token exchange and one cached read), and it announces nothing unless something failed or came from Google.
-- Switched OFF from birth (like drive-index): a database migrated before its worker would fire handler-less jobs, and
-- migrations run one after another, so "on until 1021 turns it off" left a window. Enable it once the worker is deployed.
insert into public.responsibilities (slug, staff_id, description, job_kind, period_minutes, office_id, enabled)
select 'calendar-event-sync', s.staff_id,
       'Keep project calendars and Google Calendar in step: events made in a project go to Google, and what changes '
       'in Google comes back. Later change wins, and an override is recorded.',
       'calendar.sync_events', 15, r.office_id, false
  from public.responsibilities r
  join public.staff s on s.slug = 'operations-director'
 where r.slug = 'calendar-refresh'
on conflict (office_id, slug) do nothing;
