-- 1110 — the Services list carries the Google sign-in, read from the same health row as Gmail, Drive and Calendar (Health
-- fix, 21 November 2026)
--
-- The Services list (app.hq_studio_connections, migration 1087) is built from the knowledge connectors. The Google sign-in is
-- not a knowledge connector, so it was never in the list. Health therefore could not see a dead Google connection: on
-- 21 November 2026 the page said nothing was connected while the sign-in's own health row said "dead" (checked that day).
--
-- This adds one entry, "Google", whose state is read by app.hq_google_connection (migration 1089), the function the Google
-- tiles already use. It applies the same 24-hour rule as migration 1086: a reading nobody has checked for a day is unchecked.
-- Nothing else in the list changes; the entry is appended after the connectors.
--
-- The function body is the live definition with one addition: the final select appends the Google entry to the array.

create or replace function app.hq_studio_connections(p_office uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_catalog'
as $function$
declare
  g jsonb;
begin
  perform app.require_office(p_office);
  g := app.hq_google_connection(p_office);
  return (
  with connections as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'key', k.connector,
             'name', coalesce(nullif(k.name, ''), app.connector_label(k.connector)),
             'state', case
               when not k.enabled then 'off'
               when k.health_service is null then 'unchecked'
               when h.checked_at < now() - interval '24 hours' then 'unchecked'
               else coalesce(h.state, 'unchecked') end,
             'last', case when h.checked_at is null then ''
                          else to_char(h.checked_at, 'FMDD Mon HH24:MI') end,
             -- What it is FOR, in one line. `notes` is engineering reasoning
             -- and belongs to the engineer; see 0226.
             'used', coalesce(nullif(app.connector_purpose(k.connector), ''),
                              left(coalesce(k.notes, ''), 90)),
             'detail', coalesce(
               case when not k.enabled then k.disabled_reason
                    when h.checked_at < now() - interval '24 hours' then null
                    else h.detail end, ''),
             'action', h.action
           ) order by k.name), '[]'::jsonb) as v
      from public.knowledge_connectors k
      left join lateral (
        select ch.state, ch.detail, ch.checked_at, ch.action
          from public.connection_health ch
         where ch.office_id = any (app.office_scope(p_office)) and ch.service = k.health_service
         order by case ch.state
                    when 'dead' then 0 when 'missing' then 1
                    when 'unknown' then 2 when 'ok' then 3 else 4 end
         limit 1
      ) h on true
     -- A harness connector is not one of Grant's (0505). Filtered by the
     -- CLASS rather than by a run's names: the next crashed suite picks a
     -- prefix nobody listed, and five of these sat on his Connections page
     -- for two days because nothing was looking.
     where k.connector not like 'fixture\_%'
  ),
  google_entry as (
    select jsonb_build_object(
             'key', 'google',
             'name', 'Google',
             'state', coalesce(g ->> 'state', 'off'),
             'last', case when g ->> 'checked_at' is null then ''
                          else to_char((g ->> 'checked_at')::timestamptz, 'FMDD Mon HH24:MI') end,
             'used', 'Gmail, Drive and Calendar: one Google sign-in covers all three.',
             'detail', coalesce(g ->> 'detail', ''),
             'action', null
           ) as v
  )
  select jsonb_build_object('connections', (select v from connections) || jsonb_build_array((select v from google_entry)))
  );
end
$function$;
