-- 0350 — Disconnect for Slack and Telegram, and the exact truth about revoking
--
-- Issue #198 wants Connect and Disconnect that PERFORM the action. Grant's UX
-- review found roughly a third of its thirty items were dead controls —
-- "a Disconnect that does not disconnect" — and #109 is the sharper version:
-- disconnect deletes our copy of a credential but does not revoke it at the
-- provider, so a person who presses it reasonably believes access ended.
--
-- Both were previously REFUSED here, with a reason, which was the right answer
-- while the alternative was a lie. This makes them work, and it draws the line
-- exactly where the truth is rather than where it would be convenient.
--
-- ## What can honestly be done from inside the database
--
-- Deleting our copy of a credential is real and immediate: the office cannot
-- use what it does not have, every duty that needs it stops, and the health
-- row says why. That is the whole of what a SQL function can do — Postgres
-- cannot make an outbound HTTPS call, so no function here can ask Slack or
-- Telegram to invalidate anything.
--
-- ## What each provider actually offers, which is not the same for the two
--
--   * SLACK has `auth.revoke`, a real API that invalidates the token. It needs
--     an HTTP call, so it belongs in an edge function or a worker duty — #109,
--     which stays open with the endpoint named rather than as a vague worry.
--     Until then the app also stays INSTALLED in the workspace, and uninstalling
--     is a separate act at Slack that only Grant can perform.
--
--   * TELEGRAM offers NO way to revoke a bot token by API. Only BotFather can,
--     with /revoke, and that is a human step in a chat window. There is no
--     version of #109 that automates it, so the honest thing is to say so with
--     the exact steps rather than to imply a revoke that cannot happen.
--
-- So `revoked` is never claimed. Each answer says what stopped, what did not,
-- and precisely what Grant must do to finish it — with URLs and steps, per
-- "Always be explicit with instructions!!!".

begin;

