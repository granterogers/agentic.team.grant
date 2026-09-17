-- Claire briefs him at seven.
--
-- Issue #56. The duty that makes the morning briefing actually happen. Every
-- piece of this existed before today and none of them were joined up:
-- `briefings` (0 rows, ever), `needs_me`, `today`, the duty dispatcher running
-- every minute since 0133.
--
-- ## 07:00, local
--
-- `at_time` from 0187, so it is a wall-clock time rather than an interval that
-- drifts. The timezone is null, which means it follows
-- `system_config['grant.timezone']` — Europe/Athens today. If he moves, the
-- briefing moves with him and nobody has to remember to change this row.
--
-- Seven is a guess and it is his to change. That is a single UPDATE, and the
-- Behaviour tab in Settings (#54) should eventually own it, because *"treat an
-- avoidable request for manual configuration as a design failure"* — but a row
-- he can change beats a constant he cannot.
--
-- ## Why the chief of staff and nobody else
--
-- `telegram.only_chief_speaks` is true. Grant: *"I only get messages from the
-- chief of staff."* He asked for this briefing FROM his chief of staff
-- specifically, so the duty is owned by Claire and the handler writes as her.
--
-- ## period_minutes is still 1440
--
-- 0187's constraint requires it: a wall-clock duty may not also be a sub-daily
-- interval, and the column stays non-null so that the existing sanity bound
-- applies and nothing reading it finds a null it did not expect. With `at_time`
-- set, the interval is not what schedules the duty.

begin;

insert into public.responsibilities
  (slug, staff_id, description, job_kind, period_minutes, at_time, timezone, enabled)
select
  'morning-briefing',
  s.staff_id,
  'Brief Grant each morning: what needs him, what is on today, what the office '
    || 'did overnight, and what is worth deciding.',
  'briefing.morning',
  1440,
  '07:00',
  null,
  true
from public.staff s
where s.slug = 'chief-of-staff'
on conflict (slug) do update
   set at_time     = excluded.at_time,
       job_kind    = excluded.job_kind,
       description = excluded.description,
       enabled     = true,
       updated_at  = app.now_utc();

commit;
