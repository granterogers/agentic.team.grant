-- 0109 — The calendar the team can see
--
-- Phase 9 has been "unblocked but not scheduled" since ADR-0013 re-based it.
-- The OAuth plumbing shipped in 0094–0096 and the Settings page walks Grant
-- through the four steps. What has never existed is anything that READS the
-- calendar once he connects it: §20 names Calendar read/write and there is no
-- reader, so the whole integration is a consent screen leading nowhere.
--
-- ## Why a table and not `documents`
--
-- ADR-0013 makes `documents` the corpus: things with text that get searched and
-- cited. A calendar event is not that. It has a shape — a start, an end, a
-- place, people — and the questions asked of it are about time, not content.
-- Putting events in `documents` would mean full-text searching for "Tuesday".
--
-- ## Why a cache at all, rather than calling Google when asked
--
-- Because the voice surface answers in two seconds and the front end renders
-- without a network round trip per card, and because §18 requires the rest of
-- the system to carry on when an integration is down. A cache with a
-- `fetched_at` can say "as of twenty minutes ago"; a live call can only say
-- nothing. §17's disableable integration then means the events stay readable
-- with the connector off, exactly as Notion's documents do.
--
-- ## What is deliberately NOT stored
--
-- Attendee names and addresses, and the description body beyond a short
-- excerpt. §15's reasoning about credentials applies to a diary as well: the
-- least that answers the question. "Three people" answers "is this a meeting or
-- a reminder" without copying anyone's address book into Postgres.

begin;

-- --------------------------------------------------------------------------
-- The refresh token needs reading now, so the allow-list widens by one
-- --------------------------------------------------------------------------
--
-- 0095 allow-listed `app.vault_secret` to `google.client_secret` alone, which
-- was right when nothing read the refresh token. The reader needs it. Widened
-- by ONE name rather than opened up, and the function stays the only way in:
-- a caller that wants a different secret still has to change this line, in a
-- migration, where it is reviewable.
create or replace function app.vault_secret(p_name text)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
begin
  if p_name not in ('google.client_secret', 'google.refresh_token') then
    raise exception 'no' using errcode = '42501';
  end if;
  return (select decrypted_secret from vault.decrypted_secrets where name = p_name);
end;
$$;

-- --------------------------------------------------------------------------
-- The events
-- --------------------------------------------------------------------------

create table public.calendar_events (
  -- Google's own id, which is stable across edits and is what makes a refresh
  -- an upsert rather than a delete-and-reload.
  event_id      text        not null,
  calendar_id   text        not null,

  summary       text,
  -- An excerpt, not the body. Enough to tell two "Catch-up" entries apart.
  excerpt       text,
  location      text,

  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  -- An all-day event has no meaningful time, and rendering one at 00:00 is how
  -- a birthday becomes a midnight meeting.
  all_day       boolean     not null default false,

  -- A count, never the people. See the note at the top.
  attendees     integer     not null default 0,
  -- 'confirmed', 'tentative', 'cancelled' — Google's own vocabulary, kept
  -- rather than mapped, because a cancelled event still answers "why is that
  -- hour free now".
  status        text        not null default 'confirmed',
  html_link     text,

  remote_updated_at timestamptz,
  fetched_at    timestamptz not null default app.now_utc(),

  primary key (calendar_id, event_id),
  constraint calendar_events_ends_after_start check (ends_at >= starts_at)
);

create index calendar_events_when on public.calendar_events (starts_at);

comment on table public.calendar_events is
  'Grant''s own calendar, cached so the team can answer questions about it in '
  'the two seconds a spoken question allows and can go on answering them when '
  'Google is unreachable (§18). Attendee names are deliberately not stored.';

alter table public.calendar_events enable row level security;
alter table public.calendar_events force  row level security;
grant select on public.calendar_events to ai_team_app;
create policy calendar_events_app_read on public.calendar_events
  for select to ai_team_app using (true);

/**
 * What is on, over a window, as the team would say it.
 *
 * A function rather than a view because both the voice surface and the front
 * end ask the same question over different windows, and two hand-written
 * versions of "today's events, in order, excluding cancellations" would
 * eventually disagree about what "today" means.
 */
