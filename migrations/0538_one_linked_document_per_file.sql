-- 0538 — picking the same file twice makes one document, not two
--
-- 0537's writer says `on conflict (connector, external_parent_ref, external_ref)`
-- and a file picked out of Drive has NO parent — it was chosen on its own, not
-- discovered inside a notebook — so `external_parent_ref` is null. Two nulls
-- are distinct in a unique index, the conflict target matched nothing, and
-- picking the same file twice made two documents.
--
-- CLAUDE.md records this exact defect from 0317–0322, in its own words: "NULL
-- is not equal to NULL in a unique index, so `on conflict` catches nothing...
-- The fix is a narrow partial index whose columns contain nothing nullable."
-- Not `= ''` either, which is 0177's sentinel wearing a different hat.
--
-- So: an index over (connector, external_ref) for exactly the rows that have a
-- reference and no parent. Narrow on purpose — a notebook's source and a
-- synced Drive file both HAVE parents and keep the three-column index they
-- already rely on.
--
-- It was found by driving the function four times, which is the fourth defect
-- in this one feature that reading could not have shown.

-- THE SWEEP COMES FIRST. Creating the index before clearing the duplicates
-- fails on them - which it did, and the whole migration rolled back, which is
-- the machinery working.
--
-- The duplicates that defect already made, before the index can refuse them.
-- Keeping the FIRST of each pair: it is the one anything else may already
-- refer to, and the second is a copy nobody asked for.
delete from public.documents d
 where d.external_ref is not null
   and d.external_parent_ref is null
   and exists (
     select 1 from public.documents e
      where e.connector = d.connector
        and e.external_ref = d.external_ref
        and e.external_parent_ref is null
        and e.created_at < d.created_at
   );

create unique index if not exists documents_one_per_linked_file
  on public.documents (connector, external_ref)
  where external_ref is not null and external_parent_ref is null;

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
  -- The narrow index above, and its predicate written out: a conflict target
  -- without the same predicate matches no index and the insert fails, which is
  -- how a sync once stored zero rows for a whole run.
  on conflict (connector, external_ref)
    where external_ref is not null and external_parent_ref is null
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
