begin;

-- The studio payload counts an office's live jobs on every load. jobs_office_idx finds every job the office has,
-- so the count has to visit the table for each one; with ~53,000 jobs and constant worker churn that is about
-- 0.75 s for the busiest office, several times per page. A partial index holds only the live jobs, which is what the
-- count reads. Additive and reversible (drop index). Not applied: production schema change, awaiting approval.

create index if not exists jobs_live_by_office_idx
  on public.jobs (office_id)
  where state not in ('complete', 'cancelled', 'failed');

commit;
