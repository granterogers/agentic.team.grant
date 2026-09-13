begin;

/**
 * NULL is not equal to NULL, so the conflict never fired.
 *
 * 0317 through 0320 spent three migrations getting `on conflict` to MATCH the
 * index — the columns, then the partial predicate — and every one of them
 * missed that matching the index is not the same as the index catching
 * anything.
 *
 * `documents_one_per_external_ref` is unique on
 * `(connector, external_parent_ref, external_ref)`. An imported output has
 * **`external_parent_ref` null** — it has no container — and in a unique index
 * two nulls are DISTINCT. So two rows with the same connector and the same
 * `external_ref` do not conflict, the `do update` never ran, and importing the
 * same output twice made two documents.
 *
 * `verify:import` caught it on its first complete run: *"2 document(s), same
 * id: false"*. 0317's own comment claimed the opposite in prose —
 * *"pressing Import twice imports one document"* — which is what a comment is
 * worth without a check behind it.
 *
 * ## The fix, and why not the obvious two
 *
 * NOT `external_parent_ref = ''`: that is a sentinel standing in for "no
 * parent", and 0177's argument — a sentinel satisfies the constraint and lies —
 * has been re-learned in this repository twice already.
 *
 * NOT `nulls not distinct` on the existing index: it is shared by every
 * connector, and changing null semantics under Notion and Drive to fix an
 * upload path is a wide change for a narrow problem.
 *
 * A second, narrow partial index instead. It covers exactly the rows this
 * function creates — `external_ref like 'output:%'` — and says so.
 */

create unique index if not exists documents_one_per_imported_output
  on public.documents (project_id, external_ref)
  where external_ref like 'output:%';

comment on index public.documents_one_per_imported_output is
  '#28. One document per imported output. The general index includes '
  'external_parent_ref, which is NULL for an import — and two nulls are '
  'distinct, so it caught nothing and a second press made a second document. '
  '0322.';

create or replace function app.import_output(
  p_output uuid,
  p_collection text default null,
  p_tags text[] default null,
  p_related_task uuid default null,
  p_related_source uuid default null,
  p_title text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  o          record;
  v_project  uuid;
  v_author   text;
  v_title    text;
  v_document uuid;
  v_meta     jsonb;
begin
  select oo.output_id, oo.body, oo.job_id, oo.staff_id, oo.reviewer_status
    into o
    from public.outputs oo where oo.output_id = p_output;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'no such output');
  end if;
  if coalesce(btrim(o.body), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'that output has no text to import');
  end if;

  select j.project_id into v_project from public.jobs j where j.job_id = o.job_id;
  if v_project is null then
    return jsonb_build_object('ok', false, 'error', 'that output is not attached to a project');
  end if;

  -- The author's SLUG: `documents.produced_by` is a slug, and 0310 derives
  -- `agent -produced-> document` by joining `staff.slug` to it.
  select s.slug into v_author from public.staff s where s.staff_id = o.staff_id;

  v_title := coalesce(
    nullif(btrim(coalesce(p_title, '')), ''),
    nullif(btrim(split_part(o.body, E'\n', 1)), ''),
    'Untitled');
  v_title := left(v_title, 200);

  insert into public.documents
    (project_id, connector, external_parent_ref, external_ref, title, doc_type, content,
     content_fingerprint, content_chars, fetched_at, origin, state,
     produced_by, produced_by_job)
  values (v_project, 'upload', null, format('output:%s', p_output), v_title, 'note', o.body,
          encode(extensions.digest(o.body, 'sha256'), 'hex'), length(o.body),
          app.now_utc(), 'made', 'draft',
          -- Provenance, from the output itself. Not parameters, so nothing can
          -- pass the wrong thing (#28).
          coalesce(v_author, ''), o.job_id)
  /*
    The narrow index (0322), whose columns contain no nullable one — which is
    the whole reason it exists. The general index includes
    external_parent_ref, null here, and two nulls do not conflict.
  */
  on conflict (project_id, external_ref) where external_ref like 'output:%'
  do update set title = excluded.title
  returning document_id into v_document;

  v_meta := app.approve_document(v_document, p_collection, p_tags, p_related_task, p_related_source);
  if coalesce((v_meta->>'ok')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'document', v_document,
                              'error', v_meta->>'error');
  end if;

  update public.outputs
     set reviewer_status = 'approved', reviewed_by = null, reviewed_at = app.now_utc()
   where output_id = p_output;

  return jsonb_build_object(
    'ok', true, 'document', v_document, 'title', v_title,
    'collection', v_meta->'collection', 'tags', v_meta->'tags', 'source', v_meta->'source');
end;
$$;

commit;
