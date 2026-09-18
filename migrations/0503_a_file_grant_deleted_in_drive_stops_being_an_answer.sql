/*
  Drive deletions reach the index (the Drive half of the run mandate).

  The settled decision narrows Drive to a ONE-WAY knowledge source — Drive to
  the office, never back — and names what that has to include: *"changes and
  deletions must update the index"*. Deletions did not.

  ## What was actually missing, which is less than it looks

  Almost all of this already existed and none of it needed inventing:

  - `app.record_drive_document` keys on (connector, folder, file id), so a
    re-read UPDATES rather than duplicating, and reports `added` / `changed` /
    `unchanged` off a content fingerprint.
  - `app.reconcile_vanished(connector, parent_ref, seen[])` is a complete,
    connector-agnostic tombstoning mechanism, written for NotebookLM in 0465:
    a blast-radius guard that refuses when more than half a corpus is absent
    (likelier a failed listing than a deletion), a two-strike rule so one bad
    pass cannot hide anything, and the symmetric return path a file that comes
    BACK needs.

  What was missing was a CALLER, and one fact `src/google/drive.ts` could not
  supply. Its own header argues — correctly — that a folder listing is the
  wrong tool for change detection. It is also the only tool for the opposite
  question: **a changes feed cannot tell you what is still there.** A `removed`
  change carries no file object, so there is nothing to attribute to a folder;
  an expired page token loses events permanently; a file trashed while nothing
  was watching produces no change at all. So the office would go on answering
  from a document Grant deleted from Drive weeks ago and nothing could notice.

  `listFolder` supplies the ids; this migration bounds how often it is paid for
  and records what happened.

  ## Why a day

  The changes feed runs every ten minutes and stays the fast path. A listing is
  two hundred rows to notice nothing, so it is the slow backstop: once a day per
  folder, and only for a folder the office actually holds documents for. 0477
  set the same shape for the Slack channel sweep after 740 jobs in twelve hours,
  and the lesson there was that an unbounded retry of an expensive thing is the
  default until somebody bounds it.
*/

alter table public.drive_watch
  add column if not exists last_reconciled_at timestamptz,
  add column if not exists last_reconcile_note text;

comment on column public.drive_watch.last_reconciled_at is
  'When the folder was last LISTED to find deletions the changes feed cannot report. Daily, not every pass.';
comment on column public.drive_watch.last_reconcile_note is
  'What that listing concluded, including a refusal from the blast-radius guard, so a quiet failure is visible.';

/*
  The watcher's reader gains one boolean. Spliced from the live definition
  rather than rewritten -- CLAUDE.md records what rewriting `app.pause_job`
  from memory cost, and this function has a `search_path = ''` and a column
  list a rewrite would be a chance to get wrong.
*/
drop function if exists app.drive_folders_to_check(integer);

create or replace function app.drive_folders_to_check(p_minutes integer default 10)
returns table(
  attachment_id uuid, project_id uuid, project_name text,
  folder_id text, page_token text, primed boolean, reconcile_due boolean)
language sql
stable security definer
set search_path to ''
as $fn$
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
                   where d.connector = 'drive'
                     and d.external_parent_ref = w.folder_id
                     and d.external_ref is not null)
          and (w.last_reconciled_at is null
               or w.last_reconciled_at <= app.now_utc() - interval '1 day')) as reconcile_due
    from public.drive_watch w
    join public.project_attachments a on a.attachment_id = w.attachment_id and a.enabled
    join public.projects p on p.project_id = a.project_id
   where p.status = 'active'
     and not p.is_fixture
     and (w.last_checked_at is null
          or w.last_checked_at <= app.now_utc()
             - make_interval(mins => greatest(coalesce(p_minutes, 10), 1)))
     -- A folder that has failed repeatedly stops being polled and says so,
     -- rather than burning a request every ten minutes for ever.
     and w.failures < 5
   order by w.last_checked_at nulls first
$fn$;

grant execute on function app.drive_folders_to_check(integer) to service_role;

/*
  Reconciling a Drive folder, which is `reconcile_vanished` plus the record of
  having done it.

  The record is not bookkeeping. Without it a listing that the blast-radius
  guard REFUSED is indistinguishable from one that found nothing -- the
  found-nothing shape again, and this time about deletions, where believing a
  false "all present" is exactly the failure the whole mechanism exists to
  prevent. `last_reconcile_note` carries the refusal in words.

  The timestamp is stamped even on a refusal, deliberately. A folder whose
  listing is genuinely half-empty would otherwise be re-listed every ten
  minutes for ever, which is 0477's 740 jobs with a different API at the far
  end.
*/
create or replace function app.drive_reconcile(
  p_attachment uuid, p_folder_id text, p_seen text[], p_error text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
declare v_r jsonb; v_note text;
begin
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

  select app.reconcile_vanished('drive', p_folder_id, coalesce(p_seen, '{}'::text[])) into v_r;

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
$fn$;

grant execute on function app.drive_reconcile(uuid, text, text[], text) to service_role;
