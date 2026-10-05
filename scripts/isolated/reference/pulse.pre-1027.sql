-- FROZEN reference copy of app.hq_pulse as it stood in production on 5 October 2026 (before migration 1027).
-- scripts/isolated/pulse-equivalence.ts runs it beside the optimised definition and requires equal results.
-- Do not "improve" this file. Lives in its own schema so the product can never call it.
drop schema if exists proof_ref cascade;
create schema proof_ref;

CREATE OR REPLACE FUNCTION proof_ref.hq_pulse(p_office uuid)
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
    'jobs_running', (select count(*)::int from public.jobs
                      where office_id = p_office and state in ('running', 'queued') and not is_fixture),
    'jobs_done', (select count(*)::int from public.jobs
                   where office_id = p_office and state = 'complete' and not is_fixture),
    'outputs', (select count(*)::int from public.outputs o
                 join public.jobs j using (job_id) where j.office_id = p_office and not j.is_fixture),
    'tasks_open', (select count(*)::int from public.tasks
                    where office_id = p_office and state in ('todo', 'doing', 'blocked') and not is_fixture),
    'documents', (select count(*)::int from public.documents where office_id = p_office),
    'messages', (select count(*)::int from public.inbound_commands where office_id = p_office),
    'latest', greatest(
      (select max(updated_at) from public.jobs where office_id = p_office and not is_fixture),
      (select max(o2.created_at) from public.outputs o2 join public.jobs j2 on j2.job_id = o2.job_id and j2.office_id = p_office),
      (select max(updated_at) from public.tasks where office_id = p_office and not is_fixture),
      (select max(updated_at) from public.projects where office_id = p_office),
      (select max(received_at) from public.inbound_commands where office_id = p_office)
    )
  )
  );
end
$function$;
