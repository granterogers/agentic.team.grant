-- 0861 - the bridge's helper that decided whether a writer looked like harness traffic (multi-user P3, Wave 12).
--
-- `app.harness_actor(text)` existed so the compatibility bridge could send a harness-named writer to the test office.
-- 0860 removed the bridge; nothing calls the helper, and `check:callers` names an unreachable capability as a failure.
-- 0657 used it once, in the one-off backfill that has already run; the backfill's record is in office_backfill_report.

drop function app.harness_actor(text);

do $m$
begin
  if exists (select 1 from pg_proc where proname = 'harness_actor') then
    raise exception '0861: the helper is still present';
  end if;
end
$m$;
