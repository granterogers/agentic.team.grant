begin;

/**
 * A Drive file becomes a document.
 *
 * Issue #96, and the honesty half of #51.
 *
 * ## The claim that was not true
 *
 * `connector_capabilities` has said this since 0300:
 *
 *     drive | read a file's text | the text | api | job kind drive.watch
 *           | verified_by: suite | last_verified: 2026-09-12
 *
 * There is no such code. `src/google/drive.ts` had exactly three network
 * functions — a start token, a changes feed, and a scope check — and none of
 * them fetches content. `drive.watch` sees a file appear and raises a question
 * with four options, of which *"Add them to the project as source documents"*
 * was implemented by nothing.
 *
 * That is the `web.search` trap (0298) with a worse detail: this row says
 * `verified_by: 'suite'`. A row claiming a capability is one thing; a row
 * claiming it was TESTED is what makes an agent confident about it. Every
 * connector sheet has been telling all eight of them the office can read a
 * Drive file, and CLAUDE.md records what that costs — being told YES about
 * something impossible costs the work, silently, and Grant finds out when
 * nothing arrives.
 *
 * The remedy here is implementation rather than retraction: `drive.readonly`
 * ALREADY permits `files.get?alt=media` and `files.export` — readonly
 * restricts writes, not downloads — so the claim needed a function, not a
 * reconsent.
 *
 * ## Keyed on the folder AND the file, because null is not equal to null
 *
 * `documents_one_per_external_ref` is unique on `(connector,
 * external_parent_ref, external_ref)` where the ref is not null. Leaving the
 * parent null would make two nulls DISTINCT and let the same Drive file become
 * two documents — which is exactly what #28 spent five migrations discovering
 * about imported outputs. So the Drive FOLDER is the parent ref: it makes the
 * index bite, and it is what the file's parent actually is.
 *
 * ## Text or bytes, never both, and the constraints say so
 *
 * A Google Doc exports to text and has no bytes. A PDF downloads to bytes and
 * has no text, because nothing in this repository parses PDFs server-side.
 * Three constraints make that shape mandatory rather than a choice:
 *
 *   - `documents_content_and_fingerprint_together` — content and fingerprint
 *     are null together;
 *   - `documents_fetched_iff_content` — so is `fetched_at`, which reads oddly
 *     for a file we plainly did fetch, and is right: the column is about when
 *     the TEXT was read;
 *   - `connector_matches_origin` — `origin = 'source'` demands a connector,
 *     which a Drive file has.
 *
 * The bytes are attached separately by `app.attach_file_to_document` (0331),
 * so a file that gains text later, or text that gains its file later, both
 * work without either writer knowing about the other.
 */

create or replace function app.record_drive_document(
  p_project_id uuid,
  p_folder_id text,
  p_file_id text,
  p_title text,
  p_content text default null,
  p_added_by text default 'chief-of-staff')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_id          uuid;
  v_was         text;
  v_content     text := nullif(btrim(coalesce(p_content, '')), '');
  v_fingerprint text;
  v_outcome     text;
begin
  if p_project_id is null or coalesce(btrim(p_file_id), '') = ''
     or coalesce(btrim(p_folder_id), '') = '' then
    return jsonb_build_object(
      'ok', false, 'error', 'a project, a folder and a file id are all needed');
  end if;
  if not exists (select 1 from public.projects where project_id = p_project_id) then
    return jsonb_build_object('ok', false, 'error', 'no such project');
  end if;

  if v_content is not null then
    v_fingerprint := encode(extensions.digest(v_content, 'sha256'), 'hex');
  end if;

  select document_id, content_fingerprint into v_id, v_was
    from public.documents
   where connector = 'drive'
     and external_parent_ref = p_folder_id
     and external_ref = p_file_id;

  if v_id is null then
    insert into public.documents
      (project_id, connector, external_parent_ref, external_ref, title, doc_type,
       content, content_fingerprint, content_chars, fetched_at, origin, added_by)
    values
      (p_project_id, 'drive', p_folder_id, p_file_id,
       coalesce(nullif(btrim(p_title), ''), 'Untitled'), 'file',
       v_content, v_fingerprint,
       case when v_content is null then null else length(v_content) end,
       case when v_content is null then null else app.now_utc() end,
       'source', p_added_by)
    returning document_id into v_id;
    v_outcome := 'added';
  else
    /*
      An unchanged file is left alone rather than re-stamped.

      `upsertSource` makes the same distinction and for the same reason: a
      re-read that reports "changed" makes everything downstream re-brief, and
      a folder polled every ten minutes would re-brief on every pass. The
      fingerprint is over the text we actually store, so it only moves when the
      text does.
    */
    if v_content is not null and v_fingerprint is distinct from v_was then
      update public.documents
         set title = coalesce(nullif(btrim(p_title), ''), title),
             content = v_content,
             content_fingerprint = v_fingerprint,
             content_chars = length(v_content),
             fetched_at = app.now_utc()
       where document_id = v_id;
      v_outcome := 'changed';
    else
      update public.documents
         set title = coalesce(nullif(btrim(p_title), ''), title)
       where document_id = v_id;
      v_outcome := 'unchanged';
    end if;
  end if;

  return jsonb_build_object(
    'ok', true, 'document', v_id, 'outcome', v_outcome,
    'has_text', v_content is not null);
end;
$$;

comment on function app.record_drive_document is
  '#96. Create or refresh the document for one Drive file. Parented on the '
  'FOLDER id so documents_one_per_external_ref actually bites — a null parent '
  'makes two nulls distinct and lets one file become two documents, which is '
  'what #28 spent five migrations learning. Text only; bytes are attached by '
  'app.attach_file_to_document. 0332.';

create or replace function public.record_drive_document(
  p_project_id uuid, p_folder_id text, p_file_id text, p_title text,
  p_content text default null, p_added_by text default 'chief-of-staff')
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.record_drive_document(
  p_project_id, p_folder_id, p_file_id, p_title, p_content, p_added_by) $$;

grant execute on function app.record_drive_document(uuid, text, text, text, text, text) to ai_team_app;
grant execute on function public.record_drive_document(uuid, text, text, text, text, text) to ai_team_app;

-- ---------------------------------------------------------------------------
-- The registry stops overclaiming, and starts claiming the right thing
-- ---------------------------------------------------------------------------

/*
  Two corrections, and the second is the one that matters.

  The verb was "read a file's text", which is true of a Google Doc and false of
  a PDF — a PDF has no text to read without a parser this repository does not
  have. The office reads a Drive file: text where Drive can export text, the
  file itself where it cannot.

  And `verified_by` goes back to 'declared' until a suite has actually driven
  it. 0300 marked it 'suite' for code that did not exist, which is how a claim
  becomes confident rather than merely wrong. `verify:files` sets it to
  'suite' by running it, and until then this row says what it is.
*/
update public.connector_capabilities
   set verb = 'read a file — its text where Drive can export text, the file itself where it cannot',
       returns = 'the text, or the bytes in the office''s own storage',
       used_by = 'job kind drive.read_file',
       verified_by = 'declared',
       last_verified = null
 where connector = 'drive' and verb = 'read a file''s text';

commit;
