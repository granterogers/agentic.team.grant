-- 0801 - Drive watching and reconciliation take an office (multi-user P3, wave 2, cluster i-integrations2, part 2 of 5).
--
-- Before: the folder poll (drive_folders_to_check) listed every office's watched folders; drive_watch_checked and
-- drive_reconcile took an attachment id and wrote it whoever owned it; reconcile_vanished archived every document
-- holding a (connector, parent) pair whatever office held it - a Drive folder id is the same string in two offices if
-- two people share a folder, so one office's listing could mark, archive or restore the other's documents;
-- record_drive_document looked a file up by (folder, file) alone and then UPDATED the row it found, which would be the
-- other office's; attach_file_to_document named the other holder's document id in its refusal.
--
-- Now each takes `p_office uuid` FIRST, with no default. A folder, an attachment, a project or a document of another
-- office is indistinguishable from one that does not exist: the same sentence. The folder poll is per office - the
-- duty loops the offices - so its answer is one office's folders.
--
-- Global key, reported and not rebuilt (recipe section 6): documents_one_per_external_ref is unique on
-- (connector, external_parent_ref, external_ref), so two offices can never HOLD the same Drive file. A second office's
-- insert of a file the first holds is refused with the same words as any failed record, and the first office's row is
-- never touched. That is a P2 follow-up (widen the index with office_id).
--
-- app.attach_drive_folder already has its office-explicit overload (0711); the legacy ones are dropped here.

create function app.drive_folders_to_check(p_office uuid, p_minutes integer default 10)
 returns table(attachment_id uuid, project_id uuid, project_name text, folder_id text, page_token text, primed boolean, reconcile_due boolean)
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
begin
  perform app.require_office(p_office);
  return query
  select w.attachment_id, a.project_id, p.name, w.folder_id, w.page_token, w.primed,
         /*
           Due only when there is something to reconcile AGAINST.
           A folder the office has never imported from holds no documents, so a
           listing could only ever conclude "nothing is missing" -- the
           found-nothing shape, paid for with two hundred rows a day. The
           EXISTS is what keeps the backstop proportionate to the corpus rather
           than to the number of folders attached.
         */
         (exists (select 1 from public.documents d
                   where d.office_id = p_office
                     and d.connector = 'drive'
                     and d.external_parent_ref = w.folder_id
                     and d.external_ref is not null)
          and (w.last_reconciled_at is null
               or w.last_reconciled_at <= app.now_utc() - interval '1 day')) as reconcile_due
    from public.drive_watch w
    join public.project_attachments a on a.attachment_id = w.attachment_id and a.enabled
    join public.projects p on p.project_id = a.project_id and p.office_id = p_office
   where p.status = 'active'
     and not p.is_fixture
     and (w.last_checked_at is null
          or w.last_checked_at <= app.now_utc()
             - make_interval(mins => greatest(coalesce(p_minutes, 10), 1)))
     -- A folder that has failed repeatedly stops being polled and says so,
     -- rather than burning a request every ten minutes for ever.
     and w.failures < 5
   order by w.last_checked_at nulls first;
end;
$function$;
revoke all on function app.drive_folders_to_check(uuid, integer) from public, anon, authenticated, service_role;

create function app.drive_watch_checked(p_office uuid, p_attachment_id uuid, p_page_token text, p_saw_changes boolean default false, p_error text default null)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  perform app.require_office(p_office);
  update public.drive_watch w
     set page_token      = coalesce(p_page_token, w.page_token),
         primed          = w.primed or p_page_token is not null,
         last_checked_at = app.now_utc(),
         last_change_at  = case when p_saw_changes then app.now_utc() else w.last_change_at end,
         failures        = case when p_error is null then 0 else w.failures + 1 end,
         last_error      = p_error,
         updated_at      = app.now_utc()
   where w.attachment_id = p_attachment_id
     and exists (select 1
                   from public.project_attachments a
                   join public.projects p on p.project_id = a.project_id and p.office_id = p_office
                  where a.attachment_id = w.attachment_id);
