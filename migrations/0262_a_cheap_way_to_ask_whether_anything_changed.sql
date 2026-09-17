-- A cheap way to ask whether anything changed (#117).
--
-- The studio fetches once and never changes again. A job finishing, an output
-- arriving, a task ticked from Telegram -- none of it appears until you reload,
-- so the ribbon saying what the office is doing RIGHT NOW is only true at the
-- moment the page loaded.
--
-- ## Why this is not Supabase Realtime
--
-- Realtime was the obvious answer and it is not available here, for a reason
-- worth writing down rather than rediscovering.
--
-- A browser subscribing to Realtime needs the ANON KEY and RLS policies letting
-- that key read `jobs`, `outputs` and `tasks`. The studio holds exactly one
-- credential -- `hq.api_token`, checked by `hq-api` -- and CLAUDE.md is
-- explicit that there is no new auth system. Adding the anon key would be a
-- second credential path in the browser, and the RLS policies it needs would
-- make the office's work readable to anyone holding a key that is public by
-- design.
--
-- So: the page asks a cheap question on a timer instead. Not as elegant, and it
-- costs one small query every twenty seconds while the tab is in front of you.
-- The alternative costs a credential and an open door.
--
-- ## What makes it cheap
--
-- One row, four numbers and a max timestamp -- no payload, no joins across
-- documents, nothing that grows with the size of the office. The page compares
-- the digest with the one it holds and only refetches the real payload when it
-- differs, so the common answer ("nothing has happened") costs a few hundred
-- bytes and no work.
--
-- Fixtures are excluded, for the reason they are excluded everywhere: harness
-- traffic reported as the office moving would make the page redraw all day
-- during a verification run.

CREATE OR REPLACE FUNCTION app.hq_pulse()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  select jsonb_build_object(
    'at', app.now_utc(),
    /*
      The digest. Anything that changes what the studio DRAWS has to move one of
      these, and nothing else should -- a digest that changes when nothing
      visible did is a page that redraws for no reason, which is worse than a
      stale one because it interrupts.
    */
    'jobs_running', (select count(*)::int from public.jobs
                      where state in ('running', 'queued') and not is_fixture),
    'jobs_done', (select count(*)::int from public.jobs
                   where state = 'complete' and not is_fixture),
    'outputs', (select count(*)::int from public.outputs o
                 join public.jobs j using (job_id) where not j.is_fixture),
    'tasks_open', (select count(*)::int from public.tasks
                    where state in ('todo', 'doing', 'blocked') and not is_fixture),
    'documents', (select count(*)::int from public.documents),
    -- The most recent moment anything the page shows was touched. Catches an
    -- edit that leaves every count identical -- a task renamed, a project
    -- given an icon -- which the counts alone cannot see.
    'latest', greatest(
      (select max(updated_at) from public.jobs where not is_fixture),
      (select max(created_at) from public.outputs),
      (select max(updated_at) from public.tasks where not is_fixture),
      (select max(updated_at) from public.projects)
    )
  )
$function$;

GRANT EXECUTE ON FUNCTION app.hq_pulse() TO ai_team_app, service_role;
