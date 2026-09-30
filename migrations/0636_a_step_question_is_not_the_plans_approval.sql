-- 0636 - a question asked INSIDE an approved plan is not the plan's approval (final audit, review F1).
--
-- Answering a generation or plan approval creates the job it approves (`office.execute_plan`,
-- `notebook.generate`), and the new job was given a COPY of the asking job's config - including `approval_next`, the
-- marker that says "answering my question starts the next job". `app.hq_answer_blocker` decides what an answer
-- performs by reading that marker off the job of the blocker being answered, so a STEP question raised inside the
-- approved plan ("Write the summary into Notion?" - by `perform.ts`, on the execute_plan child) was routed to the
-- generation branch. That branch judged the answer by a word list - `yes, do it` is not on it - so a yes was recorded
-- as a decline (`resolution = 'declined'`, `answered_option = 'Yes, do it'`), the paused plan never resumed, and the
-- office told him it was going ahead.
--
-- Three changes, because any one alone leaves a door:
--   1. The job an approval STARTS is the action, not an asker: it does not inherit `approval_next`.
--   3. And a question on a job that an approval started is never read as a generation approval, whatever its config
--      still says: an `office.execute_plan` child created BEFORE this migration still carries `approval_next`, and a
--      yes to its step question would have started a second plan (review R2-5).
--   2. The yes/no of a generation answer is read from the question's own DECLINE option when it has one (the
--      writer recorded it: 0616), not from a list of English words. Only a question with no recorded decline
--      option (older rows) still falls back to the list.
-- Both functions are rebuilt from their LIVE definitions; the migration refuses to apply if an anchor is missing.

do $m$
declare
  v_def text;
  v_old1 constant text := E'         coalesce(v_config, ''{}''::jsonb)\n           || jsonb_build_object(''approved_by'', p_by, ''approval'', p_blocker)';
  v_new1 constant text := E'         (coalesce(v_config, ''{}''::jsonb) - ''approval_next'')\n           || jsonb_build_object(''approved_by'', p_by, ''approval'', p_blocker)';
  v_old2 constant text := E'      lower(v_answer) in (''yes'', ''approve'', ''approved'', ''go ahead'', ''ok'', ''do it''),';
  v_new2 constant text := E'      case when b.decline_option is not null then v_answer <> b.decline_option\n           else lower(v_answer) in (''yes'', ''approve'', ''approved'', ''go ahead'', ''ok'', ''do it'') end,';
  v_old3 constant text := E'  select pinned_config ->> ''approval_next'' into v_next\n    from public.jobs where job_id = b.job_id;\n  if v_next is not null and v_called_off then';
  v_new3 constant text := E'  select case when pinned_config ? ''approval'' then null else pinned_config ->> ''approval_next'' end into v_next\n    from public.jobs where job_id = b.job_id;\n  if v_next is not null and v_called_off then';
begin
  v_def := pg_get_functiondef('app.answer_generation_approval(uuid,boolean,text)'::regprocedure);
  if position(v_old1 in v_def) = 0 then
    raise exception '0636: the child config anchor is not in app.answer_generation_approval';
  end if;
  execute replace(v_def, v_old1, v_new1);

  v_def := pg_get_functiondef('app.hq_answer_blocker(uuid,text,text)'::regprocedure);
  if position(v_old2 in v_def) = 0 or position(v_old3 in v_def) = 0 then
    raise exception '0636: an anchor is not in app.hq_answer_blocker';
  end if;
  execute replace(replace(v_def, v_old2, v_new2), v_old3, v_new3);

  if position('- ''approval_next''' in pg_get_functiondef('app.answer_generation_approval(uuid,boolean,text)'::regprocedure)) = 0
     or position('b.decline_option is not null then v_answer' in pg_get_functiondef('app.hq_answer_blocker(uuid,text,text)'::regprocedure)) = 0
     or position('pinned_config ? ''approval'' then null' in pg_get_functiondef('app.hq_answer_blocker(uuid,text,text)'::regprocedure)) = 0 then
    raise exception '0636: a change did not land';
  end if;
end
$m$;
