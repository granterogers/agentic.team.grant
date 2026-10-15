begin;

-- An unchanged plan step is asked about once (COS-092, REG-006; Canary incident 15 October 2026, 09:36 / 09:53 / 10:59).
--
-- The plan executor raised a question every time a step came back `ask`, and nothing checked for an identical question
-- already open on the same job. Each raise was a new open blocker, and each one also put a task on Grant's list. The same
-- stop message reached him three times.
--
-- What changed, and only this:
--   * Existing duplicates are WITHDRAWN, not deleted (blockers are an audit record, and a withdrawn row is still readable):
--     for each job and action fingerprint with more than one open question, the newest stays open and the rest are withdrawn
--     with a resolution that says why. Withdrawing a blocker already closes its task (blockers_close_their_task).
--   * A partial unique index allows at most one OPEN question per job and action fingerprint. It is the same shape as
--     blockers_one_open_delivery_attention (1049). A caller that bypasses the writer is still refused.
--   * No new SQL function. `src/inference/record.ts` inserts with `on conflict do nothing` against this index and returns
--     the open question's id, so a repeat raise creates neither a second question nor a second task.
--
-- Not changed: resolved and expired questions, the standing and approval logic, and the fingerprint itself.

with ranked as (
  select blocker_id,
         row_number() over (partition by job_id, action_fingerprint order by created_at desc, blocker_id) as rn
    from public.blockers
   where state = 'open'
     and action_fingerprint is not null
     and job_id is not null
)
update public.blockers b
   set state = 'withdrawn',
       resolved_at = app.now_utc(),
       resolution = 'withdrawn: an identical question was already open for this job, so this repeat was not asked again (1073)'
  from ranked r
 where b.blocker_id = r.blocker_id
   and r.rn > 1;

create unique index if not exists blockers_one_open_per_job_action
  on public.blockers (job_id, action_fingerprint)
  where state = 'open' and action_fingerprint is not null and job_id is not null;

commit;
