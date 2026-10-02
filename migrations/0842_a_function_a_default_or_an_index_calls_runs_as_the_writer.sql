-- 0842 - a function that a column default, a constraint, a policy or an index expression calls runs as the WRITER (multi-user P3).
--
-- 0841 revoked EXECUTE on every function in schema `app` from public, anon and authenticated, as defence in depth: nothing
-- reaches them (no USAGE on the schema, PostgREST exposes only `public`). That was right for every function that is only ever
-- called by another function, because a SECURITY DEFINER function runs as its owner. It was wrong for the few that the
-- DATABASE calls on the writer's behalf: PostgreSQL checks EXECUTE at the moment an expression is first run, for the role
-- running the statement, and a default, a generated column, a CHECK, a policy and an index expression are all run that way.
-- `inbound_commands.received_at` defaults to app.now_utc(), so from 0841 until this migration every INSERT made through
-- PostgREST as service_role - the Telegram webhook, Slack events and the voice door - failed with "permission denied for
-- function now_utc". The attack suite did not see it because it wrote as the table owner; 0841's own comment said nothing could
-- reach the function, which was true of a caller and false of the database.
--
-- The set is DERIVED, not listed: every app function that something in pg_depend runs on the writer's behalf. A function added
-- later and used in a default is picked up by the check that goes with this migration (scripts/isolated/p3-cases/98), not by
-- remembering.
do $m$
declare r record;
begin
  for r in
    select distinct p.oid::regprocedure::text as sig
      from pg_depend d
      join pg_proc p on p.oid = d.refobjid and d.refclassid = 'pg_proc'::regclass
     where p.pronamespace = 'app'::regnamespace
       and (d.classid in ('pg_attrdef'::regclass, 'pg_constraint'::regclass, 'pg_policy'::regclass)
            or (d.classid = 'pg_class'::regclass
                and exists (select 1 from pg_class c where c.oid = d.objid and c.relkind = 'i')))
  loop
    execute format('grant execute on function %s to public', r.sig);
  end loop;
end
$m$;
