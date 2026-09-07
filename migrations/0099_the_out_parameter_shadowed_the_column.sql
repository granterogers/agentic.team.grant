-- 0099 — An OUT parameter that shadowed the column it was returning
--
-- 0098's dispatcher declared `returns table (..., job_id uuid)` and then wrote
-- `returning job_id into v_job`. Inside a plpgsql function an OUT column is a
-- variable, so `job_id` was both that variable and `public.jobs.job_id`, and
-- Postgres refused the whole call with 42702 rather than picking one.
--
-- Caught on the first real run, by the dispatcher reporting its own failure
-- instead of throwing — which is the only reason it was one line of output
-- rather than a worker that stopped draining the queue.
--
-- Renamed rather than qualified. `returning j.job_id` with an alias would also
-- compile, and would leave the next person to add an OUT column standing on the
-- same rake.

begin;

drop function if exists app.dispatch_due_responsibilities();
drop function if exists public.dispatch_due_responsibilities();

create or replace function app.dispatch_due_responsibilities()
returns table (duty_slug text, duty_kind text, outcome text, fired_job_id uuid)
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
returns table (duty_slug text, duty_kind text, outcome text, fired_job_id uuid)
language sql security definer set search_path = public, pg_catalog
as $$ select * from app.dispatch_due_responsibilities() $$;

revoke all on function public.dispatch_due_responsibilities() from public;
grant execute on function public.dispatch_due_responsibilities() to service_role;

commit;
