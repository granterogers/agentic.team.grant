-- 0098 — The duties nobody fired
--
-- §17 gave the system recurring duties and 0027 built the table for them:
-- `responsibilities`, owned by a staff role so that "who is responsible for
-- noticing this" always has an answer, with `app.due_responsibilities()`
-- deriving each duty's idempotency key once so that two firings in one period
-- collide instead of producing two jobs.
--
-- `verify:autonomy` proves all of that. It proves the key is stable within a
-- period, that a re-fire collides on 0005's index, and that stamping
-- `last_run_at` takes the duty out of the due set.
--
-- And in production the table has no rows and nothing calls the function. Every
-- property is enforced and none of it has ever run — which is this project's
-- recurring defect in its twelfth costume: a check whose result does not depend
-- on the thing under test, because the thing under test was never wired to
-- anything.
--
-- ## Why the dispatcher is in SQL
--
-- The whole anti-duplication property is the unique index on
-- `idempotency_key`, and the only way to be sure a dispatcher honours it is to
-- let the insert fail and treat the failure as the normal outcome. A TypeScript
-- dispatcher would have to reproduce that reasoning; this one cannot avoid it.
--
-- ## Why plpgsql and not one statement
--
-- 0090's lesson: a CTE cannot see the row a function inside it just inserted,
-- and a statement that inserts a job and then stamps the duty in the same
-- breath is exactly that shape. So: one duty at a time, insert then stamp,
-- with the unique violation caught per duty rather than for the batch — one
-- duty already fired this period must not stop the other five.

begin;

/**
 * Fire every duty that is due, and stamp it.
 *
 * Returns one row per duty considered, saying what happened, because "the
 * dispatcher ran" and "the dispatcher enqueued something" are different facts
 * and a caller that cannot tell them apart will report the wrong one.
 *
 * `already_fired` is a normal outcome, not an error: two workers overlapping,
 * or one worker running twice inside a period, both land here.
 */
create or replace function app.dispatch_due_responsibilities()
returns table (slug text, job_kind text, outcome text, job_id uuid)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  d record;
  v_job uuid;
begin
  for d in select * from app.due_responsibilities() loop
    begin
      insert into public.jobs
        (correlation_id, project_id, idempotency_key, kind, requested_by, announce)
      values
        (gen_random_uuid(), d.project_id, d.idempotency_key, d.job_kind,
         'duty:' || d.slug,
         -- A recurring duty does not announce that it has started. Grant asked
         -- for progress on work he requested; a duty he did not ask for saying
         -- "starting now" every morning is the pager becoming noise.
         false)
      returning job_id into v_job;

      -- Stamped only after the insert succeeded. Stamping first would take a
      -- duty out of the due set on a firing that never happened, and it would
      -- stay out for a whole period.
      update public.responsibilities
         set last_run_at = app.now_utc()
       where responsibility_id = d.responsibility_id;

      return query select d.slug, d.job_kind, 'fired'::text, v_job;
    exception
      when unique_violation then
        -- The index doing its job. Per duty, so one collision does not abandon
        -- the rest of the batch.
        return query select d.slug, d.job_kind, 'already_fired'::text, null::uuid;
    end;
  end loop;
end;
$$;

comment on function app.dispatch_due_responsibilities is
  'Fires every due duty from public.responsibilities, once per period. The '
  'unique index on jobs.idempotency_key is what makes that true; this function '
  'catches its violation and reports it as the normal outcome it is.';

grant execute on function app.dispatch_due_responsibilities() to ai_team_app;
grant execute on function app.dispatch_due_responsibilities() to service_role;

create or replace function public.dispatch_due_responsibilities()
returns table (slug text, job_kind text, outcome text, job_id uuid)
language sql security definer set search_path = public, pg_catalog
as $$ select * from app.dispatch_due_responsibilities() $$;

revoke all on function public.dispatch_due_responsibilities() from public;
grant execute on function public.dispatch_due_responsibilities() to service_role;

-- --------------------------------------------------------------------------
-- The first duty: the daily capacity report §22 names
-- --------------------------------------------------------------------------
--
-- §22's scenario A ends "usage visible in-app AND in the daily capacity
-- report". The in-app half has existed since 0077 — the Usage tab. The report
-- did not exist at all.
--
-- Owned by Daniel, because §9 gives him measurement and §11 gives him the
-- distinction between a measured figure and a modelled one. A capacity report
-- is mostly that distinction: our own notebook count is an estimate and
-- Google's is unknowable, and a report that blurred the two would be worse than
-- none.
--
-- Daily rather than hourly. 1440 minutes, inside 0027's sane range, and the
-- window index that makes the idempotency key is therefore the day.

insert into public.responsibilities
  (slug, staff_id, description, job_kind, period_minutes)
select
  'daily-capacity-report',
  s.staff_id,
  'Report each day what the team spent: work done, model calls and their cost, '
  'the notebook allowance remaining, whether messages arrived, and what is '
  'waiting on Grant.',
  'office.capacity_report',
  1440
  from public.staff s
 where s.slug = 'finance-director'
on conflict (slug) do nothing;

commit;
