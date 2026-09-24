-- ---------------------------------------------------------------------------
-- HISTORICAL PRECONDITION, applied immediately before migration 0584
--
-- 0584 stops a scheduled duty saying the same sentence every hour, and drives
-- `app.say_once` in both directions -- a duty silenced on the repeat, and
-- conversation deliberately left alone. It needs one job of each shape:
--
--     select job_id into v_duty from public.jobs
--      where kind = 'google.read_mail' order by created_at desc limit 1;
--     select job_id into v_chat from public.jobs
--      where kind = 'office.instruction' order by created_at desc limit 1;
--     if v_duty is null or v_chat is null then
--       raise exception 'no subject to drive with';
--
-- The conversation half already exists on a replayed database -- the earlier
-- preconditions created `office.instruction` jobs. Nothing has ever scheduled
-- a mail read, so the duty half is null and the migration correctly refuses to
-- drive with no subject.
--
-- Part of F-002. One duty job is scaffolded, of the kind the drive names.
-- Nothing else about it matters to the migration: `say_once` reads the job's
-- KIND and looks that kind up in `public.responsibilities`, which the corpus
-- itself populates, so the assertion still depends on the product rather than
-- on anything set here. The fixtures the drive writes are rolled back by its
-- own subtransaction; this row is not one of them, so it is named and
-- cancelled like every other scaffold.
-- ---------------------------------------------------------------------------

insert into public.jobs
  (correlation_id, idempotency_key, kind, requested_by, announce)
values (gen_random_uuid(), 'fresh-install-scaffold-0584', 'google.read_mail',
        'harness:verify-fresh-install-scaffold', false)
on conflict do nothing;

update public.jobs
   set state = 'cancelled',
       state_reason = 'fresh-install baseline scaffolding; never ran'
 where idempotency_key = 'fresh-install-scaffold-0584'
   and state = 'queued';
