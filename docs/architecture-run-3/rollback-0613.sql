-- Rollback for 0613. This RE-OPENS every public function to a public key
-- (the exposure 0613 exists to close); use it only if the sweep itself broke the
-- office, and re-apply the sweep as soon as the cause is fixed.
drop event trigger if exists close_new_public_function;
drop function if exists app.close_new_public_function();
do $rb$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.prokind in ('f','p')
  loop
    execute format('grant execute on function %s to public, anon, authenticated', f.sig);
  end loop;
end $rb$;
alter default privileges for role postgres in schema public grant execute on functions to anon, authenticated;
