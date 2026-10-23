begin;

-- app.office_timezone checked each office's zone against pg_timezone_names, a system view that lists every zone and costs
-- about 80 ms per call. The studio asks once for every project, so an office with twenty projects spent about two seconds on
-- that check alone. This asks the database directly instead: AT TIME ZONE accepts exactly the zones it can use, and anything
-- else falls back to UTC as before. Checked against every zone the offices hold (UTC and Europe/Athens, which agree under
-- both tests). Same signature, same grants. Read-only apart from the function body.

create or replace function app.office_timezone(p_office uuid)
returns text
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_zone text;
begin
  select o.timezone into v_zone from public.offices o where o.office_id = p_office;
  if v_zone is null then
    return 'UTC';
  end if;
  -- Raises for a zone the database cannot use; the caller then gets UTC, as it always did.
  perform now() at time zone v_zone;
  return v_zone;
exception when others then
  return 'UTC';
end;
$function$;

commit;
