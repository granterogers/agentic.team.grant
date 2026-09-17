-- The MCP entry says what it is (#91).
--
-- Grant: *"Implement MCP client controls: Make the MCP client entry open a
-- functional setup or management view."* It opened nothing.
--
-- There is a real server behind it -- `npm run deploy:mcp` exists and probes
-- itself, there are 21 tools in `tool_permissions`, and `mcp_clients` and
-- `mcp_calls` record who has connected and what they asked for. So this is
-- another missing view over working infrastructure.
--
-- ## Why this one matters more than it looks
--
-- *"I want to reduce my dependence on Claude or another coding interface for
-- maintaining and extending the system."* MCP is how another client reaches
-- the office WITHOUT a coding session. A capability that exists only as a
-- script an agent runs is a capability Grant does not have, and one he cannot
-- see how to connect to is the same thing.
--
-- ## No secret goes near this
--
-- Connecting a client needs the bearer token, and this tab will be captured by
-- `npm run shots` and attached to a build step on a public page. So the token
-- is not here, not truncated, not fingerprinted. What travels is the
-- PROCEDURE for getting it -- `npm run hq:token`, which sends it to him on
-- Telegram -- and `token_sha256` is never selected even to show that one
-- exists.

create or replace function app.hq_mcp()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'url', 'https://' ||
           coalesce((select value #>> '{}' from public.system_config where key = 'db.project_ref'),
                    'baujwlzcziasnfhhkchg') ||
           '.supabase.co/functions/v1/mcp',
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
$$;

create or replace function public.hq_mcp()
returns jsonb language sql stable security definer set search_path = public, pg_catalog
as $$ select app.hq_mcp() $$;
