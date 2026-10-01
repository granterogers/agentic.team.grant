-- 0663 - row security on every public table (multi-user P2).
--
-- 46 tables had row security off. Enabling it with one policy for the application role is a tripwire, nothing more:
-- the tables already refuse anon and authenticated by grant (0642), and postgres and service_role bypass row security
-- by construction, so this does NOT protect against them and must not be described as doing so. What it adds is that a
-- role which is later granted access to one of these tables gets NOTHING until a policy is written for it, instead of
-- everything. (Seventeen tables already had row security on and no policy at all: closed to every role that does not
-- bypass it. They are left exactly so; a policy there would be a loosening this migration has no business making.)
-- The policy is the same one the other tables carry: ai_team_app, using (true). No setting, no act-as
-- role and no per-office predicate is introduced - ownership is the composite keys' job and the functions' (P3).

do $m$
declare
  r record;
  n int := 0;
begin
  for r in
    select c.relname
      from pg_class c join pg_namespace s on s.oid = c.relnamespace
     where s.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
       and c.relname <> 'isolated_replica_marker'
     order by 1
  loop
    execute format('alter table public.%I enable row level security', r.relname);
    execute format('create policy %I on public.%I for all to ai_team_app using (true) with check (true)', r.relname || '_app_all', r.relname);
    n := n + 1;
  end loop;
  raise notice '0663: row security enabled on % table(s)', n;

  if exists (
    select 1 from pg_class c join pg_namespace s on s.oid = c.relnamespace
     where s.nspname = 'public' and c.relkind in ('r', 'p') and c.relname <> 'isolated_replica_marker'
       and not c.relrowsecurity
  ) then
    raise exception '0663: a public table is still without row security';
  end if;
end $m$;

-- ROLLBACK (not part of the migration): for each table named by a policy <table>_app_all created here,
-- drop policy <table>_app_all on public.<table>; alter table public.<table> disable row level security;
