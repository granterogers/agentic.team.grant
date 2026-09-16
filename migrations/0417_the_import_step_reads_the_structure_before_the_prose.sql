-- The import step reads the STRUCTURE before it reads the prose (#130).
--
-- #130's title is the complaint: *"the import step is parsing English"*, and
-- it was right about the one place it named. `app.import_output` derived a
-- document's title with
--
--     nullif(btrim(split_part(o.body, E'\n', 1)), '')
--
-- -- the first line of the body. That is a parse, and it is the kind that
-- works until the answer opens with "Here is the summary you asked for:".
--
-- ## The contract already existed and nothing read it
--
-- `public.output_shapes` has declared six shapes since 0272, with required and
-- optional facts per shape, and a trigger that fails the write when the facts
-- do not match. `draft_document` requires `title` and `markdown`, and offers
-- `tags` and `suggested_collection`.
--
-- So the structure a consumer needs was specified, enforced, and then not
-- consulted by the consumer it was specified for. That is the same shape as a
-- column nothing reads and a control nothing presses, which this repository
-- has now recorded three times — the mechanism built, the join forgotten.
--
-- ## The order, and why the prose stays as the fallback
--
--   1. what the person typed into the import sheet, because a human looking at
--      the thing beats everything;
--   2. what the output DECLARED, if it declared a shape carrying a title;
--   3. the first line of the prose.
--
-- The third stays because most outputs declare no shape at all — 3,240 of them
-- today — and removing the fallback would trade a sometimes-wrong title for no
-- title. #130's own rule: `body` stays, the structure sits BESIDE it.
--
-- Tags work the same way and in the same order, and an empty array from the
-- sheet is treated as "none given" rather than "none wanted", because the
-- sheet sends `{}` when Grant leaves the box alone.

create or replace function app.import_output(
  p_output uuid,
  p_collection text default null,
  p_tags text[] default null,
  p_related_task uuid default null,
  p_related_source uuid default null,
  p_title text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  o          record;
  v_project  uuid;
  v_author   text;
  v_title    text;
  v_document uuid;
  v_meta     jsonb;
  v_declared jsonb;
  v_tags     text[];
  v_collection text;
begin
  select oo.output_id, oo.body, oo.job_id, oo.staff_id, oo.reviewer_status,
         oo.shape, oo.facts
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

  select s.slug into v_author from public.staff s where s.staff_id = o.staff_id;

  /*
    What the output said about itself, if anything. Guarded on the shape being
    one the registry knows AND the facts being an object: a shape naming
    something that is not declared cannot be trusted to carry the keys it
    would imply, and 0272's trigger means such a row should not exist anyway.
  */
  v_declared := case
    when o.shape is not null
     and jsonb_typeof(coalesce(o.facts, 'null'::jsonb)) = 'object'
     and exists (select 1 from public.output_shapes s where s.shape = o.shape)
    then o.facts
    else '{}'::jsonb
  end;

  v_title := coalesce(
    nullif(btrim(coalesce(p_title, '')), ''),
    nullif(btrim(coalesce(v_declared ->> 'title', '')), ''),
    nullif(btrim(split_part(o.body, E'\n', 1)), ''),
    'Untitled');
  v_title := left(v_title, 200);

  /*
    Tags the same way. `array_length` rather than `= '{}'`, because the sheet
    sends an empty array when the box is left alone and that means "none
    given", not "none wanted".
  */
  v_tags := case
    when p_tags is not null and coalesce(array_length(p_tags, 1), 0) > 0 then p_tags
    when jsonb_typeof(v_declared -> 'tags') = 'array'
      then (select array_agg(btrim(t)) from jsonb_array_elements_text(v_declared -> 'tags') t
             where btrim(t) <> '')
    else p_tags
  end;

  -- And the collection, in the same order: the sheet, then what the output
  -- suggested about itself, then nothing.
  v_collection := coalesce(
    nullif(btrim(coalesce(p_collection, '')), ''),
    nullif(btrim(coalesce(v_declared ->> 'suggested_collection', '')), ''));

  insert into public.documents
    (project_id, connector, external_parent_ref, external_ref, title, doc_type, content,
     content_fingerprint, content_chars, fetched_at, origin, state,
     produced_by, produced_by_job)
  values (v_project, 'upload', null, format('output:%s', p_output), v_title, 'note', o.body,
          encode(extensions.digest(o.body, 'sha256'), 'hex'), length(o.body),
          app.now_utc(), 'made', 'draft',
          coalesce(v_author, ''), o.job_id)
  on conflict (project_id, external_ref) where external_ref like 'output:%'
  do update set title = excluded.title
  returning document_id into v_document;

  /*
    Everything after the document goes through `app.approve_document`, exactly
    as it did before — the collection, the tags and the two relations keep
    their own refusals, and this function keeps having one place where a
    document becomes part of the project.

    The first draft of 0417 rewrote this half from memory and invented
    `app.file_in_collection`, `app.tag_document(uuid, text)` and `app.relate`
    with a signature nothing has. It failed on the first real run, which is the
    cheap direction — CLAUDE.md's rule about guessing names, applied to
    functions rather than columns.
  */
  v_meta := app.approve_document(v_document, v_collection, v_tags, p_related_task,
                                 p_related_source);
  if coalesce((v_meta->>'ok')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'document', v_document,
                              'error', v_meta->>'error');
  end if;

  update public.outputs
     set reviewer_status = 'approved', reviewed_by = null, reviewed_at = app.now_utc()
   where output_id = p_output;

  return jsonb_build_object(
    'ok', true, 'document', v_document, 'title', v_title,
    -- Whether the title came from what the output DECLARED rather than from
    -- its first line, so #130's gain is visible rather than inferred.
    'title_from_structure', v_declared ? 'title',
    'collection', v_meta->'collection', 'tags', v_meta->'tags', 'source', v_meta->'source');
end;
$function$;