end;
$function$;
revoke all on function app.drive_watch_checked(uuid, uuid, text, boolean, text) from public, anon, authenticated, service_role;

create function app.reconcile_vanished(p_office uuid, p_connector text, p_parent_ref text, p_seen text[], p_limit_fraction numeric default 0.5)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_held int;
  v_absent int;
  v_marked int := 0;
  v_archived int := 0;
  v_returned int := 0;
  v_restored int := 0;
begin
  perform app.require_office(p_office);
  if coalesce(btrim(p_connector), '') = '' or coalesce(btrim(p_parent_ref), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'a connector and a parent are required');
  end if;

  select count(*) into v_held from public.documents
   where office_id = p_office and connector = p_connector and external_parent_ref = p_parent_ref;

  select count(*) into v_absent from public.documents
   where office_id = p_office and connector = p_connector and external_parent_ref = p_parent_ref
     and external_ref is not null
     and not (external_ref = any (coalesce(p_seen, '{}'::text[])));

  -- The blast radius, checked BEFORE anything is written, so a refusal cannot
  -- leave half the marks behind for the next pass to act on.
  if v_held > 0 and v_absent::numeric / v_held::numeric > p_limit_fraction then
    return jsonb_build_object(
      'ok', false, 'refused', true, 'held', v_held, 'absent', v_absent,
      'error', format(
        '%s of %s sources are missing from this listing, which is more than the %s%% this may act on. '
        'That is likelier to be a failed listing than a deletion, so nothing was changed.',
        v_absent, v_held, round(p_limit_fraction * 100)));
  end if;

  /*
    Back from the dead: seen again, and archived by THIS mechanism.

    Counted separately from an ordinary return, because "a file came back" and
    "a file we had hidden came back and is answerable again" are different
    events and the second is the one worth a sentence.
  */
  update public.documents
     set state = 'approved', missing_since = null
   where office_id = p_office and connector = p_connector and external_parent_ref = p_parent_ref
     and external_ref = any (coalesce(p_seen, '{}'::text[]))
     and missing_since is not null
     and coalesce(state, '') = 'archived';
  get diagnostics v_restored = row_count;

  -- Anything else that came back simply stops being missing.
  update public.documents
     set missing_since = null
   where office_id = p_office and connector = p_connector and external_parent_ref = p_parent_ref
     and missing_since is not null
     and external_ref = any (coalesce(p_seen, '{}'::text[]));
  get diagnostics v_returned = row_count;

  -- Strike two: already missing at an earlier pass, and still missing.
  update public.documents
     set state = 'archived'
   where office_id = p_office and connector = p_connector and external_parent_ref = p_parent_ref
     and external_ref is not null
     and not (external_ref = any (coalesce(p_seen, '{}'::text[])))
     and missing_since is not null
     and coalesce(state, '') <> 'archived';
  get diagnostics v_archived = row_count;

  -- Strike one: absent for the first time. Marked, never hidden.
  update public.documents
     set missing_since = app.now_utc()
   where office_id = p_office and connector = p_connector and external_parent_ref = p_parent_ref
     and external_ref is not null
     and not (external_ref = any (coalesce(p_seen, '{}'::text[])))
     and missing_since is null;
  get diagnostics v_marked = row_count;

  return jsonb_build_object(
    'ok', true, 'held', v_held, 'absent', v_absent,
    'marked', v_marked, 'archived', v_archived,
    'returned', v_returned, 'restored', v_restored);
end;
$function$;
revoke all on function app.reconcile_vanished(uuid, text, text, text[], numeric) from public, anon, authenticated, service_role;

