-- ---------------------------------------------------------------------------
-- HISTORICAL PRECONDITION, applied immediately before migration 0582
--
-- 0582 stops the office having two vocabularies for "a suite signed this":
-- 0574 read only the FIRST segment of the dedupe key, and a voice turn is
-- composed `<channel>:turn:<who>`, so a suite driving the live voice webhook
-- hid its label in the third segment. It drives the widened predicate in both
-- directions and then asks the non-emptiness question:
--
--     if v_caught = 0 then
--       raise exception 'the check matched nothing, so it proves nothing';
--
-- On Grant's database fourteen such turns existed -- the ones that reached his
-- real chat because the guard and its witness shared one blind predicate. A
-- blank database has none, so the check correctly refuses to claim it proved
-- anything.
--
-- Part of F-002. One turn is scaffolded in exactly the shape the migration is
-- about -- the label in the third segment of a voice key -- so `v_caught` has
-- a subject. The control immediately below it is three literal calls to
-- `app.harness_label` and is unaffected by anything here, which is the half of
-- the proof that matters: nothing scaffolded can make a real request read as
-- harness.
--
-- The job is named so `jobs.is_fixture` generates true as well. That is not
-- laundering the assertion -- `v_caught` counts jobs the predicate catches and
-- both signals agree it is harness, which is what a scaffold should be: the
-- structure of the case, honestly labelled in every column that can carry a
-- label.
-- ---------------------------------------------------------------------------

insert into public.jobs
  (correlation_id, idempotency_key, kind, requested_by, announce)
values (gen_random_uuid(), 'fresh-install-scaffold-0582', 'office.instruction',
        'harness:verify-fresh-install-scaffold', false)
on conflict do nothing;

insert into public.inbound_commands
  (origin_channel, origin_ref, actor, instruction, dedupe_key, job_id, received_at)
select 'voice', '1386648496', 'harness:verify-fresh-install-scaffold',
       'fresh-install baseline scaffolding: a suite labelling itself in the third segment',
       'voice:turn:verify-fresh-install-scaffold',
       j.job_id,
       app.now_utc() - interval '3 days'
  from public.jobs j
 where j.idempotency_key = 'fresh-install-scaffold-0582'
on conflict do nothing;

update public.jobs j
   set pinned_config = j.pinned_config
       || jsonb_build_object('command_id',
            (select c.command_id from public.inbound_commands c
              where c.dedupe_key = 'voice:turn:verify-fresh-install-scaffold'))
 where j.idempotency_key = 'fresh-install-scaffold-0582';

update public.jobs
   set state = 'cancelled',
       state_reason = 'fresh-install baseline scaffolding; never ran'
 where idempotency_key = 'fresh-install-scaffold-0582'
   and state = 'queued';
