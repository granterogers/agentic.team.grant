-- The trace prunes itself (#115).
--
-- 0257 wrote `app.job_trace_prune` and nothing called it. That is the exact
-- pattern filed as #72 -- build the mechanism, forget the mouth -- and it is
-- worse here than usual, because the thing it fails to do is bound the largest
-- table in a 500 MB database.
--
-- Hourly rather than nightly, and capped per pass. An unbounded delete on the
-- highest-volume table is how a free-tier instance becomes unresponsive at 3am;
-- a capped hourly pass clears any realistic backlog within a day and never
-- holds a long lock. `job_trace_prune` reports `more` when it hit its cap, so a
-- backlog is visible rather than inferred.
--
-- Marcus, because retention is operations.

insert into public.responsibilities
  (slug, staff_id, description, job_kind, period_minutes)
select
  'job-trace-retention',
  s.staff_id,
  'Drop job trace steps older than thirty days, keeping the rollup on the job. '
  'The trace is the highest-volume table in the office and the free tier is '
  '500 MB, so the window is enforced rather than intended.',
  'office.prune_job_traces',
  60
  from public.staff s
 where s.slug = 'operations-director'
on conflict (slug) do nothing;
