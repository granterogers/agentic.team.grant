-- ROLLBACK for migration 1027: restores the predecessor definition of app.hq_pulse(uuid), the exact body production ran before 1027,
-- from the production-equivalent replica. Data: none changes. Grants and owner: unchanged. Apply only with scripts/rollout/step.ts.

begin;

CREATE OR REPLACE FUNCTION app.hq_pulse(p_office uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  perform app.require_office(p_office);
  return (
  select jsonb_build_object(
    'at', app.now_utc(),
    /*
      The digest. Anything that changes what the studio DRAWS has to move one of
      these, and nothing else should -- a digest that changes when nothing
      visible did is a page that redraws for no reason, which is worse than a
      stale one because it interrupts.
    */
    'jobs_running', (select count(*)::int from public.jobs
                      where office_id = p_office and state in ('running', 'queued') and not is_fixture),
    'jobs_done', (select count(*)::int from public.jobs
                   where office_id = p_office and state = 'complete' and not is_fixture),
    'outputs', (select count(*)::int from public.outputs o
                 join public.jobs j using (job_id) where j.office_id = p_office and not j.is_fixture),
    'tasks_open', (select count(*)::int from public.tasks
                    where office_id = p_office and state in ('todo', 'doing', 'blocked') and not is_fixture),
    'documents', (select count(*)::int from public.documents where office_id = p_office),
    /*
      0343. Something was SAID.

      Most conversation already moves this digest by accident: a message
      becomes a job, and `jobs_running` counts it. Most is not all — a
      backfilled message makes no job (0340), and neither does a button press.
      Without this the studio's chat would sit still while the conversation
      grew underneath it, which is exactly the "photograph, not a window"
      this function exists to stop.
    */
    'messages', (select count(*)::int from public.inbound_commands where office_id = p_office),
    -- The most recent moment anything the page shows was touched. Catches an
    -- edit that leaves every count identical -- a task renamed, a project
    -- given an icon -- which the counts alone cannot see.
    'latest', greatest(
      (select max(updated_at) from public.jobs where office_id = p_office and not is_fixture),
      (select max(o2.created_at) from public.outputs o2 join public.jobs j2 on j2.job_id = o2.job_id and j2.office_id = p_office),
      (select max(updated_at) from public.tasks where office_id = p_office and not is_fixture),
      (select max(updated_at) from public.projects where office_id = p_office),
      -- And an edit that changes no count: a message arriving on a surface
      -- whose job already existed.
      (select max(received_at) from public.inbound_commands where office_id = p_office)
    )
  )
  );
end
$function$;

commit;
