do $p$
declare j uuid; b uuid;
begin
  insert into public.jobs (correlation_id, kind, state, requested_by, announce, idempotency_key)
    values (gen_random_uuid(), 'verify.approval_race', 'queued', 'teamhq:verify-apprace-rb', false, 'verify-apprace-rb') returning job_id into j;
  insert into public.blockers (job_id, requested_action, why_needed, consequences_of_delay, approval_options, originating_agent, work_can_continue, on_answer)
    values (j, 'probe', 'probe', 'none', array['Yes','No'], 'chief-of-staff', true, jsonb_build_object('option','Yes','kind','verify.approval_race_child','payloads', jsonb_build_array('{}'::jsonb)))
    returning blocker_id into b;
  insert into _result select 'wrong option first: '||app.hq_answer_blocker(b, 'Maybe')::text;
  insert into _result select 'first: '||(app.hq_answer_blocker(b, 'Yes')->>'started');
  insert into _result select 'second: '||app.hq_answer_blocker(b, 'Yes')::text;
  insert into _result select 'children: '||(select count(*) from public.jobs where parent_job_id = j);
end $p$;
