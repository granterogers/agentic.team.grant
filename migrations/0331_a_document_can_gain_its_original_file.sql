begin;

/**
 * A document can gain its original file, without losing what it already is.
 *
 * Issue #96, and the reason it has stayed open with its code finished.
 *
 * ## The wall
 *
 * The reader is built and proven: `app.studio_document` emits `storage_path`,
 * `hq-api` swaps it for a ten-minute signed URL and drops the path, and the
 * studio renders a PDF inline with a prominent link to the real file. None of
 * it can be demonstrated, because **no PDF in the office has any bytes**. All
 * five are text extractions with `storage_path` and `mime_type` null — they
 * arrived through NotebookLM, which hands out `get_fulltext` and has no way to
 * export a source's original file.
 *
 * ## Why `record_file_document` cannot be reused
 *
 * It exists (0208) and it works, and it is the wrong shape for this. 0206's
 * title says why: *a generated file was made, not sourced*. It hardcodes
 * `origin = 'made'`, `connector = null`, `doc_type = 'file'` and
 * `content = null`, because it is for an artefact the office produced and
 * fetched — an audio overview with no text.
 *
 * A PDF from Grant's Drive is the opposite on every one of those. It was
 * sourced, it came through a connector, and it already holds 34,000 characters
 * of extracted text that is the useful half. Calling `record_file_document`
 * would create a SECOND row beside the text one, and the gallery would show
 * the same document twice — once readable and once a file.
 *
 * So: a function that adds bytes to the row that is already there, and touches
 * nothing else.
 *
 * ## The constraint it has to satisfy
 *
 * `documents_file_is_complete` (0205) is all-or-nothing:
 *
 *     (storage_path is null and mime_type is null and byte_size is null)
 *     or (storage_path is not null and mime_type is not null and byte_size > 0)
 *
 * Which is right, and it means this cannot set one field and leave another for
 * later. All three or none — checked here as well as by the column, so the
 * caller gets a sentence rather than a constraint name.
 */

create or replace function app.attach_file_to_document(
  p_document_id uuid,
  p_storage_path text,
  p_mime_type text,
  p_byte_size bigint)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_title    text;
  v_existing text;
  v_project  uuid;
  v_owner    uuid;
begin
  select title, storage_path, project_id
    into v_title, v_existing, v_project
    from public.documents where document_id = p_document_id;
  if v_title is null then
    return jsonb_build_object('ok', false, 'error', 'no such document');
  end if;

  /*
    Idempotent on the path, the way `record_file_document` is.

    A re-read of the same Drive file lands on the same object — `x-upsert` sees
    to that on the storage side — so arriving here twice is the normal case,
    not an error. Answering `already_there` lets a caller retry freely.
  */
  if v_existing is not distinct from p_storage_path then
    return jsonb_build_object(
      'ok', true, 'already_there', true, 'document', p_document_id, 'title', v_title);
  end if;

  if coalesce(btrim(p_storage_path), '') = '' or coalesce(btrim(p_mime_type), '') = ''
     or coalesce(p_byte_size, 0) <= 0 then
    -- `documents_file_is_complete` would refuse this too. Said in words here
    -- because a caller reading "violates check constraint" learns nothing
    -- about which of the three it forgot.
    return jsonb_build_object(
      'ok', false,
      'error', 'a file needs all three of a path, a mime type and a size above zero');
  end if;

  /*
    One document per object.

    Two rows pointing at the same bytes would make deleting either one a
    question nobody wants to answer, and the path is derived from the
    connector's own file id, so a collision means two documents claim to be the
    same file. Worth refusing loudly.
  */
  select document_id into v_owner
    from public.documents
   where storage_path = p_storage_path and document_id <> p_document_id;
  if v_owner is not null then
    return jsonb_build_object(
      'ok', false, 'error', format('another document already holds that file (%s)', v_owner));
  end if;

  /*
    Only the three file columns.

    `content`, `origin`, `connector`, `doc_type`, `state` and every other
    column are left exactly as they were: this is a document that gained a
    file, not a file that gained a document. The extracted text stays the
    readable half, and the reader falls through to it whenever the browser
    cannot render the bytes.
  */
  update public.documents
     set storage_path = p_storage_path,
         mime_type    = p_mime_type,
         byte_size    = p_byte_size
   where document_id = p_document_id;

  return jsonb_build_object(
    'ok', true, 'document', p_document_id, 'title', v_title,
    'project_id', v_project, 'bytes', p_byte_size);
end;
$$;

comment on function app.attach_file_to_document is
  '#96. Give an existing document its original file. Unlike '
  'app.record_file_document (0208) this touches ONLY storage_path, mime_type '
  'and byte_size — the text, the origin and the connector are what the '
  'document already is, and a PDF from Drive is sourced rather than made. '
  'Idempotent on the path. 0331.';

create or replace function public.attach_file_to_document(
  p_document_id uuid, p_storage_path text, p_mime_type text, p_byte_size bigint)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.attach_file_to_document(p_document_id, p_storage_path, p_mime_type, p_byte_size) $$;

grant execute on function app.attach_file_to_document(uuid, text, text, bigint) to ai_team_app;
grant execute on function public.attach_file_to_document(uuid, text, text, bigint) to ai_team_app;

commit;
