-- 1101 — the project brief says what documents it holds and who is on the team (A20)
--
-- The agents were given a project's TASKS and nothing else (app.project_work_brief, 0869), so asked how many documents a
-- project had, or who handled finance, they answered "no record". This adds a second, read-only brief next to the task
-- brief: the project's document count with its most recent titles, and the permanent team with each role. Both are
-- stated as facts, like the task brief. Nothing is written.
--
-- The office check is the same one the task brief uses: another office's project, and a project that does not exist,
-- answer the same way (null).

begin;

create or replace function app.project_context_brief(
  p_office uuid,
  p_project uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_office uuid := app.require_office(p_office);
  v_total integer;
  v_titles jsonb;
  v_team jsonb;
begin
  if not exists (
    select 1 from public.projects p
     where p.project_id = p_project and p.office_id = v_office
  ) then
    return null;
  end if;

  select count(*) into v_total
    from public.documents d
   where d.office_id = v_office and d.project_id = p_project;

  select coalesce(jsonb_agg(t.title order by t.created_at desc), '[]'::jsonb) into v_titles
    from (
      select d.title, d.created_at
        from public.documents d
       where d.office_id = v_office and d.project_id = p_project
       order by d.created_at desc
       limit 15
    ) t;

  select coalesce(jsonb_agg(jsonb_build_object('name', s.name, 'role', s.title) order by s.name), '[]'::jsonb)
    into v_team
    from public.staff s
   where s.active and s.permanent;

  return jsonb_build_object(
    'documents', jsonb_build_object('total', v_total, 'titles', v_titles),
    'team', v_team);
end;
$$;

revoke all on function app.project_context_brief(uuid, uuid) from public, anon, authenticated;

commit;
