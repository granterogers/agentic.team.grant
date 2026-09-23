-- Acknowledging the escapes 0582 made visible (#354).
--
-- These are not new escapes. They are old ones the witness could not report,
-- because app.claim_delivery and check:leaks both ask app.harness_job and
-- app.harness_job could not read a harness label outside the dedupe key's first
-- segment. 0582 closed that. The moment it applied, check:leaks went from
-- "new escapes since containment fix: 0" to 20.
--
-- Recorded rather than left red, for the reason CLAUDE.md already gives about
-- the two #298 rows: a gate that is red BY DESIGN teaches people to skip it,
-- and a witness that cannot say "N known, 0 new" stops being able to say
-- anything. Nothing in public.deliveries is touched and nothing is rewritten
-- to obtain green -- the sends happened, they are still there, and this table
-- is the sanctioned place to say they are accounted for.
--
-- The class is closed going forward: 0582 means app.claim_delivery now refuses
-- this traffic a production destination, suppressing rather than raising, so
-- the suite that produced these keeps working and its messages stop reaching
-- Grant. A suite that genuinely needs to deliver registers a destination in
-- public.test_destinations, which is deliberate, visible and per-destination.

insert into public.known_escapes (delivery_id, issue, why, acknowledged_at)
select d.delivery_id,
       '#354',
       'invisible to app.harness_job until 0582: the suite labelled itself in '
       || 'the dedupe key''s third segment (voice:turn:verify-...) and 0574''s '
       || 'split_part test read only the first. The guard and its witness '
       || 'shared the blind spot, so both reported clean.',
       app.now_utc()
  from public.deliveries d
  join public.jobs j on j.job_id = d.job_id
 where app.harness_job(j.job_id)
   and d.sent_at is not null
   and d.created_at > app.harness_guard_since()
   and not exists (
     select 1 from public.known_escapes k where k.delivery_id = d.delivery_id
   );

-- Drive it. The witness must now be able to say "known, none new".
do $$
declare
  v_new integer;
  v_known integer;
begin
  select coalesce(jsonb_array_length(app.harness_escapes() -> 'fresh'), 0),
         coalesce(jsonb_array_length(app.harness_escapes() -> 'known'), 0)
    into v_new, v_known;

  if v_new > 0 then
    raise exception '% escape(s) still unaccounted for', v_new;
  end if;

  -- The control: acknowledging must not have emptied the record. If this is
  -- zero then the rows were removed rather than recorded, which is the one
  -- outcome this migration must never produce.
  if v_known < 3 then
    raise exception
      'known escapes fell to %, so the evidence was lost rather than recorded',
      v_known;
  end if;
end $$;
