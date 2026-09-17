begin;

-- ---------------------------------------------------------------------------
-- 0356 - Slack can be reconnected from the page (#210)
--
-- `verify:disconnect` deleted Slack's bot token and signing secret on 14
-- September, and the restore instruction sent Grant to "the studio's Setting
-- up tab, Slack section" - which does not exist. The studio has a credential
-- form for Google and nothing equivalent for Slack, so there was nowhere to
-- put the values even with both in hand.
--
-- The only path that existed was `npm run slack:repair-refs` with the token in
-- an environment variable. §31 calls an avoidable request for manual
-- configuration a design failure, and Grant's standing goal is blunter:
--
--   "I want to reduce my dependence on Claude or another coding interface for
--    maintaining and extending the system."
--
-- A capability that exists only as a script an agent runs is a capability he
-- does not have. So this is the setter, shaped exactly like
-- `hq_set_google_secret` (0094), and the page grows the form beside it.
--
-- ## Both halves in one call
--
-- A bot token without a signing secret leaves Slack able to post and unable to
-- verify anything inbound, which reads as "connected" on the Connections panel
-- and is half a connection. Reinstalling produces both at the same moment on
-- two adjacent pages, so asking for them together matches what he is actually
-- holding - and it means the row is never enabled in a state that cannot
-- receive.
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
    Shape-checked, not validated, exactly as 0094 does it.

    A Slack bot token starts `xoxb-`. The commonest mistake is pasting the App
    Configuration token (`xoxe-`) or the client secret, and both would be
    stored happily and fail later as `invalid_auth` a long way from the form.
  */
  if btrim(p_bot_token) !~ '^xoxb-' then
    return jsonb_build_object('error',
      'that does not look like a bot token - they start xoxb-, and it is on the Install App page');
  end if;
  -- Slack signing secrets are 32 hex characters. Narrow enough to catch a
  -- token pasted into the wrong box, wide enough not to guess at their format.
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

  /*
    Enabled again, and the reason cleared.

    A row left disabled with a stale explanation is the same defect as a health
    view nobody reads: the credentials would be present and the office would
    still refuse to use them, for a sentence about an incident that is over.
  */
  update public.slack_app_credentials
     set bot_token_ref = v_bot,
         signing_secret_ref = v_sig,
         enabled = true,
         disabled_reason = null,
         revoked_at = null,
         installed_at = app.now_utc(),
         updated_at = app.now_utc()
   where slack_app_id = v_app;

  update public.connection_health
     set state = 'ok',
         detail = 'reconnected from the web front end',
         action = null,
         checked_at = app.now_utc()
   where service = 'Slack';

  return jsonb_build_object('stored', true, 'app', v_app);
end;
$$;

comment on function app.hq_set_slack_credentials(text, text) is
  'Put Slack back after a disconnect, from the page rather than a terminal '
  '(#210). Takes both halves together because a bot token without a signing '
  'secret can post and cannot verify, which reads as connected and is not.';

grant execute on function app.hq_set_slack_credentials(text, text) to service_role;

create or replace function public.hq_set_slack_credentials(
  p_bot_token text, p_signing_secret text)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.hq_set_slack_credentials(p_bot_token, p_signing_secret) $$;

revoke all on function public.hq_set_slack_credentials(text, text) from public;
grant execute on function public.hq_set_slack_credentials(text, text) to service_role;

commit;
