-- ---------------------------------------------------------------------------
-- HISTORICAL PRECONDITION, applied immediately before migration 0583
--
-- 0583 acknowledges the escapes 0582 made visible: twenty deliveries from
-- suite-labelled voice turns that reached Grant's real chat and real Slack
-- channels, invisible to the guard because the guard and its witness shared
-- one blind predicate. It records them rather than removing them, and then
-- drives the witness:
--
--     if v_known < 3 then
--       raise exception 'known escapes fell to %, so the evidence was lost
--         rather than recorded', v_known;
--
-- That control is the important half of the migration -- it is what proves
-- the acknowledgement did not quietly empty the record -- and on a blank
-- database there is nothing to acknowledge, so it fires.
--
-- Part of F-002, and the same shape as the precondition before 0524, which
-- seeds the escaped deliveries 0524 counts. Three are scaffolded here, on the
-- suite-labelled voice turn the precondition before 0582 already created, in
-- the window the guard watches -- `created_at` after 0523's own ledger row,
-- which `app.harness_guard_since()` reads and which this replay wrote minutes
-- ago.
--
-- Nothing about the migration's meaning changes. 0583's insert still has to
-- FIND them through `app.harness_job`, which means 0582's widened predicate
-- still has to work; if it did not, `v_new` above would be non-zero and the
-- migration would fail on the other assertion instead.
--
-- `state = 'sent'` drags three constraints with it -- `sent_at` iff sent, and
-- a `message_ref` only a sent or suppressed row may carry -- read from
-- `pg_constraint` rather than guessed.
-- ---------------------------------------------------------------------------

insert into public.deliveries
  (channel, dedupe_key, account_ref, target_ref, purpose, state, lease_expires_at,
   sent_at, message_ref, created_at, job_id)
select 'telegram',
       'fresh-install-scaffold-0583-' || g::text,
       'chief', '1386648496', 'result', 'sent',
       app.now_utc() + interval '1 hour',
       app.now_utc(),
       'fresh-install-scaffold-message-0583-' || g::text,
       app.now_utc(),
       (select job_id from public.jobs
         where idempotency_key = 'fresh-install-scaffold-0582')
  from generate_series(1, 3) g
on conflict do nothing;
