/*
  0613 - the public key reaches no function

  Issue #384, and the reason it is a security finding rather than a tidy-up.

  Supabase grants EXECUTE on every new public-schema function to anon and
  authenticated, and the built-in default also grants it to PUBLIC. 0607, 0608
  and 0611 closed the functions that NAME an approver; the rest stayed open:
  249 of 276 SECURITY DEFINER functions in schema public were executable with
  nothing but the project's anon key, and the anon key is a public key by
  design (the Management API hands it out, and any Supabase client carries it).
  Read-only privilege checks on production, 30 September 2026:

    - public.vault_secret(text)      returns a named Google credential from the vault
    - public.vault_inventory()       lists every vault secret name, size and age
    - public.callback_ack(...)       returns a Telegram bot token for an enabled bot
    - public.hq_disconnect(text)     deletes a stored credential
    - public.register_mcp_provider   makes the office send a vault-held bearer to
                                     an endpoint the caller names
    - public.hq_revoke_tool          revokes a specialist's tool AS 'grant'
    - public.learn                   plants a standing rule under any author
    - public.append_event            forges a row in the ledger

  WHAT THE EVIDENCE SAYS ABOUT WHO NEEDS ANON: nobody. Nothing in web/ calls
  PostgREST at all; every edge function calls /rest/v1/rpc with the SERVICE
  key, and uses the anon key only against /auth/v1 (verifying a session, the
  magic link, the refresh). The worker and src/ reach the database as
  ai_team_app or postgres. The audit that produced this list is
  docs/architecture-run-3/ANON-INVENTORY.md, with the before and after tables.

  So this is the class, not the eight worst: every function in public is closed
  to PUBLIC, anon and authenticated, and open to service_role. What the office
  itself relies on is kept:

    - ai_team_app keeps exactly the functions it could execute before. Some of
      those reached it ONLY through the PUBLIC grant this revokes, so they are
      re-granted to it by name; without that the worker would fail on the first
      call to any of them.
    - postgres is the owner and is untouched.

  FUTURE FUNCTIONS. Default privileges are not retroactive, and the built-in
  PUBLIC default cannot be removed for one schema (a schema-scoped ALTER
  DEFAULT PRIVILEGES can only ADD to the global default). So the sweep is
  accompanied by an EVENT TRIGGER on CREATE FUNCTION: whoever creates a
  function in schema public, it is closed to PUBLIC, anon and authenticated
  and opened to service_role in the same statement. A migration that wants
  another role to have it grants it afterwards, as 0611's closing block does.
  The trigger never blocks DDL (a failure to revoke is a NOTICE), so the
  witness is `npm run check:anon-exposure`, which reads production and fails
  on any public function a public key can execute.

  The closing block DRIVES the result: it fails the migration, and so rolls it
  back, if any function is still reachable by a public key, if service_role
  lost anything, or if ai_team_app lost anything. It also refuses to pass on an
  empty set, because a check that finds nothing to inspect is indistinguishable
  from one that passed.

  Reversible: rollback is a GRANT of the same three roles on the same set, and
  docs/architecture-run-3/rollback-0613.sql carries it.
*/

do $sweep$
declare
  f record;
  v_total integer := 0;
  v_ai_before integer;
  v_ai_after integer;
  v_open integer;
  v_svc_missing integer;
