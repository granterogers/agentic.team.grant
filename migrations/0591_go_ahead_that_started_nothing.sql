-- Grant presses "Go ahead" and nothing is made.
--
-- Three of the four questions currently open on his dashboard are notebook
-- generation approvals:
--
--     Generate audio overview for "AI learning" in the notebook   (9 Sep)
--     Generate slide deck for "Legacy Coaching Course"           (11 Sep)
--     Generate audio overview for "Legacy Coaching Course"       (11 Sep)
--
-- Driven inside a rollback, answering one returns
-- `ok=true, state=resolved, started=0`. The office says yes, marks the
-- question answered, and queues nothing. Worse than a refusal, because he has
-- no way to tell: the answer was accepted.
--
-- ## Both halves right alone
--
-- `app.answer_generation_approval` knows exactly what approving one means and
-- handles the missing key in its own body, with a comment saying so:
--
--     -- `notebook.generate` when the job did not say, which is every approval
--     -- created before this migration.
--     v_next := coalesce(v_config ->> 'approval_next', 'notebook.generate');
--
-- And `app.hq_answer_blocker` routes to it only when the key is PRESENT:
--
--     select pinned_config ->> 'approval_next' into v_next ...
--     if v_next is not null then return app.answer_generation_approval(...)
--
-- So the caller's pre-check is stricter than the callee's own tolerance, and
-- the exact case the callee was written to absorb can never reach it. That is
-- 0282/0293's shape — loosening a constraint does not loosen the function that
-- pre-checks it — and this is its fourth instance in this repository.
--
-- ## Fixed in the WRITER, not the router
--
-- `app.request_generation_approval` raises these and never records what
-- answering performs. Widening the router instead would mean deciding from
-- the job's KIND or from the option text: the first risks routing a plan
-- step's approval (raised by `perform.ts` on a paused job, answered by
-- RESUMING it) into a duplicate generation, and the second is #130's parsing
-- defect on a path that enqueues work. The writer already knows what it is
-- raising, so it says so.
--
-- `approval_next` is the JOB kind of the follow-on, which is
-- `notebook.generate` re-entered — `answer_generation_approval` copies the
-- original `pinned_config` forward and adds `approved_by`, which is precisely
-- the field `handlers/notebook.ts` checks before generating. The function's
-- own `p_kind` argument is the ARTIFACT kind (`audio_overview`, `slides`) and
-- is deliberately NOT used for this: a job of kind `slides` has no handler.
--
-- ## And his three live questions are repaired
--
-- Scoped exactly: an OPEN blocker, on a `notebook.generate` job, offering this
-- writer's own two options, with no `approval_next` and no `on_answer`. The
-- drive asserts none is left behind rather than asserting a count, because a
-- count is wrong the next time a question is raised.

do $splice$
declare
  v_src text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'request_generation_approval';
  if v_src is null then raise exception '0591: app.request_generation_approval is missing'; end if;

  v_old := '  insert into public.blockers' || E'\n'
        || '    (project_id, job_id, requested_action, why_needed, consequences_of_delay,';
  v_new := '  -- What answering this PERFORMS. Without it app.hq_answer_blocker'  || E'\n'
        || '  -- resolves the question and queues nothing, which is what Grant'   || E'\n'
        || '  -- got for three approvals between 9 and 11 September (0591).'      || E'\n'
        || '  update public.jobs'                                                 || E'\n'
        || '     set pinned_config = coalesce(pinned_config, ''{}''::jsonb)'      || E'\n'
        || '           || jsonb_build_object(''approval_next'', ''notebook.generate'')' || E'\n'
        || '   where job_id = p_job'                                              || E'\n'
        || '     and coalesce(pinned_config ->> ''approval_next'', '''') = '''';' || E'\n'
        || E'\n'
        || v_old;

  if position(v_old in v_src) = 0 then raise exception '0591: the blocker insert was not found'; end if;
  v_src := replace(v_src, v_old, v_new);
  execute v_src;
end $splice$;

-- His three live questions, repaired so answering them does the thing.
update public.jobs j
   set pinned_config = coalesce(j.pinned_config, '{}'::jsonb)
         || jsonb_build_object('approval_next', 'notebook.generate')
 where j.kind = 'notebook.generate'
   and coalesce(j.pinned_config ->> 'approval_next', '') = ''
   and exists (
     select 1 from public.blockers b
      where b.job_id = j.job_id
        and b.state = 'open'
        and b.on_answer is null
        and b.approval_options = array['Go ahead', 'Not now']);

-- Drive it. Reading a migration proves it parses.
do $drive$
declare
  v_dead integer;
  v_job uuid;
  v_blocker uuid;
  v_next text;
  v_res jsonb;
begin
  /*
    1. Nothing Grant can see is still dead.

    The property, not a count: an OPEN question of his whose job has finished
    and which names neither a follow-on nor an on-answer payload is one whose
    affirmative answer can start nothing and resume nothing.
  */
  select count(*) into v_dead
    from public.blockers b
    join public.jobs j on j.job_id = b.job_id
   where b.state = 'open'
     and not app.harness_job(b.job_id)
     and j.state in ('complete', 'failed', 'cancelled')
     and b.on_answer is null
     and coalesce(j.pinned_config ->> 'approval_next', '') = '';
  if v_dead > 0 then
    raise exception '0591: % open question(s) of his would still start nothing', v_dead;
  end if;

  /*
    2. The writer records it now, and answering starts the work.

    End to end on a real subject, inside a subtransaction that is rolled back
    by raising a marker — so the blocker, the pinned key and the follow-on job
    are all created, asserted, and discarded. A job cannot be deleted, so the
    inner block is the only honest way to drive this.
  */
  begin
    select j.job_id into v_job
      from public.jobs j
     where j.kind = 'notebook.generate'
       and not exists (select 1 from public.blockers b
                        where b.job_id = j.job_id and b.state = 'open')
     order by j.created_at desc
     limit 1;
    if v_job is null then
      raise exception 'DRIVE:no notebook.generate job to drive against';
    end if;

    v_blocker := app.request_generation_approval(
      v_job, 'slides', 'slide deck for a drive that is rolled back',
      'It costs about 5 of the allowance.');

    select pinned_config ->> 'approval_next' into v_next
      from public.jobs where job_id = v_job;
    if coalesce(v_next, '') <> 'notebook.generate' then
      raise exception 'DRIVE:the writer did not record approval_next (got %)', coalesce(v_next, '(null)');
    end if;

    v_res := app.hq_answer_blocker(v_blocker, 'Go ahead');
    if coalesce(v_res ->> 'approved', '') <> 'true' or (v_res ->> 'job_id') is null then
      raise exception 'DRIVE:answering started nothing: %', left(v_res::text, 200);
    end if;

    raise exception 'DRIVE:ok';
  exception when others then
    if SQLERRM = 'DRIVE:ok' then
      null;                                   -- both halves proved, all of it discarded
    elsif SQLERRM like 'DRIVE:%' then
      raise exception '0591: %', SQLERRM;
    else
      raise;
    end if;
  end;
end $drive$;
