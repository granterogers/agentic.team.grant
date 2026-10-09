-- 1053 - a public key reaches no view in `public`.
--
-- Found at the R1c catalogue comparison (9 October 2026, Issue #457) by asking the catalogue what `anon` and `authenticated` can SELECT:
-- all 14 views in `public` (credential_health, credential_health_problems, decisions_live, delivery_health, lessons_live, model_record,
-- needs_me, notebook_budget, notebook_capability, skills_live, slack_rotation_health, today, undo_offers, usable_models) carry the
-- platform's default SELECT (and write) grants to both roles.
--
-- Why that matters, and why 0642 did not close it. 0642 revoked the public roles from every TABLE that has no row policy and relied on
-- "a table WITH row security already denies a public key, because its policies name only ai_team_app". That reasoning does not hold for a
-- VIEW: a view reads its tables with its OWNER'S rights (these 14 are owned by `postgres`, none sets security_invoker), and the owner
-- bypasses row security (Supabase's postgres role carries BYPASSRLS; on a replica it is a superuser), so the table's policies are never
-- asked. A role that may SELECT the view reads every row of it, across every office: `decisions_live` is each decision the offices
-- recorded, `lessons_live` each standing rule and lesson, `skills_live` each procedure, `today` every office's open jobs and project names.
-- `needs_me` and `model_record` happen to be refused only because they call app.harness_job, which a public key may not execute (0841).
-- 0642's sweep and `npm run check:anon-exposure` both looked at relkind 'r' and 'p' only.
--
-- Nothing needs it: the browser talks to the hq-api gateway (service key), the app and worker connect as postgres / ai_team_app, and the
-- edge functions use the anon key for the sign-in endpoints alone. No view is read with a public key by any code in this repository.
--
-- The change: REVOKE every privilege on every view and materialised view in `public` from anon and authenticated, and say so again for the
-- default privileges (idempotent: 0642 set the table default; views are "tables" to ALTER DEFAULT PRIVILEGES, and a view created by another
-- role is covered by the supabase_admin statement where that role exists). It does not set security_invoker: after the revoke nobody
-- public can select, and flipping a view's security context would change what ai_team_app and service_role read for no gain here.
-- A grant to PUBLIC is not touched because none exists on these views; the self-check below fails if one ever does.
--
-- Rollback: GRANT SELECT ON <view> TO anon, authenticated for each view (not recommended; it reopens the exposure). Forward recovery:
-- this file is idempotent and may be applied again.

do $m$
declare
  r record;
  v_n int := 0;
  v_open text;
begin
  for r in
    select c.oid::regclass::text as t
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('v', 'm')
  loop
    execute format('revoke all on table %s from anon, authenticated', r.t);
    v_n := v_n + 1;
  end loop;

  alter default privileges in schema public revoke all on tables from anon, authenticated;
  begin
    alter default privileges for role supabase_admin in schema public revoke all on tables from anon, authenticated;
  exception when others then
    raise notice '1053: default privileges for supabase_admin left as they were (%)', sqlerrm;
  end;

  -- the self-check: after the sweep no public view may be selectable by a public key, by any route (a direct grant, a grant to PUBLIC)
  select string_agg(c.relname, ', ' order by c.relname) into v_open
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('v', 'm')
     and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('authenticated', c.oid, 'select'));
  if v_open is not null then
    raise exception '1053: a public key can still select: %', v_open;
  end if;
  raise notice '1053: closed % view(s) to a public key', v_n;
end $m$;
