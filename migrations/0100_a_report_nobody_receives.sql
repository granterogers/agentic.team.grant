-- 0100 — A report produced every morning and shown to nobody
--
-- 0098 set `announce = false` on every duty job, with a comment about not
-- wanting the pager to buzz at 6am for work Grant did not ask for. The comment
-- is right and the mechanism was the wrong one.
--
-- `jobs.announce` (0074) governs whether the RESULT is delivered. What governs
-- the "On it." message is `WORTH_SAYING` in `src/channels/progress.ts`, an
-- allow-list of job kinds that a duty was never in. So the start was already
-- silent, and setting `announce = false` silenced the only thing the duty
-- exists to produce: the daily capacity report ran, wrote its output, and
-- committed with "nothing worth announcing".
--
-- Which is this project's recurring defect once more, and the most polite
-- version of it yet: every state correct, every reason truthful, and the work
-- delivered to nobody.

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
         'duty:' || d.slug,
         -- True. A duty's output IS the point of the duty; the start message is
         -- kept quiet by the kind not being in WORTH_SAYING, which is where
         -- that decision actually lives.
         true)
      returning job_id into v_job;

      update public.responsibilities
         set last_run_at = app.now_utc()
       where responsibility_id = d.responsibility_id;

      return query select d.slug, d.job_kind, 'fired'::text, v_job;
    exception
      when unique_violation then
        return query select d.slug, d.job_kind, 'already_fired'::text, null::uuid;
    end;
  end loop;
end;
$$;

-- The one that already ran silently. Cleared so the next tick fires it and the
-- report is actually seen, rather than waiting a day to find out.
update public.responsibilities
   set last_run_at = null
 where slug = 'daily-capacity-report';

commit;
