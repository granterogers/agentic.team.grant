/*
  0478 — the connector inventory shows everything except what a press needs

  #265 built the inventory and #276 found that nothing in the page could act
  on it: `register_connector`, `revoke_connector` and `offer_connector_tool`
  are gateway actions with no control. Two of the three cannot HAVE a control
  as things stand, because `app.mcp_inventory` returns no identifiers —
  `revoke_mcp_provider` takes a `provider_id` and `offer_mcp_tool` takes a
  `discovered` id, and the page has neither.

  An id is not a secret. The token is not in this payload and never has been
  (0440 is explicit about that, for the same reason the MCP block below it
  shows a URL and no bearer), and nothing here changes it.

  Spliced from the live definition: the function is 40 lines and two of them
  change.
*/

do $splice$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'mcp_inventory';

  if position('''name'', p.name, ''display_name'', p.display_name' in v_def) = 0 then
    raise exception '0478 cannot find the provider object it means to widen';
  end if;
  v_def := replace(
    v_def,
    '''name'', p.name, ''display_name'', p.display_name',
    '''id'', p.provider_id, ''name'', p.name, ''display_name'', p.display_name');

  if position('''name'', d.external_name, ''reach'', d.reach' in v_def) = 0 then
    raise exception '0478 cannot find the tool object it means to widen';
  end if;
  v_def := replace(
    v_def,
    '''name'', d.external_name, ''reach'', d.reach',
    '''id'', d.discovered_id, ''name'', d.external_name, ''reach'', d.reach');

  execute v_def || ';';
end
$splice$;

comment on function app.mcp_inventory() is
  'Every outside provider, what it advertises, what the office offered and '
  'what Grant can actually use (#265) — with the ids a press needs (0478). '
  'No credential, ever: the token is not selected here.';
