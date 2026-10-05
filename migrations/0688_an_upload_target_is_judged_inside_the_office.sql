-- 0688 - the gateway authorises an upload's target inside the caller's office before it writes the object (multi-user P3).
--
-- 0650 (P1.4) moved the question "is this target real" in front of the storage write. It was asked of the whole deployment:
-- a project id or a contact id belonging to another office was a perfectly real target, so a person could overwrite another
-- office's object (the storage path is built from the project) by naming its ids. The question is now asked inside the
-- verified office, and a foreign target and a missing one are the same refusal.

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
drop function public.hq_upload_target(text, uuid, uuid, text);
