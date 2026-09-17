-- The public wrappers a page needs (#265).
--
-- PostgREST exposes `public` and nothing else, so every `app.*` function the
-- Settings page calls needs one. CLAUDE.md records this as a trap because the
-- half that gets forgotten is always the wrapper -- 0440 shipped five
-- functions and one wrapper, and `check:callers` caught two of them with
-- nothing but a suite naming them.
--
-- `offer_mcp_tool` gets one and `enable` does NOT, deliberately. Offering a
-- discovered tool makes a switched-off capability; switching it on is the
-- existing approval path, which has its own action and its own record. A
-- second door to the same decision is how an invariant erodes.

create or replace function public.register_mcp_provider(
  p_name text, p_endpoint text, p_display_name text default '',
  p_auth_kind text default 'none', p_credential_ref uuid default null,
  p_notes text default '')
returns jsonb language sql security definer set search_path to ''
as $function$ select app.register_mcp_provider(p_name, p_endpoint, p_display_name,
                                               p_auth_kind, p_credential_ref, p_notes) $function$;

create or replace function public.revoke_mcp_provider(p_provider uuid, p_why text default '')
returns jsonb language sql security definer set search_path to ''
as $function$ select app.revoke_mcp_provider(p_provider, p_why) $function$;

create or replace function public.offer_mcp_tool(p_discovered uuid, p_as text default null)
returns jsonb language sql security definer set search_path to ''
as $function$ select app.offer_mcp_tool(p_discovered, p_as) $function$;
