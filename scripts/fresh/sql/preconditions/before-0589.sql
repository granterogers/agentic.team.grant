-- ---------------------------------------------------------------------------
-- HISTORICAL PRECONDITION, applied immediately before migration 0589
--
-- 0589 dedupes a duty's report on what it is ABOUT rather than on the words a
-- model happened to choose, and drives it on the case 0584 could not handle:
--
--     select job_id into v_duty from public.jobs
--      where kind = 'office.slack_rotate' order by created_at desc limit 1;
--     if v_duty is null or v_chat is null then
--       raise exception 'no subject to drive with';
--
-- The same shape as 0584 and 0585 -- a blank database has never rotated a
-- Slack token, so there is no job of that kind to drive with.
--
-- Part of F-002. One duty job of the named kind is scaffolded. Everything the
-- migration asserts is still decided by `app.say_once` and by whether
-- `office.slack_rotate` is a row in `public.responsibilities`, which the
-- corpus itself creates; the fixtures the drive writes are rolled back by its
-- own subtransaction.
-- ---------------------------------------------------------------------------

insert into public.jobs
  (correlation_id, idempotency_key, kind, requested_by, announce)
values (gen_random_uuid(), 'fresh-install-scaffold-0589', 'office.slack_rotate',
        'harness:verify-fresh-install-scaffold', false)
on conflict do nothing;

update public.jobs
   set state = 'cancelled',
       state_reason = 'fresh-install baseline scaffolding; never ran'
 where idempotency_key = 'fresh-install-scaffold-0589'
   and state = 'queued';
