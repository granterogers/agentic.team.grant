-- A replayed job, and everything it spawns, can never announce (#133).
--
-- `npm run replay` re-asks real past requests against current code. It inserts
-- its parent job with announce = false and passes no notifier, which is enough
-- for the parent and is NOT enough for what the parent causes: replaying
-- "Write me a PDF report on ..." made the office enqueue two `artifact.report`
-- children, and a child inherits `requested_by` from its parent but takes the
-- column default for `announce`, which is true.
--
-- Both children completed and tried to reply. Nothing reached Grant, and the
-- reason is luck rather than design -- the state_reason reads "no inbound
-- telegram message to reply to", because the replay's fixture parent had no
-- message to answer. Replay a request that DID have a reply target and he
-- receives a second copy of an answer he got days ago, from a harness.
--
-- ## Why this is a trigger and not a rule about harness traffic
--
-- The obvious wider rule -- harness jobs may never announce -- is wrong.
-- 3,878 fixture jobs have announce = true, and they should: `verify:transport`
-- and `verify:worker` exist to exercise the delivery path, with notifiers they
-- supply themselves. A blanket refusal would break the suites that test
-- delivery, which is the opposite of safety.
--
-- What is safe to state absolutely is narrower, and it is about the REPLAY:
-- this one namespace re-runs things a person really asked, so anything it
-- causes is by definition a repeat of something already delivered. It has no
-- legitimate reason to speak, ever.
--
-- ## Why the database and not the script
--
-- The script cannot win the race. A child is inserted by the handler mid-run
-- and the deployed worker ticks every minute, so a script that corrected
-- `announce` after `runJob` returned would be correcting a row that may
-- already have been drained. A BEFORE INSERT trigger has no window.
--
-- Scoped by the prefix the replay owns, so no other suite can be touched by
-- it, and written as a forced value rather than a refusal: a replay that
-- ERRORED here would make the harness fail on the office behaving correctly.

create or replace function app.replays_never_announce()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if coalesce(new.requested_by, '') like 'verify:replay-%' then
    new.announce := false;
  end if;
  return new;
end;
$fn$;

comment on function app.replays_never_announce() is
  'A replayed job and its descendants may not be delivered (#133). Scoped to the '
  'verify:replay- namespace: harness traffic in general MAY announce, because the '
  'suites that test delivery need to.';

drop trigger if exists jobs_replays_never_announce on public.jobs;
create trigger jobs_replays_never_announce
  before insert on public.jobs
  for each row execute function app.replays_never_announce();
