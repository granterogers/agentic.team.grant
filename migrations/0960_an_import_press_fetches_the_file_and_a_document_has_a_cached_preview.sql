-- 0960. Two halves of "an external document does not need to be copied to be useful, and an explicit Import makes a
--       durable copy" that 0907 (written as 0900) left open. UNAPPLIED to production; proved only on a local replica.
-- Numbering note (6 Oct 2026): below, "0900" means the documents migration, now 0907 (the Sample's applied 0900 is another).
--
-- 1. THE IMPORT PRESS NOW STARTS THE FETCH. 0900's hq_document_import recorded a request for a Drive file whose text or
--    bytes Team HQ did not hold and then waited for something else to read the file (drive.watch happening to see a
--    change). Nothing started the read, so a press on a quiet folder was pending for ever. The press now enqueues one
--    drive.read_file job (the handler that already exports a Google Doc to text, downloads a binary to the files bucket
--    and calls app.document_import_fulfil). Reading is autonomous (reach 'reads' in src/jobs/containment.ts); WRITING the
--    copy into Team HQ is the person's press already recorded as the request, so a read can never import a document
--    nobody asked for: document_import_fulfil still does nothing without that row.
--      * requested_by is 'hq' (the database saying "the deployment's own plumbing asked", as google_revoke_begin does)
--        and app.internal_root_ok recognises exactly that pair when a request names the document, so the work has an
--        origin and is not 'unknown'.
--      * announce is false: the person pressed a button on a page that shows the state; nothing is messaged.
--      * the idempotency key is live-job scoped, so a second press while the first is running makes no second job and a
--        press after a failure is a retry.
--      * a failed read is RECORDED on the request (attempts, last_error) instead of leaving it pending in silence; the
--        page says why and offers the press again.
--
-- 2. A DOCUMENT CARRIES A CACHED PREVIEW EXCERPT. "Team HQ may cache lightweight derived data (thumbnails, extracted
--    text, preview pages) without copying the full binary." documents.preview_excerpt is the first ~320 characters of
--    the extracted text, whitespace collapsed. It is GENERATED from content (the same sanctioned shape as documents.search
--    and jobs.is_fixture): it cannot disagree with the text it summarises, holds no second copy of the document, and
--    needs no writer. hq_project_documents reports it in the item's thumbnail object so a tile can show real words
--    instead of invented lines. It is NOT a rendered image: nothing here makes a bitmap thumbnail of a PDF or an
--    image, and nothing fetches a provider thumbnail link.

-- ---------------------------------------------------------------------------------------------------------------------
-- 1a. What the request remembers about trying.
-- ---------------------------------------------------------------------------------------------------------------------

alter table public.document_import_requests
  add column attempts        integer     not null default 0,
  add column last_error      text,
  add column last_attempt_at timestamptz,
  add column fetch_job_id    uuid;

comment on column public.document_import_requests.last_error is
  'Why the most recent fetch of this document failed, in words a person can read; cleared when a fetch is started again. Null while no attempt has failed.';
comment on column public.document_import_requests.fetch_job_id is
  'The drive.read_file job the press started, so the page and a proof can name what is doing the work. Not a foreign key: a job is never deleted and this is a pointer for a reader, not a constraint.';

-- ---------------------------------------------------------------------------------------------------------------------
-- 1b. Starting the fetch. Internal: the only caller is hq_document_import, which is a person's press.
-- ---------------------------------------------------------------------------------------------------------------------

create or replace function app.document_import_enqueue_fetch(p_office uuid, p_document uuid)
returns uuid
language plpgsql
security definer
set search_path = 'public', 'pg_catalog'
as $f$
declare
  d      public.documents%rowtype;
  v_mime text;
  v_job  uuid;
