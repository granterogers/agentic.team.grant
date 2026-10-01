-- Rollback of 0642: the default grants return. This re-opens tables without a row policy to a public key; it exists so a
-- migration that turns out to break a caller can be undone, not because the grants are wanted.
begin;
do $m$
declare r record;
begin
  for r in
    select c.oid::regclass::text as t
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
  loop
    execute format('grant all on table %s to anon, authenticated', r.t);
  end loop;
end $m$;
alter default privileges in schema public grant all on tables to anon, authenticated;
commit;
