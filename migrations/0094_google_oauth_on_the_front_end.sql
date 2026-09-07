-- 0094 — Google's OAuth client, configured from the page
--
-- Grant: *"put the google oauth on the web front end please."*
--
-- Calendar is the thing waiting on it, and what it needs is a Google Cloud
-- OAuth client — a client id and a secret he creates once in his own console.
-- Until now the only place to put those was a shell script he would have to be
-- talked through.
--
-- ## The secret does not go in `system_config`
--
-- `system_config` is read by `hq_settings` and rendered in a browser. A client
-- secret there would be a client secret in a web response, which is how the
-- avatar host and the Slack team id are allowed to live there and a credential
-- is not. So the id is configuration and the secret is a vault reference, and
-- the page can only ever WRITE the secret — never read it back.
--
-- ## Why the connect button is a redirect and not a form
--
-- Google's consent screen is Google's. The page sends him there and Google
-- sends him back to a callback that exchanges the code. Nothing here ever sees
-- his Google password, which is the entire point of OAuth and worth not
-- accidentally designing around.

begin;

insert into public.system_config (key, value, description) values
  ('google.client_id', to_jsonb(''::text),
   'The OAuth client id from Google Cloud. Public by design — it appears in '
   'every authorization URL — so it lives here rather than in the vault.'),
  ('google.redirect_uri', to_jsonb(
     'https://baujwlzcziasnfhhkchg.supabase.co/functions/v1/google-oauth/callback'::text),
   'Where Google sends him back. Must be listed verbatim in the Cloud console''s '
   'Authorised redirect URIs, or the consent screen refuses before he sees it.'),
  ('google.scopes', to_jsonb(
     'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly'::text),
   'What to ask for. Calendar only: §17 keeps each integration separately '
   'disableable, and a token that can also read Gmail is a token whose blast '
   'radius is not what the page says it is.')
on conflict (key) do nothing;

/**
 * What the page shows about Google, and what it may change.
 *
 * `has_secret` and `has_refresh_token` are booleans on purpose. The page needs
 * to know whether a step is done; it must never receive the credential that
 * proves it.
 */
create or replace function app.hq_google()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select jsonb_build_object(
    'client_id', coalesce(
      (select value #>> '{}' from public.system_config where key = 'google.client_id'), ''),
    'redirect_uri', coalesce(
      (select value #>> '{}' from public.system_config where key = 'google.redirect_uri'), ''),
    'scopes', coalesce(
      (select value #>> '{}' from public.system_config where key = 'google.scopes'), ''),
    'has_secret', exists (
      select 1 from vault.decrypted_secrets where name = 'google.client_secret'),
    'has_refresh_token', exists (
      select 1 from vault.decrypted_secrets where name = 'google.refresh_token'),
    'calendar_enabled', coalesce(
      (select value::text::boolean from public.system_config where key = 'calendar.enabled'), false)
  )
$$;

/**
 * Store the client secret. Write-only, by construction.
 *
 * There is no `hq_google_secret()` to read it back, and there will not be: the
 * only caller that needs the value is the token exchange, which runs in an Edge
 * Function with the service key and reads the vault directly.
 */
create or replace function app.hq_set_google_secret(p_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if coalesce(trim(p_secret), '') = '' then
    return jsonb_build_object('error', 'the secret is empty');
  end if;
  -- Shape-checked, not validated: Google's client secrets start `GOCSPX-`.
  -- Rejecting anything else catches the commonest mistake, which is pasting
  -- the client ID into the secret box.
  if trim(p_secret) !~ '^GOCSPX-' then
    return jsonb_build_object(
      'error', 'that does not look like a Google client secret — they start GOCSPX-'
    );
  end if;
  perform app.store_secret('google.client_secret', trim(p_secret),
    'Google Cloud OAuth client secret, entered on the web front end.');
  return jsonb_build_object('stored', true);
end;
$$;

create or replace function public.hq_google()
returns jsonb language sql stable security definer set search_path = public, pg_catalog
as $$ select app.hq_google() $$;

create or replace function public.hq_set_google_secret(p_secret text)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.hq_set_google_secret(p_secret) $$;

-- The client id is ordinary configuration, so it joins the allow-list rather
-- than getting a setter of its own.
create or replace function app.hq_set_setting(p_key text, p_value text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_json jsonb;
begin
  if p_key not in ('db.project_ref', 'db.region', 'backup.s3_bucket',
                   'backup.s3_endpoint', 'backup.s3_region',
                   'calendar.enabled', 'calendar.calendar_id',
                   'notebook.window_units', 'notebook.week_units',
                   'google.client_id', 'google.redirect_uri', 'google.scopes') then
    return jsonb_build_object('error', format('%L is not a setting this page may change', p_key));
  end if;

  v_json := case
    when p_key = 'calendar.enabled'
      then to_jsonb(lower(trim(p_value)) in ('true', 'on', 'yes', '1'))
    when p_key like 'notebook.%units'
      then to_jsonb(greatest(1,
             coalesce(nullif(regexp_replace(p_value, '[^0-9]', '', 'g'), ''), '1')::integer))
    else to_jsonb(trim(p_value))
  end;

  insert into public.system_config (key, value)
  values (p_key, v_json)
  on conflict (key) do update set value = excluded.value;

  if p_key = 'notebook.window_units' then
    update public.system_config set value = to_jsonb(false)
     where key = 'notebook.ceiling_is_measured';
  end if;

  return jsonb_build_object('key', p_key, 'value', v_json);
end;
$$;

commit;