begin
  perform app.require_office(p_office);
  select * into d from public.documents where document_id = p_document and office_id = p_office;
  -- Only a Drive file with a place to read it from. Anything else has no read job, and the request stays what 0900 made it.
  if not found or d.connector is distinct from 'drive' or d.origin <> 'source' or d.project_id is null
     or coalesce(btrim(d.external_ref), '') = '' or coalesce(btrim(d.external_parent_ref), '') = '' then
    return null;
  end if;
  -- The request must exist: a fetch is only ever the answer to a recorded press.
  if not exists (select 1 from public.document_import_requests r
                  where r.office_id = p_office and r.document_id = p_document and r.state = 'pending') then
    return null;
  end if;
  -- A metadata row for a Google format has no mime type of its own; the handler asks Drive when this is null.
  v_mime := coalesce(nullif(btrim(d.mime_type), ''), case d.doc_type
              when 'google-doc' then 'application/vnd.google-apps.document'
              when 'google-sheet' then 'application/vnd.google-apps.spreadsheet'
              when 'google-slides' then 'application/vnd.google-apps.presentation'
              else null end);
  begin
    insert into public.jobs
      (office_id, correlation_id, project_id, idempotency_key, kind, requested_by, priority, announce, pinned_config)
    values (p_office, gen_random_uuid(), d.project_id,
            'import-fetch:' || d.document_id::text,
            'drive.read_file', 'hq', 150, false,
            jsonb_strip_nulls(jsonb_build_object(
              'document_id', d.document_id,
              'project_id', d.project_id,
              'folder_id', d.external_parent_ref,
              'file_id', d.external_ref,
              'title', d.title,
              'mime_type', v_mime,
              'import_request', true)))
    returning job_id into v_job;
  exception when unique_violation then
    -- A fetch for this document is already live. That is the answer; a second would only race the first.
    select j.job_id into v_job from public.jobs j
     where j.office_id = p_office and j.idempotency_key = 'import-fetch:' || d.document_id::text
       and j.state not in ('complete', 'cancelled', 'failed');
    return v_job;
  end;
  update public.document_import_requests
     set fetch_job_id = v_job, last_error = null, last_attempt_at = app.now_utc()
   where office_id = p_office and document_id = p_document and state = 'pending';
  return v_job;
end
$f$;

comment on function app.document_import_enqueue_fetch(uuid, uuid) is
  'Starts the read that completes a recorded import request (drive.read_file, announce false, requested_by hq). Does nothing for anything but a pending request on a Drive file with a folder and a file id; at most one live fetch per document.';

-- The handler reports a failed read here, so the request says why it is still pending.
create or replace function app.document_import_note_failure(p_office uuid, p_document uuid, p_error text)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'pg_catalog'
as $f$
declare
  v_n integer;
begin
  perform app.require_office(p_office);
  update public.document_import_requests
     set attempts = attempts + 1,
         last_error = left(coalesce(nullif(btrim(p_error), ''), 'the read failed without saying why'), 300),
         last_attempt_at = app.now_utc()
   where office_id = p_office and document_id = p_document and state = 'pending';
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'noted', v_n > 0);
end
$f$;

comment on function app.document_import_note_failure(uuid, uuid, text) is
  'Records why a fetch for a pending import request failed. Touches only a pending request; a read that nobody asked for has nothing to annotate.';

revoke all on function app.document_import_enqueue_fetch(uuid, uuid), app.document_import_note_failure(uuid, uuid, text)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- 1c. The press starts it. Spliced from the LIVE definition; each splice is asserted to have landed.
-- ---------------------------------------------------------------------------------------------------------------------

do $s$
declare
  v_def text := pg_get_functiondef('app.hq_document_import(uuid, uuid, text)'::regprocedure);
  v_old text := $a$  return jsonb_build_object(
    'ok', true, 'state', 'pending', 'request_id', v_req,
    'needs', case o.connector when 'drive' then 'drive.read_file' else 'source_read' end,
    'note', 'Team HQ does not hold this document''s text or file yet. The import is recorded and completes when the source has been read.');$a$;
  v_new text := $b$  v_job := app.document_import_enqueue_fetch(p_office, o.document_id);
  return jsonb_build_object(
    'ok', true, 'state', 'pending', 'request_id', v_req,
    'needs', case o.connector when 'drive' then 'drive.read_file' else 'source_read' end,
    'fetch_job_id', v_job,
    'note', case when v_job is not null
                 then 'Requested. Team HQ is fetching the file from Drive now; the copy is made when it arrives.'
                 else 'Team HQ does not hold this document''s text or file yet. The import is recorded and completes when the source has been read.' end);$b$;
