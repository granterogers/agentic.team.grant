begin;

-- ---------------------------------------------------------------------------
-- 0357 - the page can tell whether Slack needs credentials (#210)
--
-- 0356 added the setter. The form that calls it needs to know when to appear,
-- and the first attempt asked `services` for an entry named "Slack" - which
-- does not exist. Slack is listed there as **"The office"**, so the condition
-- could never be true and the form never rendered.
--
-- That is CLAUDE.md's own rule about checking what the PAGE is handed rather
-- than what the thing is called, arriving one layer further out. The fix is
-- not to match the display string: it is to hand the page the same shape it
-- already has for Google, so nothing has to guess.
--
-- No secret is exposed. `ready` is derived from whether the two refs RESOLVE,
-- which is what `credential_health` already publishes; the values never leave
-- the vault.
-- ---------------------------------------------------------------------------

create or replace function app.hq_slack_setup()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select coalesce(
    (select jsonb_build_object(
       'app_id', c.slack_app_id,
       'enabled', c.enabled,
       -- Both halves, deliberately. A bot token without a signing secret can
       -- post and cannot verify anything inbound, which reads as connected
       -- and is half a connection (0356 takes them together for this reason).
       'has_bot_token', exists (select 1 from vault.secrets s where s.id = c.bot_token_ref),
       'has_signing_secret', exists (select 1 from vault.secrets s where s.id = c.signing_secret_ref),
       'ready', c.enabled
                and exists (select 1 from vault.secrets s where s.id = c.bot_token_ref)
                and exists (select 1 from vault.secrets s where s.id = c.signing_secret_ref),
       'why_off', c.disabled_reason)
       from public.slack_app_credentials c limit 1),
    jsonb_build_object('ready', false, 'has_bot_token', false,
      'has_signing_secret', false, 'why_off', 'no Slack app is registered here'))
$$;

comment on function app.hq_slack_setup() is
  'Whether Slack can actually be used, for the setup page (#210). Derived from '
  'whether the vault references RESOLVE, never from the values themselves.';

grant execute on function app.hq_slack_setup() to service_role;

-- ---------------------------------------------------------------------------
-- hq_setup gains the key
--
-- Reproduced from its live definition with one line added, generated rather
-- than retyped.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.hq_setup()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select app.hq_setup_services() || jsonb_build_object(
    'google', app.hq_google(),
    -- #210. Shaped like `google` above, for the same reason: the page needs to
    -- know whether to offer a form, and matching a DISPLAY NAME is how the
    -- first attempt failed -- Slack is listed as "The office" in `services`,
    -- so a condition on the name "Slack" could never fire.
    'slack', app.hq_slack_setup(),
    -- Only the keys this page switches. The generic settings form on the
    -- Advanced page is where the rest belong, and a setup screen that shipped
    -- every configuration value would be the Advanced page with a different
    -- name.
    'settings', jsonb_build_object(
      'calendar.enabled', coalesce(
        (select value::text::boolean from public.system_config where key = 'calendar.enabled'),
        false),
      'notebook.enabled', coalesce(
        (select value::text::boolean from public.system_config where key = 'notebook.enabled'),
        false)
    )
  )
$function$;

commit;
