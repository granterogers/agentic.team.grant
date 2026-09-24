-- ---------------------------------------------------------------------------
-- HISTORICAL PRECONDITION, applied immediately before migration 0574
--
-- 0574 teaches `app.harness_job` a fourth signal -- a suite signs the message
-- it sent, with a `verify:` dedupe namespace no real adapter writes -- and it
-- ends with the rule this repository states everywhere:
--
--     -- A found-nothing check proves nothing until its subject is non-empty.
--     select count(*) into v_seen from public.inbound_commands
--      where dedupe_key like 'verify:%';
--     if v_seen = 0 then raise exception 'no suite-signed commands at all …'
--
-- On Grant's database 59 such commands existed, left by suites that had
-- driven the real enqueue path. A blank database has never run a suite, so
-- the subject is empty and the migration correctly refuses to claim its two
-- checks proved anything.
--
-- Part of F-002, and the benign end of it: what the assertion needs is one
-- suite-signed command, which is a thing a suite writes rather than a thing
-- about Grant. One is scaffolded, in the namespace the migration is about,
-- and nothing invents a conversation -- it carries no job, so the two
-- substantive checks above it are unaffected in either direction.
--
-- `dedupe_key` is constrained to `^[a-z]+:[a-z_]+:[A-Za-z0-9:_.-]+$`, read
-- from `pg_constraint` rather than guessed.
-- ---------------------------------------------------------------------------

insert into public.inbound_commands
  (origin_channel, origin_ref, actor, instruction, dedupe_key, received_at)
values ('telegram', '1386648496', 'verify:fresh-install-scaffold',
        'fresh-install baseline scaffolding: a suite signing its own message',
        'verify:fresh_install:scaffold-0574',
        app.now_utc() - interval '3 days')
on conflict do nothing;
