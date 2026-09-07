-- 0101 — A duty that collided is a duty that fired
--
-- 0100's dispatcher stamped `last_run_at` only on the branch that inserted a
-- job. The `already_fired` branch left the duty unstamped, so it stayed in the
-- due set and every tick for the rest of the period tried the insert again and
-- collided again — twelve wasted attempts an hour, and a `last_run_at` that
-- disagreed with the job sitting in the queue.
--
-- Found by a CONTROL: *a duty already stamped this period is not offered at
-- all*. It failed, and the first instinct was that the control was
-- mis-specified. It was not. `already_fired` means a live job with this
-- period's key exists — which is precisely what "this duty has fired this
-- period" means, so the stamp belongs on both branches.
--
-- Worth stating plainly because the wrong fix was one character away: relaxing
-- the control to expect a row would have made the suite green and left the
-- retry loop in place.

begin;

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
         'duty:' || d.slug, true)
      returning job_id into v_job;

      update public.responsibilities
         set last_run_at = app.now_utc()
       where responsibility_id = d.responsibility_id;

      return query select d.slug, d.job_kind, 'fired'::text, v_job;
    exception
      when unique_violation then
        -- Stamped here too. A live job carrying this period's key exists, so
        -- the duty HAS fired this period; leaving it unstamped only buys a
        -- failed insert every tick until the period turns over.
        update public.responsibilities
           set last_run_at = app.now_utc()
         where responsibility_id = d.responsibility_id;
        return query select d.slug, d.job_kind, 'already_fired'::text, null::uuid;
    end;
  end loop;
end;
$$;

commit;
