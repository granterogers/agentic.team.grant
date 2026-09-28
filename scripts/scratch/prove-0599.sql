do $p$
declare v_job uuid; v_proj uuid; v_state text; v_n int;
begin
  select project_id into v_proj from public.projects where slug = 'fixture-sess-gamma-rem-propagate';
  insert into public.jobs (kind, requested_by, project_id, idempotency_key, correlation_id)
    values ('office.instruction', 'teamhq:verify-prove-0599', v_proj, 'verify-prove-0599-' || gen_random_uuid(), gen_random_uuid())
    returning job_id into v_job;
  update public.jobs set state = 'running', leased_by = 'prove', leased_until = now() + interval '1 minute' where job_id = v_job;
  insert into public.outputs (job_id, body, confidence, evidence, deterministic) values (v_job, 'x', 'low', 'inferred', true);
  update public.jobs set state = 'output_created' where job_id = v_job;
  update public.jobs set state = 'quality_review' where job_id = v_job;
  update public.jobs set state = 'committing', leased_until = now() - interval '1 minute' where job_id = v_job;
  perform app.recover_stalled_jobs();
  select state::text into v_state from public.jobs where job_id = v_job;
  insert into _result values ('stranded committing job -> ' || v_state);
end $p$;
