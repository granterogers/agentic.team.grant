-- ---------------------------------------------------------------------------
-- HISTORICAL PRECONDITION, applied immediately before migration 0489
--
-- 0489 ends with a drive block — *"A migration that applies cleanly is not a
-- function that works"*, which is a rule this repository learned the hard way
-- and applies rigorously. The drive needs a job to attribute a proposal to:
--
--     select job_id into v_job from public.jobs order by created_at desc limit 1;
--
-- On Grant's database that always found one. On a blank database `public.jobs`
-- is empty, `v_job` is null, and the repair it then drives finds nothing to put
-- back — so the migration raises about its own assertion rather than about
-- anything wrong with the code.
--
-- And the job has to be FINISHED. `app.proposals_undeliver` judges only jobs
-- in `complete`, `failed` or `cancelled` — deliberately, because *"a job still
-- running, retrying or waiting has not failed to deliver, it has not finished
-- trying"*. A queued scaffold job is invisible to it and the assertion fires
-- about a function that is working. `queued -> cancelled` is the legal move
-- (CLAUDE.md: cancelling is the teardown for a job left queued).
--
-- Part of F-002. The job below is named so that `jobs.is_fixture` generates
-- TRUE: `requested_by` matching `%:verify-%` is the shape 0342 added for
-- exactly this, and CLAUDE.md records five separate occasions where harness
-- traffic that did not look like harness traffic was reported to Grant as the
-- office failing.
-- ---------------------------------------------------------------------------
insert into public.jobs (correlation_id, idempotency_key, kind, requested_by, announce)
values (gen_random_uuid(), 'fresh-install-scaffold-0489', 'office.instruction',
        'harness:verify-fresh-install-scaffold', false)
on conflict do nothing;

update public.jobs
   set state = 'cancelled',
       state_reason = 'fresh-install baseline scaffolding; never ran'
 where idempotency_key = 'fresh-install-scaffold-0489'
   and state = 'queued';
