-- 1024 - an upload target can be a project's background picture, named by slug (#445).
--
-- THE GAP THIS CLOSES. A person's own canvas picture lived in one browser's IndexedDB, so it never reached a second device.
-- The gateway now stores one picture per project in the private `files` bucket under `<office_id>/backgrounds/<project_id>.<ext>`
-- and keeps only a small reference (`rev`) in the arrangement the page already saves. Before any byte is written the gateway
-- asks the database whether the TARGET is real inside the verified office (the 0650/0688 order: authenticate, authorise the
-- target, then write). This migration is that question for the new kind.
--
-- WHAT CHANGES (additive in behaviour; the old two kinds answer exactly as before):
--   public.hq_upload_target gains an optional trailing `p_slug text` and accepts kind 'project_background', which resolves the
--   project BY SLUG INSIDE p_office (a foreign slug and a missing one are the same refusal) and applies the same authority
--   check as a document upload. The page never sends a project id for this kind; the id the gateway builds the key from is the
--   one this function read from the row.
--
-- NO NEW TABLE, NO NEW COLUMN. The reference lives in the arrangement document (`bg.rev`), the bytes in the bucket.
--
-- ROLLBACK: re-create the five-argument function exactly as it stands in migration 0688 (the live definition before this file is
-- reproduced below in the comment), after dropping the six-argument one. Roll the gateway back FIRST.
--   drop function public.hq_upload_target(uuid, text, uuid, uuid, text, text);
--   create function public.hq_upload_target(p_office uuid, p_kind text, p_project_id uuid, p_contact_id uuid default null, p_by text default null) ... (0688)

begin;

drop function if exists public.hq_upload_target(uuid, text, uuid, uuid, text);

create function public.hq_upload_target(
  p_office uuid, p_kind text, p_project_id uuid, p_contact_id uuid default null, p_by text default null,
  p_slug text default null)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to 'public', 'pg_catalog'
as $function$
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
  elsif p_kind = 'project_background' then
    -- By slug, inside the office. The same words for a missing project and another office's.
    select p.project_id into v_project from public.projects p
     where p.slug = p_slug and p.office_id = p_office;
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
$function$;

revoke all on function public.hq_upload_target(uuid, text, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.hq_upload_target(uuid, text, uuid, uuid, text, text) to service_role;

commit;
