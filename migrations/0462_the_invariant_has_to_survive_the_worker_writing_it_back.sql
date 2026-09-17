-- 0461's trigger was INSERT only, and the worker writes announce AFTER the run.
--
-- `src/jobs/worker.ts` ends a job with
-- `update public.jobs set announce = <what the handler returned>`, so a
-- handler that says "this is worth telling him" re-arms the flag on a row the
-- insert trigger had already disarmed. Exactly one child in the next replay
-- run came back with announce = true, and the one beside it did not, which is
-- the shape of a rule that covers one of the two ways a column is written.
--
-- The invariant is about the JOB, not about the moment: a job in the replay
-- namespace is re-asking something a person really asked and already received,
-- so it may never be delivered, whoever sets the flag and whenever. Extended
-- to UPDATE, which is where the office's own decision lands.
--
-- Same forced value rather than a refusal, for the same reason: a handler
-- doing the right thing must not error because a harness is watching.

drop trigger if exists jobs_replays_never_announce on public.jobs;
create trigger jobs_replays_never_announce
  before insert or update on public.jobs
  for each row execute function app.replays_never_announce();

comment on function app.replays_never_announce() is
  'A replayed job and its descendants may not be delivered (#133), on insert AND '
  'on the update the worker uses to write the handler''s own announce decision. '
  'Scoped to the verify:replay- namespace: harness traffic in general MAY '
  'announce, because the suites that test delivery need to.';
