-- THE CODE VERSION WAS STORED AND NEVER READ.
--
-- `app.step_begin` carries this comment, directly above its staleness test:
--
--   -- A checkpoint from different code is not a checkpoint this run may reason
--   -- about, finished or not.
--
-- and then compares `schema_version` only. `job_steps.code_version` has been
-- written on every step since the table existed and read by nothing -- the
-- dial-with-no-reader defect, in the durability layer.
--
-- Two files document the mechanism it does not have. `src/jobs/checkpoint.ts`
-- says a code version is "bumped when the MEANING of a step's outcome changes"
-- and that "a resume under a different number parks rather than guessing";
-- `src/handlers/pursue.ts` repeats it. Both were false: a plan whose earlier
-- steps were recorded by different code resumed and reasoned about outcomes
-- whose meaning that code no longer guarantees.
--
-- Found by driving it (#283): `verify:pursues` ran a plan under
-- `office.pursue@1`, then again under `office.pursue@2`, and it carried on.
--
-- WHY THIS IS SAFE TO TURN ON NOW
--
-- Parking is not destructive -- the job pauses with a reason a person can
-- read, and `app.resumable_now` decides when it wakes. And it can only affect
-- a step that is UNFINISHED: all 19 in the database belong to cancelled
-- `verify:stop` probes, so no real in-flight work is disturbed. A finished
-- step is now stale too, deliberately, because the comment says "finished or
-- not" and the reason is the same either way: an outcome recorded by other
-- code is one this run may not read.
--
-- Spliced from the live definition rather than retyped, because the rest of
-- the function is behaviour nobody intends to change and CLAUDE.md records
-- what rewriting one from memory costs.

do $splice$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'step_begin';
  if v_def is null then
    raise exception 'app.step_begin is not there to change';
  end if;

  v_old := '  if v.schema_version <> p_schema then'                              || chr(10) ||
           '    return jsonb_build_object(''stale'', true,'                      || chr(10) ||
           '      ''was'', v.schema_version, ''now'', p_schema,'                 || chr(10) ||
           '      ''why'', format(''step %L was recorded by schema %s and this is %s'','
                                                                                 || chr(10) ||
           '                    p_step, v.schema_version, p_schema));'           || chr(10) ||
           '  end if;';

  if position(v_old in v_def) = 0 then
    raise exception 'the staleness test is not the shape this migration expected';
  end if;

  v_new := '  if v.schema_version <> p_schema then'                              || chr(10) ||
           '    return jsonb_build_object(''stale'', true,'                      || chr(10) ||
           '      ''was'', v.schema_version, ''now'', p_schema,'                 || chr(10) ||
           '      ''why'', format(''step %L was recorded by schema %s and this is %s'','
                                                                                 || chr(10) ||
           '                    p_step, v.schema_version, p_schema));'           || chr(10) ||
           '  end if;'                                                           || chr(10) ||
           ''                                                                    || chr(10) ||
           '  -- And the CODE version, which this function stored and never read'
                                                                                 || chr(10) ||
           '  -- until 0527. The comment above has always said "finished or not",'
                                                                                 || chr(10) ||
           '  -- and it means it: an outcome recorded by code that is no longer'  || chr(10) ||
           '  -- running is one this run may not reason about, however complete.' || chr(10) ||
           '  if coalesce(v.code_version, '''') is distinct from coalesce(p_code, '''') then'
                                                                                 || chr(10) ||
           '    return jsonb_build_object(''stale'', true,'                      || chr(10) ||
           '      ''was'', v.code_version, ''now'', p_code,'                     || chr(10) ||
           '      ''why'', format(''step %L was recorded by %s and this is %s'','  || chr(10) ||
           '                    p_step, coalesce(v.code_version, ''nothing''),'   || chr(10) ||
           '                    coalesce(p_code, ''nothing'')));'                || chr(10) ||
           '  end if;';

  execute replace(v_def, v_old, v_new);
end $splice$;

-- DRIVE IT. A migration that applies cleanly is not a function that works, and
-- this one exists because something was stored and never exercised.
do $check$
declare
  v_job     uuid;
  v_verdict jsonb;
begin
  insert into public.jobs (kind, state, requested_by, idempotency_key, correlation_id)
  values ('office.pursue', 'running', 'migration:verify-0527',
          format('m0527-%s', gen_random_uuid()), gen_random_uuid())
  returning job_id into v_job;

  -- A first pass under one code version, carried to completion.
  v_verdict := app.step_begin(v_job, 'a step', 0, 'none', 1, 'proof@1');
  if not coalesce((v_verdict ->> 'do')::boolean, false) then
    raise exception 'a brand new step should be done, got %', v_verdict;
  end if;
  perform app.step_done(v_job, 'a step', '{"found": true}'::jsonb, null);

  -- The same code version resumes and SKIPS, which is the control: without it
  -- a function that returned `stale` for everything would pass the test below.
  v_verdict := app.step_begin(v_job, 'a step', 0, 'none', 1, 'proof@1');
  if not coalesce((v_verdict ->> 'skip')::boolean, false) then
    raise exception 'the same code should skip a finished step, got %', v_verdict;
  end if;

  -- Different code must PARK, finished or not.
  v_verdict := app.step_begin(v_job, 'a step', 0, 'none', 1, 'proof@2');
  if not coalesce((v_verdict ->> 'stale')::boolean, false) then
    raise exception 'a finished step from other code should be stale, got %', v_verdict;
  end if;
  if v_verdict ->> 'why' not like '%proof@1%' then
    raise exception 'the reason must name the code that recorded it, got %', v_verdict;
  end if;

  -- And the schema test still works, so the splice did not displace it.
  v_verdict := app.step_begin(v_job, 'a step', 0, 'none', 99, 'proof@1');
  if not coalesce((v_verdict ->> 'stale')::boolean, false) then
    raise exception 'a schema change should still be stale, got %', v_verdict;
  end if;

  update public.jobs set state = 'cancelled', finished_at = app.now_utc(),
    state_reason = '0527 proof' where job_id = v_job;
end $check$;
