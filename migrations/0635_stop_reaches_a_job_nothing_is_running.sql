-- 0635 - "Stop" cancels a job that nothing is running, and says who stopped it (final audit, reviews L4, R2-3, R2-7).
--
-- `app.request_stop` only stamped `stop_requested_at`, and the only reader of that stamp is `runSteps` inside a running
-- handler. A job that is PAUSED, QUEUED or RETRYING has no handler running, so pressing Stop on it changed nothing:
-- `{"ok":true,"state":"paused"}` and the job stayed paused for ever. That matters most for the parked unsure effect
-- (`needs_reconciliation`), whose own notice says "stop it" - a control the office told him to press and that could not
-- do it.
--
-- For a job in a state where no worker holds it and the transition table allows cancelling, Stop now cancels it,
-- recording who and why, withdraws the questions that job had open (a question about work that was stopped is not
-- waiting on anybody) and stops the idle work beneath it. The cancel is conditional on the state it read, so a worker
-- that claims the job in the meantime is not cancelled from under itself: that case falls through to the flag, which a
-- running handler reads between steps. A running job is unchanged, and a finished job is still reported as finished.
--
-- WHO. The public wrapper defaulted the stopper to 'grant', so a machine credential (the office key) that named nobody
-- stopped jobs as Grant. The wrapper's default is now null; the function records a caller that names nobody as "the
-- office", and a named test principal is refused on a real job as it is everywhere else.
--
-- Built from the live definitions; it refuses to apply if the statement it means to precede is not there.

do $m$
declare
  v_def text;
  v_old constant text := E'  update public.jobs\n     set stop_requested_at = coalesce(stop_requested_at, app.now_utc()),';
  v_new constant text := E'  v_who := coalesce(nullif(trim(coalesce(p_who, '''')), ''''), ''the office'');
  if nullif(trim(coalesce(p_who, '''')), '''') is not null then
    v_refusal := app.authority_refusal(trim(p_who), p_job, (select project_id from public.jobs where job_id = p_job));
    if v_refusal is not null then
      return jsonb_build_object(''error'', v_refusal);
    end if;
  end if;
  if v_state in (''paused'', ''queued'', ''retrying'') and app.job_is_stoppable(v_state::public.job_state) then
    update public.jobs
       set state = ''cancelled'',
           finished_at = app.now_utc(),
           state_reason = left(''stopped by '' || v_who || '' while it was '' || v_state, 500),
           stop_requested_at = coalesce(stop_requested_at, app.now_utc()),
           stop_requested_by = coalesce(stop_requested_by, v_who),
           leased_by = null,
           leased_until = null
     where job_id = p_job and state::text = v_state;
    get diagnostics v_n = row_count;
    if v_n = 1 then
      -- The questions this job had open are withdrawn with it, and the idle work beneath it is stopped.
      update public.blockers
         set state = ''resolved'', resolved_at = app.now_utc(),
             resolution = ''withdrawn: the job it asked about was stopped by '' || v_who
       where job_id = p_job and state = ''open'';
      with recursive below as (
        select job_id from public.jobs where parent_job_id = p_job
        union all
        select j.job_id from public.jobs j join below b on j.parent_job_id = b.job_id
      ), gone as (
        update public.jobs k
           set state = ''cancelled'', finished_at = app.now_utc(),
               state_reason = left(''stopped with the job it belongs to (by '' || v_who || '')'', 500),
               leased_by = null, leased_until = null
         where k.job_id in (select job_id from below)
           and k.state in (''paused'', ''queued'', ''retrying'')
        returning k.job_id
      )
      select coalesce(array_agg(job_id), ''{}''::uuid[]) into v_kids from gone;
      update public.blockers
         set state = ''resolved'', resolved_at = app.now_utc(),
             resolution = ''withdrawn: the job it asked about was stopped by '' || v_who
       where state = ''open'' and job_id = any (v_kids);
      return jsonb_build_object(''ok'', true, ''state'', ''cancelled'', ''was'', v_state);
    end if;
  end if;
  update public.jobs
     set stop_requested_at = coalesce(stop_requested_at, app.now_utc()),';
begin
  v_def := pg_get_functiondef('app.request_stop(uuid,text)'::regprocedure);
  if position(v_old in v_def) = 0 or position(E'declare\n  v_state text;\nbegin' in v_def) = 0 then
    raise exception '0635: the anchors are not in app.request_stop';
  end if;
  v_def := replace(v_def, E'declare\n  v_state text;\nbegin', E'declare\n  v_state text;\n  v_who text;\n  v_n integer;\n  v_kids uuid[];\n  v_refusal text;\nbegin');
  v_def := replace(v_def, v_old, v_new);
  v_def := replace(v_def, E'stop_requested_by = coalesce(stop_requested_by, nullif(trim(coalesce(p_who, '''')), '''')),\n         updated_at', E'stop_requested_by = coalesce(stop_requested_by, v_who),\n         updated_at');
  execute v_def;
  if position('stopped by ' in pg_get_functiondef('app.request_stop(uuid,text)'::regprocedure)) = 0 then
    raise exception '0635: the change did not land';
  end if;

  v_def := pg_get_functiondef('public.request_stop(uuid,text)'::regprocedure);
  if position('p_who text DEFAULT ''grant''::text' in v_def) = 0 then
    raise exception '0635: the wrapper default is not as expected';
  end if;
  execute replace(v_def, 'p_who text DEFAULT ''grant''::text', 'p_who text DEFAULT NULL::text');
end
$m$;
