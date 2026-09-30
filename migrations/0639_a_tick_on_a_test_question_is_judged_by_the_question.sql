-- 0639 - a to-do that stands for a question is judged by the question's job (found by run2-live after 0637).
--
-- 0637 made `app.hq_task_state` ask `app.authority_refusal` about the named principal, passing the task's PROJECT. A
-- harness question on a real project then refused its own test member (`A test principal cannot decide something real`),
-- because the project is real although the JOB the question belongs to is a test's. `authority_refusal` already accepts
-- either witness; the function now hands it the job the to-do stands for, so a test member answering a test's own
-- question is allowed and a test member ticking a real task (no such job, real project) is still refused.
-- Rebuilt from the LIVE definition; refuses to apply if the text it replaces is not there.

do $m$
declare
  v_def text;
  v_old constant text := 'app.authority_refusal(btrim(p_by), null, v_project)';
  v_new constant text := 'app.authority_refusal(btrim(p_by), (select b.job_id from public.tasks t join public.blockers b on b.blocker_id = t.satisfies_blocker where t.task_id = v_id), v_project)';
begin
  v_def := pg_get_functiondef('app.hq_task_state(text,text,text,text)'::regprocedure);
  if position(v_old in v_def) = 0 then
    raise exception '0639: hq_task_state does not carry the 0637 refusal call';
  end if;
  execute replace(v_def, v_old, v_new);
end $m$;
