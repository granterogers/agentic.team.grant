-- ---------------------------------------------------------------------------
-- HISTORICAL PRECONDITION, applied immediately before migration 0591
--
-- 0591 closes the case of a "Go ahead" that started nothing -- an open
-- question of Grant's whose affirmative answer had no follow-on to run -- and
-- drives the writer and the answer end to end on a real subject:
--
--     select j.job_id into v_job from public.jobs
--      where j.kind = 'notebook.generate' …
--     if v_job is null then
--       raise exception 'DRIVE:no notebook.generate job to drive against';
--
-- A blank database has never generated anything from a notebook, so there is
-- no subject and the migration correctly refuses to claim it drove one.
--
-- Part of F-002, and the last of the duty/job-kind family -- 0584, 0585, 0589
-- and this one all need one job of a named kind to drive against. One is
-- scaffolded, on the scaffold project the precondition before 0167 created.
--
-- The migration's first assertion is untouched and is the one that matters:
-- it asks a PROPERTY of every open question of his -- that none of them can
-- start nothing -- and nothing here writes a blocker, so that count stays
-- honest. Everything the drive itself creates is discarded by its own
-- `DRIVE:ok` marker.
-- ---------------------------------------------------------------------------

insert into public.jobs
  (correlation_id, idempotency_key, kind, requested_by, announce, project_id)
select gen_random_uuid(), 'fresh-install-scaffold-0591', 'notebook.generate',
       'harness:verify-fresh-install-scaffold', false, p.project_id
  from public.projects p
 where p.slug = 'baseline-scaffold-do-not-use'
on conflict do nothing;

update public.jobs
   set state = 'cancelled',
       state_reason = 'fresh-install baseline scaffolding; never ran'
 where idempotency_key = 'fresh-install-scaffold-0591'
   and state = 'queued';
