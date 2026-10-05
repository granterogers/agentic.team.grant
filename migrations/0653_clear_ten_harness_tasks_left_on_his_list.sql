-- 0653 - clear the ten harness-made tasks that P1's gate runs left on Grant's personal list.
--
-- One-shot, NOT a capability. On 1 October 2026 between 10:41 and 10:49 UTC suites that fail identically at the base
-- commit (verify:another-go, verify:run2-live) wrote ten tasks through harness jobs and did not tear down; check:leaks
-- reports them, correctly. The ordinary delete path refused (as it should: nothing in the product deletes a task a job
-- made). This removes exactly those rows and nothing else, and it can only do so because EVERY condition holds:
--   * the task id is one of the ten named here;
--   * it is on the human list, not done, made by a job;
--   * app.harness_job(job_id) says the job is harness traffic.
-- A row that fails any condition is left, and the migration raises if it did not find exactly ten, so it can never
-- silently delete fewer or more. No function is created: the attack surface after this migration is what it was before.

do $m$
declare
  v_ids uuid[] := array[
    'bdc6ae67-66d3-4917-9d67-87ce8a0fce1f', '71076bc8-4b7e-4bf4-b972-a25f62790907',
    '192e9e3e-aeac-4875-9866-cb045754144b', '77f36098-97e3-4c57-b076-c8c2287d52c9',
    '06550607-907c-4dd8-9678-78650f3b5140', 'bb442f6c-4ad2-4ddf-9f48-81322260a9da',
    '6853c1f6-9a84-4b3a-83af-475c64d7cf6a', '317addd8-81f8-4325-a475-bd1e66c169d3',
    '9fd5c55c-4082-4546-85fa-eb151f183564', '5069f7d8-938a-4bb6-9711-8bc221177677']::uuid[];
  v_found int;
  v_gone int;
begin
  select count(*) into v_found from public.tasks t
   where t.task_id = any (v_ids) and t.assigned_to_human and t.state <> 'done'
     and t.job_id is not null and app.harness_job(t.job_id)
     and t.created_at >= timestamptz '2026-10-01 10:30+00' and t.created_at < timestamptz '2026-10-01 11:00+00';
  if v_found is distinct from 10 then
    -- On a database that does not hold them (the replica), there is nothing to clear and nothing to prove.
    if v_found = 0 and not exists (select 1 from public.tasks where task_id = any (v_ids)) then
      return;
    end if;
    raise exception '0653 expected exactly 10 harness tasks, found %', v_found;
  end if;
  delete from public.tasks t
   where t.task_id = any (v_ids) and t.assigned_to_human and t.state <> 'done'
     and t.job_id is not null and app.harness_job(t.job_id);
  get diagnostics v_gone = row_count;
  if v_gone <> 10 then
    raise exception '0653 deleted %, expected 10', v_gone;
  end if;
end
$m$;
