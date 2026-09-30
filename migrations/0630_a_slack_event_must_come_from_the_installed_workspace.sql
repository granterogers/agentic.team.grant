/*
  0630 - a Slack event must come from the workspace the app is installed in (Final audit reconciliation, #392.3).

  A valid Slack signature proves Slack produced the request. It does not prove which workspace it came from: the same
  app can be installed elsewhere, and a sender admitted by Slack user id (subject_identities) is admitted by an id that
  is only unique within one workspace. `public.slack_app_credentials` holds the installed workspace
  (`team_id`, enabled, not revoked); nothing compared the envelope's `team_id` with it. `public.slack_workspaces`
  cannot be the allow-list - suites write ~130 fixture team ids into it.

  `app.slack_team_ok(team)` is true exactly when the team id is well formed and is the workspace of an enabled,
  unrevoked installation. The edge function asks it for every event and every button press that is NOT inside a declared
  test conversation (a harness keeps its fixture team ids, and is contained by the test-origin machinery instead).
  Missing, malformed or different: the event is acknowledged 200 and stored nowhere. A failure to ASK answers 503 so
  Slack retries; it never reads as a yes.

  ROLLBACK: docs/final-audit/rollback-0630.sql.
*/
create or replace function app.slack_team_ok(p_team text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(p_team ~ '^T[A-Z0-9]{8,}$', false)
     and exists (select 1 from public.slack_app_credentials c
                  where c.team_id = p_team and c.enabled and c.revoked_at is null)
$fn$;
revoke all on function app.slack_team_ok(text) from public, anon, authenticated;

create or replace function public.slack_team_ok(p_team text)
returns boolean
language sql
stable
security definer
set search_path = 'public', 'pg_catalog'
as $fn$
  select app.slack_team_ok(p_team)
$fn$;
revoke all on function public.slack_team_ok(text) from public, anon, authenticated;
grant execute on function public.slack_team_ok(text) to service_role;
