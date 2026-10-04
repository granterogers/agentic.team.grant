-- ADR-0065: the Slack OAuth callback (an edge function, service role) needs the app's CLIENT ID to exchange a code, and the
-- gateway needs the same id and the bot scopes to build the authorise link. Both are public: the client id is in every
-- authorise URL, and a scope list is not a credential. The client SECRET is not here: it is the callback's own function secret,
-- set at deploy from the vault, and no door returns it.
--
-- `slack.bot_scopes` is optional (a comma-separated list); when it is not set the code asks for the conservative default it
-- carries, and the person running the deployment sets the row to match the Slack app's configured scopes (a scope the app does
-- not hold is refused by Slack, not granted).
create or replace function app.slack_install_client()
returns jsonb
language sql
stable
security definer
set search_path to ''
as $f$
  select jsonb_build_object(
    'client_id', nullif(btrim((select c.value #>> '{}' from public.system_config c where c.key = 'slack.client_id')), ''),
    'scopes',    nullif(btrim((select c.value #>> '{}' from public.system_config c where c.key = 'slack.bot_scopes')), ''))
$f$;

create or replace function public.slack_link_client() returns jsonb
language sql stable security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.slack_install_client() $f$;

revoke all on function app.slack_install_client() from public, anon, authenticated, service_role;
revoke all on function public.slack_link_client() from public, anon, authenticated;
grant execute on function public.slack_link_client() to service_role;
