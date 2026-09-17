-- A renamed file keeps its old name for ever (#257).
--
-- `app.record_file_document` finds an existing row by storage path and returns
-- `already_there: true` WITHOUT touching it. So a file renamed in Drive keeps
-- the title it had when the office first read it, and Grant searching for its
-- new name finds nothing — which is #257's original complaint in a different
-- costume: he asks about a document that is definitely there and is told it is
-- not.
--
-- #257's acceptance criteria list it plainly: *"Updates, renames and deletions
-- reconcile correctly."* Content updates already do — editing re-indexes and
-- the old text stops matching. Renames never have.
--
-- ## Whose name wins
--
-- Not simply the source's. `app.rename_document` (0312) lets Grant rename a
-- document in the dashboard, with an undo — so overwriting on every re-read
-- would silently undo something he did, which is the rule this repository
-- states about reversals: *"an undo must not take back what the person did in
-- between."*
--
-- So the office remembers what the SOURCE last called it. Then:
--
--   * the source renames it and Grant never touched it -> the new name wins;
--   * Grant renamed it -> his name stays, and the source's new name is
--     recorded so nothing is lost and a future reader can see they differ.
--
-- `source_title` is not derivable from anything — it is a fact about an
-- external system at a moment in time — so 0310's rule about not storing what
-- you can read does not apply.
--
-- ## Deletion is deliberately NOT part of this
--
-- A file disappearing from Drive is not the same event as Grant wanting it
-- gone from his project, and deciding that the office deletes its copy because
-- somebody cleared out a shared folder is a product decision, not a migration.
-- Recorded on the Issue rather than guessed at here.

alter table public.documents
  add column if not exists source_title text;

comment on column public.documents.source_title is
  'What the CONNECTOR last called this document. Null for anything the office '
  'made or Grant uploaded. Compared on re-read so an upstream rename can be '
  'applied without undoing a rename Grant made himself.';

/*
  Backfill: for everything that came from a connector, the stored title IS what
  the source last said — nothing has ever changed it from the source side,
  because nothing could.
*/
update public.documents
   set source_title = title
 where source_title is null
   and origin = 'source'
   and connector is not null;

create or replace function app.record_file_document(
  p_project_id uuid, p_title text, p_storage_path text, p_mime_type text,
  p_byte_size bigint, p_parent_ref text default null, p_external_ref text default null,
  p_duration_s integer default null, p_added_by text default 'chief-of-staff',
  p_job_id uuid default null, p_origin text default 'made')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  made public.documents%rowtype;
  v_renamed boolean := false;
  v_kept boolean := false;
begin
  if not exists (select 1 from public.projects where project_id = p_project_id) then
    return jsonb_build_object('error', 'no such dashboard project');
  end if;
  if coalesce(p_byte_size, 0) <= 0 then
    return jsonb_build_object('error', 'a file with no bytes is not a file');
  end if;
  if p_parent_ref is not null and coalesce(btrim(p_external_ref), '') = '' then
    return jsonb_build_object('error', 'a parent reference needs the artifact reference too');
  end if;
  if p_origin is null or p_origin not in ('made', 'yours') then
    return jsonb_build_object(
      'error', format('a stored file is either yours or made here, not %L', p_origin));
  end if;

  select * into made from public.documents
   where project_id = p_project_id and storage_path = p_storage_path;
  if found then
    /*
      Already here — and possibly renamed upstream since.

      The comparison is against `source_title`, never against `title`: the
      question is not "does the office call it something else" but "has the
      SOURCE started calling it something else", and those differ exactly when
      Grant has renamed it himself.
    */
    if coalesce(made.source_title, '') is distinct from coalesce(p_title, '') then
      v_renamed := true;
      -- Grant's own rename is anything that no longer matches what the source
      -- last said. His wins; the source's new name is still written down.
      v_kept := coalesce(made.title, '') is distinct from coalesce(made.source_title, '');

      update public.documents
         set source_title = p_title,
             title = case when v_kept then title else p_title end,
             updated_at = app.now_utc()
       where document_id = made.document_id;
    end if;

    return jsonb_build_object(
      'document_id', made.document_id, 'already_there', true,
      'renamed_at_source', v_renamed,
      'kept_your_name', v_kept,
      'title', case when v_renamed and not v_kept then p_title else made.title end);
  end if;

  insert into public.documents
    (project_id, title, source_title, doc_type, connector, external_parent_ref, external_ref,
     storage_path, mime_type, byte_size, duration_s,
     content, content_fingerprint, content_chars,
     fetched_at,
     added_by, produced_by, produced_by_job, origin, state)
  values
    (p_project_id, p_title,
     case when p_origin = 'yours' then p_title else null end,
     'file', 'upload',
     p_parent_ref, p_external_ref,
     p_storage_path, p_mime_type, p_byte_size, p_duration_s,
     null, null, null,
     null,
     p_added_by,
     case when p_origin = 'made' then p_added_by else null end,
     p_job_id, p_origin, 'draft')
  returning * into made;

  return jsonb_build_object('document_id', made.document_id, 'already_there', false);
end;
$fn$;