create or replace function app.calendar_ahead(p_hours integer default 24)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select jsonb_build_object(
    -- Age, always. A cached answer that does not say when it was cached is a
    -- stale answer presented as a current one, which is the defect this
    -- project keeps meeting in new costumes.
    'as_of', (select max(fetched_at) from public.calendar_events),
    'enabled', coalesce(
      (select value::text::boolean from public.system_config where key = 'calendar.enabled'), false),
    'events', coalesce((
      select jsonb_agg(row_to_json(e) order by e.starts_at)
        from (
          select summary, location, starts_at, ends_at, all_day, attendees, status, html_link
            from public.calendar_events
           where status <> 'cancelled'
             and ends_at   >= app.now_utc()
             and starts_at <= app.now_utc() + make_interval(hours => greatest(p_hours, 1))
           order by starts_at
           limit 25
        ) e
    ), '[]'::jsonb)
  )
$$;

grant execute on function app.calendar_ahead(integer) to ai_team_app, service_role;

-- --------------------------------------------------------------------------
-- The overview carries it, so the page needs no new endpoint
-- --------------------------------------------------------------------------

/**
 * The overview, minus the calendar.
 *
 * Split out so 0109 can add a key without restating 1,900 characters of
 * projection it does not touch — and so the next thing to add one does not have
 * to either. `hq_overview` is now the composition, which is the only part that
 * changes.
 */
create or replace function app.hq_overview_base()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $base$
  select jsonb_build_object(
    'generated_at', app.now_utc(),
    'counts', jsonb_build_object(
      'live_jobs', (
        select count(*)::int from public.jobs
        where state not in ('complete', 'cancelled', 'failed')
      ),
      'needs_me', (select count(*)::int from public.needs_me),
      'needs_me_overdue', (select count(*)::int from public.needs_me where overdue),
      'active_projects', (select count(*)::int from public.projects where status = 'active'),
      'undo_offers', (select count(*)::int from public.undo_offers)
    ),
    -- Capped, and the cap is reported. A list that silently shows 7 of 40 looks
    -- healthy exactly when it stops being useful.
    'needs_me', coalesce((
      select jsonb_agg(row_to_json(n)) from (
        select blocker_id, project_id, requested_action, why_needed,
               consequences_of_delay, approval_options, real_deadline, overdue,
               work_can_continue, created_at
        from public.needs_me
        order by overdue desc, real_deadline nulls last, created_at
        limit 20
      ) n
    ), '[]'::jsonb),
    'today', coalesce((
      select jsonb_agg(row_to_json(t)) from (
        select job_id, project_id, project_name, kind, state, intent_class,
               priority, state_reason, waiting_on, minutes_since_change
        from public.today
        order by priority desc, minutes_since_change desc
        limit 40
      ) t
    ), '[]'::jsonb),
    'projects', coalesce((
      select jsonb_agg(row_to_json(p)) from (
        select project_id, slug, name, open_blockers, overdue_blockers,
               live_jobs, failed_jobs_24h, stalled_jobs, hours_since_sync,
               has_brief, brief_is_stale
        from app.project_attention()
      ) p
    ), '[]'::jsonb)
  );
$base$;

grant execute on function app.hq_overview_base() to ai_team_app, service_role;

create or replace function app.hq_overview()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select app.hq_overview_base() || jsonb_build_object('calendar', app.calendar_ahead(24))
$$;

-- --------------------------------------------------------------------------
-- Refreshing it is a duty, owned by the person whose job is sequencing
-- --------------------------------------------------------------------------
--
-- Marcus: §9 gives Operations "sequencing, dependencies, capacity and
-- follow-through", which is what a diary is for. Hourly: a calendar that is an
-- hour stale is a calendar, and one refreshed every five minutes is a quota
-- spent on nothing.

insert into public.responsibilities
  (slug, staff_id, description, job_kind, period_minutes)
select
  'calendar-refresh',
  s.staff_id,
  'Keep the cached view of Grant''s calendar current, so the team can answer '
  'questions about his week without a round trip and can go on answering them '
  'when Google is unreachable.',
  'google.read_calendar',
  60
  from public.staff s
 where s.slug = 'operations-director'
on conflict (slug) do nothing;

commit;
