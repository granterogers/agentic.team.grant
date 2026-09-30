/*
  0626 - the telegram webhook's voice-note dispatch asks the CI ledger (Run 5, #391).

  `supabase/functions/telegram-webhook` POSTed `repository_dispatch` `voice-note` straight to GitHub. That starts
  .github/workflows/worker.yml, and it never touched `app.ci_reserve` - the ledger that enforces the Actions-minutes
  ceiling (1,800 of 2,000 free minutes once went to a five-minute cron). `app.ci_may_run('voice-note')` answered
  "not a workflow the office may run" and there was no public wrapper, so the edge function could not have asked.

  This registers the workflow, gives the edge function two service-role-only doors (0613's event trigger closes a
  new public function to the public key), and the function reserves before it dispatches and releases the
  reservation when GitHub refuses, exactly as `dispatchWorkflow` does for every other workflow.

  A voice note is never LOST by this: the ceiling refusing only means no runner is started for it; the note is
  queued either way and the next worker that can hear takes it. What changes is that it can no longer spend minutes
  the ledger has not counted.

  ROLLBACK: docs/architecture-run-5/rollback-0626.sql.
*/
insert into public.ci_workflows (workflow, purpose, expected_minutes, cap_minutes)
values ('voice-note',
        'A voice note was queued and no worker that can turn speech into words is running: start one to drain the queue.',
        5, 15)
on conflict (workflow) do nothing;

create or replace function app.ci_release(p_ci_run uuid, p_why text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  update public.ci_runs
     set settled_at = app.now_utc(), outcome = 'refused_by_github',
         actual_minutes = 0, detail = left(coalesce(p_why, ''), 400)
   where ci_run_id = p_ci_run and settled_at is null;
  return jsonb_build_object('ok', found);
end;
$fn$;

create or replace function public.ci_reserve(p_workflow text, p_event_type text, p_reason text, p_by text, p_job uuid)
returns jsonb
language sql
security definer
set search_path = 'public', 'pg_catalog'
as $fn$
  select app.ci_reserve(p_workflow, p_event_type, p_reason, p_by, p_job)
$fn$;

create or replace function public.ci_release(p_ci_run uuid, p_why text)
returns jsonb
language sql
security definer
set search_path = 'public', 'pg_catalog'
as $fn$
  select app.ci_release(p_ci_run, p_why)
$fn$;

revoke all on function public.ci_reserve(text, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.ci_release(uuid, text) from public, anon, authenticated;
grant execute on function public.ci_reserve(text, text, text, text, uuid) to service_role;
grant execute on function public.ci_release(uuid, text) to service_role;
revoke all on function app.ci_release(uuid, text) from public, anon, authenticated;
