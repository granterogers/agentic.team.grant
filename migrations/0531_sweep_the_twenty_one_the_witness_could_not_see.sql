/*
  0531 — sweep the twenty-one the witness could not see

  0530 gave a personal task the job that made it, and taught the four readers
  Grant looks at to ask app.harness_task. That is the rule from here on. This
  migration clears the rows that were already there when the rule arrived.

  Twenty-one tasks, on his personal list:

    * two called "draft.create — report outdated items" and "draft.create —
      produce a draft listing what is out of date", raised as blockers by
      verify:composes' race case against a real project called Unnamed;
    * nineteen reading "Review what came out of zelmirath9vjm8c5b",
      "Reconcile the velkanth3fd7tsss register" and the like, written by
      crashed runs of verify:pursues through the real task.create executor.

  The two are DERIVABLE: their job_id is set and app.harness_job says harness.
  The nineteen are not — they predate the job column, so nothing in the row
  can say where they came from, and the only property they actually share is
  a nonsense word no real task can contain. zelmirath and velkanth are the run
  tokens verify:pursues generates.

  So this is a ONE-OFF sweep of rows that exist today, not a rule. A future
  suite picking a different nonsense word is caught by 0530's job column, not
  by a list of words that will always be missing the next one — CLAUDE.md's
  standing correction, and the reason the two halves are separate migrations.

  Their blockers go with them. A blocker task is also a blocker, so removing
  the task alone would leave two open questions on a real project, asked by a
  job that was never Grant's. And the pause that produced one of them is
  awaiting_approval with resumable false, so the job waits for an answer
  nobody owes it: it is cancelled, along with any other harness job left
  stranded for more than six hours.

  WITHDRAWN, not resolved. `blocker_state` offers open, resolved, expired and
  withdrawn, and the true one is withdrawn: nobody answered these, and marking
  them resolved would put a decision in the record that nobody made.

  The proof block at the end is the point of the whole file. A sweep that
  matches nothing looks exactly like a sweep that worked.
*/

do $sweep$
declare
  v_tasks int;
  v_blockers int;
  v_jobs int;
begin
  update public.blockers b
     set state = 'withdrawn',
         resolved_at = app.now_utc(),
         resolution = 'swept by 0531 — raised by a verification job, never Grant''s question'
   where b.state = 'open'
     and b.job_id is not null
     and app.harness_job(b.job_id);
  get diagnostics v_blockers = row_count;

  delete from public.tasks t
   where t.state <> 'done'
     and (t.title ~ '(zelmirath|velkanth)'
          or (t.job_id is not null and app.harness_job(t.job_id)));
  get diagnostics v_tasks = row_count;

  update public.jobs j
     set state = 'cancelled',
         finished_at = app.now_utc(),
         state_reason = '0531 — a verification job left waiting for an approval nobody owes it'
   where j.state in ('paused', 'queued', 'retrying')
     and app.harness_job(j.job_id)
     and j.created_at < app.now_utc() - interval '6 hours';
  get diagnostics v_jobs = row_count;

  raise notice '0531 swept: % task(s), % blocker(s), % stranded harness job(s)',
    v_tasks, v_blockers, v_jobs;
end;
$sweep$;

do $proof$
declare
  v_left int;
begin
  select count(*) into v_left
    from public.tasks t
   where t.state <> 'done'
     and t.assigned_to_human
     and (t.title ~ '(zelmirath|velkanth)'
          or (t.job_id is not null and app.harness_job(t.job_id)));
  if v_left <> 0 then
    raise exception '0531: % harness task(s) are still on his list', v_left;
  end if;
end;
$proof$;
