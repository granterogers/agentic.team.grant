begin;

/**
 * A probe is not a wall the office hit.
 *
 * ## What Grant saw
 *
 * #54 shipped the Governance tab an hour before this, and its best list — the
 * one the Issue calls the most useful thing on the page — is what each agent
 * TRIED and could not do. Ruby's card said:
 *
 *     probe-need-j4je9xrc          the office has no such tool     8x
 *     probe-need-j4je9xrc-ambiguous                                1x
 *     ...
 *
 * Five rows, all of them debris from a `verify:proposes` run, on a governance
 * surface, presented as things a member of staff had genuinely been stopped
 * by. That is exactly the failure `jobs.is_fixture` and `projects.is_fixture`
 * were introduced to prevent, and which CLAUDE.md records as "harness traffic
 * was reported to Grant as the office collapsing".
 *
 * ## Why it happened, which is not "the suite forgot"
 *
 * `verify:proposes` tests `impediments_tally`, and the tally EXCLUDES
 * fixtures — so a suite named `fixture-…` cannot test it at all. That is #45's
 * trap, and the suite obeyed the rule by using real subjects. The version that
 * left this debris was the one written before 0297 gave `raise_proposals` its
 * `p_include_fixtures` parameter; once that existed the suite moved to fixture
 * jobs, and it leaves nothing today. The rows it already wrote are permanent:
 * `job_impediments` refuses DELETE, UPDATE and TRUNCATE by trigger (§6).
 *
 * ## Two halves, and the second is the durable one
 *
 * **The data.** `jobs.is_fixture` is GENERATED from `requested_by`, so
 * correcting the attribution on the probe jobs regenerates it. The jobs are
 * not append-only — the suite already cancels them — so this is a permitted
 * write, and it is an honest one: the work was requested by a verification
 * run, and recording it as Grant's was the original error.
 *
 * **The reader.** `job_impediments.is_fixture` is a plain column COPIED from
 * the job by trigger at insert, and it can never be corrected afterwards
 * because the same §6 triggers refuse the update. A flag that can be wrong and
 * can never be fixed is not a flag to read. So the tally now asks the JOB,
 * whose `is_fixture` is generated and therefore always current, and treats the
 * ledger's own copy as a fallback for the rows that predate a job.
 *
 * This is the general lesson and it is why the reader changes rather than only
 * the rows: **a denormalised flag on an append-only table is a fact frozen at
 * insert.** Join to the thing that can still tell the truth.
 *
 * Nothing is deleted. The impediments stay on the ledger exactly as written —
 * they simply stop being counted as work, which is what a fixture is for.
 */

-- ---------------------------------------------------------------------------
-- The data: attribute the probe jobs to the run that made them
-- ---------------------------------------------------------------------------

/*
  `requested_by`, not `state`. Cancelling them (which the suite does, and which
  the tail of this migration finishes) removes them from the queue but not from
  the tally: an impediment on a cancelled job is still an impediment, and it
  SHOULD be — a job cancelled because it was blocked is exactly the case the
  tally exists to count. Only the attribution distinguishes a probe from work.
*/
update public.jobs
   set requested_by = 'verify:proposes'
 where idempotency_key like 'probe-proposes-%'
   and requested_by <> 'verify:proposes';

/*
  And the fourteen this suite left queued when a run of it crashed before its
  teardown. They can only ever reach a terminal state — `job_state_transitions`
  is append-only and holds a foreign key to `jobs` (ADR-0022) — so cancelled,
  and unlinked from the project so they do not sit in a dashboard project's
  history as work nobody did.

  `app.office_health()` reported them as fourteen stalled research jobs with
  the oldest at 156 minutes, which is the same lie in a different window.
*/
update public.jobs
   set state = 'cancelled', finished_at = app.now_utc(), project_id = null
 where idempotency_key like 'probe-proposes-%'
   and state not in ('complete', 'cancelled', 'failed');

-- ---------------------------------------------------------------------------
-- The reader: ask the job, not the copy
-- ---------------------------------------------------------------------------

/*
  Signature unchanged, so no drop is needed — `create or replace` only fails to
  replace when the ARGUMENT LIST changed, and this one has not. The public
  wrapper is untouched for the same reason.
*/
create or replace function app.impediments_tally(
  p_days int default 30, p_min int default 2, p_include_fixtures boolean default false)
returns table (
  kind impediment_kind, needed text, staff_slug text, times int,
  first_seen timestamptz, last_seen timestamptz, projects int, for_instance text)
language sql
stable
security definer
set search_path = ''
as $$
  select i.kind,
         i.needed,
         i.staff_slug,
         count(*)::int                        as times,
         min(i.created_at)                    as first_seen,
         max(i.created_at)                    as last_seen,
         count(distinct i.project_id)::int    as projects,
         (array_agg(i.detail order by i.created_at desc)
            filter (where btrim(i.detail) <> ''))[1] as for_instance
    from public.job_impediments i
    left join public.jobs j on j.job_id = i.job_id
   where (
           coalesce(p_include_fixtures, false)
           -- The job's own flag is GENERATED and therefore current; the
           -- ledger's copy was frozen at insert and cannot be corrected. Read
           -- the job where there is one, and fall back only where there is not.
           or not coalesce(j.is_fixture, i.is_fixture)
         )
     and i.created_at >= app.now_utc() - make_interval(days => greatest(coalesce(p_days, 30), 1))
   group by i.kind, i.needed, i.staff_slug
  having count(*) >= greatest(coalesce(p_min, 2), 1)
   order by count(*) desc, max(i.created_at) desc
$$;

comment on function app.impediments_tally is
  'What the office tried and could not do (#49), read by the Governance tab '
  '(#54). Fixture-ness comes from the JOB, whose is_fixture is generated and '
  'so always current — job_impediments.is_fixture is a copy frozen at insert '
  'on a table that refuses UPDATE, so it can be wrong and can never be fixed. '
  '0303, after five probe rows reached Grant governance page as things Ruby '
  'had genuinely been stopped by.';

commit;
