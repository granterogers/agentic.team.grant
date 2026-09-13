begin;

/**
 * IMPORT TO PROJECT is where an output becomes a document.
 *
 * Issue #28, and the step the specification draws as its own box:
 *
 *     AGENT OUTPUTS  ->  IMPORT TO PROJECT
 *                        ├── choose collection
 *                        ├── add tags
 *                        ├── relate to task
 *                        ├── relate to source
 *                        └── preserve provenance
 *
 * ## The thing I had wrong for an hour
 *
 * 0315 wired `approve_document`, on the assumption that an output IS a document
 * awaiting approval. It is not. `public.outputs` is what an agent WROTE — a
 * body, a confidence, an evidence type, a job — and `public.documents` is what
 * the project HOLDS. They are different tables with different shapes and
 * nothing had ever converted one into the other.
 *
 * So importing is not a state change. It is a CREATION, and that is exactly why
 * #28 calls it a step: choosing a collection and some tags at the moment a
 * thing enters the project is the only moment anyone will ever choose them.
 *
 * `approve_document` is still right and is still used — for the metadata half,
 * unchanged, called from here. What was missing is everything before it.
 *
 * ## Provenance is not a field anybody fills in
 *
 * #28: *"Provenance carried automatically and not removable."*
 *
 * `produced_by_job` and `produced_by` are set from the output's own job and
 * author. Nothing is passed in for either, so nothing can pass the wrong thing
 * — and `job -produced-> document` and `agent -produced-> document` are then
 * DERIVED by `relations_of` (0310) rather than stored, which is what makes them
 * unremovable: there is no row to delete.
 *
 * ## Twice is once
 *
 * The unique index on `(project_id, connector, external_ref)` is keyed on the
 * OUTPUT's id, so pressing Import twice imports one document. That is the
 * honest behaviour for a button on a phone with a slow connection, and it is
 * cheaper than a guard that has to decide what "already imported" means.
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
    -- An output whose job has no project cannot be imported anywhere, and
    -- guessing a project for it is how a finding ends up in the wrong one.
    return jsonb_build_object('ok', false, 'error', 'that output is not attached to a project');
  end if;

  -- The author's SLUG, because `documents.produced_by` is a slug and 0310
  -- derives `agent -produced-> document` by joining `staff.slug` to it.
  select s.slug into v_author from public.staff s where s.staff_id = o.staff_id;

  /*
    A title, and the first line is the best guess anybody has.

    `studio_requests` already shows exactly this as the output's title, so what
    Grant saw on the card is what the document is called — and `p_title` lets
    him say otherwise at the moment of import, which is the only moment he is
    looking at it.
  */
  v_title := coalesce(
    nullif(btrim(coalesce(p_title, '')), ''),
    nullif(btrim(split_part(o.body, E'\n', 1)), ''),
    'Untitled');
  v_title := left(v_title, 200);

  insert into public.documents
    (project_id, connector, external_ref, title, doc_type, content,
     content_fingerprint, content_chars, fetched_at, origin, state,
     produced_by, produced_by_job)
  values (v_project, 'upload', format('output:%s', p_output), v_title, 'note', o.body,
          encode(extensions.digest(o.body, 'sha256'), 'hex'), length(o.body),
          app.now_utc(), 'made', 'draft',
          -- Provenance, from the output itself. Not parameters, so nothing can
          -- pass the wrong thing (#28).
          coalesce(v_author, ''), o.job_id)
  on conflict (project_id, connector, external_ref) do update
    set title = excluded.title
  returning document_id into v_document;

  /*
    The metadata half, through the function that already did it.

    `approve_document` sets the state, replaces the tags, files it in a
    collection and writes the task and source edges — and it validates the
    source against this project, which is a check worth having in one place.
  */
  v_meta := app.approve_document(v_document, p_collection, p_tags, p_related_task, p_related_source);
  if coalesce((v_meta->>'ok')::boolean, false) is not true then
    -- The document exists and is a draft, so nothing is lost and nothing is in
    -- the project. Returning the reason rather than raising keeps the page able
    -- to say it.
    return jsonb_build_object('ok', false, 'document', v_document,
                              'error', v_meta->>'error');
  end if;

  /*
    And the output is settled, so it stops asking.

    `studio_requests` reads `reviewer_status` to decide whether a row is still
    awaiting review, so leaving it pending would put the card back in the
    waiting list with the document already imported.
  */
  update public.outputs
     set reviewer_status = 'approved', reviewed_by = null, reviewed_at = app.now_utc()
   where output_id = p_output;

  return jsonb_build_object(
    'ok', true, 'document', v_document, 'title', v_title,
    'collection', v_meta->'collection', 'tags', v_meta->'tags', 'source', v_meta->'source');
end;
$$;

comment on function app.import_output is
  '#28. Where an agent OUTPUT becomes a project DOCUMENT — the step the '
  'specification draws as its own box. Provenance (produced_by, '
  'produced_by_job) comes from the output rather than from a parameter, so it '
  'cannot be passed wrongly, and the job and agent edges are then DERIVED '
  'rather than stored, which is what makes them unremovable. 0317.';

create or replace function public.import_output(
  p_output uuid, p_collection text default null, p_tags text[] default null,
  p_related_task uuid default null, p_related_source uuid default null,
  p_title text default null)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.import_output(p_output, p_collection, p_tags, p_related_task,
                               p_related_source, p_title) $$;

grant execute on function app.import_output(uuid, text, text[], uuid, uuid, text) to ai_team_app;
grant execute on function public.import_output(uuid, text, text[], uuid, uuid, text) to ai_team_app;

commit;
