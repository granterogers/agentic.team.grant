-- Rollback of 0639: hq_task_state judges a tick by the task's project alone again (0637's shape).
begin;
do $m$
declare v_def text;
  v_new constant text := 'app.authority_refusal(btrim(p_by), (select b.job_id from public.tasks t join public.blockers b on b.blocker_id = t.satisfies_blocker where t.task_id = v_id), v_project)';
begin
  v_def := pg_get_functiondef('app.hq_task_state(text,text,text,text)'::regprocedure);
  if position(v_new in v_def) = 0 then raise exception 'rollback 0639: 0639 is not applied'; end if;
  execute replace(v_def, v_new, 'app.authority_refusal(btrim(p_by), null, v_project)');
end $m$;
commit;
