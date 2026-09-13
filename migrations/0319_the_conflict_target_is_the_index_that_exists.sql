begin;

/**
 * The conflict target is the index that exists.
 *
 * 0317 wrote `on conflict (project_id, connector, external_ref)`, which is the
 * key that SOUNDS right — one document per external reference per project — and
 * is not the one on the table. The real index is
 *
 *     documents_one_per_external_ref
 *       on (connector, external_parent_ref, external_ref)
 *       where external_ref is not null
 *
 * — no `project_id`, and an `external_parent_ref` instead. Postgres answers
 * "there is no unique or exclusion constraint matching the ON CONFLICT
 * specification", which is exactly right and says nothing about which columns
 * to use.
 *
 * CLAUDE.md's rule about guessing COLUMN names extends to guessing INDEX
 * columns, and this is the second half of the same lesson: `pg_indexes` costs
 * one query.
 *
 * `external_parent_ref` is null for an imported output — it has no container —
 * and a partial index over a nullable column still needs it named in the
 * target, so all three go in. The uniqueness is unchanged in practice:
 * `output:<uuid>` is globally unique, so one output imports to one document
 * whichever project it belongs to.
 */

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
  -- The index that exists: (connector, external_parent_ref, external_ref).
  on conflict (connector, external_parent_ref, external_ref) do update
    set title = excluded.title
  returning document_id into v_document;

  v_meta := app.approve_document(v_document, p_collection, p_tags, p_related_task, p_related_source);
  if coalesce((v_meta->>'ok')::boolean, false) is not true then
    -- The document exists and is a draft, so nothing is lost and nothing is in
    -- the project. The reason is returned rather than raised so the page can
    -- say it out loud.
    return jsonb_build_object('ok', false, 'document', v_document,
                              'error', v_meta->>'error');
  end if;

  -- And the output is settled, so `studio_requests` stops listing it as
  -- awaiting review with the document already imported.
  update public.outputs
     set reviewer_status = 'approved', reviewed_by = null, reviewed_at = app.now_utc()
   where output_id = p_output;

  return jsonb_build_object(
    'ok', true, 'document', v_document, 'title', v_title,
    'collection', v_meta->'collection', 'tags', v_meta->'tags', 'source', v_meta->'source');
end;
$$;

commit;