create function app.drive_reconcile(p_office uuid, p_attachment uuid, p_folder_id text, p_seen text[], p_error text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_catalog'
as $function$
declare v_r jsonb; v_note text;
begin
  perform app.require_office(p_office);
  -- A folder that is not this office's is a folder that is not there: one sentence for both.
  if not exists (select 1
                   from public.drive_watch w
                   join public.project_attachments a on a.attachment_id = w.attachment_id
                   join public.projects p on p.project_id = a.project_id and p.office_id = p_office
                  where w.attachment_id = p_attachment) then
    return jsonb_build_object('ok', false, 'error', 'no such folder');
  end if;
  if p_error is not null then
    /*
      A listing that failed is NOT an empty folder, and handing `{}` to
      `reconcile_vanished` would say every document in it had been deleted.
      The guard would refuse that -- and relying on a guard to catch a caller's
      own mistake is how a guard comes to be the only thing standing between a
      failed request and a wiped corpus.
    */
    update public.drive_watch
       set last_reconciled_at = app.now_utc(),
           last_reconcile_note = left('could not list the folder: ' || p_error, 400)
     where attachment_id = p_attachment;
    return jsonb_build_object('ok', false, 'error', p_error);
  end if;
  select app.reconcile_vanished(p_office, 'drive', p_folder_id, coalesce(p_seen, '{}'::text[])) into v_r;
  v_note := case
    when coalesce((v_r ->> 'ok')::boolean, false) = false
      then left(coalesce(v_r ->> 'error', 'reconcile refused'), 400)
    else format('%s held, %s absent; marked %s, archived %s, returned %s, restored %s',
                v_r ->> 'held', v_r ->> 'absent', v_r ->> 'marked',
                v_r ->> 'archived', v_r ->> 'returned', v_r ->> 'restored')
  end;
  update public.drive_watch
     set last_reconciled_at = app.now_utc(),
         last_reconcile_note = v_note
   where attachment_id = p_attachment;
  return v_r || jsonb_build_object('note', v_note);
end;
$function$;
revoke all on function app.drive_reconcile(uuid, uuid, text, text[], text) from public, anon, authenticated, service_role;

create function app.record_drive_document(p_office uuid, p_project_id uuid, p_folder_id text, p_file_id text, p_title text, p_content text default null::text, p_added_by text default 'chief-of-staff'::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_id          uuid;
  v_was         text;
  v_content     text := nullif(btrim(coalesce(p_content, '')), '');
  v_fingerprint text;
  v_outcome     text;
begin
  perform app.require_office(p_office);
  if p_project_id is null or coalesce(btrim(p_file_id), '') = ''
     or coalesce(btrim(p_folder_id), '') = '' then
    return jsonb_build_object(
      'ok', false, 'error', 'a project, a folder and a file id are all needed');
  end if;
  if not exists (select 1 from public.projects where project_id = p_project_id and office_id = p_office) then
    return jsonb_build_object('ok', false, 'error', 'no such project');
  end if;

  if v_content is not null then
    v_fingerprint := encode(extensions.digest(v_content, 'sha256'), 'hex');
  end if;

  select document_id, content_fingerprint into v_id, v_was
    from public.documents
   where office_id = p_office
     and connector = 'drive'
     and external_parent_ref = p_folder_id
     and external_ref = p_file_id;

  if v_id is null then
    begin
      insert into public.documents
        (office_id, project_id, connector, external_parent_ref, external_ref, title, doc_type,
         content, content_fingerprint, content_chars, fetched_at, origin, added_by)
      values
        (p_office, p_project_id, 'drive', p_folder_id, p_file_id,
         coalesce(nullif(btrim(p_title), ''), 'Untitled'), 'file',
         v_content, v_fingerprint,
         case when v_content is null then null else length(v_content) end,
         case when v_content is null then null else app.now_utc() end,
         'source', p_added_by)
      returning document_id into v_id;
    exception when unique_violation then
      -- A file another office already holds (the key is global, reported): the same words as any failed record.
      return jsonb_build_object('ok', false, 'error', 'that file could not be recorded');
    end;
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
       where document_id = v_id and office_id = p_office;
      v_outcome := 'changed';
    else
      update public.documents
         set title = coalesce(nullif(btrim(p_title), ''), title)
       where document_id = v_id and office_id = p_office;
      v_outcome := 'unchanged';
    end if;
  end if;

  return jsonb_build_object(
    'ok', true, 'document', v_id, 'outcome', v_outcome,
    'has_text', v_content is not null);
end;
$function$;
revoke all on function app.record_drive_document(uuid, uuid, text, text, text, text, text) from public, anon, authenticated, service_role;

create function app.attach_file_to_document(p_office uuid, p_document_id uuid, p_storage_path text, p_mime_type text, p_byte_size bigint)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_title    text;
  v_existing text;
  v_project  uuid;
  v_owner    uuid;
begin
  perform app.require_office(p_office);
  select title, storage_path, project_id
    into v_title, v_existing, v_project
    from public.documents where document_id = p_document_id and office_id = p_office;
  if v_title is null then
    return jsonb_build_object('ok', false, 'error', 'no such document');
  end if;

  /*
    Idempotent on the path, the way `record_file_document` is.

    A re-read of the same Drive file lands on the same object — `x-upsert` sees
    to that on the storage side — so arriving here twice is the normal case,
    not an error. Answering `already_there` lets a caller retry freely.
  */
  if v_existing is not distinct from p_storage_path then
    return jsonb_build_object(
      'ok', true, 'already_there', true, 'document', p_document_id, 'title', v_title);
  end if;

  if coalesce(btrim(p_storage_path), '') = '' or coalesce(btrim(p_mime_type), '') = ''
     or coalesce(p_byte_size, 0) <= 0 then
    -- `documents_file_is_complete` would refuse this too. Said in words here
    -- because a caller reading "violates check constraint" learns nothing
    -- about which of the three it forgot.
    return jsonb_build_object(
      'ok', false,
      'error', 'a file needs all three of a path, a mime type and a size above zero');
  end if;

  /*
    One document per object.

    Two rows pointing at the same bytes would make deleting either one a
    question nobody wants to answer, and the path is derived from the
    connector's own file id, so a collision means two documents claim to be the
    same file. Worth refusing loudly. Looked for inside the office only: the
    refusal names a document, and it must never name another office's.
  */
  select document_id into v_owner
    from public.documents
   where storage_path = p_storage_path and document_id <> p_document_id and office_id = p_office;
  if v_owner is not null then
    return jsonb_build_object(
      'ok', false, 'error', format('another document already holds that file (%s)', v_owner));
  end if;

  /*
    Only the three file columns.

    `content`, `origin`, `connector`, `doc_type`, `state` and every other
    column are left exactly as they were: this is a document that gained a
    file, not a file that gained a document. The extracted text stays the
    readable half, and the reader falls through to it whenever the browser
    cannot render the bytes.
  */
  update public.documents
     set storage_path = p_storage_path,
         mime_type    = p_mime_type,
         byte_size    = p_byte_size
   where document_id = p_document_id and office_id = p_office;

  return jsonb_build_object(
    'ok', true, 'document', p_document_id, 'title', v_title,
    'project_id', v_project, 'bytes', p_byte_size);
end;
$function$;
revoke all on function app.attach_file_to_document(uuid, uuid, text, text, bigint) from public, anon, authenticated, service_role;

-- the old signatures go
drop function public.reconcile_vanished(text, text, text[], numeric);
drop function public.record_drive_document(uuid, text, text, text, text, text);
drop function public.attach_file_to_document(uuid, text, text, bigint);
drop function public.attach_drive_folder(uuid, text, text, text);
drop function app.attach_drive_folder(uuid, text, text, text);
drop function app.drive_reconcile(uuid, text, text[], text);
drop function app.reconcile_vanished(text, text, text[], numeric);
drop function app.drive_folders_to_check(integer);
drop function app.drive_watch_checked(uuid, text, boolean, text);
drop function app.record_drive_document(uuid, text, text, text, text, text);
drop function app.attach_file_to_document(uuid, text, text, bigint);
