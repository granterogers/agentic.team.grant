-- ---------------------------------------------------------------------------
-- HISTORICAL PRECONDITION, applied immediately before migration 0566
--
-- 0566 separates escapes the office has already accounted for from new ones,
-- and seeds the two it had accounted for BY THEIR DELIVERY ID:
--
--     insert into public.known_escapes (delivery_id, issue, why)
--     values ('7ff55c4a-…', '#298', 'verify:history corrected its attribution…'),
--            ('edc47073-…', '#298', …)
--
-- Those two uuids are rows in Grant's `deliveries` table. On a fresh install
-- they do not exist and the foreign key refuses the insert -- F-002's purest
-- shape: the migration asserts the CONTENTS of his database, and the content
-- it asserts is two specific historical mistakes.
--
-- The two rows are scaffolded with those exact ids, in the same idiom as the
-- precondition before 0524, which seeds the hundred escapes 0524 counts. They
-- are labelled as scaffolding in every column that can carry a label, and they
-- hang off the scaffold job the earlier preconditions already created -- so
-- nothing here pretends to be traffic that happened.
--
-- This does not invent business data: `known_escapes` is a record of defects,
-- the rows are the record, and what the precondition supplies is the referent
-- the foreign key needs. A fresh office's own escapes ledger stays empty,
-- because the baseline captures STRUCTURE and not these rows.
-- ---------------------------------------------------------------------------

insert into public.deliveries
  (delivery_id, channel, dedupe_key, account_ref, target_ref, purpose, state,
   lease_expires_at, sent_at, message_ref, created_at, job_id)
select v.id::uuid,
       'telegram',
       'fresh-install-scaffold-0566-' || v.id,
       'chief', '1386648496', 'result', 'sent',
       app.now_utc() + interval '1 hour',
       app.now_utc() - interval '2 days',
       'fresh-install-scaffold-message-0566-' || v.id,
       app.now_utc() - interval '2 days',
       (select job_id from public.jobs
         where idempotency_key = 'fresh-install-scaffold-0489')
  from (values ('7ff55c4a-3154-47b1-876b-50926963050d'),
               ('edc47073-5f7a-495f-9e4a-9af6a66ea912')) as v(id)
 where not exists (select 1 from public.deliveries d where d.delivery_id = v.id::uuid)
on conflict do nothing;
