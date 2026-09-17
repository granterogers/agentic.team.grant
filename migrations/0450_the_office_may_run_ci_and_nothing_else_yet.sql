-- Which workflows the office may actually run (#17).
--
-- One, for now, and that is the point rather than an omission: a workflow is
-- dispatchable only when it carries BOTH halves — the `repository_dispatch`
-- trigger the office's credential can reach, and the step that reports what
-- the job cost. A row here for a workflow missing the second half would
-- reserve minutes that nothing ever settles, so the ledger would drift up by
-- the reservation every time it ran.
--
-- `backup.yml` is the one with the strongest claim to being next — the README
-- is right that `pg_dump` and the restore rehearsal can ONLY run in Actions —
-- and it has three jobs, so it needs the reporting step three times. Left out
-- deliberately rather than half-wired.
--
-- The expected figure is taken from what the workflow's own header records
-- about the incident: the checks were a five-job matrix billed at five minutes
-- for eight seconds of work, and were folded into ONE job for that reason. Six
-- is a deliberate over-estimate; a reservation that is too small is the one
-- that lets the ceiling be passed.

insert into public.ci_workflows (workflow, purpose, expected_minutes, cap_minutes)
values (
  'ci',
  'Lint, typecheck, tests, the migration check and the secret scan, on a machine '
  'that is not the authoring session — the independent second opinion the local '
  'pre-push gate cannot give.',
  6, 15)
on conflict (workflow) do update
  set purpose = excluded.purpose,
      expected_minutes = excluded.expected_minutes,
      cap_minutes = excluded.cap_minutes,
      updated_at = app.now_utc();

-- The public wrappers the page and the runner need. PostgREST exposes `public`
-- and nothing else, and `ci_report` is called by the RUNNER over the
-- Management API rather than PostgREST, so it needs no wrapper — but the two
-- READERS do.
create or replace function public.ci_budget()
returns jsonb language sql stable security definer set search_path to ''
as $function$ select app.ci_budget() $function$;

create or replace function public.ci_lately(p_limit int default 20)
returns jsonb language sql stable security definer set search_path to ''
as $function$ select app.ci_lately(p_limit) $function$;

/*
  No public wrapper for `ci_reserve`, deliberately.

  Taking a reservation is half of a dispatch, and the other half is an
  authenticated call to GitHub that only the worker can make. A page that could
  reserve without dispatching would spend the month's ceiling on runs that
  never happen — the offer promising what the press cannot perform, on a
  budget.
*/
