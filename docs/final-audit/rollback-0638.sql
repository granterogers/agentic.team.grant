-- Rollback of 0638: a machine may touch any project (the gateway check then fails closed on a missing function, so
-- deploy the previous hq-api FIRST), and a bad slug searches everything again.
begin;
drop function if exists public.machine_project_ok(text);
drop function if exists app.machine_project_ok(text);
do $m$
declare v_def text;
begin
  v_def := pg_get_functiondef('app.mcp_search(text,text,integer)'::regprocedure);
  execute replace(v_def, E'   where p_project is null or exists (select 1 from public.projects p where p.slug = p_project)\n', '');
end $m$;
commit;