create or replace function app.hq_disconnect(p_service text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_key     text := lower(btrim(coalesce(p_service, '')));
  v_gone    int  := 0;
  v_had     boolean;
begin
  -- The Google family is one consent behind three services, so any of them
  -- disconnects the account. 0112 already does the work correctly; calling it
  -- rather than repeating it means there is one description of what signing
  -- out of Google means.
  if v_key in ('google', 'drive', 'calendar', 'gmail') then
    select exists (select 1 from vault.secrets where name = 'google.refresh_token')
      into v_had;
    if not v_had then
      return jsonb_build_object('ok', true, 'service', 'Google', 'removed', 0,
        'note', 'Google was already signed out here -- nothing to remove.',
        'revoke_at', 'https://myaccount.google.com/permissions');
    end if;
    perform app.hq_forget_google();
    return jsonb_build_object('ok', true, 'service', 'Google', 'removed', 1,
      'note', 'Signed out. Calendar reading is off and the refresh token is deleted. '
              || 'The client id and secret stay -- they are the registration, not the consent, '
              || 'so signing in again does not need the console step.',
      'revoke_at', 'https://myaccount.google.com/permissions');
  end if;

  if v_key = 'notion' then
    delete from vault.secrets where name = 'notion.integration_token';
    get diagnostics v_gone = row_count;
    if v_gone = 0 then
      return jsonb_build_object('ok', true, 'service', 'Notion', 'removed', 0,
        'note', 'There was no Notion token here to remove.',
        'revoke_at', 'https://www.notion.so/profile/integrations');
    end if;
    update public.connection_health
       set state = 'missing',
           detail = 'disconnected at your request',
           action = 'Add a Notion integration token in Setting up',
           checked_at = app.now_utc()
     where service = 'Notion';
    return jsonb_build_object('ok', true, 'service', 'Notion', 'removed', v_gone,
      'note', 'Disconnected. The office can no longer read Notion. '
              || 'Pages it already imported stay -- ADR-0013: a route may be closed and the corpus is kept.',
      'revoke_at', 'https://www.notion.so/profile/integrations');
  end if;

  if v_key in ('notebooklm', 'notebook') then
    delete from vault.secrets where name = 'notebook.storage_state';
    get diagnostics v_gone = row_count;
    -- Off as well as gone: a duty running hourly against a credential that was
    -- deliberately removed is a red light he caused and cannot explain.
    update public.system_config set value = to_jsonb(false) where key = 'notebook.enabled';
    return jsonb_build_object('ok', true, 'service', 'NotebookLM', 'removed', v_gone,
      'note', case when v_gone = 0
                then 'There was no NotebookLM session here to remove; generation is switched off.'
                else 'Disconnected and generation switched off. Notebooks already attached to a '
                     || 'dashboard project stay attached, and what they produced stays.' end,
      'revoke_at', 'https://notebooklm.google.com');
  end if;

  /*
    Slack (#198, #109).

    Everything of ours goes: the bot token and the short-lived config tokens.
    The office stops posting and stops reading within one worker pass, which is
    real and immediate and is the part a database can do.

    What it CANNOT do is revoke the token at Slack or uninstall the app, both
    of which need an outbound call or a person. So neither is claimed. The
    answer names `auth.revoke` because a future #109 needs the endpoint, and
    names the uninstall page because that is the step only Grant can take.
  */
  if v_key = 'slack' then
    delete from vault.secrets
     where name in ('slack.bot_token', 'slack.config_access_token',
                    'slack.config_refresh_token', 'slack.app_token',
                    'slack.signing_secret');
    get diagnostics v_gone = row_count;

    update public.connection_health
       set state = 'missing',
           detail = 'disconnected at your request',
           action = 'Reconnect in Setting up, or uninstall the app at Slack to finish it',
           checked_at = app.now_utc()
     where service = 'Slack';

    return jsonb_build_object(
      'ok', true, 'service', 'Slack', 'removed', v_gone,
      'stopped', 'The office can no longer read or post in Slack. Every message '
                 || 'already there stays, and so does everything the office recorded from it '
                 || '-- losing a channel loses a surface, not the conversation.',
      /*
        Said plainly, because #109 is a real defect and shipping a Disconnect
        that implied otherwise would inherit it. This is the honest partial:
        it names what did not happen as clearly as what did.
      */
      'not_revoked', 'The token was deleted here, NOT revoked at Slack, and the app is '
                     || 'still installed in the workspace. Nothing can use the token now -- '
                     || 'it is gone -- but Slack has not been told to invalidate it.',
      'to_finish', jsonb_build_array(
        'Open https://api.slack.com/apps and choose Agentic Team Grant.',
        'Go to Settings, then Install App, and press Revoke All OAuth Tokens.',
        'To remove it from the workspace entirely: Settings, then Basic Information, '
          || 'then Delete App at the bottom.'
      ),
      'revoke_at', 'https://api.slack.com/apps',
      'note', 'Reconnecting means installing the app again and pasting a new bot token '
              || 'in Setting up. The channels the office made stay where they are.'
    );
  end if;

  /*
    Telegram (#198, #70).

    Grant, 13 September: "we don't need a different bot for each role. In fact,
    we only need the chief of staff." So this deletes the chief's token, which
    is the one that reaches him, and reports the staff bots separately rather
    than silently taking eight things away with one press.

    No API can revoke a Telegram bot token. Only BotFather's /revoke can, in a
    chat window, by a person. That is not a gap waiting for #109 to close --
    there is nothing to automate -- so the steps are given in full.
  */
  if v_key = 'telegram' then
    delete from vault.secrets where name in ('telegram.bot_token', 'telegram.chief_bot_token');
    get diagnostics v_gone = row_count;

    -- Off as well as gone, for 0112's reason: a duty polling a credential that
    -- was deliberately removed is a red light he caused and cannot explain.
    update public.system_config
       set value = to_jsonb(false)
     where key = 'telegram.enabled';

    update public.connection_health
       set state = 'missing',
           detail = 'disconnected at your request',
           action = 'Reconnect in Setting up with a bot token from BotFather',
           checked_at = app.now_utc()
     where service = 'Telegram' and credential like '%chief%';

    return jsonb_build_object(
      'ok', true, 'service', 'Telegram', 'removed', v_gone,
      'stopped', 'The office can no longer send or receive on Telegram. Everything '
                 || 'already said there is kept and still in the conversation.',
      'not_revoked', 'Telegram has no API that revokes a bot token -- only BotFather can, '
                     || 'and only a person can ask it. The token is deleted here, so nothing '
                     || 'of ours can use it, but it is still a valid token until you revoke it.',
      'to_finish', jsonb_build_array(
        'Open Telegram and message @BotFather.',
        'Send /revoke and choose @agenticteamgrantbot.',
        'BotFather replies with a new token, which invalidates the old one. '
          || 'Paste the new one into Setting up if you want the office back on Telegram.'
      ),
      'revoke_at', 'https://t.me/BotFather',
      'note', 'The staff bots are separate and were NOT touched -- they are handed back '
              || 'one at a time in Settings, Channels. Issue #70 records the decision to '
              || 'retire them: Telegram is one bot, the chief of staff, and individual '
              || 'people are reached in Slack and here.'
    );
  end if;

  -- Everything else: refused, with the reason. A Disconnect that did nothing
  -- is the failure this issue describes, and so is one that turns the office
  -- off without saying that is what it does.
  return jsonb_build_object('error', case v_key
    when 'openrouter' then
      'OpenRouter is how the team thinks -- removing the key stops every agent. '
      || 'Change or remove it in Settings, Models, where the consequence is on the page.'
    when 'github' then
      'GitHub holds the office''s own code and its two tokens do different jobs. '
      || 'Disconnecting it from here would be one button for two decisions.'
    when 'supabase' then
      'Supabase IS the office -- this function is running inside it.'
    when 'mcp' then
      'The MCP server has no stored credential to remove. Revoke a client''s token '
      || 'on the MCP screen instead.'
    else format('There is no disconnect for %s.', coalesce(nullif(v_key, ''), 'that'))
  end);
end;
$fn$;

comment on function app.hq_disconnect(text) is
  'Issues #198, #109. Removes our copy of a credential and says, exactly, what '
  'that did and did not stop. Never claims a revoke it cannot perform.';

commit;
