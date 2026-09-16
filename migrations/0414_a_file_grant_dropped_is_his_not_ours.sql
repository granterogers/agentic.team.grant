-- A file Grant dropped is HIS, not something the office made (#126).
--
-- `app.record_file_document` was written for one caller — a PDF the office
-- read out of Drive — and hardcodes `origin = 'made'`. #126 gave it a second
-- caller with the opposite provenance: a file dragged onto a project from
-- Grant's desktop. The office did not make it; he handed it over.
--
-- Left as it was, the document reads back with its origin rendered from
-- `produced_by`, so a file he dropped announced itself on his own dashboard as
-- having been produced by "grant" — which is true in the narrow sense and
-- wrong in the sense the column exists for. `origin` distinguishes material
-- the office was GIVEN from material it MADE, and 0169's whole point is that
-- confusing the two lets an agent cite its own output as a source.
--
-- The parameter defaults to 'made', so the Drive caller is untouched and this
-- is not a behaviour change anywhere it is not passed. Added at the END of the
-- signature for the same reason: every positional caller keeps working, and
-- CLAUDE.md records what happens when an argument list shifts under one.
--
-- `connector` stays null. `connector_matches_origin` only requires a connector
-- when the origin is 'source', and a dropped file came from no connector — it
-- came from a desktop, which is the absence of one.
--
-- `create or replace` is not enough on its own here: the argument list changes,
-- so Postgres would create a SECOND overload and every call would become
-- ambiguous. Dropped by exact signature first.

drop function if exists app.record_file_document(uuid, text, text, text, bigint, text, text, integer, text, uuid);

create function app.record_file_document(
  p_project_id uuid,
  p_title text,
  p_storage_path text,
  p_mime_type text,
  p_byte_size bigint,
  p_parent_ref text default null,
  p_external_ref text default null,
  p_duration_s integer default null,
  p_added_by text default 'chief-of-staff',
  p_job_id uuid default null,
  p_origin text default 'made'
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  made public.documents%rowtype;
begin
  if not exists (select 1 from public.projects where project_id = p_project_id) then
    return jsonb_build_object('error', 'no such dashboard project');
  end if;
  if coalesce(p_byte_size, 0) <= 0 then
    return jsonb_build_object('error', 'a file with no bytes is not a file');
  end if;
  -- `documents_external_identity_is_whole`: a parent with no child reference
  -- is a pointer to nothing.
  if p_parent_ref is not null and coalesce(btrim(p_external_ref), '') = '' then
    return jsonb_build_object('error', 'a parent reference needs the artifact reference too');
  end if;
  /*
    Only the two origins that can have no connector. 'source' is excluded
    deliberately rather than by omission: `connector_matches_origin` requires a
    connector for it, this function has no way to know one, and the refusal a
    caller would get from the constraint names the constraint rather than the
    mistake.
  */
  if p_origin is null or p_origin not in ('made', 'yours') then
    return jsonb_build_object(
      'error', format('a stored file is either yours or made here, not %L', p_origin));
  end if;

  select * into made from public.documents
   where project_id = p_project_id and storage_path = p_storage_path;
  if found then
    return jsonb_build_object('document_id', made.document_id, 'already_there', true);
  end if;

  insert into public.documents
    (project_id, title, doc_type, connector, external_parent_ref, external_ref,
     storage_path, mime_type, byte_size, duration_s,
     content, content_fingerprint, content_chars, fetched_at,
     added_by, produced_by, produced_by_job, origin, state)
  values
    (p_project_id, p_title, 'file',
     null,                                  -- neither origin here takes one
     p_parent_ref, p_external_ref,
     p_storage_path, p_mime_type, p_byte_size, p_duration_s,
     null, null, null,
     -- `documents_fetched_iff_content`: fetched_at means "we pulled TEXT in",
     -- and no text was pulled. The bytes arriving is not the same event.
     null,
     p_added_by,
     -- `produced_by` is who MADE it, so a file Grant handed over has nobody in
     -- it. The column is `not null default ''` (0284 removed the sentinel from
     -- the readers), so the empty string is the honest value and not a lie.
     case when p_origin = 'made' then p_added_by else '' end,
     p_job_id, p_origin, 'draft')
  returning * into made;

  return jsonb_build_object('document_id', made.document_id, 'already_there', false);
end;
$function$;

grant execute on function app.record_file_document(uuid, text, text, text, bigint, text, text, integer, text, uuid, text) to ai_team_app, service_role;

-- PostgREST only exposes `public`, and the gateway calls this one by name over
-- the REST RPC path, so the wrapper has to move with the signature.
drop function if exists public.record_file_document(uuid, text, text, text, bigint, text, text, integer, text, uuid);

create function public.record_file_document(
  p_project_id uuid,
  p_title text,
  p_storage_path text,
  p_mime_type text,
  p_byte_size bigint,
  p_parent_ref text default null,
  p_external_ref text default null,
  p_duration_s integer default null,
  p_added_by text default 'chief-of-staff',
  p_job_id uuid default null,
  p_origin text default 'made'
)
returns jsonb
language sql
security definer
set search_path to ''
as $$
  select app.record_file_document(
    p_project_id, p_title, p_storage_path, p_mime_type, p_byte_size,
    p_parent_ref, p_external_ref, p_duration_s, p_added_by, p_job_id, p_origin)
$$;

grant execute on function public.record_file_document(uuid, text, text, text, bigint, text, text, integer, text, uuid, text) to ai_team_app, service_role, authenticated, anon;
