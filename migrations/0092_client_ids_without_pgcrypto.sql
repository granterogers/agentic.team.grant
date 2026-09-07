-- 0092 — Client ids without pgcrypto
--
-- `app.mcp_register_client` built its client id with `gen_random_bytes`, which
-- is pgcrypto, which lives in the `extensions` schema and is unreachable from
-- `search_path = public, pg_catalog`. Registration therefore failed with
-- `function gen_random_bytes(integer) does not exist` and the endpoint returned
-- a 500 with no clue in it.
--
-- This is the second time. 0069 hit exactly this with `digest()` and solved it
-- the same way — reach for a built-in rather than widen the search path, since
-- widening it to reach one function exposes every function in that schema to
-- every SECURITY DEFINER body in this one.
--
-- `gen_random_uuid()` is core Postgres, is 122 bits of randomness, and is
-- already used for every other identifier here. A client id does not need to be
-- unguessable — it is public by construction and the security is in PKCE and
-- the redirect allow-list — but there is no reason to make it sequential.

begin;

create or replace function app.mcp_register_client(
  p_client_name   text,
  p_redirect_uris text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_id text;
  v_name text;
begin
  if coalesce(array_length(p_redirect_uris, 1), 0) = 0 then
    return jsonb_build_object('error', 'invalid_redirect_uri');
  end if;
  if exists (select 1 from unnest(p_redirect_uris) u
              where u !~ '^https://' and u !~ '^http://localhost') then
    return jsonb_build_object('error', 'invalid_redirect_uri');
  end if;

  v_name := coalesce(nullif(trim(p_client_name), ''), 'unnamed client');
  -- Core Postgres, not pgcrypto. See the header.
  v_id := 'mcpc_' || replace(gen_random_uuid()::text, '-', '');

  insert into public.mcp_oauth_clients (client_id, client_name, redirect_uris)
  values (v_id, v_name, p_redirect_uris);

  return jsonb_build_object(
    'client_id', v_id,
    'client_name', v_name,
    'redirect_uris', to_jsonb(p_redirect_uris),
    'token_endpoint_auth_method', 'none',
    'grant_types', jsonb_build_array('authorization_code'),
    'response_types', jsonb_build_array('code')
  );
end;
$$;

commit;
