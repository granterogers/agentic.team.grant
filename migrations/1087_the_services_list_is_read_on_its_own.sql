begin;

-- The Services list is read on its own (issue #502 follow-up: Settings took 3 to 14 seconds to open).
--
-- Every Settings tab waited for hq_studio_settings, which builds usage, headroom and mail counts as well as the list of
-- connections. The connections part depends only on the connector rows, their health rows and the office scope, so it is
-- read by its own function now, and the whole read no longer blocks the Services list.
--
-- The connections block is copied from the LIVE hq_studio_settings definition, not retyped, so the two cannot disagree.
-- hq_studio_settings keeps its own connections key for anything that still reads it. The gateway adds the viewer's
-- operator flag to this payload as it does to studio_settings, so the page never draws a write control to a visitor.

do $$
declare
  v text := pg_get_functiondef('app.hq_studio_settings(uuid)'::regprocedure);
  s_mark text := '  connections as (';
  e_mark text := E'  ),\n\n  channels as (';
  s_pos int;
  e_pos int;
  body text;
  f text;
begin
  -- Idempotent: a database that already has the function is left as it is.
  if to_regprocedure('app.hq_studio_connections(uuid)') is not null then
    return;
  end if;
  s_pos := position(s_mark in v);
  e_pos := position(e_mark in v);
  if s_pos = 0 or e_pos = 0 or e_pos <= s_pos then
    raise exception '1087: the connections block was not found once in the live hq_studio_settings';
  end if;
  body := substring(v from s_pos + length(s_mark) for e_pos - s_pos - length(s_mark));

  f := 'create or replace function app.hq_studio_connections(p_office uuid)' || E'\n'
    || 'returns jsonb' || E'\n'
    || 'language plpgsql' || E'\n'
    || 'stable' || E'\n'
    || 'security definer' || E'\n'
    || 'set search_path = public, pg_catalog' || E'\n'
    || 'as $f$' || E'\n'
    || 'begin' || E'\n'
    || '  perform app.require_office(p_office);' || E'\n'
    || '  return (' || E'\n'
    || '  with connections as (' || body || '  )' || E'\n'
    || '  select jsonb_build_object(''connections'', (select v from connections))' || E'\n'
    || '  );' || E'\n'
    || 'end;' || E'\n'
    || '$f$;';
  execute f;
end
$$;

comment on function app.hq_studio_connections(uuid) is
  'The Services list on its own: the connector rows and their health, for one office. Read by the gateway section studio_connections.';

revoke all on function app.hq_studio_connections(uuid) from public;
grant execute on function app.hq_studio_connections(uuid) to service_role;

create or replace function public.hq_studio_connections(p_office uuid)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.hq_studio_connections(p_office) $$;

revoke all on function public.hq_studio_connections(uuid) from public;
grant execute on function public.hq_studio_connections(uuid) to service_role;

commit;
