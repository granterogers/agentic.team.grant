-- Rollback of 0628: pause_job without the claim.
begin;
drop function if exists app.pause_job(uuid, text, text, text, boolean, timestamp with time zone, timestamp with time zone, text, text, bigint);
CREATE OR REPLACE FUNCTION app.pause_job(p_job uuid, p_reason text, p_detail text, p_resume_when text, p_resumable boolean DEFAULT true, p_until timestamp with time zone DEFAULT NULL::timestamp with time zone, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_binds_to text DEFAULT NULL::text)
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
delete from app.schema_migrations where name like '0628_%';
commit;
