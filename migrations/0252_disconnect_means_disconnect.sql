-- Disconnect means disconnect (#90).
--
-- Grant: *"Support disconnecting services: Provide a working Disconnect action
-- for connected services such as Notion, and update the displayed connection
-- status."* And the sentence that decides the design: *"the page asserting a
-- connection that is not there is worse than no button, because he will act
-- on it."*
--
-- ## One entry point, and an honest refusal is a valid answer
--
-- `app.hq_disconnect(p_service)` knows what disconnecting each service means.
-- Where a service can be genuinely disconnected it removes the credential,
-- switches off everything that reads it, and marks the connection missing --
-- in one statement, so the page can never show the old state.
--
-- Where it cannot, it REFUSES and says why, in a sentence. That is the whole
-- point rather than a shortcut: OpenRouter is how the team thinks and Telegram
-- is how it reaches him, so a Disconnect button on those would be a button
-- that turns the office off, and one that quietly did nothing would be the
-- exact lie this issue is about.
--
-- ## Forgetting is not revoking, and the difference is said out loud
--
-- The issue asks to *"revoke, do not just forget"*. Only Google can be revoked
-- from here: `https://oauth2.googleapis.com/revoke` is an HTTP call and Postgres
-- makes none. So every answer carries `revoke_at` -- the provider's own page --
-- and the page shows it. Deleting our copy of a credential is the part we can
-- do; telling him exactly where to withdraw the consent is the rest of it,
-- and saying "revoked" when nothing was revoked would be the same class of lie.
-- Provider-side revocation belongs in the worker, which has vault access in
-- Node; it is filed rather than half-built here.
--
-- ## The trap this walks around
--
-- "A teardown that matches nothing looks exactly like a teardown that worked."
-- Every branch reports what it actually removed, counted from the delete, so a
-- disconnect of something that was never connected says so instead of
-- returning a cheerful ok.

CREATE OR REPLACE FUNCTION app.hq_disconnect(p_service text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
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
    -- deliberately removed is a red light he caused and cannot explain. The
    -- same reasoning 0112 applies to `calendar.enabled`.
    update public.system_config set value = to_jsonb(false) where key = 'notebook.enabled';
    return jsonb_build_object('ok', true, 'service', 'NotebookLM', 'removed', v_gone,
      'note', case when v_gone = 0
                then 'There was no NotebookLM session here to remove; generation is switched off.'
                else 'Disconnected and generation switched off. Notebooks already attached to a '
                     || 'dashboard project stay attached, and what they produced stays.' end,
      'revoke_at', 'https://notebooklm.google.com');
  end if;

  -- Everything else: refused, with the reason. A Disconnect that did nothing
  -- is the failure this issue describes, and so is one that turns the office
  -- off without saying that is what it does.
  return jsonb_build_object('error', case v_key
    when 'openrouter' then
      'OpenRouter is how the team thinks -- removing the key stops every agent. '
      || 'Change or remove it in Settings, Models, where the consequence is on the page.'
    when 'telegram' then
      'Telegram is how the office reaches you. Individual bots are handed back in '
      || 'Settings, Channels; there is no single switch, deliberately.'
    when 'slack' then
      'Slack is an installed app, and removing it belongs at Slack rather than here. '
      || 'Settings, Channels has the workspace it is installed in.'
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
$function$;

-- PostgREST only exposes `public`.
CREATE OR REPLACE FUNCTION public.hq_disconnect(p_service text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
AS $function$ select app.hq_disconnect(p_service) $function$;

REVOKE ALL ON FUNCTION public.hq_disconnect(text) FROM public;
GRANT EXECUTE ON FUNCTION public.hq_disconnect(text) TO service_role;
GRANT EXECUTE ON FUNCTION app.hq_disconnect(text) TO service_role;
