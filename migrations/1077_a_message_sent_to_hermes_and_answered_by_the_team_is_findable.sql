-- 1077 - A message a person sent to Hermes that the team answered instead can be FOUND (Hermes, release audit, 11 October 2026).
--
-- The one thing the Hermes integration promises never to do is answer a Hermes-chosen message as the team, silently. It is prevented by
-- ORDER (deploy:voice reads the live worker bundle and refuses unless the worker carries the engine seam, D-36) and by the switch (the doors
-- refuse when Hermes is off for the office). Both are procedures. A rollback of the worker below the seam while the doors are live, a manual
-- deploy that skipped the script, or a bridge outage handled by the wrong operator step each reintroduce it, and nothing in the database
-- could say so afterwards: the job is `complete`, it has an output and a delivery, and the only trace of what the person asked for is
-- inbound_commands.engine = 'hermes' beside a job that has no engine_runs row.
--
-- app.engine_mismatches(p_office) reads exactly that and nothing else: the office's jobs whose own command chose Hermes, that are no longer
-- waiting, and that have NO engine run. Read-only. It names ids, never text. It excludes harness traffic through the one canonical
-- predicate (app.harness_job), so a suite cannot make it cry wolf and an escape of one cannot hide in it. An office is always named: there
-- is no person default (check:machine-key). A job still queued or running is not a mismatch (it may be about to open its run), and neither
-- is a job that opened one.
--
-- Callers: scripts/check-engine-mismatch.ts (a production read, behind the production-read gate) and the release acceptance in
-- docs/hermes/RELEASE-READINESS.md. No table, no column, no write.
--
-- ROLLBACK. drop function app.engine_mismatches(uuid); nothing else depends on it.

create or replace function app.engine_mismatches(p_office uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
  v_count integer;
begin
  perform app.require_office(p_office);
  with m as (
    select j.job_id, j.state::text as state, c.command_id, c.origin_channel, j.finished_at
      from public.inbound_commands c
      join public.jobs j on j.job_id = c.job_id and j.office_id = c.office_id
     where c.office_id = p_office
       and c.engine = 'hermes'
       and j.state::text in ('complete', 'failed', 'cancelled')
       and not exists (select 1 from public.engine_runs r where r.job_id = j.job_id and r.office_id = p_office)
       and not app.harness_job(j.job_id)
  )
  select count(*)::integer,
         coalesce((select jsonb_agg(jsonb_build_object('job_id', x.job_id, 'command_id', x.command_id, 'state', x.state, 'channel', x.origin_channel, 'finished_at', x.finished_at))
                     from (select * from m order by finished_at desc nulls last, job_id limit 20) x), '[]'::jsonb)
    into v_count, v_rows
    from m;
  return jsonb_build_object('mismatched', v_count, 'jobs', v_rows);
end
$$;

comment on function app.engine_mismatches(uuid) is
  'Jobs of one office whose own command chose Hermes, that are over, and that have no engine run: a Hermes message the team (or nothing) answered. Ids only. Excludes harness traffic by app.harness_job.';

revoke all on function app.engine_mismatches(uuid) from public, anon, authenticated, service_role;
