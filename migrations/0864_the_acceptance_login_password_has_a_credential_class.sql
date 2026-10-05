-- 0864 - the second-person acceptance login's password is a classified secret (multi-user P4).
--
-- `scripts/p4/provision-second-person.ts` stores the password of the controlled acceptance login in the Vault as
-- `p4.second_person.password` and never prints it. `npm run check:system-secrets` (0648) refuses any vault secret that has
-- no credential class, which is correct: a secret nobody classified is one nobody decided how to read. This one is read by
-- the acceptance harness only, to sign the controlled login in, and it is not a human-integration credential, a channel
-- credential or an agent-reachable one - it belongs with the deployment's own operator secrets (`infra`).
--
-- The function is replaced whole (the live definition, with one name added); its signature is unchanged, so this creates
-- no second overload.

create or replace function app.credential_class(p_name text)
 returns text
 language sql
 immutable
 set search_path to ''
as $function$
  select case
    when p_name in ('google.client_secret', 'google.refresh_token', 'google.revoking_refresh_token',
                    'notion.integration_token', 'vikunja.api_token', 'github.read_token', 'github.token',
                    'notebook.master_token_json', 'notebook.reader_secret', 'notebook.storage_state',
                    'telegram.user_session', 'telegram.api_id', 'telegram.api_hash')
      then 'human_integration'
    -- Posting through the deployment's own bots and Slack app. Reached through app.resolve_secret(ref) by the
    -- channel adapters, behind delivery containment (claim_delivery / may_act_outside), not through this reader.
    -- A Google credential held by an office other than the deployment's own (0800): the name carries the office.
    when p_name ~ '^google\.(refresh_token|revoking_refresh_token)\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then 'human_integration'
    when p_name in ('slack.bot_token', 'slack.client_secret', 'slack.config_refresh_token',
                    'slack.config_token', 'slack.signing_secret', 'telegram.webhook_secret')
      or p_name ~ '^telegram\..+\.bot_token$'
      then 'channel'
    when p_name in ('hq.api_token', 'openrouter.api_key', 'voice.api_key', 'worker.kick_secret',
                    'github.dispatch_token', 'p4.second_person.password')
      or p_name like 'supabase.%' or p_name like 'backup.%' or p_name like 'browser.cloudflare\_%'
      then 'infra'
    else null
  end
$function$;
