-- A file a person dropped into a project vanished from the project until somebody approved it (#411, found as the Sample).
--
-- `app.record_file_document` filed every stored file as a DRAFT, whoever it was from. The Docs surface shows only
-- approved documents (`studio_documents`, #28: an unreviewed OUTPUT is not in the project), and Team HQ has no approve
-- control, so a person who uploaded a budget saw nothing happen: the file was stored, indexed and readable by the team,
-- and absent from the one screen that lists what a project holds. Four of the Sample's seven Wellness documents were in
-- that state, and it read as an upload that had failed.
--
-- The review gate exists to keep the office's own unreviewed work from standing as source material. A file somebody
-- gave the office is not that: it is theirs, there is nobody to review it before they may see it, and 0414 already made
-- the distinction in `origin` ('yours' against 'made'). So a file that is yours is filed approved, and a file the office
-- made still waits as a draft for a person to decide.
--
-- Spliced from the live definition (one token changed, asserted to be found exactly once), then the files already
-- stranded are released: stored files with origin 'yours' that are still drafts. No other state is touched.

begin;

do $do$
declare
  v_def text := pg_get_functiondef('app.record_file_document(uuid,uuid,text,text,text,bigint,text,text,integer,text,uuid,text)'::regprocedure);
  v_old text := 'p_job_id, p_origin, ''draft'')';
  v_new text := 'p_job_id, p_origin, case when p_origin = ''yours'' then ''approved'' else ''draft'' end)';
  v_hits integer := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
begin
  if v_hits <> 1 then
    raise exception 'expected the draft insert exactly once in app.record_file_document, found %', v_hits;
  end if;
  execute replace(v_def, v_old, v_new);
end
$do$;

update public.documents
   set state = 'approved'
 where origin = 'yours' and state = 'draft' and storage_path is not null;

commit;
