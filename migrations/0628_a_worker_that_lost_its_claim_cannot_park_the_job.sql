/*
  0628 - a worker that has lost its claim cannot park the job (Final audit reconciliation, #398).

  Run 5 fenced state writes, the output, the heartbeat and child creation by the claim (0625), and left
  `app.pause_job` taking only the job id: worker A, superseded by worker B, could still call it and park the job B
  was running (a bogus pause row, leased_by cleared, B working on a parked job). pause_job now takes the caller's
  worker and claim_gen as two optional arguments; given, it refuses a caller that does not hold the job now
  ('stale caller', 40001) and an incomplete pair (22023). Without them it asks nothing - an old worker is exactly as
  before. The TypeScript pause path (pauseJob, beginStep, claimExternal, runSteps) carries the claim.

  ROLLBACK: docs/final-audit/rollback-0628.sql.
*/
drop function app.pause_job(uuid, text, text, text, boolean, timestamp with time zone, timestamp with time zone, text);
CREATE OR REPLACE FUNCTION app.pause_job(p_job uuid, p_reason text, p_detail text, p_resume_when text, p_resumable boolean DEFAULT true, p_until timestamp with time zone DEFAULT NULL::timestamp with time zone, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_binds_to text DEFAULT NULL::text, p_worker text DEFAULT NULL::text, p_gen bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_state text;
  v_since timestamptz;
  v_answered uuid;
begin
  -- A worker that says who it is must still hold the claim: a zombie cannot park the job its replacement is running.
  if (p_worker is null) <> (p_gen is null) then
    raise exception 'an incomplete caller: name the worker and the claim, or neither' using errcode = '22023';
  end if;
  if p_worker is not null
     and not exists (select 1 from public.jobs j
                      where j.job_id = p_job and j.leased_by = p_worker and j.claim_gen = p_gen
                        and j.state in ('running', 'output_created', 'quality_review', 'committing', 'committed', 'notifying')) then
    raise exception 'stale caller: % no longer holds job %', p_worker, p_job using errcode = '40001';
  end if;
  select state::text into v_state from public.jobs where job_id = p_job;
  if v_state is null then
    return jsonb_build_object('error', 'no such job');
  end if;
  if v_state = 'paused' then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  if p_reason = 'awaiting_approval' and coalesce(p_binds_to, '') !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('error',
      'an approval has to bind to the exact action it approves — pass the '
      'fingerprint of what the job is promising to do');
  end if;

  insert into public.job_pauses
    (job_id, reason, detail, resume_when, resumable, expires_at, binds_to)
  values (p_job, p_reason, p_detail, p_resume_when, coalesce(p_resumable, true),
          p_expires_at, p_binds_to);

  update public.jobs
     set state = 'paused',
         state_reason = left(p_reason || ': ' || p_detail, 500),
         waiting_on = left(p_resume_when, 500),
         not_before = coalesce(p_until, not_before),
         leased_by = null,
         leased_until = null
   where job_id = p_job;

  /*
    D5. The question was raised by a write that committed before this one, so a person could answer in the gap:
    the blocker is resolved, `let_job_go` found the job still running and released nothing, and this then parked
    it on an answer already given. Look for exactly that - a blocker of this job, resolved since this attempt
    began, with none still open - and release. The pause row above is closed by let_job_go, so the ledger reads
    parked, answered, queued, in that order.
  */
  if p_reason in ('awaiting_approval', 'awaiting_human_action') then
    select max(t.occurred_at) into v_since
      from public.job_state_transitions t where t.job_id = p_job and t.to_state = 'running';
    select b.blocker_id into v_answered from public.blockers b
     where b.job_id = p_job and b.state <> 'open' and b.resolved_at >= coalesce(v_since, '-infinity')
     order by b.resolved_at desc limit 1;
    if v_answered is not null
       and not exists (select 1 from public.blockers b where b.job_id = p_job and b.state = 'open') then
      perform app.let_job_go(p_job, 'answered while it was being parked');
      return jsonb_build_object('ok', true, 'was', v_state, 'released', v_answered);
    end if;
  end if;

  return jsonb_build_object('ok', true, 'was', v_state);
end;
$function$;
