begin;

-- ---------------------------------------------------------------------------
-- 0358 - `connection_health.action` is NOT NULL (#210)
--
-- 0356 set `action = null` on a successful reconnect, meaning "nothing to do".
-- The column refuses null, so the setter raised 23502 and could never have
-- stored anything - it would have failed on the line AFTER the credentials
-- were written, leaving them in the vault with the row still disabled.
--
-- Caught by calling the function before shipping it rather than by Grant
-- pressing the button. The convention every healthy row already follows is a
-- short sentence saying where the thing is managed, not an empty string:
--
--   google_calendar  ok  'Settings -> Google on the web front end'
--
-- An empty string would satisfy the constraint and say nothing, which is
-- 0177's sentinel argument in a column a person reads.
-- ---------------------------------------------------------------------------

create or replace function app.hq_set_slack_credentials(
  p_bot_token      text,
  p_signing_secret text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_bot uuid;
  v_sig uuid;
  v_app text;
begin
  if coalesce(btrim(p_bot_token), '') = '' or coalesce(btrim(p_signing_secret), '') = '' then
    return jsonb_build_object('error',
      'both the bot token and the signing secret are needed - reinstalling gives you both');
  end if;

  /*
    Shape-checked, not validated, exactly as 0094 does it for Google.

    A Slack bot token starts `xoxb-`. The commonest mistake is pasting the App
    Configuration token (`xoxe-`) or the client secret, and both would be
    stored happily and fail later as `invalid_auth` a long way from the form.
  */
  if btrim(p_bot_token) !~ '^xoxb-' then
    return jsonb_build_object('error',
      'that does not look like a bot token - they start xoxb-, and it is on the Install App page');
  end if;
  if btrim(p_signing_secret) !~ '^[0-9a-f]{32}$' then
    return jsonb_build_object('error',
      'that does not look like a signing secret - 32 hex characters, on Basic Information');
  end if;

  select slack_app_id into v_app from public.slack_app_credentials limit 1;
  if v_app is null then
    return jsonb_build_object('error', 'there is no Slack app row to attach these to');
  end if;

  perform app.store_secret('slack.bot_token', btrim(p_bot_token),
    'Bot user OAuth token for the AI Team HQ app, entered on the web front end.');
  perform app.store_secret('slack.signing_secret', btrim(p_signing_secret),
    'Slack request signing secret, entered on the web front end.');

  select id into v_bot from vault.secrets where name = 'slack.bot_token';
  select id into v_sig from vault.secrets where name = 'slack.signing_secret';

  update public.slack_app_credentials
     set bot_token_ref = v_bot,
         signing_secret_ref = v_sig,
         enabled = true,
         disabled_reason = null,
         revoked_at = null,
         installed_at = app.now_utc(),
         updated_at = app.now_utc()
   where slack_app_id = v_app;

  -- Says where it is managed, which is what every other healthy row says.
  update public.connection_health
     set state = 'ok',
         detail = 'reconnected from the web front end',
         action = 'Setting up -> Slack on the web front end',
         checked_at = app.now_utc()
   where service = 'Slack';

  return jsonb_build_object('stored', true, 'app', v_app);
end;
$$;

commit;
