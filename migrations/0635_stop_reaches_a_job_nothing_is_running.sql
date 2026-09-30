-- 0635 - "Stop" cancels a job that nothing is running (final audit, review L4).
--
-- `app.request_stop` only stamped `stop_requested_at`, and the only reader of that stamp is `runSteps` inside a running
-- handler. A job that is PAUSED, QUEUED or RETRYING has no handler running, so pressing Stop on it changed nothing:
-- `{"ok":true,"state":"paused"}` and the job stayed paused for ever. That matters most for the parked unsure effect
-- (`needs_reconciliation`), whose own instructions say "stop this job" - a control the office told him to press and
-- that could not do it.
--
-- For a job in a state where no worker holds it and the transition table allows cancelling, Stop now cancels it,
-- recording who and why. A running job is unchanged (the flag is read between steps, which is where it can be honoured
-- safely), and a finished job is still reported as finished. Built from the live definition; it refuses to apply if the
-- statement it means to precede is not there.

do $m$
declare
  v_def text;
  v_old constant text := E'  update public.jobs\n     set stop_requested_at = coalesce(stop_requested_at, app.now_utc()),';
  v_new constant text := E'  if v_state in (''paused'', ''queued'', ''retrying'') and app.job_is_stoppable(v_state::public.job_state) then
    update public.jobs
       set state = ''cancelled'',
           finished_at = app.now_utc(),
           state_reason = left(''stopped by ''  || coalesce(nullif(trim(coalesce(p_who, '''')), ''''), ''a person'') || '' while it was ''  || v_state, 500),
           stop_requested_at = coalesce(stop_requested_at, app.now_utc()),
           stop_requested_by = coalesce(stop_requested_by, nullif(trim(coalesce(p_who, '''')), '''')),
           leased_by = null,
           leased_until = null
     where job_id = p_job;
    return jsonb_build_object(''ok'', true, ''state'', ''cancelled'', ''was'', v_state);
  end if;
  update public.jobs
     set stop_requested_at = coalesce(stop_requested_at, app.now_utc()),';
begin
  v_def := pg_get_functiondef('app.request_stop(uuid,text)'::regprocedure);
  if position(v_old in v_def) = 0 then
    raise exception '0635: the statement to precede is not in app.request_stop';
  end if;
  execute replace(v_def, v_old, v_new);
  if position('stopped by ' in pg_get_functiondef('app.request_stop(uuid,text)'::regprocedure)) = 0 then
    raise exception '0635: the change did not land';
  end if;
end
$m$;
