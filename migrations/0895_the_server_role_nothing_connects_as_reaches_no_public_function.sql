-- 0895 - ai_team_app reaches no public function.
--
-- What the contract is, from the architecture as it runs now (docs/multi-user/ARCHITECTURE.md, decision 6):
-- `ai_team_app` is NOLOGIN with no password, and nothing connects as it. The gateway and the worker connect as
-- `service_role` and `postgres`; a person's browser holds the anon or authenticated key. The role exists so that a
-- row policy has a name to be written for, and so that a suite can `set local role ai_team_app` to prove what a
-- non-bypass role is refused. A function in `public` is a door for the gateway (service_role); none of them is a door
-- for this role.
--
-- What it held instead: 37 public functions, granted by the first migrations when the role was imagined as the future
-- runtime login, and never reviewed since. They include the writers of a Google secret, a setting, the roster, an MCP
-- client registration, a project deletion and an enqueue. Nothing used them, and a grant nothing uses is a door nobody
-- is watching: the day the role is given a password for the least-privilege runtime (docs/parked/phase-2-hardening.md,
-- item 4) it would have arrived holding them all.
--
-- This revokes every public function from the role, in one pass over the catalogue so that none that somebody added
-- by hand is missed. It does not grant anything to anybody, and does not touch `app` (the schema the role's own
-- suites call: `app.now_utc`, `app.append_event`). A function created later is born closed to this role already:
-- the default privileges name service_role alone.
--
-- When the role becomes a real login, its grants are decided then, function by function, against the runtime that
-- uses it, and written as an allow-list with a reason. Nothing here makes that harder.
--
-- Safe to apply on its own: nothing connects as the role, and the only code that assumes it (the verification
-- suites' `set local role`) calls tables and `app` functions, not `public` ones.

do $r$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.prokind in ('f', 'p')
       and has_function_privilege('ai_team_app', p.oid, 'execute')
  loop
    execute format('revoke all on function %s from ai_team_app', f.sig);
  end loop;
  if exists (
    select 1 from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.prokind in ('f', 'p')
       and has_function_privilege('ai_team_app', p.oid, 'execute')
  ) then
    raise exception '0895: ai_team_app still reaches a public function';
  end if;
end $r$;
