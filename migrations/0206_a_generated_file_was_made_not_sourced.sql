-- A generated file was MADE, not sourced.
--
-- Issue #66. 0205's `record_file_document` wrote `origin = 'produced'` with
-- `connector = 'notebooklm'` and the constraint refused it:
--
--     new row for relation "documents" violates check
--     constraint "connector_matches_origin"
--
-- Two mistakes in one line, and only the first is a typo.
--
-- **`produced` is not a word this column knows.** The vocabulary is `source`,
-- `yours`, `made`. I invented a fourth without reading the constraint — the
-- third variant of CLAUDE.md's "guessing wastes hours" this week: right table,
-- right column, invented VALUE.
--
-- **And the right word is `made`, which forbids a connector.** That is the
-- constraint being right rather than in the way. An audio overview the office
-- asked NotebookLM to generate is NOT source material: it is something we made.
-- Filing it as `source` would have put it in the pool of evidence the office
-- reasons from, and 0169 exists because exactly that already happened once —
-- *"a document we wrote into a connector is not new material."* This is the
-- same error pointed the other way, and the constraint caught it.
--
-- So: `made`, no connector, and the provenance goes where provenance goes —
-- `external_parent_ref` for the notebook it came out of, `external_ref` for the
-- artifact, `produced_by` and `produced_by_job` for who and which job.

begin;

drop function if exists app.record_file_document(uuid, text, text, text, bigint, text, text, integer, text, uuid);
drop function if exists public.record_file_document(uuid, text, text, text, bigint, text, text, integer, text, uuid);

create or replace function app.record_file_document(
  p_project_id   uuid,
  p_title        text,
  p_storage_path text,
  p_mime_type    text,
  p_byte_size    bigint,
  -- The notebook, Drive folder or Notion page it came OUT of. Not a connector
  -- grant — see the header — just where to look for the original.
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
     content, content_chars, added_by, produced_by, produced_by_job, origin, state)
  values
    (p_project_id, p_title, 'file',
     -- NULL, and the constraint requires it: `made` means we made this, and a
     -- connector here would file our own output as source material.
     null,
     p_parent_ref, p_external_ref,
     p_storage_path, p_mime_type, p_byte_size, p_duration_s,
     '', 0, p_added_by, p_added_by, p_job_id, 'made', 'active')
  returning * into made;

  return jsonb_build_object('document_id', made.document_id, 'already_there', false);
end;
$$;

comment on function app.record_file_document is
  'Put a file the office MADE into a dashboard project (#9, #66). origin = '
  '''made'' with no connector: an audio overview we asked for is not source '
  'material, and filing it as one would put our own output into the evidence '
  'the office reasons from — 0169''s mistake, pointed the other way.';

create or replace function public.record_file_document(
  p_project_id uuid, p_title text, p_storage_path text, p_mime_type text,
  p_byte_size bigint, p_parent_ref text default null,
  p_external_ref text default null, p_duration_s integer default null,
  p_added_by text default 'chief-of-staff', p_job_id uuid default null
)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.record_file_document(p_project_id, p_title, p_storage_path,
     p_mime_type, p_byte_size, p_parent_ref, p_external_ref, p_duration_s,
     p_added_by, p_job_id) $$;

commit;
