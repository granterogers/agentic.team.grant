/*
  0609 - waiting for a dependency does not spend the attempts a failure would

  Audit finding B4, reproduced first (scripts/isolated/fan-in-waits.ts): with
  the real worker and the real office.synthesise handler, the sixth wake of a
  fan-in over a branch that had not finished found the synthesis `queued` at
  attempt 5 of 5 - unclaimable, and never completing even once the branch
  settled. See the comment in the function for the mechanism and the bound.

  app.resume_job spliced from the live definition, argument list unchanged.
*/

CREATE OR REPLACE FUNCTION app.resume_job(p_job uuid, p_why text DEFAULT 'the condition was met'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare v_state text; v_resumable boolean; v_reason text;
begin
  select state::text into v_state from public.jobs where job_id = p_job;
  if v_state is null then
    return jsonb_build_object('error', 'no such job');
  end if;
  if v_state <> 'paused' then
    return jsonb_build_object('error', format('that job is %s, not paused', v_state));
  end if;
  select resumable, reason into v_resumable, v_reason from public.job_pauses
   where job_id = p_job and resumed_at is null order by at desc limit 1;
  if v_resumable is false then
    return jsonb_build_object('error',
      'that pause was recorded as not automatically resumable; it needs a person');
  end if;

  update public.job_pauses
     set resumed_at = app.now_utc(), resumed_why = left(coalesce(p_why, ''), 400)
   where job_id = p_job and resumed_at is null;

  /*
    A WAIT IS NOT AN ATTEMPT (audit B4, 0609).

    `dequeue_job` spends an attempt every time it claims a job, and a job that
    pauses to wait ends its run cleanly - it did not fail. So every wake of a
    fan-in synthesis (a 60-second poll while its specialists work) cost one of
    its five attempts, and after five wakes `attempt < max_attempts` no longer
    held: the job sat `queued`, could never be claimed, and no sweep failed it
    (they handle running and retrying jobs). A slow specialist therefore left
    the question unanswered, silently, for good. The header of synthesise.ts
    said it "waits without burning attempts"; nothing made that true.

    Given back here, at the one door a pause is resumed through, and only for
    the two waits that are bounded by THEIR OWN condition: a dependency wait
    ends at the group's deadline (fan_in_ready is true once it passes) and a
    scheduled wait ends at its time. A provider that is throttled or down is
    NOT restored: retrying it is exactly what the attempt count exists to
    bound, and refunding it would let a dead provider loop for ever.
  */
  update public.jobs
     set state = 'queued', state_reason = left(coalesce(p_why, 'resumed'), 500),
         waiting_on = null, not_before = null,
         attempt = case when v_reason in ('dependency_wait', 'scheduled_wait')
                        then greatest(attempt - 1, 0) else attempt end
   where job_id = p_job;

  return jsonb_build_object('ok', true);
end;
$function$;
