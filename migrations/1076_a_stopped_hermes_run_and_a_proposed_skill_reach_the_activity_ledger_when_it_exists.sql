-- 1076 - Two events the Hermes integration promised the Activity Ledger and 1070 and 1074 did not send (Hermes, M7).
--
-- 1070 mirrors a run's lifecycle through app.engine_mirror, which calls app.record_external_activity ONLY when that door exists (it
-- exists on feature/unified-activity-ledger, migration 1060, and on no other branch) and writes a refusal to engine_runs.ledger_note
-- instead of failing the run. Reading it against the ledger's own contract found two gaps:
--
--   1. A run the office STOPPED (outcome 'cancelled') recorded external.research_started at its first claim and nothing at its end, so the
--      ledger showed a worker that began and never finished. It now records external.worker_error with the sentence "Hermes was stopped
--      before it finished." (idempotency key run:<run>:cancelled, like the other terminal events).
--   2. A skill proposed from a learning run (1074) was never reported. It now records external.skill_proposed with the skill's NAME only
--      (key run:<run>:skill_proposed, so a retry is one event; a run proposes once, 1074). The procedure text is never sent: the ledger
--      holds a reference for a person to review, not the content a model wrote.
--
-- Nothing else changes: no table, no column, no new door, no second ledger. With the door absent, or the ledger off, or the office not
-- covered, both calls do nothing (the door returns null) and the run finishes exactly as before. Spliced from the LIVE definitions, with
-- each anchor asserted.
--
-- ROLLBACK. Restore app.engine_run_finish and app.engine_propose_skill from 1070 and 1074; the two events are simply no longer sent.

do $splice$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('app.engine_run_finish(uuid,uuid,uuid,integer,text,jsonb)'::regprocedure);
  v_new := replace(v_def,
    E'  v_resumed := app.engine_wake(v_run.job_id, ''Hermes '' || p_outcome);',
    E'  if p_outcome = ''cancelled'' then\n    perform app.engine_mirror(p_office, p_run, ''external.worker_error'', ''cancelled'',\n                              ''Hermes was stopped before it finished.'', v_run.job_id, v_run.project_id);\n  end if;\n  v_resumed := app.engine_wake(v_run.job_id, ''Hermes '' || p_outcome);');
  if v_new = v_def then raise exception '1076: engine_run_finish anchor did not land'; end if;
  execute v_new;

  v_def := pg_get_functiondef('app.engine_propose_skill(uuid,uuid,uuid,jsonb)'::regprocedure);
  v_new := replace(v_def,
    E'  return jsonb_build_object(''suggestion_id'', v_id);',
    E'  perform app.engine_mirror(p_office, r.run_id, ''external.skill_proposed'', ''skill_proposed'',\n                            format(''Hermes proposed a skill called "%s" for a person to review.'', left(v_name, 80)), r.job_id, r.project_id);\n  return jsonb_build_object(''suggestion_id'', v_id);');
  if v_new = v_def then raise exception '1076: engine_propose_skill anchor did not land'; end if;
  execute v_new;
end
$splice$;
