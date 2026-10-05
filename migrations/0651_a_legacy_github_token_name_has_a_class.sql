-- 0651 - the legacy GitHub token name is classified (multi-user P1.2, #400). Follows 0648.
--
-- src/github/api.ts still asks the vault for 'github.token' as a fallback name. The vault holds none today, which is
-- why nothing failed, and 0648 gave it no class - so npm run check:system-secrets, on its first run against the live
-- catalogue, refused the read. A name nobody classified is refused by the resolver, and the right answer for a
-- personal GitHub token is the same as for github.read_token: a human integration, served only to an operator or to
-- work the deployment owns.

create or replace function app.credential_class(p_name text)
returns text
language sql
immutable
set search_path to ''
as $f$
  select case
    when p_name in ('google.client_secret', 'google.refresh_token', 'google.revoking_refresh_token',
                    'notion.integration_token', 'vikunja.api_token', 'github.read_token', 'github.token',
                    'notebook.master_token_json', 'notebook.reader_secret', 'notebook.storage_state',
                    'telegram.user_session', 'telegram.api_id', 'telegram.api_hash')
      then 'human_integration'
    -- Posting through the deployment's own bots and Slack app. Reached through app.resolve_secret(ref) by the
    -- channel adapters, behind delivery containment (claim_delivery / may_act_outside), not through this reader.
    when p_name in ('slack.bot_token', 'slack.client_secret', 'slack.config_refresh_token',
                    'slack.config_token', 'slack.signing_secret', 'telegram.webhook_secret')
      or p_name ~ '^telegram\..+\.bot_token$'
      then 'channel'
    when p_name in ('hq.api_token', 'openrouter.api_key', 'voice.api_key', 'worker.kick_secret',
                    'github.dispatch_token')
      or p_name like 'supabase.%' or p_name like 'backup.%' or p_name like 'browser.cloudflare\_%'
      then 'infra'
    else null
  end
$f$;

-- ROLLBACK (not part of the migration): re-run app.credential_class from 0648.
