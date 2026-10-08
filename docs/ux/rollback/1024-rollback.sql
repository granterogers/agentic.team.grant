-- ROLLBACK for migration 1024 (a project background picture is an upload the office can authorise; #445).
--
-- Restores the five-argument upload-target check exactly as migration 0688 left it. NO TABLE OR COLUMN WAS ADDED BY 1024, so
-- nothing else needs undoing. Pictures already stored stay in the private `files` bucket under <office>/backgrounds/ and are
-- unreachable once the gateway is rolled back (see docs/ux/deploy-442-445.md for removing them if wanted).
--
-- ORDER: roll the PAGE and the GATEWAY back first (the gateway's project_background actions call this function with p_slug;
-- against the five-argument function PostgREST answers "could not find the function" and the actions answer 503).
-- Before running, compare: select pg_get_functiondef('public.hq_upload_target(uuid,text,uuid,uuid,text,text)'::regprocedure);

begin;

drop function if exists public.hq_upload_target(uuid, text, uuid, uuid, text, text);

create function public.hq_upload_target(p_office uuid, p_kind text, p_project_id uuid, p_contact_id uuid default null, p_by text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $f$
declare
  v_project uuid;
  v_refusal text;
begin
  perform app.require_office(p_office);
  if p_kind = 'contact_photo' then
    select c.project_id into v_project
      from public.contacts c
      join public.projects p on p.project_id = c.project_id and p.office_id = p_office
     where c.contact_id = p_contact_id and c.project_id = p_project_id;
    if v_project is null then
      return jsonb_build_object('error', 'no such contact');
    end if;
  elsif p_kind = 'document_upload' then
    select p.project_id into v_project from public.projects p
     where p.project_id = p_project_id and p.office_id = p_office;
    if v_project is null then
      return jsonb_build_object('error', 'no such dashboard project');
    end if;
  else
    return jsonb_build_object('error', 'no such upload');
  end if;

  if nullif(btrim(coalesce(p_by, '')), '') is not null then
    v_refusal := app.authority_refusal(p_by, null, v_project);
    if v_refusal is not null then
      return jsonb_build_object('error', case p_kind when 'contact_photo' then 'no such contact' else 'no such dashboard project' end);
    end if;
  end if;

  return jsonb_build_object('ok', true, 'project_id', v_project);
end
$f$;
revoke all on function public.hq_upload_target(uuid, text, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.hq_upload_target(uuid, text, uuid, uuid, text) to service_role;

delete from app.schema_migrations where name = '1024_a_project_background_picture_is_an_upload_the_office_can_authorise.sql';

commit;
