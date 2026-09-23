-- ---------------------------------------------------------------------------
-- HISTORICAL PRECONDITION, applied immediately before migration 0524
--
-- The most extreme instance of F-002 in the corpus. 0524 asserts a VOLUME of
-- Grant's accumulated history:
--
--     if (v ->> 'before_the_guard')::int < 100 then
--       raise exception '0524: the historical count reads %, which is too low
--         to be the real one - the window is wrong';
--
-- It is counting how many harness deliveries escaped to real destinations
-- before 0523's guard existed, and refusing to believe a window that reports
-- fewer than a hundred — because on Grant's database the true answer was in the
-- hundreds, and a small number would have meant the window was computed wrongly.
--
-- The check is defensible on the database it was written for and impossible on
-- any other. No configuration, credential or account creates a hundred historical
-- mistakes; only running the system for months does.
--
-- 120 backdated harness deliveries, attributed to the fixture job so
-- `app.harness_job` reads them as harness traffic, which is what the count is
-- of. Backdated a day so they fall inside the "before the guard" window however
-- recently 0523 was applied in this replay.
-- ---------------------------------------------------------------------------
insert into public.deliveries
  (channel, dedupe_key, account_ref, target_ref, purpose, state, lease_expires_at,
   sent_at, message_ref, created_at, job_id)
select 'telegram',
       'fresh-install-scaffold-0524-' || g::text,
       'chief', '1386648496', 'result', 'sent',
       app.now_utc() + interval '1 hour',
       app.now_utc() - interval '2 days',
       'fresh-install-scaffold-message-' || g::text,
       app.now_utc() - interval '2 days',
       (select job_id from public.jobs
         where idempotency_key = 'fresh-install-scaffold-0489')
from generate_series(1, 120) g
on conflict do nothing;
