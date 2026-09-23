-- ---------------------------------------------------------------------------
-- HISTORICAL PRECONDITION, applied immediately before migration 0490
--
-- 0490 derives whether a proposal is harness traffic from whether its EVIDENCE
-- is, and its drive block needs both sides to prove the derivation
-- discriminates:
--
--     select job_id into v_real from public.jobs
--      where not is_fixture and not app.harness_job(job_id) ...
--     if v_real is null then raise exception '0490: no real job to build the
--       control from';
--
-- That control is the right shape — CLAUDE.md: *"a suite made only of refusals
-- passes against a system that refuses everything"* — and it means the
-- migration needs a job that does NOT look like harness traffic. A blank
-- database has neither kind.
--
-- Part of F-002. This row must not be fixture-shaped or the control it feeds
-- is vacuous, and it must not be on a fixture project either: `app.harness_job`
-- derives harness-ness from the project too (0355). So it carries no project at
-- all, which is what a real instruction from a channel looks like before it is
-- routed.
-- ---------------------------------------------------------------------------
insert into public.jobs (correlation_id, idempotency_key, kind, requested_by, announce)
values (gen_random_uuid(), 'fresh-install-scaffold-0490-control', 'office.instruction',
        'telegram:scaffold', false)
on conflict do nothing;

update public.jobs
   set state = 'cancelled',
       state_reason = 'fresh-install baseline scaffolding; never ran'
 where idempotency_key = 'fresh-install-scaffold-0490-control'
   and state = 'queued';
