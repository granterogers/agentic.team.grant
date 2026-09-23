-- ---------------------------------------------------------------------------
-- HISTORICAL PRECONDITION, applied immediately before migration 0523
--
-- 0523 stops harness traffic reaching a production destination, and its fourth
-- control proves the rule cannot be switched off:
--
--     v_grant text := '1386648496';   -- his real chat
--     ...
--     insert into public.test_destinations values ('telegram', v_grant, ...);
--     raise exception '0523: Grant''s real chat was accepted as a test destination';
--
-- The refusal is not a hard-coded identity check — it is evidential, and that
-- is the good design here: *"A destination real traffic has ever reached is not
-- a test destination, and saying so is not a matter of judgement — the delivery
-- rows know."* The trigger counts real deliveries to that target.
--
-- On a blank database there are no delivery rows, so nothing has ever reached
-- that chat, so registering it as a test destination correctly succeeds — and
-- the control fires. The migration is right, the database is empty, and those
-- two facts are incompatible.
--
-- Part of F-002, and the clearest example of its shape: the migration does not
-- depend on Grant's chat id being special, it depends on his HISTORY of talking
-- to it. A fresh install has no history, and history is the one precondition
-- that cannot be created by configuration.
--
-- One sent delivery, attributed to no job, so `app.harness_job` cannot read it
-- as harness traffic and the count reaches the trigger.
--
-- `state = 'sent'` drags three constraints with it, read from `pg_constraint`
-- rather than guessed: `sent_at` iff sent, and a `message_ref` that only a sent
-- or suppressed row may carry. The same travel-together shape as a `documents`
-- fixture, and the same cure.
-- ---------------------------------------------------------------------------
insert into public.deliveries
  (channel, dedupe_key, account_ref, target_ref, purpose, state, lease_expires_at,
   sent_at, message_ref)
values ('telegram', 'fresh-install-scaffold-0523', 'chief', '1386648496', 'result',
        'sent', app.now_utc() + interval '1 hour', app.now_utc() - interval '1 day',
        'fresh-install-scaffold-message')
on conflict do nothing;