begin
  if position(v_old in v_def) = 0 then raise exception '0960 splice anchor missing: hq_document_import return'; end if;
  v_def := replace(v_def, v_old, v_new);
  if position('  v_req  uuid;' in v_def) = 0 then raise exception '0960 splice anchor missing: hq_document_import declare'; end if;
  v_def := replace(v_def, '  v_req  uuid;', E'  v_req  uuid;\n  v_job  uuid;');
  if position('document_import_enqueue_fetch' in v_def) = 0 or position('v_job  uuid;' in v_def) = 0 then
    raise exception '0960 hq_document_import splice did not land';
  end if;
  execute v_def;
end
$s$;

-- A job the press started has an origin: the pair (hq, drive.read_file) is the database's own plumbing, but only for a
-- document somebody has a recorded request for. Spliced from the live definition and asserted to have landed.
do $s$
declare
  v text := pg_get_functiondef('app.internal_root_ok(uuid)'::regprocedure);
  v_anchor text := E'      -- app.register_mcp_provider\n';
begin
  if position(v_anchor in v) = 0 then raise exception '0960 splice anchor missing: internal_root_ok'; end if;
  v := replace(v, v_anchor,
    E'      -- app.document_import_enqueue_fetch: the read a person''s recorded Import press started\n'
    || E'      or (j.requested_by = ''hq'' and j.kind = ''drive.read_file'' and exists (\n'
    || E'            select 1 from public.document_import_requests r\n'
    || E'             where r.office_id = j.office_id and r.document_id::text = j.pinned_config ->> ''document_id''))\n'
    || v_anchor);
  if position('app.document_import_enqueue_fetch' in v) = 0 then raise exception '0960 internal_root_ok splice did not land'; end if;
  execute v;
end
$s$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2a. The cached preview excerpt.
-- ---------------------------------------------------------------------------------------------------------------------

alter table public.documents
  add column preview_excerpt text generated always as (
    nullif(left(btrim(regexp_replace(left(coalesce(content, ''), 4000), '\s+', ' ', 'g')), 320), '')
  ) stored;

comment on column public.documents.preview_excerpt is
  'The first ~320 characters of the extracted text, whitespace collapsed: cached, derived, never written. It is what a tile shows instead of a drawn page. Null when no text is held. It is not an image and not a provider thumbnail.';

-- ---------------------------------------------------------------------------------------------------------------------
-- 2b. The list reports it, and why an import is still pending.
-- ---------------------------------------------------------------------------------------------------------------------

do $s$
declare
  v_def text := pg_get_functiondef('app.hq_project_documents(uuid, text, boolean)'::regprocedure);
  v_old text := $a$           'thumbnail', jsonb_build_object(
              'available', false,
              'previewable_from_file', s.storage_path is not null and (coalesce(s.mime_type, '') like 'image/%' or s.mime_type = 'application/pdf'),
              'kind', case when coalesce(s.mime_type, '') like 'image/%' then 'image'
                           when s.mime_type = 'application/pdf' then 'pdf' else null end),$a$;
  v_new text := $b$           'thumbnail', jsonb_build_object(
              'available', s.preview_excerpt is not null,
              'previewable_from_file', s.storage_path is not null and (coalesce(s.mime_type, '') like 'image/%' or s.mime_type = 'application/pdf'),
              'kind', case when coalesce(s.mime_type, '') like 'image/%' then 'image'
                           when s.mime_type = 'application/pdf' then 'pdf'
                           when s.preview_excerpt is not null then 'excerpt' else null end,
              'excerpt', s.preview_excerpt,
              'derived_from', case when s.preview_excerpt is not null then 'extracted_text' else null end),
           'import_error', (select r.last_error from public.document_import_requests r
                             where r.office_id = p_office and r.document_id = s.document_id and r.state = 'pending'),$b$;
begin
  if position(v_old in v_def) = 0 then raise exception '0960 splice anchor missing: hq_project_documents thumbnail'; end if;
  v_def := replace(v_def, v_old, v_new);
  if position('preview_excerpt' in v_def) = 0 then raise exception '0960 hq_project_documents splice did not land'; end if;
  execute v_def;
end
$s$;
