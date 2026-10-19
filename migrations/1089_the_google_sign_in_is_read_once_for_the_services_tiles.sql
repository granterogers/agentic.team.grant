begin;

-- The Services tiles for Gmail, Drive and Calendar read ONE state, because one Google sign-in covers all three (the
-- consent asks for them together, and every Google part uses the same refresh token).
--
-- That state is the connection_health row for google_calendar / oauth_client, which google-oauth and the token refresh
-- write. The Services list (hq_studio_connections, migration 1087) never read that row, so a healthy sign-in showed as
-- "Not connected" and Connect Google was offered again. This function reads the row and applies the same 24-hour rule as
-- migration 1086: a row nobody has checked for a day is unchecked, not connected.
--
-- Additive: a new function and its public wrapper. Nothing existing is changed.

create or replace function app.hq_google_connection(p_office uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  r record;
begin
  perform app.require_office(p_office);
  select ch.state::text as state, coalesce(ch.detail, '') as detail, ch.checked_at
    into r
    from public.connection_health ch
   where ch.office_id = any (app.office_scope(p_office))
     and ch.service = 'google_calendar'
     and ch.credential = 'oauth_client'
   order by ch.checked_at desc nulls last
   limit 1;
  if r.state is null then
    return jsonb_build_object('state', 'off', 'detail', '', 'checked_at', null);
  end if;
  if r.checked_at < now() - interval '24 hours' then
    return jsonb_build_object('state', 'unchecked', 'detail', '', 'checked_at', r.checked_at);
  end if;
  return jsonb_build_object('state', r.state, 'detail', r.detail, 'checked_at', r.checked_at);
end;
$$;

comment on function app.hq_google_connection(uuid) is
  'The one Google sign-in, as the Services tiles for Gmail, Drive and Calendar show it. Read by the gateway section google_connection.';

revoke all on function app.hq_google_connection(uuid) from public;
grant execute on function app.hq_google_connection(uuid) to service_role;

create or replace function public.hq_google_connection(p_office uuid)
returns jsonb language sql stable security definer set search_path = public, pg_catalog
as $$ select app.hq_google_connection(p_office) $$;

revoke all on function public.hq_google_connection(uuid) from public;
grant execute on function public.hq_google_connection(uuid) to service_role;

commit;
