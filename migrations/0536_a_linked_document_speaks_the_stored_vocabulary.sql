-- 0536 — a linked document speaks the vocabulary the table already has
--
-- 0535 wrote `origin = 'linked'` for a file picked out of Drive, and
-- `connector_matches_origin` refused every one of them: the word for "this
-- came from a connector" is **`source`**, and it is the only word the table has
-- ever used. Eight distinct (origin, connector) pairs exist and not one of them
-- says linked.
--
-- This is 0311's lesson arriving again — a derived value must speak the STORED
-- vocabulary, and inventing a neighbouring word is how a reader that filters on
-- `origin = 'source'` silently misses half its rows. Here it failed loudly
-- instead, which is the lucky direction, and it failed on the first real call
-- rather than in a reading of the migration.
--
-- WHAT DISTINGUISHES A PICKED FILE FROM A SYNCED ONE, now that both say
-- `source`: a picked one has no `content`. It is a reference by construction —
-- Drive goes on holding the file — whereas the sync pulls text across so the
-- office can search it. That is a property of the row rather than a label, so
-- nothing has to be kept in step.
--
-- Numbered as 0534 and 0535 on this branch are: see the note in 0534.

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
  if v_conn not in ('drive', 'notion', 'notebooklm', 'github', 'mcp', 'upload') then
    return jsonb_build_object('error', format('%L is not a connector this office reads', v_conn));
  end if;
  if not exists (select 1 from public.projects
                  where project_id = p_project_id and coalesce(status, '') <> 'archived') then
    return jsonb_build_object('error', 'no such dashboard project');
  end if;

  insert into public.documents
    (project_id, connector, external_ref, title, mime_type, source_title,
     origin, state, added_by, doc_type)
  values
    (p_project_id, v_conn, v_ref, v_title, nullif(btrim(coalesce(p_mime, '')), ''),
     nullif(btrim(coalesce(p_source_title, '')), ''),
     -- The word the table uses. Not `linked`, which 0535 invented and the
     -- check constraint refused.
     'source', 'approved', 'grant', 'file')
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
