-- 0650 - the database target is authorized BEFORE an object is written to storage (multi-user P1.4, #400).
--
-- hq-api's contact_photo and document_upload took a project id and a contact id from the request, built a storage
-- path from them, wrote the object (upsert, up to 8 MB) and only THEN asked the database whether the contact or
-- project was anything. Three consequences, none reachable with one human and all of them with two:
--   * an object could be written under a project prefix that does not exist, or one the caller has no claim to;
--   * a photo could overwrite another contact's photo by naming that contact's project and id;
--   * the path came from the request's project id, not from the contact's own, so a mismatched pair stored a
--     path under project X and attached it to a contact of project Y.
--
-- This is the question the gateway now asks first. One function, one answer: it returns the CANONICAL project for
-- the target - read from the row, never from the request - or the same refusal whether the target is foreign,
-- mismatched or missing (no existence oracle). A test principal is held to its rule (it decides only test traffic)
-- by the same call; the machine key carries no principal and is not asked it.
--
-- When offices exist this becomes (p_office, ...) and the existence test becomes an ownership test; the ORDER the
-- gateway calls it in is what this migration fixes.

create or replace function public.hq_upload_target(
  p_kind       text,
  p_project_id uuid,
  p_contact_id uuid default null,
  p_by         text default null
)
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
  if p_kind = 'contact_photo' then
    select c.project_id into v_project
      from public.contacts c
     where c.contact_id = p_contact_id and c.project_id = p_project_id;
    if v_project is null then
      return jsonb_build_object('error', 'no such contact');
    end if;
  elsif p_kind = 'document_upload' then
    select p.project_id into v_project from public.projects p where p.project_id = p_project_id;
    if v_project is null then
      return jsonb_build_object('error', 'no such dashboard project');
    end if;
  else
    return jsonb_build_object('error', 'no such upload');
  end if;

  if nullif(btrim(coalesce(p_by, '')), '') is not null then
    v_refusal := app.authority_refusal(p_by, null, v_project);
    if v_refusal is not null then
      -- Said the same way as a missing target: a test member learns nothing about real projects.
      return jsonb_build_object('error', case p_kind when 'contact_photo' then 'no such contact' else 'no such dashboard project' end);
    end if;
  end if;

  return jsonb_build_object('ok', true, 'project_id', v_project);
end;
$f$;

revoke all on function public.hq_upload_target(text, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.hq_upload_target(text, uuid, uuid, text) to service_role;

comment on function public.hq_upload_target(text, uuid, uuid, text) is
  'Authorizes the DATABASE target of an upload before any object is written (0650). Returns the canonical project id or the same refusal for a missing, mismatched or off-limits target.';

-- ROLLBACK (not part of the migration): redeploy the previous hq-api first, then drop function public.hq_upload_target(text, uuid, uuid, text).
