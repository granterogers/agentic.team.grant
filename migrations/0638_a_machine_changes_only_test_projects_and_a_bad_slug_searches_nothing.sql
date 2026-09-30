-- 0638 - two more places a credential or a typo was read as more than it is (final audit, reviews R2-2, R2-3, F5).
--
-- 1. `app.machine_project_ok(ref)`. The office key and a test member are on the gateway's allow-list for
--    `create_project`, `rename_project`, `project_archive` and `project_unarchive`, and none of those asks whose project it
--    is: a machine created a real project (which fifteen minutes later provisions a Slack channel that cannot be deleted),
--    and archived a real one (which switched its duties off). The gateway now asks this first for any credential that is
--    not a person: only a project whose slug is a fixture's (fixture-, verify-, ledger-proof-), or a name that derives one,
--    is the machine's to touch. A person is unaffected.
--
-- 2. `app.mcp_search`. An unknown project slug resolved to NULL, and NULL means every project to `search_documents`, so a
--    typo in a slug searched everything. A slug that names nothing now searches nothing; no slug still means every project
--    (the client is reading Grant's own material).

create or replace function app.machine_project_ok(p_ref text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select case
    when p_ref is null or btrim(p_ref) = '' then false
    when exists (select 1 from public.projects where slug = p_ref)
      then coalesce((select is_fixture from public.projects where slug = p_ref), false)
    else left(trim(both '-' from regexp_replace(lower(p_ref), '[^a-z0-9]+', '-', 'g')), 60)
           ~ '^(fixture|verify|ledger-proof)-'
  end
$$;

create or replace function public.machine_project_ok(p_ref text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select app.machine_project_ok(p_ref) $$;

revoke all on function app.machine_project_ok(text) from public, anon, authenticated;
revoke all on function public.machine_project_ok(text) from public, anon, authenticated;
grant execute on function public.machine_project_ok(text) to service_role;

do $m$
declare
  v_def text;
  v_old constant text := E'         ) s\n$function$';
begin
  v_def := pg_get_functiondef('app.mcp_search(text,text,integer)'::regprocedure);
  if position(E'         ) s\n' in v_def) = 0 then
    raise exception '0638: the anchor is not in app.mcp_search';
  end if;
  execute replace(v_def, E'         ) s\n', E'         ) s\n   where p_project is null or exists (select 1 from public.projects p where p.slug = p_project)\n');
  if position('where p_project is null or exists' in pg_get_functiondef('app.mcp_search(text,text,integer)'::regprocedure)) = 0 then
    raise exception '0638: the change did not land';
  end if;
end
$m$;
