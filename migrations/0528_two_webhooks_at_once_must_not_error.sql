-- A RETRIED WEBHOOK THAT ARRIVES TWICE AT ONCE RAISED 23505 AT GRANT.
--
-- `app.enqueue_inbound` is idempotent by SELECT-then-INSERT, which is not
-- atomic. Two calls in flight together both miss the existing row and both
-- insert; `jobs_one_live_per_idempotency_key` catches the second and raises
-- 23505 out of a SECURITY DEFINER function. The adapter sees a hard error for
-- a message that WAS recorded, and Grant is told his message could not be
-- taken -- the same shape as the `addressed_to` foreign key CLAUDE.md records,
-- where a bad value lost the whole turn rather than degrading.
--
-- This is not hypothetical. Telegram retries a delivery it did not get an
-- acknowledgement for, and it retries fast; Slack does the same. Sequential
-- duplicates were always handled, so nothing had ever seen it -- `verify:composes`
-- enqueues the same command twice CONCURRENTLY (#283) and hit it on a
-- deployed run.
--
-- THE FIX IS THE STANDARD IDEMPOTENT INSERT, and the conflict target has to
-- MATCH the partial index or it catches nothing. CLAUDE.md records three
-- migrations spent learning that on `documents_one_per_external_ref`: the
-- predicate is part of the target, not decoration.
--
-- `do nothing` rather than `do update`: the loser of the race wants the
-- winner's job, not to overwrite it. It then re-reads, and that read is inside
-- the same statement's aftermath so the winner's row is visible.

do $splice$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'enqueue_inbound';
  if v_def is null then
    raise exception 'app.enqueue_inbound is not there to change';
  end if;

  v_old := '  returning job_id into v_job;';
  if position(v_old in v_def) = 0 then
    raise exception 'the insert does not end the way this migration expected';
  end if;

  v_new := '  on conflict (idempotency_key)'                                      || chr(10) ||
           '    where state <> all (array[''complete''::public.job_state,'        || chr(10) ||
           '                              ''cancelled''::public.job_state,'       || chr(10) ||
           '                              ''failed''::public.job_state])'         || chr(10) ||
           '    do nothing'                                                       || chr(10) ||
           '  returning job_id into v_job;'                                       || chr(10) ||
           ''                                                                     || chr(10) ||
           '  -- THE LOSER OF THE RACE WANTS THE WINNER''S JOB (0528).'           || chr(10) ||
           '  -- `do nothing` returns no row, so v_job is null exactly when'      || chr(10) ||
           '  -- another call inserted first. Reading it back is the whole'       || chr(10) ||
           '  -- point: both callers must be told the same job id, which is'      || chr(10) ||
           '  -- what idempotent means to the adapter that asked.'                || chr(10) ||
           '  if v_job is null then'                                              || chr(10) ||
           '    select job_id into v_job from public.jobs'                        || chr(10) ||
           '     where idempotency_key = format(''inbound-%s'', p_command_id)'    || chr(10) ||
           '       and state <> all (array[''complete''::public.job_state,'       || chr(10) ||
           '                               ''cancelled''::public.job_state,'      || chr(10) ||
           '                               ''failed''::public.job_state]);'       || chr(10) ||
           '    if v_job is null then'                                            || chr(10) ||
           '      raise exception ''could not record what you said: the job for'' ' || chr(10) ||
           '        '' command % was neither inserted nor found'', p_command_id;' || chr(10) ||
           '    end if;'                                                          || chr(10) ||
           '  end if;';

  execute replace(v_def, v_old, v_new);
end $splice$;

-- DRIVE IT, including the race it exists for.
do $check$
declare
  v_command uuid;
  v_a       jsonb;
  v_b       jsonb;
begin
  insert into public.inbound_commands
    (origin_channel, origin_ref, actor, instruction, dedupe_key)
  values ('telegram', format('m0528-%s', gen_random_uuid()), 'verify-0528',
          'Go through the material and work out what is out of date in it.',
          format('telegram:message:m0528-%s', gen_random_uuid()))
  returning command_id into v_command;

  v_a := app.enqueue_inbound(v_command);
  -- The second call is what a retried webhook is. It must answer with the
  -- SAME job rather than raising.
  v_b := app.enqueue_inbound(v_command);

  if (v_a ->> 'job_id') is null or (v_a ->> 'job_id') <> (v_b ->> 'job_id') then
    raise exception 'a duplicate got a different job: % then %', v_a, v_b;
  end if;

  -- And exactly one live job carries that key, which is the property the
  -- index is for. A function that returned the same id while inserting twice
  -- would pass the check above and fail this one.
  if (select count(*) from public.jobs
       where idempotency_key = format('inbound-%s', v_command)) <> 1 then
    raise exception 'more than one job was created for one command';
  end if;

  update public.jobs set state = 'cancelled', finished_at = app.now_utc(),
    state_reason = '0528 proof'
   where idempotency_key = format('inbound-%s', v_command);
  delete from public.inbound_commands where command_id = v_command;
end $check$;
