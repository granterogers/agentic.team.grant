-- 0634 - a turn parked for good owes the person who asked it a sentence (final audit, invariants 28 and 29).
--
-- `app.owed_a_word` said who is owed a word when a turn DIES (state failed). A turn can also end without an answer
-- by PARKING for good: an external step that was interrupted (`needs_reconciliation`) or written by other code
-- (`checkpoint_stale`) is a non-resumable pause, nothing resumes it and nothing asks anybody, so Grant's request sat
-- in `paused` in silence. The safe direction held - the step is never repeated - but "anything that can end a turn
-- with no answer has to say so somewhere he looks" did not.
--
-- A parked turn is owed a word when: it is a root job of a real conversation, it is paused, it holds an open
-- NON-resumable pause, no question to him is open (a question reaches him by its own delivery), it is not harness
-- traffic (so no output row and no announce flip is ever made for a test, whatever the delivery layer would say), and
-- nothing has been delivered for it yet. Built from the LIVE definition so one predicate moves and nothing else does; it refuses to
-- apply when the predicate it means to widen is not there.

do $m$
declare
  v_def text;
  v_join constant text := E'      on c.command_id = (j.pinned_config ->> ''command_id'')::uuid';
  v_join_new constant text := E'      on c.command_id = coalesce((j.pinned_config ->> ''command_id'')::uuid,\n                                 (select ic.command_id from public.inbound_commands ic\n                                   where ic.job_id = coalesce(j.root_job_id, j.job_id) limit 1))';
  v_root constant text := E'and j.parent_job_id is null';
  v_root_new constant text := E'and (j.parent_job_id is null or j.state = ''paused'')';
  v_old constant text := E'and j.state = ''failed''';
  v_new constant text := E'and (j.state = ''failed''
          or (j.state = ''paused''
              and exists (select 1 from public.job_pauses p
                           where p.job_id = j.job_id and p.resumed_at is null and p.resumable = false)
              and not exists (select 1 from public.blockers b
                               where b.job_id = j.job_id and b.state = ''open'')
              and not app.harness_job(j.job_id)))';
begin
  v_def := pg_get_functiondef('app.owed_a_word(uuid)'::regprocedure);
  if position(v_old in v_def) = 0 or position(v_root in v_def) = 0 or position(v_join in v_def) = 0 then
    raise exception '0634: the predicate to widen is not in app.owed_a_word';
  end if;
  -- A parked CHILD is owed a word too: the approved notebook generation and every claimExternal caller is a child of
  -- the turn, so requiring a root left the headline case silent (review R2-4). A failed turn still has to be a root.
  -- A child has no command of its own: its reply goes where the ROOT turn's does (src/channels/reply.ts walks the lineage).
  v_def := replace(replace(v_def, v_root, v_root_new), v_join, v_join_new);
  execute replace(v_def, v_old, v_new);
  if position('j.state = ''paused''' in pg_get_functiondef('app.owed_a_word(uuid)'::regprocedure)) = 0 then
    raise exception '0634: the widening did not land';
  end if;
end
$m$;

-- And the office can SAY it when asked. `app.conversation_work` reported only work handed ON to others: a turn that
-- parked with no child of its own left `obligation` null and `waiting_on_you` 0, so "what is happening with that?" had
-- nothing to answer with (review F3). A turn's own non-resumable pause now counts in both, and `obligation_state`
-- (0631) already reads it as waiting on a person.
do $m$
declare
  v_def text;
  v_a constant text := E'         and exists (select 1 from public.jobs k where k.parent_job_id = c.job_id)';
  v_a2 constant text := E'         and (exists (select 1 from public.jobs k where k.parent_job_id = c.job_id)\n              or exists (select 1 from public.job_pauses pz where pz.job_id = c.job_id and pz.resumed_at is null and pz.resumable = false))';
  v_b constant text := E'       where b.state = ''open''), 0))';
  v_b2 constant text := E'       where b.state = ''open''), 0)\n      + coalesce((\n      select count(*)::int from turns t2\n        join public.job_pauses p2 on p2.job_id = t2.job_id\n        join public.jobs j2 on j2.job_id = t2.job_id\n       where p2.resumed_at is null and p2.resumable = false and j2.state = ''paused''), 0))';
begin
  v_def := pg_get_functiondef('app.conversation_work(uuid,interval,uuid,interval)'::regprocedure);
  if position(v_a in v_def) = 0 or position(v_b in v_def) = 0 then
    raise exception '0634: an anchor is not in app.conversation_work';
  end if;
  execute replace(replace(v_def, v_a, v_a2), v_b, v_b2);
  if position('pz.resumable = false' in pg_get_functiondef('app.conversation_work(uuid,interval,uuid,interval)'::regprocedure)) = 0 then
    raise exception '0634: the conversation_work change did not land';
  end if;
end
$m$;

