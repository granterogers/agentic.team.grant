-- 1028 - the "can the office think" reading asks only that (efficiency run, 5 to 6 October 2026; NOT applied to production).
--
-- WHAT WAS MEASURED (replica seeded to production's 5 Oct shape; scripts/forensics/resource-probe.ts). Team HQ reads the section
-- `thinking` on load and on every pulse tick, every twenty seconds per visible tab (web/studio/app.js readThinking). The section was
-- served by public.office_health, the whole health reading: a 24-hour job census, the failing kinds, the stuck and waiting queues,
-- the backup state, progress and the budget hold. The page uses exactly one key of that, `cannot_think`, which is a read of
-- provider_health (a handful of rows). After 1023 the call still cost 81,475 buffer hits and 1,058 statements; the one key
-- the page draws costs about thirty.
--
-- WHAT CHANGED. app.cannot_think(p_office) returns {"cannot_think": [...]} built by the SAME expression office_health uses for that
-- key, with the same office guard, and public.cannot_think wraps it for the gateway (PostgREST exposes public only, EXECUTE to
-- service_role as for office_health). The gateway's `thinking` section calls it instead. office_health itself is untouched and
-- still serves every other caller (the operator tools, the health page, the scripts that read the whole reading).
--
-- WHAT DOES NOT CHANGE. The key the page reads, byte for byte (proved against office_health for every office). Office isolation:
-- require_office first, as before. Nothing is removed: a client that wanted the rest of the reading asks `office_health`.
-- DEPLOY ORDER (when this is ever approved): apply 1028, then deploy hq-api. The reverse order would call a function that does
-- not exist yet. Rolling back the gateway alone is safe (it goes back to office_health); rolling back the migration alone is safe
-- once the gateway is rolled back.
--
-- Proof: scripts/isolated/thinking-equivalence.ts.

begin;

create or replace function app.cannot_think(p_office uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
begin
  perform app.require_office(p_office);
  return jsonb_build_object('cannot_think', (
    -- Why a morning of failures happened, when the answer is "it could not think". Empty when every provider is reachable,
    -- which is the common case. The same expression as app.office_health's key of the same name.
    select coalesce(jsonb_agg(jsonb_build_object(
             'provider', h.provider,
             'since', h.opened_at,
             'next_probe_at', h.next_probe_at,
             'said', left(coalesce(h.last_error, ''), 200)) order by h.opened_at), '[]'::jsonb)
      from public.provider_health h
     where h.state = 'open'
       and h.provider not like 'probe_%'
  ));
end
$function$;

create or replace function public.cannot_think(p_office uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public', 'pg_catalog'
as $function$
 select app.cannot_think(p_office)
$function$;

revoke all on function public.cannot_think(uuid) from public, anon, authenticated;
grant execute on function public.cannot_think(uuid) to service_role;
revoke all on function app.cannot_think(uuid) from public, anon, authenticated;

commit;
