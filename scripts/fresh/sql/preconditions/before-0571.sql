-- ---------------------------------------------------------------------------
-- HISTORICAL PRECONDITION, applied immediately before migration 0571
--
-- 0571 teaches the office that a turn which died owes the person a sentence,
-- and it drives the reader it creates against the case the reader exists for:
--
--     select count(*) ... from app.owed_a_word('3cb9409e-…'::uuid);
--     if v_found <> 1 then raise exception 'the voice note that died is owed
--       a word, and owed_a_word found % row(s)', v_found;
--
-- That uuid is Grant's 17-second voice note of 8 September -- a real job in
-- his `public.jobs`, with a real `inbound_commands` row behind it, that failed
-- with no delivery. On a blank database it does not exist, `owed_a_word`
-- correctly returns nothing, and the migration raises about its own assertion
-- rather than about anything wrong with the function.
--
-- F-002 again, and this is its hardest shape: the migration does not merely
-- need A job, it needs a job in a specific SHAPE -- terminal failed, root,
-- from a repliable channel, with an inbound origin, with nothing delivered.
-- That shape is the whole definition the function encodes, so a scaffold of
-- it is the only precondition that can be written without weakening the
-- assertion.
--
-- What is scaffolded is the STRUCTURE of that turn, not its content. The
-- instruction says what it is; the transcript is not invented, because
-- `owed_a_word` never reads one. The two controls below it are unaffected:
-- the job is `office.instruction`, which is not a row in `responsibilities`,
-- so the duty control still passes, and nothing here completes.
--
-- Three details read from the schema rather than guessed: `dedupe_key` is
-- constrained to `^[a-z]+:[a-z_]+:[A-Za-z0-9:_.-]+$`; `queued -> failed` is a
-- legal transition, so the job reaches its terminal state through the same
-- trigger every real job does; and `origin_ref` is `<chat>:<thread>`, of which
-- the reader takes the first field as the target.
-- ---------------------------------------------------------------------------

insert into public.jobs
  (job_id, correlation_id, idempotency_key, kind, requested_by, announce, pinned_config)
values ('3cb9409e-22be-4a57-91b8-506b0906e8cc'::uuid,
        gen_random_uuid(),
        'fresh-install-scaffold-0571',
        'office.instruction',
        'harness:verify-fresh-install-scaffold',
        false,
        '{}'::jsonb)
on conflict do nothing;

insert into public.inbound_commands
  (origin_channel, origin_ref, actor, instruction, dedupe_key, job_id, received_at)
values ('telegram', '1386648496', 'harness:verify-fresh-install-scaffold',
        'fresh-install baseline scaffolding: the shape of a turn that died unanswered',
        'telegram:fresh_install:scaffold-0571',
        '3cb9409e-22be-4a57-91b8-506b0906e8cc'::uuid,
        app.now_utc() - interval '3 days')
on conflict do nothing;

update public.jobs j
   set pinned_config = j.pinned_config
       || jsonb_build_object('command_id',
            (select c.command_id from public.inbound_commands c
              where c.dedupe_key = 'telegram:fresh_install:scaffold-0571'))
 where j.job_id = '3cb9409e-22be-4a57-91b8-506b0906e8cc'::uuid;

update public.jobs
   set state = 'failed',
       state_reason = 'fresh-install baseline scaffolding; never ran'
 where job_id = '3cb9409e-22be-4a57-91b8-506b0906e8cc'::uuid
   and state = 'queued';