begin
  -- What the office's own role can execute NOW, effective grants included: this
  -- is the set that must survive, whichever grant carried it.
  create temporary table _ai_kept on commit drop as
    select p.oid as fn
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.prokind in ('f', 'p')
       and has_function_privilege('ai_team_app', p.oid, 'execute');
  select count(*) into v_ai_before from _ai_kept;

  for f in
    select p.oid::regprocedure as sig, p.oid as fn
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.prokind in ('f', 'p')
  loop
    v_total := v_total + 1;
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
    if exists (select 1 from _ai_kept k where k.fn = f.fn) then
      execute format('grant execute on function %s to ai_team_app', f.sig);
    end if;
  end loop;

  -- Functions created from now on: no explicit grant to a public key, service_role yes.
  alter default privileges for role postgres in schema public
    revoke execute on functions from anon, authenticated;
  alter default privileges for role postgres in schema public
    grant execute on functions to service_role;
  begin
    alter default privileges for role supabase_admin in schema public
      revoke execute on functions from anon, authenticated;
    alter default privileges for role supabase_admin in schema public
      grant execute on functions to service_role;
  exception when insufficient_privilege then
    -- Objects Supabase itself creates belong to supabase_admin; this session may
    -- not speak for that role. The check catches such a function; it is not a
    -- reason to refuse the sweep of everything this project owns.
    raise notice '0613: default privileges for supabase_admin left as they were';
  end;

  -- ---- a function created from now on is closed at birth --------------------
  create or replace function app.close_new_public_function()
  returns event_trigger
  language plpgsql
  as $evt$
  declare
    c record;
  begin
    for c in
      select object_identity as ident
        from pg_event_trigger_ddl_commands()
       where command_tag in ('CREATE FUNCTION', 'CREATE PROCEDURE')
         and schema_name = 'public'
    loop
      begin
        execute format('revoke execute on function %s from public, anon, authenticated', c.ident);
        execute format('grant execute on function %s to service_role', c.ident);
      exception when others then
        -- Never block a migration over this; the check reports what is left open.
        raise notice 'app.close_new_public_function: %: %', c.ident, sqlerrm;
      end;
    end loop;
  end
  $evt$;
  revoke all on function app.close_new_public_function() from public;

  drop event trigger if exists close_new_public_function;
  create event trigger close_new_public_function on ddl_command_end
    when tag in ('CREATE FUNCTION', 'CREATE PROCEDURE')
    execute function app.close_new_public_function();

  -- ---- drive it ---------------------------------------------------------
  if v_total = 0 then
    raise exception '0613: swept nothing - a sweep of an empty set proves nothing';
  end if;

  select count(*) into v_open
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.prokind in ('f', 'p')
     and (has_function_privilege('anon', p.oid, 'execute')
       or has_function_privilege('authenticated', p.oid, 'execute')
       or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                   where a.grantee = 0 and a.privilege_type = 'EXECUTE'));
  if v_open <> 0 then
    raise exception '0613: % public function(s) are still reachable by a public key', v_open;
  end if;

  select count(*) into v_svc_missing
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.prokind in ('f', 'p')
     and not has_function_privilege('service_role', p.oid, 'execute');
  if v_svc_missing <> 0 then
    raise exception '0613: service_role lost % function(s)', v_svc_missing;
  end if;

  select count(*) into v_ai_after
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.prokind in ('f', 'p')
     and has_function_privilege('ai_team_app', p.oid, 'execute');
  if v_ai_after < v_ai_before then
    raise exception '0613: ai_team_app lost functions (% before, % after)', v_ai_before, v_ai_after;
  end if;
  -- The trigger, driven: a function created now must be born closed. A subtransaction
  -- undoes the probe; only this migration's own marker is swallowed.
  begin
    create function public.zz_0613_probe() returns int language sql as 'select 1';
    if has_function_privilege('anon', 'public.zz_0613_probe()'::regprocedure, 'execute')
       or has_function_privilege('authenticated', 'public.zz_0613_probe()'::regprocedure, 'execute')
       or exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                   where p.oid = 'public.zz_0613_probe()'::regprocedure
                     and a.grantee = 0 and a.privilege_type = 'EXECUTE') then
      raise exception '0613: a new public function was born reachable by a public key';
    end if;
    if not has_function_privilege('service_role', 'public.zz_0613_probe()'::regprocedure, 'execute') then
      raise exception '0613: a new public function was born closed to service_role too';
    end if;
    raise exception '0613-probe-ok';
  exception when others then
    if sqlerrm <> '0613-probe-ok' then raise; end if;
  end;
  raise notice '0613: % function(s) swept; ai_team_app keeps % of % ', v_total, v_ai_after, v_ai_before;
end
$sweep$;
