-- 0095 — Storing the refresh token, and reading a secret from an Edge Function
--
-- Two small functions the callback in `google-oauth` needs, kept out of 0094
-- because that one is about what the PAGE may do and these are about what the
-- FUNCTION may do — a distinction worth keeping visible, since the page must
-- never be able to call either.
--
-- `vault_secret` is the sharper of the two: it returns a credential in plain
-- text. It exists because the token exchange needs the client secret and runs
-- in Deno with the service key, not because anything else should call it. The
-- allow-list of names is the whole control, and it has one entry.

begin;

/**
 * One named secret, for a caller that already holds the service key.
 *
 * Allow-listed by name rather than open, because "read any vault secret" is a
 * different function from "read the Google client secret", and only the second
 * one has a reason to exist. A future caller that needs another name has to add
 * it here, in a migration, where it is visible in a diff.
 */
create or replace function app.vault_secret(p_name text)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
begin
  if p_name not in ('google.client_secret') then
    raise exception 'no' using errcode = '42501';
  end if;
  return (select decrypted_secret from vault.decrypted_secrets where name = p_name);
end;
$$;

create or replace function app.hq_store_google_refresh(p_refresh_token text, p_scopes text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if coalesce(trim(p_refresh_token), '') = '' then
    return jsonb_build_object('error', 'no refresh token');
  end if;
  perform app.store_secret('google.refresh_token', trim(p_refresh_token),
    format('Google refresh token, granted %s. Scopes: %s', app.now_utc(), p_scopes));

  insert into public.system_config (key, value, description)
  values ('google.granted_scopes', to_jsonb(p_scopes),
          'What Google actually granted, which can be less than what was asked for.')
  on conflict (key) do update set value = excluded.value;

  -- The light goes green because a token exists, not because we hope one does.
  insert into public.connection_health (service, credential, state, detail, owner, action)
  values ('google_calendar', 'oauth_client', 'ok',
          'connected — a refresh token is in the vault', 'grant', '')
  on conflict (service, credential) do update
    set state = excluded.state, detail = excluded.detail,
        action = excluded.action, checked_at = app.now_utc();

  return jsonb_build_object('stored', true);
end;
$$;

create or replace function public.vault_secret(p_name text)
returns text language sql stable security definer set search_path = public, pg_catalog
as $$ select app.vault_secret(p_name) $$;

create or replace function public.hq_store_google_refresh(p_refresh_token text, p_scopes text)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.hq_store_google_refresh(p_refresh_token, p_scopes) $$;

commit;
