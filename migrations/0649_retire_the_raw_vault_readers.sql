-- 0649 - the raw vault readers are retired (multi-user P1.2, #400). Follows 0648.
--
-- app.vault_secret(name) checked the NAME and never the asker, and public.vault_secret wrapped it for any holder of
-- the service key. 0648 added the resolver; the gateway, google-oauth and the worker have been deployed to use it.
-- This removes the old door: app.vault_secret refuses everything, and the PostgREST wrapper is dropped.
--
-- Apply only after those three are deployed. `npm run check:system-secrets` is the witness that nothing in the
-- repository still calls the retired reader.

create or replace function app.vault_secret(p_name text)
returns text
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $f$
begin
  raise exception 'retired: use app.deployment_credential (0648)' using errcode = '42501';
end;
$f$;
drop function if exists public.vault_secret(text);


-- ROLLBACK (not part of the migration): recreate public.vault_secret(text) as 'select app.vault_secret(p_name)' and
-- restore app.vault_secret's allow-list body (google.client_secret, google.refresh_token, github.dispatch_token,
-- google.revoking_refresh_token; anything else raises 42501) from migration 0354's definition.
