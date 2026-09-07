-- 0093 — The consent page names the registered client, not a query parameter
--
-- The first version read the name to display from `?client_name=` on the
-- authorize URL. That is a string the client controls, on the one page whose
-- entire job is to let Grant recognise what is asking — so any application
-- could have presented itself as "ChatGPT" and been believed.
--
-- It is the oldest phishing shape there is, and it arrived by convenience: the
-- name was already in the query string during registration, so reusing it saved
-- a lookup.
--
-- The registered name is the one we assigned at registration and is the only
-- one worth showing. A client that registers as "Definitely ChatGPT" still
-- shows as "Definitely ChatGPT", which is the point: the page shows what the
-- server knows, not what the caller says right now.

begin;

create or replace function app.mcp_client_name(p_client_id text)
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select client_name from public.mcp_oauth_clients where client_id = p_client_id
$$;

create or replace function public.mcp_client_name(p_client_id text)
returns text language sql stable security definer set search_path = public, pg_catalog
as $$ select app.mcp_client_name(p_client_id) $$;

comment on function app.mcp_client_name is
  'The name a client registered under, for the consent page. Never the one it '
  'passes in a query parameter: that is a string the caller controls, on the '
  'one page whose job is to let Grant recognise what is asking.';

commit;
