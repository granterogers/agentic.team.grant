-- A file has no text yet, and the schema already knew that.
--
-- Issue #66. 0206 wrote `content = ''` with no fingerprint, reasoning in a
-- comment that `content` was NOT NULL. It is not:
--
--     CHECK ((content IS NULL) = (content_fingerprint IS NULL))
--
-- The rule is that the two travel together — text and the hash that says which
-- text — and both are nullable. So a document with no text is `content = null`
-- and `content_fingerprint = null`, which is exactly what an audio file is
-- until something transcribes it.
--
-- I asserted a NOT NULL that was not there and then wrote a comment justifying
-- the workaround. The empty string was worse than wrong: `content = ''` says
-- "this document has been read and it is empty", where NULL says "nobody has
-- read this yet". A search over documents would have found an audio overview
-- and returned nothing from it, as a fact rather than as a gap.
--
-- Third constraint to refuse this insert, and all three were right. The
-- schema has been more careful than I was.

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

  select * into made from public.documents
   where project_id = p_project_id and storage_path = p_storage_path;
  if found then
    return jsonb_build_object('document_id', made.document_id, 'already_there', true);
  end if;

  insert into public.documents
    (project_id, title, doc_type, connector, external_parent_ref, external_ref,
     storage_path, mime_type, byte_size, duration_s,
     content, content_fingerprint, content_chars,
     added_by, produced_by, produced_by_job, origin, state)
  values
    (p_project_id, p_title, 'file', null, p_parent_ref, p_external_ref,
     p_storage_path, p_mime_type, p_byte_size, p_duration_s,
     /*
       NULL, not ''.

       `content = ''` claims the document was read and found empty; NULL says
       nobody has read it yet. For an audio file the second is true, and the
       difference matters the first time a question is asked of the project:
       an empty string is a confident answer of nothing.

       The fingerprint travels with it — that is what the constraint enforces —
       and both fill in when a transcript arrives.
     */
     null, null, null,
     p_added_by, p_added_by, p_job_id, 'made', 'active')
  returning * into made;

  return jsonb_build_object('document_id', made.document_id, 'already_there', false);
end;
$$;

commit;
