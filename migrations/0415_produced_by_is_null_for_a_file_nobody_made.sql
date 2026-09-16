-- `produced_by` is NULL for a file nobody made (#126).
--
-- 0414 wrote the empty string for a dropped file, on a comment that said the
-- column is `not null default ''`. It is not, and has not been since 0284:
-- `information_schema` says nullable, no default. That comment described the
-- state CLAUDE.md records as the DEFECT — a sentinel that satisfies a
-- constraint and lies, which made `coalesce(d.produced_by, 'The team')` dead
-- code in four readers and rendered a blank origin line where a name belongs.
--
-- Writing '' would have put the sentinel back one caller at a time. NULL is
-- the value the column has for "nobody made this", every reader already
-- coalesces it, and the difference is visible: a document Grant dropped shows
-- "Yours" rather than an empty name.
--
-- Patched from the live definition rather than retyped, and every statement
-- terminated, because `pg_get_functiondef` emits no trailing semicolon and
-- this repository has been caught by that twice.

create or replace function app.record_file_document(
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
  if p_parent_ref is not null and coalesce(btrim(p_external_ref), '') = '' then
    return jsonb_build_object('error', 'a parent reference needs the artifact reference too');
  end if;
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
     null,
     p_parent_ref, p_external_ref,
     p_storage_path, p_mime_type, p_byte_size, p_duration_s,
     null, null, null,
     null,
     p_added_by,
     -- NULL, not '', for a file the office did not make (0284, 0177).
     case when p_origin = 'made' then p_added_by else null end,
     p_job_id, p_origin, 'draft')
  returning * into made;

  return jsonb_build_object('document_id', made.document_id, 'already_there', false);
end;
$function$;
