-- 0534 — the MCP address is this office's, or it is nothing
--
-- `app.hq_mcp()` composes the server URL a person copies into Claude Desktop,
-- and it ended with a fallback:
--
--     coalesce((select value #>> '{}' from public.system_config
--               where key = 'db.project_ref'),
--              'baujwlzcziasnfhhkchg')
--
-- On this database that is harmless, because the key is set and the fallback
-- never fires. On any other it is the whole defect: a second person installing
-- this office, who has not yet set `db.project_ref`, is shown a perfectly
-- well-formed MCP URL pointing at GRANT'S project — and told, in the steps
-- immediately below it, to connect a client to that address with a bearer
-- token. Nothing anywhere would say the address was wrong. It looks exactly
-- like a working setup.
--
-- Found by the fresh-install baseline build, whose contamination scan refuses
-- to write a baseline containing this project's identifiers. It was the only
-- live database function that held one; 252 FILES do, as
-- `process.env.SUPABASE_PROJECT_REF ?? '<the ref>'`, which is F-005 and is not
-- this migration's business.
--
-- ## Null rather than a better default
--
-- There is no better default. The address of an office is a fact about that
-- office, and there is nothing to guess it from — so the honest answer when
-- nobody has said is to say nobody has said. `hq_mcp` returns null for `url`,
-- the Settings page renders the absence, and `npm run fresh:doctor` names the
-- key and the command that sets it.
--
-- This is the same argument 0177 made about a sentinel satisfying a constraint
-- and lying, and the same one `telegram_bots_enabled_needs_a_token` makes: a
-- claim the system cannot honour must not be made. A URL is a claim.
--
-- Spliced from `pg_get_functiondef` rather than retyped. CLAUDE.md records what
-- rewriting a function from memory costs: `app.pause_job` lost four behaviours
-- in one go, including its lease.

begin;

CREATE OR REPLACE FUNCTION app.hq_mcp()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'url', (select case
              when nullif(btrim(coalesce(value #>> '{}', '')), '') is null then null
              else 'https://' || (value #>> '{}') || '.supabase.co/functions/v1/mcp'
            end
            from public.system_config where key = 'db.project_ref'),
    -- What a client would actually see. Level and description come straight
    -- from the permissions table, so a tool turned off says so here rather
    -- than being quietly missing.
    'tools', (select coalesce(jsonb_agg(jsonb_build_object(
                       'tool', t.tool,
                       'level', t.level,
                       'what', t.description,
                       'on', t.enabled,
                       'why_off', nullif(coalesce(t.disabled_reason, ''), '')
                     ) order by t.enabled desc, t.tool), '[]'::jsonb)
                from public.tool_permissions t),
    'clients', (select coalesce(jsonb_agg(jsonb_build_object(
                         'name', c.display_name,
                         'on', c.enabled,
                         'why_off', nullif(coalesce(c.disabled_reason, ''), ''),
                         'calls', c.calls,
                         'last', case when c.last_seen_at is null then null
                                      else app.ago(c.last_seen_at) end
                       ) order by c.last_seen_at desc nulls last), '[]'::jsonb)
                  from public.mcp_clients c),
    'recent', (select coalesce(jsonb_agg(jsonb_build_object(
                        'tool', k.tool,
                        'outcome', k.outcome,
                        'rows', k.rows_returned,
                        'when', app.ago(k.called_at)
                      ) order by k.called_at desc), '[]'::jsonb)
                 from (select * from public.mcp_calls
                        order by called_at desc limit 8) k),
    -- Explicit, every time, with the real steps. His standing instruction.
    'steps', jsonb_build_array(
      'Copy the server URL above.',
      'In the client you want to connect — Claude Desktop, an editor, anything that speaks MCP — add it as a remote MCP server at that URL.',
      'It will ask for a bearer token. Run npm run hq:token, which sends the token to you on Telegram. The token is never shown on this page.',
      'The client then sees the tools listed above, minus any that are switched off.')
  )
$function$;

comment on function app.hq_mcp() is
  'The MCP server address, the tools a client would see, and the steps to '
  'connect. The url is NULL until system_config.db.project_ref names this '
  'office project: there is nothing to guess it from, and a well-formed URL '
  'pointing at somebody else''s project is worse than no URL at all.';

-- Drive it. A migration that applies cleanly is not a function that works.
do $drive$
declare
  v_before jsonb;
  v_after  jsonb;
  v_saved  jsonb;
begin
  select value into v_saved from public.system_config where key = 'db.project_ref';

  -- With nothing declared, there is no address.
  update public.system_config set value = '""'::jsonb where key = 'db.project_ref';
  v_before := app.hq_mcp();
  if v_before ->> 'url' is not null then
    raise exception '0534: an office that has not said where it lives still claims an address: %',
      v_before ->> 'url';
  end if;

  -- CONTROL: and with one declared, the address is THAT office's.
  update public.system_config set value = '"probe0534ref"'::jsonb where key = 'db.project_ref';
  v_after := app.hq_mcp();
  if v_after ->> 'url' <> 'https://probe0534ref.supabase.co/functions/v1/mcp' then
    raise exception '0534: a declared project ref did not reach the address: %',
      coalesce(v_after ->> 'url', '(null)');
  end if;

  -- And the rest of the payload still answers, so the splice took nothing else.
  if v_after -> 'tools' is null or v_after -> 'steps' is null then
    raise exception '0534: the splice lost part of the payload';
  end if;

  update public.system_config set value = coalesce(v_saved, '""'::jsonb)
   where key = 'db.project_ref';
  raise notice '0534: the MCP address is this office''s, or it is null';
end
$drive$;

commit;
