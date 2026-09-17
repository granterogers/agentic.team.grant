-- Sixty-one harness jobs that every reader counts as real (#133).
--
-- Found while building `npm run replay`, which is the point of #133: the first
-- three requests it selected as "real history" were all
-- "Asked nowhere in particular <run>", written by `verify:history`.
--
-- ## Why nothing caught them
--
-- `verify:history` drives the REAL product path on purpose -- it inserts an
-- inbound command and calls `app.enqueue_inbound`, because a suite that
-- bypassed that would not be testing the thing it exists to test. That
-- composes `requested_by` as <origin_channel>:<actor>, and the actors are
-- 'grant' and 'U0HIST', so the jobs are `telegram:grant` and `slack:U0HIST`:
-- indistinguishable from Grant speaking.
--
-- So all three witnesses say real. `jobs.is_fixture` is generated from
-- `requested_by` and sees a real channel and a real-looking actor.
-- `app.harness_job` (0355) adds "does it belong to a fixture project", and
-- these landed on `unnamed`, which is a real project. And the suite's own
-- teardown cancels jobs BY PROJECT, so the two inserts that deliberately carry
-- no project_id -- the unmapped-channel case and the routing-guess case -- were
-- never in its reach at all.
--
-- This is the fifth instance of the shape CLAUDE.md records (0342's 43 jobs,
-- 0351's telegram:4242, 0355's 85 fixture-project jobs, 0394's 204 inference
-- calls). Every one of them was harness traffic about to be read as the office.
--
-- ## What this does, and what it deliberately does not
--
-- It corrects the ROWS that exist, by the text those five inserts write, which
-- carries the suite's run id and cannot collide with anything a person typed.
-- `requested_by` becomes `verify:history`, so `is_fixture` regenerates true and
-- every reader that already excludes harness traffic now excludes these.
--
-- It does NOT add a text rule anywhere that runs again. A permanent filter
-- keyed on the sentences one suite happens to write today is the stale
-- enumeration this repository keeps paying for; the durable half of the fix is
-- in the suite, which now corrects its own attribution in teardown and ASSERTS
-- that nothing of its run is left looking real.

update public.jobs
   set requested_by = 'verify:history'
 where not is_fixture
   and kind = 'office.instruction'
   and (
        pinned_config->>'instruction' like 'Asked in the channel %'
     or pinned_config->>'instruction' like 'Asked nowhere in particular %'
     or pinned_config->>'instruction' like 'Nothing in particular %'
     or pinned_config->>'instruction' like 'Please look at this %'
   );

-- The repair, asserted rather than assumed. A correction that matched nothing
-- looks exactly like one that worked, and this file is the only place that can
-- still say how many there were.
do $$
declare n int;
begin
  select count(*) into n from public.jobs
   where not is_fixture and kind = 'office.instruction'
     and (pinned_config->>'instruction' like 'Asked in the channel %'
       or pinned_config->>'instruction' like 'Asked nowhere in particular %'
       or pinned_config->>'instruction' like 'Nothing in particular %'
       or pinned_config->>'instruction' like 'Please look at this %');
  if n > 0 then
    raise exception 'still % harness job(s) reading as real after the correction', n;
  end if;
end $$;
