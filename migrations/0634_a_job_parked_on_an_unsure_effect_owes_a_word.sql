-- 0634 - a turn parked for good owes the person who asked it a sentence (final audit, invariants 28 and 29).
--
-- `app.owed_a_word` said who is owed a word when a turn DIES (state failed). A turn can also end without an answer
-- by PARKING for good: an external step that was interrupted (`needs_reconciliation`) or written by other code
-- (`checkpoint_stale`) is a non-resumable pause, nothing resumes it and nothing asks anybody, so Grant's request sat
-- in `paused` in silence. The safe direction held - the step is never repeated - but "anything that can end a turn
-- with no answer has to say so somewhere he looks" did not.
--
-- A parked turn is owed a word when: it is a root job of a real conversation, it is paused, it holds an open
-- NON-resumable pause, no question to him is open (a question reaches him by its own delivery), and nothing has been
-- delivered for it yet. Built from the LIVE definition so one predicate moves and nothing else does; it refuses to
-- apply when the predicate it means to widen is not there.

do $m$
declare
  v_def text;
  v_old constant text := E'and j.state = ''failed''';
  v_new constant text := E'and (j.state = ''failed''
          or (j.state = ''paused''
              and exists (select 1 from public.job_pauses p
                           where p.job_id = j.job_id and p.resumed_at is null and p.resumable = false)
              and not exists (select 1 from public.blockers b
                               where b.job_id = j.job_id and b.state = ''open'')))';
begin
  v_def := pg_get_functiondef('app.owed_a_word(uuid)'::regprocedure);
  if position(v_old in v_def) = 0 then
    raise exception '0634: the predicate to widen is not in app.owed_a_word';
  end if;
  execute replace(v_def, v_old, v_new);
  if position('j.state = ''paused''' in pg_get_functiondef('app.owed_a_word(uuid)'::regprocedure)) = 0 then
    raise exception '0634: the widening did not land';
  end if;
end
$m$;
