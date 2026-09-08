-- 0123 — One button per Google service
--
-- Grant, for the second time: *"I don't understand why you're making it so
-- complicated on the back end. It should be just, like, if someone wants to add
-- connection to Gmail, connection to Google Calendar, you just click on a
-- button, and then it brings up the Google authenticator in the browser. You
-- connect to your account, and then it's done, like so many Apple applications
-- do. I know it's possible because I already made an application."*
--
-- He is right about the flow, and he is right that it is possible. Two separate
-- things were making it not so.
--
-- ## The part that is genuinely unavoidable, once
--
-- Google has no public API for creating a general-purpose OAuth client. The
-- only programmatic creation is `gcloud iap oauth-clients create`, which
-- produces a client locked to Identity-Aware Proxy whose redirect URI cannot be
-- changed — useless here. So somebody must register this application in the
-- Google Cloud console exactly once.
--
-- Every application he has ever clicked "Sign in with Google" on did this too.
-- The difference is that theirs was done by the company that shipped it, years
-- ago, once. This one is his, so it is his to do — once, and then never again,
-- including for anyone he later sets this up for.
--
-- ## The part that was my complexity, not Google's
--
-- After that one registration, everything else was still hard, and none of it
-- had to be. There was a single `google.scopes` string in `system_config`
-- holding calendar's two scopes. Adding Gmail meant editing that string by hand
-- in Advanced Settings, then signing out of Google, then signing in again — for
-- each service. That is not a button, and it is what he was actually
-- complaining about.
--
-- So: a service is a row. Each row knows its own scopes and what it is for, and
-- Connect sends the browser to Google asking for THAT service's scopes and
-- nothing else. `include_granted_scopes=true` makes Google add them to what is
-- already granted rather than replacing it, which is what makes each button
-- independent — connecting Gmail cannot disconnect Calendar.
--
-- ## Why "connected" is derived and never stored
--
-- `google.granted_scopes` is written by the callback from what Google actually
-- returned. A service counts as connected when every scope it needs appears
-- there. Storing a per-service boolean would be a second source of truth that
-- disagrees with Google the first time a consent is partially granted or
-- revoked from Google's own account page — and it would disagree silently,
-- which is the worst way for a permission to be wrong.

begin;

create table public.google_services (
  slug        text primary key,
  name        text not null,
  -- One sentence, for the person deciding whether to press the button.
  does        text not null,
  -- Space-separated, exactly as Google wants them in the consent URL.
  scopes      text not null,
  -- Whether to offer it at all. §17: an integration must be disableable, and a
  -- service switched off deliberately must not read as an outstanding task.
  offered     boolean not null default true,
  sort        smallint not null default 100
);

comment on table public.google_services is
  'One row per Google service that can be connected with a single button. '
  'Scopes live here rather than in one system_config string so that connecting '
  'one service cannot change what another asked for.';

alter table public.google_services enable row level security;
alter table public.google_services force  row level security;
grant select on public.google_services to ai_team_app;
create policy google_services_app_read on public.google_services
  for select to ai_team_app using (true);

insert into public.google_services (slug, name, does, scopes, sort) values
  ('calendar', 'Google Calendar',
   'Lets the team see what is on your diary, so they can answer questions about your week and avoid booking over it.',
   'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly',
   10),
  ('gmail', 'Gmail',
   'Lets the team search and read your mail, and draft replies for you. It can never send: §11 keeps sending off by policy, whatever the permission allows.',
   'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose',
   20),
  ('drive', 'Google Drive',
   'Lets the team read documents you point them at, so a brief can cite your own files instead of guessing.',
   'https://www.googleapis.com/auth/drive.readonly',
   30),
  ('youtube', 'YouTube',
   'Lets the team read your playlists and saved videos, so a video you saved can become a source like any other.',
   'https://www.googleapis.com/auth/youtube.readonly',
   40)
on conflict (slug) do nothing;

/**
 * The scopes one service needs, for the consent URL.
 *
 * Returns empty for an unknown or unoffered slug rather than raising: the
 * caller is an Edge Function handling a URL a browser supplied, and a query
 * string is not a trusted input.
 */
create or replace function app.google_service_scopes(p_slug text)
returns text
language sql
stable
as $$
  select coalesce(
    (select scopes from public.google_services where slug = p_slug and offered),
    ''
  )
$$;

grant execute on function app.google_service_scopes(text) to ai_team_app, service_role;

/**
 * Google, as the front end needs it: the one-time registration, and a row per
 * service saying whether it is connected.
 *
 * Replaces the old shape, which returned one `scopes` string. That string is
 * still read by nothing after this — the consent URL now asks per service.
 */
create or replace function app.hq_google()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with granted as (
    select coalesce(
      (select value #>> '{}' from public.system_config where key = 'google.granted_scopes'), ''
    ) as s
  )
  select jsonb_build_object(
    'client_id', coalesce(
      (select value #>> '{}' from public.system_config where key = 'google.client_id'), ''),
    'redirect_uri', coalesce(
      (select value #>> '{}' from public.system_config where key = 'google.redirect_uri'), ''),
    'has_secret', exists (
      select 1 from vault.decrypted_secrets where name = 'google.client_secret'),
    'has_refresh_token', exists (
      select 1 from vault.decrypted_secrets where name = 'google.refresh_token'),
    -- True once the one-time registration is done. Until then no Connect
    -- button can work, and the page says so instead of offering four that fail.
    'ready', coalesce(
      (select value #>> '{}' from public.system_config where key = 'google.client_id'), '') <> ''
      and exists (select 1 from vault.decrypted_secrets where name = 'google.client_secret'),
    'calendar_enabled', coalesce(
      (select value::text::boolean from public.system_config where key = 'calendar.enabled'), false),
    'services', coalesce((
      select jsonb_agg(jsonb_build_object(
        'slug', s.slug,
        'name', s.name,
        'does', s.does,
        -- Connected means Google actually returned every scope this needs.
        -- Derived, never stored: see the header.
        'connected', (
          select bool_and(position(scope in g.s) > 0)
          from unnest(string_to_array(s.scopes, ' ')) as scope
        ),
        'scopes', s.scopes
      ) order by s.sort, s.name)
      from public.google_services s, granted g
      where s.offered
    ), '[]'::jsonb)
  )
$$;

create or replace function public.hq_google()
returns jsonb language sql stable security definer set search_path = public, pg_catalog
as $$ select app.hq_google() $$;

revoke all on function public.hq_google() from public;
grant execute on function public.hq_google() to service_role;

create or replace function public.google_service_scopes(p_slug text)
returns text language sql stable security definer set search_path = public, pg_catalog
as $$ select app.google_service_scopes(p_slug) $$;

revoke all on function public.google_service_scopes(text) from public;
grant execute on function public.google_service_scopes(text) to service_role;

commit;
