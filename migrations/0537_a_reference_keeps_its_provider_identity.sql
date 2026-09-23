-- 0537 — a linked file keeps its Google identity without pretending to have bytes
--
-- 0536 got the vocabulary right and then hit the next constraint:
--
--   documents_file_is_complete:
--     (storage_path is null and mime_type is null and byte_size is null)
--     or (storage_path is not null and mime_type is not null and byte_size > 0)
--
-- which says, correctly, that those three columns describe ONE stored file and
-- travel together. A picked Drive file has none of them: Drive holds the bytes
-- and the office holds a reference, which is the whole point of §23.
--
-- So the provider identity goes where it can be true. `connector` already says
-- Google Drive. `doc_type` says WHICH KIND of Google thing it is, in the
-- office's own words rather than in Google's MIME vocabulary — because
-- "application/vnd.google-apps.spreadsheet" is not a thing to put in front of
-- a person, and because the kind is what decides which Google URL opens it.
--
-- Grant's §25: "Preserve Google Docs identity, Google Sheets identity, Google
-- Slides identity, Drive file identity where known." That is exactly the
-- distinction this mapping keeps.
--
-- Third correction to one function in one afternoon, and all three were found
-- by CALLING it rather than by reading it — which is this repository's own
-- standing lesson about migrations that apply cleanly.

create or replace function app.hq_document_link(
  p_project_id   uuid,
  p_connector    text,
  p_external_ref text,
  p_title        text,
  p_mime         text default null,
  p_source_title text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_title text := btrim(coalesce(p_title, ''));
  v_conn  text := lower(btrim(coalesce(p_connector, '')));
  v_ref   text := btrim(coalesce(p_external_ref, ''));
  v_mime  text := lower(btrim(coalesce(p_mime, '')));
  v_kind  text;
  v_id    uuid;
  v_new   boolean;
begin
  if v_title = '' then
    return jsonb_build_object('error', 'that file has no name to file it under');
  end if;
  if v_ref = '' then
    return jsonb_build_object('error', 'nothing said which file this is');
  end if;
  if v_conn not in ('drive', 'notion', 'notebooklm', 'github', 'mcp', 'upload') then
    return jsonb_build_object('error', format('%L is not a connector this office reads', v_conn));
  end if;
  if not exists (select 1 from public.projects
                  where project_id = p_project_id and coalesce(status, '') <> 'archived') then
    return jsonb_build_object('error', 'no such dashboard project');
  end if;

  -- What kind of thing it is, in words. A folder is refused rather than filed:
  -- a folder is not a document and picking one would put a row in the gallery
  -- that opens into a listing.
  v_kind := case
    when v_mime = 'application/vnd.google-apps.folder' then 'folder'
    when v_mime = 'application/vnd.google-apps.document' then 'google-doc'
    when v_mime = 'application/vnd.google-apps.spreadsheet' then 'google-sheet'
    when v_mime = 'application/vnd.google-apps.presentation' then 'google-slides'
    when v_mime = 'application/vnd.google-apps.form' then 'google-form'
    when v_mime = 'application/pdf' then 'pdf'
    when v_mime like 'image/%' then 'image'
    when v_mime like 'audio/%' then 'audio'
    when v_mime like 'video/%' then 'video'
    when v_mime like 'text/%' then 'text'
    else 'file'
  end;
  if v_kind = 'folder' then
    return jsonb_build_object('error', 'that is a folder — pick a file inside it');
  end if;

  insert into public.documents
    (project_id, connector, external_ref, title, source_title,
     origin, state, added_by, doc_type)
  values
    (p_project_id, v_conn, v_ref, v_title,
     nullif(btrim(coalesce(p_source_title, '')), ''),
     'source', 'approved', 'grant', v_kind)
  on conflict (connector, external_parent_ref, external_ref)
    where external_ref is not null
    do update set
      title        = excluded.title,
      doc_type     = excluded.doc_type,
      source_title = coalesce(excluded.source_title, public.documents.source_title),
      project_id   = excluded.project_id,
      updated_at   = app.now_utc()
  returning document_id, (xmax = 0) into v_id, v_new;

  return jsonb_build_object('ok', true, 'id', v_id, 'added', v_new,
                            'title', v_title, 'kind', v_kind);
end;
$$;
