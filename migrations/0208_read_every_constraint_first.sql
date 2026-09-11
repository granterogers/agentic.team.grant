-- Read every constraint first.
--
-- Issue #66. `record_file_document` was refused four times, once per attempt,
-- by four different checks:
--
--     connector_matches_origin                  'produced' is not a word
--     documents_content_and_fingerprint_together  '' is not null
--     documents_state_check                     'active' is not a state
--     (and documents_file_is_complete, which I had written myself)
--
-- Each was right. Each cost a deploy, a run and a read. I discovered them one
-- at a time by running into them, when `pg_constraint` would have listed all
-- eight in one query before the first line was written — which is exactly what
-- CLAUDE.md means by *"guessing column names wastes hours. Query
-- information_schema first."* The lesson is not about column names. It is that
-- a table this carefully constrained has already thought about the thing you
-- are about to do.
--
-- The eight, and what they say a file document must be:
--
--   origin           yours | source | made          — 'made', we asked for it
--   connector        NULL when origin is 'made'     — our output is not source
--   content          NULL, with fingerprint NULL    — nobody has read it yet
--   fetched_at       NULL, iff content is NULL      — nothing was fetched INTO it
--   external_parent  only with an external_ref      — both, or neither
--   state            draft | review | approved | archived
--   review           only a 'made' thing may be in review
--   file             path, mime and size together, or none of them
--
-- `state = 'draft'`. Not 'approved', because nobody has listened to it; not
-- 'review', because `only_made_things_await_review` permits it and review means
-- a person is expected to act, which is a queue this does not belong in. Draft
-- is what an unheard file is.

begin;

create or replace function app.record_file_document(
  p_project_id   uuid,
  p_title        text,
  p_storage_path text,
  p_mime_type    text,
  p_byte_size    bigint,
  p_parent_ref   text default null,
  p_external_ref text default null,
  p_duration_s   integer default null,
  p_added_by     text default 'chief-of-staff',
  p_job_id       uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  made public.documents%rowtype;
begin
  if not exists (select 1 from public.projects where project_id = p_project_id) then
    return jsonb_build_object('error', 'no such dashboard project');
  end if;
  if coalesce(p_byte_size, 0) <= 0 then
    return jsonb_build_object('error', 'a file with no bytes is not a file');
  end if;
  -- `documents_external_identity_is_whole`: a parent with no child reference
  -- is a pointer to nothing.
  if p_parent_ref is not null and coalesce(btrim(p_external_ref), '') = '' then
    return jsonb_build_object('error', 'a parent reference needs the artifact reference too');
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
     null,                                  -- origin 'made' forbids a connector
     p_parent_ref, p_external_ref,
     p_storage_path, p_mime_type, p_byte_size, p_duration_s,
     null, null, null,
     -- `documents_fetched_iff_content`: fetched_at means "we pulled TEXT in",
     -- and no text was pulled. The bytes arriving is not the same event.
     null,
     p_added_by, p_added_by, p_job_id, 'made', 'draft')
  returning * into made;

  return jsonb_build_object('document_id', made.document_id, 'already_there', false);
end;
$$;

commit;
