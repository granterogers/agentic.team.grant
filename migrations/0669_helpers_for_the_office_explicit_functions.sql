-- 0669 - the small, shared pieces every office-explicit function uses (multi-user P3, wave 2).
--
-- A converted function takes `p_office uuid` FIRST with no default, and checks every resource it touches against it
-- (`where id = $x and office_id = p_office`). These are the three things they all need and would otherwise each
-- re-invent:
--
--   app.job_office(job)       - the office of a CLAIMED job, for the worker and for in-database callers that hold a job.
--                               It is the only way internal code gets an office without being handed one; it raises
--                               rather than guess, and it never returns the system office as a request's context.
--   app.office_actor(office)  - the name that office's person acts under ('grant' for Grant's). It replaces the literal
--                               'grant' that writers stamped on every row whoever the office was.
--   app.project_in_office     - resolve a project reference (a slug, or a uuid as text) inside ONE office. A project of
--                               another office and a project that does not exist are indistinguishable: both are null.

create function app.job_office(p_job uuid)
returns uuid
language plpgsql
stable
security definer
set search_path to ''
as $f$
declare
  v_office uuid;
begin
  select j.office_id into v_office from public.jobs j where j.job_id = p_job;
  if v_office is null then
    raise exception 'no_office' using errcode = '42501', hint = 'a job that does not exist has no office';
  end if;
  return app.require_office(v_office);
end
$f$;
revoke all on function app.job_office(uuid) from public, anon, authenticated, service_role;

create function app.office_actor(p_office uuid)
returns text
language sql
stable
security definer
set search_path to ''
as $f$
  select coalesce(
    (select m.owner_key
       from public.offices o
       join auth.users u on u.id = o.auth_user_id
       join public.office_members m on lower(m.email) = lower(u.email)
      where o.office_id = p_office
      limit 1),
    'office-' || left(p_office::text, 8))
$f$;
revoke all on function app.office_actor(uuid) from public, anon, authenticated, service_role;

create function app.project_in_office(p_office uuid, p_ref text)
returns uuid
language sql
stable
security definer
set search_path to ''
as $f$
  select p.project_id
    from public.projects p
   where p.office_id = p_office
     and (p.slug = btrim(p_ref)
          or (btrim(p_ref) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              and p.project_id = btrim(p_ref)::uuid))
   order by (p.slug = btrim(p_ref)) desc
   limit 1
$f$;
revoke all on function app.project_in_office(uuid, text) from public, anon, authenticated, service_role;

-- The machine key names no person and no real office (P1.5). Anything it does through the office-explicit functions is
-- done in the TEST office - the office harness traffic belongs to - so a probe, a suite or a deploy check can never read
-- or write a real office by holding the key. Service role only; the gateway asks once a minute.
create function public.resolve_machine_office()
returns jsonb
language sql
stable
security definer
set search_path to ''
as $f$
  select jsonb_build_object('ok', app.test_office() is not null, 'office_id', app.test_office())
$f$;
revoke all on function public.resolve_machine_office() from public, anon, authenticated;
grant execute on function public.resolve_machine_office() to service_role;
