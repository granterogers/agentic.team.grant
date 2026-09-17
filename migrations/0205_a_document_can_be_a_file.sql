-- A document can be a file.
--
-- Issue #9, and the thing #66 is blocked on. Grant:
--
--     "Claire could generate the audio, maybe bring that audio file into the
--      dashboard project, and just directly have the audio file sent to me on
--      Telegram that I can play it directly in Telegram rather than necessarily
--      having to open notebook."
--
-- `documents` can hold TEXT and nothing else: `content`, `content_chars`,
-- `content_fingerprint`. There is no mime type, no size, no bytes and nowhere
-- to say where the bytes are. So an audio overview the office generated has
-- nowhere to live in a dashboard project, and the chain stops at "the notebook
-- has an artifact" — which is exactly the trip to NotebookLM he does not want
-- to make.
--
-- ## The bytes go in Storage, not in the row
--
-- A 4MB audio file base64'd into a text column is 5.4MB of a 500MB database,
-- and `documents` is already the biggest table at 3.6MB. Supabase Storage has a
-- separate 1GB allowance currently at 4%, it streams, and it can hand Telegram
-- a URL rather than an upload. So the row holds the POINTER and the facts about
-- the file; the bucket holds the file.
--
-- ## A private bucket, and why that costs something
--
-- `avatars` and `build` are public because a portrait and a screenshot are not
-- interesting to anyone. A document out of Grant's project is his. So `files`
-- is private, and the consequence is real and worth naming: Telegram cannot
-- fetch a private URL, so sending one means uploading the bytes rather than
-- passing a link. That is the right trade and it is a trade.
--
-- ## `content` stays
--
-- Not replaced — a file document can have BOTH. A transcript of the audio in
-- `content` is what makes it searchable, citable and answerable, and the
-- alternative is a project whose audio files are invisible to every question
-- asked of it.

begin;

insert into storage.buckets (id, name, public, file_size_limit)
values ('files', 'files', false, 104857600)
on conflict (id) do nothing;

alter table public.documents
  add column if not exists storage_path text,
  add column if not exists mime_type    text,
  add column if not exists byte_size    bigint,
  add column if not exists duration_s   integer;

comment on column public.documents.storage_path is
  'Where the bytes are in the `files` bucket. NULL for a text-only document. '
  'The bucket is private: a document out of a dashboard project is Grant''s, '
  'which means Telegram must be sent the bytes rather than a link.';
comment on column public.documents.mime_type is
  'What the file is. Decides how it is sent — audio/* goes as playable audio '
  'rather than as an attachment.';
comment on column public.documents.duration_s is
  'Seconds, for audio and video. Telegram shows it on the player, and "a 24 '
  'minute overview" is the fact that decides whether he presses play.';

/*
  A file document is a file, or it is not one.

  Half a pointer — a path with no mime type, a size with no path — is the state
  that produces a download button that 404s. Enforced rather than trusted,
  because the writer is a handler that could be half-written.
*/
alter table public.documents
  add constraint documents_file_is_complete
    check (
      (storage_path is null and mime_type is null and byte_size is null)
      or (storage_path is not null and mime_type is not null and byte_size > 0)
    );

create index if not exists documents_files
  on public.documents (project_id) where storage_path is not null;

-- ---------------------------------------------------------------------------
-- Recording one
--
-- Idempotent on (project, storage_path): a retried download must not produce a
-- second document, and the artifact it came from is stable enough to key on.
-- ---------------------------------------------------------------------------
create or replace function app.record_file_document(
  p_project_id   uuid,
  p_title        text,
  p_storage_path text,
  p_mime_type    text,
  p_byte_size    bigint,
  p_connector    text default 'notebooklm',
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
    (project_id, title, doc_type, connector, external_ref,
     storage_path, mime_type, byte_size, duration_s,
     content, content_chars, added_by, produced_by, produced_by_job, origin, state)
  values
    (p_project_id, p_title, 'file', p_connector, p_external_ref,
     p_storage_path, p_mime_type, p_byte_size, p_duration_s,
     -- Empty, not null: `content` is NOT NULL and a file has no text until
     -- something transcribes it. The column stays because a transcript is what
     -- makes an audio file answerable, and a project whose audio is invisible
     -- to every question is a project that has filed it, not kept it.
     '', 0, p_added_by, p_added_by, p_job_id, 'produced', 'active')
  returning * into made;

  return jsonb_build_object('document_id', made.document_id, 'already_there', false);
end;
$$;

comment on function app.record_file_document is
  'Put a file into a dashboard project (#9, #66). Idempotent on the storage '
  'path, so a retried download does not produce a second document.';

create or replace function public.record_file_document(
  p_project_id uuid, p_title text, p_storage_path text, p_mime_type text,
  p_byte_size bigint, p_connector text default 'notebooklm',
  p_external_ref text default null, p_duration_s integer default null,
  p_added_by text default 'chief-of-staff', p_job_id uuid default null
)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.record_file_document(p_project_id, p_title, p_storage_path,
     p_mime_type, p_byte_size, p_connector, p_external_ref, p_duration_s,
     p_added_by, p_job_id) $$;

commit;
