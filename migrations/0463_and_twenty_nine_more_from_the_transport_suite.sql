-- The same defect as 0460, in a second suite, found the same way (#133).
--
-- `verify:transport` proves that `app.say_in_project` drops an addressee
-- naming nobody rather than losing the message -- which requires calling the
-- REAL writer, so the job it creates is `requested_by` teamhq:grant. Twenty-
-- nine of them read as things Grant asked.
--
-- Both witnesses say real for the same two reasons 0460 records:
-- `jobs.is_fixture` is generated from that string, and `app.harness_job` asks
-- whether the PROJECT is a fixture -- these land on the unnamed project, which
-- is real.
--
-- That makes four suites now (0342's verify:addressing, 0351's gate-3, 0460's
-- verify:history, this one), which is a class rather than four accidents:
-- **a suite that drives the real enqueue path with a real-looking actor
-- produces jobs indistinguishable from Grant's.** 0342 added the `%:verify-%`
-- branch to the generated column precisely so a suite can name its actor
-- `verify-something` and stay visible as harness traffic; the suites that
-- cannot do that -- because the actor is part of what they are asserting --
-- have to correct their own attribution in teardown, and now do, with an
-- assertion under it.
--
-- This file corrects the rows that exist. The rule does not live here.

update public.jobs
   set requested_by = 'verify:transport'
 where not is_fixture
   and coalesce(pinned_config->>'instruction', '') like 'transport proof %';

do $$
declare n int;
begin
  select count(*) into n from public.jobs
   where not is_fixture
     and coalesce(pinned_config->>'instruction', '') like 'transport proof %';
  if n > 0 then
    raise exception 'still % transport probe(s) reading as real', n;
  end if;
end $$;
