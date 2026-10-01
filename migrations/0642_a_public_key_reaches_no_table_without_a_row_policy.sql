-- 0642 - a public key reaches no table that has no row policy.
--
-- Found while characterising the policy work (final policy closure), by asking the database rather than the
-- documents: 43 tables in `public` have row-level security OFF while `anon` and `authenticated` hold the default
-- grants on them - SELECT, INSERT, UPDATE, DELETE. Among them `standing_authorizations` (the table a standing yes
-- lives in), `autonomy_policy` (the matrix itself), `lessons` (what the office is told Grant said), `mcp_auth_codes`,
-- `mcp_oauth_clients`, `browser_sessions`, `operator_senders`, `known_escapes` and `test_destinations`. PostgREST
-- exposes `public`, and the anon key is public by design, so anyone holding it could read - and could write - the
-- rows every authorization decision is built from. #384 closed the same door for FUNCTIONS (0613) and its check
-- never looked at tables.
--
-- Nothing in the product needs it: the browser talks only to the `hq-api` gateway (service key), the edge functions
-- use the anon key for the sign-in endpoints alone, and the app and worker connect as `postgres`/`ai_team_app` or
-- with the service key, none of which these grants touch. So this REVOKES from `anon` and `authenticated` on every
-- table that has no row policy. Tables WITH row-level security already deny a public key (their policies name only
-- `ai_team_app`) and are left exactly as they are; enabling RLS on 43 tables is a larger change than closing the
-- door and is not needed to close it.
--
-- New tables: `alter default privileges` removes the default grant for tables the migrating role creates, so the
-- next table is closed by default. `npm run check:anon-exposure` now asserts tables as well as functions.

do $m$
declare r record; v_n int := 0;
begin
  for r in
    select c.oid::regclass::text as t
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
  loop
    execute format('revoke all on table %s from anon, authenticated', r.t);
    v_n := v_n + 1;
  end loop;
  raise notice '0642: closed % table(s) to a public key', v_n;
end $m$;

alter default privileges in schema public revoke all on tables from anon, authenticated;
