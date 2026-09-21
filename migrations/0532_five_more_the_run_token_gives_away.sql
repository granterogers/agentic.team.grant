/*
  0532 — five more, and the property that gives them away

  0531 cleared twenty-one. Five were left, and they are the same class one
  layer out: personal tasks written by verify:mytasks and by the conversation
  session runner, through the real `app.my_task_add`, before 0530 gave that
  function a job to remember.

    Ring the venue ulbo4g1u            (twice)
    Ring the printers ulbo4g1u
    On 2026-12-01 to ring the venue about ykjndo68
    On 2026-12-01 to ring the venue about 6uowmf5a

  WHAT ACTUALLY GIVES THEM AWAY is not the nouns. Every suite here builds its
  run token the same way — Math.random().toString(36).slice(2, 10) — so each of
  these titles carries a standalone eight-character word mixing letters and
  digits. That is a property of how the harness names things, and it survives
  the next suite choosing a different noun, which a list of nouns does not.

  It is used here to IDENTIFY, once, the five rows that exist today. It is not
  made a rule, because a real task could legitimately carry an order number and
  a filter that hides Grant's own work is worse than the debris it removes.
  check:leaks reports the count from here on; 0530's job column is the rule.

  This is the third one-off sweep in three migrations, which is the honest
  shape of the finding: the durable fix arrived with 0530 and everything
  written before it has to be cleared by hand.
*/

do $sweep$
declare
  v_tasks int;
begin
  delete from public.tasks t
   where t.assigned_to_human
     and t.state <> 'done'
     and t.added_by = 'grant'
     and t.job_id is null
     and t.title ~ '\m[a-z0-9]{8}\M'
     and t.title ~ '\m[a-z]*[0-9][a-z0-9]*\M'
     and (t.title like 'Ring the %' or t.title like 'On 20%-%-% to ring %');
  get diagnostics v_tasks = row_count;
  raise notice '0532 swept % personal task(s) carrying a harness run token', v_tasks;
  if v_tasks <> 5 then
    /*
      Named rather than tolerated. Five is what was counted the moment before
      this migration was written; a different number means the state moved
      under it and somebody should look, not that the sweep should widen.
    */
    raise warning '0532 expected 5, removed % — check what changed', v_tasks;
  end if;
end;
$sweep$;

do $proof$
declare
  v_left int;
begin
  select count(*) into v_left
    from public.tasks t
   where t.assigned_to_human
     and t.state <> 'done'
     and (t.title like 'Ring the %' or t.title like 'On 20%-%-% to ring %');
  if v_left <> 0 then
    raise exception '0532: % harness task(s) are still on his list', v_left;
  end if;
end;
$proof$;
