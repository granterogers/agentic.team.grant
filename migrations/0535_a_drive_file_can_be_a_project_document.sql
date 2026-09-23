-- 0535 — a file in Drive can become a project document, without being copied
--
-- Grant, 23 September 2026:
--
--   "Add file/document → choose Google Drive → browse/search/select → choose
--    item → associate/import/link it to the project → see it in Docs & Files →
--    open it later... Do not build a fake list of Drive filenames."
--
--   "Determine the repository's correct data model. A Drive document may be
--    better represented as PROJECT DOCUMENT REFERENCE → provider = Google
--    Drive → external ID → canonical URL → metadata → preview information
--    rather than unnecessarily copying the file."
--
-- It is a reference. `public.documents` already holds exactly that shape for
-- every other connector: `connector` says who it belongs to, `external_ref`
-- says which file, `mime_type` says what it is, and the partial unique index on
-- (connector, external_parent_ref, external_ref) makes picking the same file
-- twice one document rather than two.
--
-- NO NEW COLUMN, and specifically no `external_url`. A Drive URL is derivable
-- from the id and the type — /file/d/<id>/view, /document/d/<id>/edit,
-- /spreadsheets/d/<id>/edit — so storing it would be a second copy of a fact
-- the row already carries, and 0310 is the migration spent undoing exactly
-- that. The page derives it in one place.
--
-- NUMBERING: as 0534 on this branch. This is the UX workstream, which carries
-- migrations 0001–0535 while the database is at 566 because another workstream
-- has applied 33 that are not on main. `app.schema_migrations` keys on the
-- NAME, so this coexists; when the branches meet, rename this file to the next
-- free number. Everything below is idempotent, so re-applying it under a new
-- name changes nothing.

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
  v_id    uuid;
  v_new   boolean;
begin
  if v_title = '' then
    return jsonb_build_object('error', 'that file has no name to file it under');
  end if;
  if v_ref = '' then
    return jsonb_build_object('error', 'nothing said which file this is');
  end if;
  -- The connectors a document may come from, which is the same list
  -- `knowledge_connectors` is keyed to. A new provider is a row there and a
  -- line here, deliberately: a document whose connector nothing recognises is
  -- a document no reader can open.
  if v_conn not in ('drive', 'notion', 'notebooklm', 'github', 'mcp', 'upload') then
    return jsonb_build_object('error', format('%L is not a connector this office reads', v_conn));
  end if;
  if not exists (select 1 from public.projects
                  where project_id = p_project_id and coalesce(status, '') <> 'archived') then
    return jsonb_build_object('error', 'no such dashboard project');
  end if;

  -- PICKING THE SAME FILE TWICE IS ONE DOCUMENT. The index this infers against
  -- is partial - an upload has no external reference, so uniqueness is not
  -- asserted over a null - and a conflict target without the same predicate
  -- matches no index and the insert fails. 0317 through 0322 were spent
  -- learning that, so the predicate is written out here.
  insert into public.documents
    (project_id, connector, external_ref, title, mime_type, source_title,
     origin, state, added_by, doc_type)
  values
    (p_project_id, v_conn, v_ref, v_title, nullif(btrim(coalesce(p_mime, '')), ''),
     nullif(btrim(coalesce(p_source_title, '')), ''),
     'linked', 'approved', 'grant', 'file')
  on conflict (connector, external_parent_ref, external_ref)
    where external_ref is not null
    do update set
      title        = excluded.title,
      mime_type    = coalesce(excluded.mime_type, public.documents.mime_type),
      source_title = coalesce(excluded.source_title, public.documents.source_title),
      project_id   = excluded.project_id,
      updated_at   = app.now_utc()
  returning document_id, (xmax = 0) into v_id, v_new;

  return jsonb_build_object('ok', true, 'id', v_id, 'added', v_new, 'title', v_title);
end;
$$;

create or replace function public.hq_document_link(
  p_project_id uuid, p_connector text, p_external_ref text, p_title text,
  p_mime text default null, p_source_title text default null
) returns jsonb language sql security definer
set search_path to 'public', 'pg_catalog'
as $$
  select app.hq_document_link(p_project_id, p_connector, p_external_ref, p_title,
                              p_mime, p_source_title);
$$;

grant execute on function public.hq_document_link(uuid, text, text, text, text, text) to service_role;
