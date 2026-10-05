-- A successful run closes every incident that run proves is over, in ONE statement (#413).
--
-- 0877 closed one named problem per call. A Google duty that works has just shown that several things are no longer true
-- at once (the connection was revoked, nobody had connected, Google refused), and the run is hourly: asking six times
-- an hour to learn that nothing was open would be the kind of idle cost this work is meant to remove. So the resolver
-- takes the list, and does nothing (no write) when none of them is open.
--
-- Returns how many incidents it closed and whether any of them had been told to the person, which is the only case where
-- "that works again" is worth saying. A second call finds nothing open and says so, so the recovery is announced once.

begin;

drop function if exists app.incident_resolve(uuid, text, text);

create function app.incident_resolve(p_office uuid, p_service text, p_problems text[])
returns jsonb
language plpgsql
security definer
set search_path to ''
as $f$
declare
  v_closed integer := 0;
  v_told boolean := false;
begin
  perform app.require_office(p_office);

  with closed as (
    update public.incidents
       set state = 'resolved', resolved_at = app.now_utc()
     where office_id = p_office
       and service = lower(btrim(p_service))
       and problem = any (select lower(btrim(x)) from unnest(coalesce(p_problems, '{}'::text[])) x)
       and state = 'open'
    returning told_at
  )
  select count(*)::integer, coalesce(bool_or(told_at is not null), false)
    into v_closed, v_told
    from closed;

  return jsonb_build_object('resolved', v_closed, 'was_told', v_told);
end
$f$;

revoke all on function app.incident_resolve(uuid, text, text[]) from public, anon, authenticated, service_role;

commit;
