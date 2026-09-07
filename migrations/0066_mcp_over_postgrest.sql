-- 0066 — the MCP functions need public wrappers
--
-- PostgREST serves only the schemas it is configured for, which here is
-- `public`. Every `app.*` function an Edge Function calls therefore needs a
-- wrapper, and this project has now learned that three times: the Telegram
-- webhook failed silently on it (0042), the HQ API documented it at the top of
-- its own file so the next endpoint would not rediscover it (0046), and the MCP
-- endpoint rediscovered it anyway — `tools/list` returned a 500 with
-- "Internal Server Error" because `app.mcp_client_for` is not reachable over
-- REST and the authentication call threw.
--
-- A comment in one file is not a mechanism. The durable fix is `verify:schema`,
-- which already fails on a function naming a relation that does not exist;
-- extending it to "an Edge Function calling an `app.` RPC that has no public
-- wrapper" is the shape that would have caught all three, and is noted as the
-- next thing to add rather than claimed here.

begin;

create or replace function public.mcp_client_for(p_token_sha256 text)
returns table (client_id text, display_name text, scopes text[])
language sql stable security definer set search_path = public, pg_catalog
as $$ select * from app.mcp_client_for(p_token_sha256) $$;

create or replace function public.mcp_record_call(
  p_client_id text, p_tool text, p_arguments jsonb, p_outcome text,
  p_rows integer default 0, p_duration_ms integer default null
)
returns void
language sql security definer set search_path = public, pg_catalog
as $$ select app.mcp_record_call(p_client_id, p_tool, p_arguments, p_outcome, p_rows, p_duration_ms) $$;

create or replace function public.mcp_projects()
returns jsonb language sql stable security definer set search_path = public, pg_catalog
as $$ select app.mcp_projects() $$;

create or replace function public.mcp_search(p_query text, p_project text default null, p_limit integer default 8)
returns jsonb language sql stable security definer set search_path = public, pg_catalog
as $$ select app.mcp_search(p_query, p_project, p_limit) $$;

create or replace function public.mcp_document(p_document_id uuid, p_max_chars integer default 20000)
returns jsonb language sql stable security definer set search_path = public, pg_catalog
as $$ select app.mcp_document(p_document_id, p_max_chars) $$;

create or replace function public.mcp_staff()
returns jsonb language sql stable security definer set search_path = public, pg_catalog
as $$ select app.mcp_staff() $$;

create or replace function public.mcp_recent_work(p_limit integer default 20)
returns jsonb language sql stable security definer set search_path = public, pg_catalog
as $$ select app.mcp_recent_work(p_limit) $$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.mcp_client_for(text)',
    'public.mcp_record_call(text, text, jsonb, text, integer, integer)',
    'public.mcp_projects()', 'public.mcp_search(text, text, integer)',
    'public.mcp_document(uuid, integer)', 'public.mcp_staff()',
    'public.mcp_recent_work(integer)'
  ] loop
    execute format('revoke all on function %s from public', fn);
    execute format('grant execute on function %s to ai_team_app, service_role', fn);
  end loop;
end $$;

commit;
