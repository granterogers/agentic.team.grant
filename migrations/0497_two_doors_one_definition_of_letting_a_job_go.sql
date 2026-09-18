/*
  0496 said `hq_answer_blocker` delegates. It did not (#259).

  0496 extracted `app.let_job_go` so the blocker-answer path and the
  personal-task path could not come to disagree about what "this job may run
  again" means, and its header says so in as many words. It then left
  `hq_answer_blocker` with its own inline copy — so there were two definitions
  and the migration that created the second one claimed there was one.

  That is the commonest defect in this repository wearing its most respectable
  face: a comment asserting a property with nothing behind it. Recorded four
  times already, and this time in a header arguing against the very thing it
  was doing.

  0472 is the shape of the fix: the second writer DELEGATES, so a future change
  to what letting a job go means cannot land in one door and not the other.

  The body is SPLICED from the live definition rather than transcribed. A
  transcription of this function would be the third instance of the mistake
  0457 records — `app.pause_job` lost four behaviours when it was rewritten
  from memory — and `pg_get_functiondef` emits no trailing semicolon, which is
  the other half of the same trap.

  No backticks in any comment in this file.
*/

do $splice$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'hq_answer_blocker';

  if v_def is null then raise exception 'app.hq_answer_blocker is not there to splice'; end if;

  v_old := '  select state::text into v_was from public.jobs where job_id = b.job_id;
  if v_was in (''waiting_user'', ''waiting_external'') then
    update public.jobs
       set state = ''paused'',
           state_reason = format(''answered: %s'', v_answer),
           updated_at = app.now_utc()
     where job_id = b.job_id;
    v_was := ''paused'';
  end if;
  if v_was = ''paused'' then
    update public.jobs
       set state = ''queued'',
           state_reason = format(''answered: %s'', v_answer),
           updated_at = app.now_utc()
     where job_id = b.job_id;
  end if;';

  v_new := '  -- One definition, in app.let_job_go (0496, 0497). A second copy here is
  -- two writers of one field, which is what 0472 exists to stop.
  perform app.let_job_go(b.job_id, format(''answered: %s'', v_answer));';

  if position(v_old in v_def) = 0 then
    raise exception 'the inline resume is not where 0497 expected it; read the live definition';
  end if;

  v_def := replace(v_def, v_old, v_new);
  /*
    The semicolon this repository has now paid for three times: 0353, 0355 and
    this one would have been the fourth.
  */
  execute v_def || ';';
end
$splice$;

/*
  Driven, because a splice that applies is not a function that still works.
  The point of the change is that answering a blocker STILL lets the job go,
  through the shared definition rather than an inline copy.
*/
do $drive$
declare
  v_project uuid;
  v_job uuid;
  v_blocker uuid;
  v_state text;
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'hq_answer_blocker';
  if position('let_job_go' in v_def) = 0 then
    raise exception 'the splice did not take: hq_answer_blocker still has its own copy';
  end if;

  insert into public.projects (name, slug, status)
  values ('fixture delegate probe', 'fixture-delegate-probe', 'active')
  returning project_id into v_project;

  insert into public.jobs (kind, state, project_id, requested_by, correlation_id,
                           idempotency_key, pinned_config)
  values ('office.instruction', 'waiting_user', v_project, 'teamhq:grant',
          gen_random_uuid(), 'delegate-probe-' || gen_random_uuid()::text, '{}'::jsonb)
  returning job_id into v_job;

  insert into public.blockers
    (project_id, job_id, requested_action, why_needed, consequences_of_delay,
     approval_options, originating_agent, work_can_continue)
  values (v_project, v_job, 'A thing only Grant can do',
          'Because only he can.', 'It waits.',
          array['Go ahead', 'Not now']::text[], 'marcus', false)
  returning blocker_id into v_blocker;

  perform app.hq_answer_blocker(v_blocker, 'Go ahead');

  select state::text into v_state from public.jobs where job_id = v_job;
  if v_state <> 'queued' then
    raise exception 'answering through the shared definition did not let the job go: %', v_state;
  end if;
  select state::text into v_state from public.blockers where blocker_id = v_blocker;
  if v_state <> 'resolved' then raise exception 'the blocker is %', v_state; end if;

  raise notice 'one definition, and answering still lets the job go';
  raise exception 'rolling the probe back';
exception
  when others then
    if sqlerrm <> 'rolling the probe back' then raise; end if;
end
$drive$;
