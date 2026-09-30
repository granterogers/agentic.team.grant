-- Rollback for 0619. Restores the pre-0619 app.job_origin (the legacy branch) and drops the origin columns.
drop trigger if exists jobs_origin_immutable on public.jobs;
drop trigger if exists jobs_stamp_origin on public.jobs;
CREATE OR REPLACE FUNCTION app.job_origin(p_job_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with recursive up as (
    select j.job_id, j.parent_job_id, j.pinned_config, 0 as depth
      from public.jobs j where j.job_id = p_job_id
    union all
    select p.job_id, p.parent_job_id, p.pinned_config, up.depth + 1
      from up join public.jobs p on p.job_id = up.parent_job_id
     where up.depth < 64
  ),
  root as (select * from up where parent_job_id is null order by depth desc limit 1)
  select case
    when not exists (select 1 from up) then 'unknown'
    when app.harness_job(p_job_id) then 'harness'
    when not exists (select 1 from root) then 'unknown'      -- a chain that never ends
    when (select pinned_config ? 'command_id' from root) then
      app.command_origin((select (pinned_config ->> 'command_id')::uuid from root))
    when app.internal_root_ok((select job_id from root)) then 'internal'
    else 'unknown'
  end
$function$;

alter table public.jobs drop constraint if exists jobs_origin_command_has_channel;
alter table public.jobs drop constraint if exists jobs_origin_class_known;
alter table public.jobs drop constraint if exists jobs_origin_kind_known;
alter table public.jobs drop column if exists origin_channel, drop column if exists origin_command_id,
  drop column if exists origin_class, drop column if exists origin_kind, drop column if exists root_job_id;
drop function if exists app.jobs_stamp_origin();
drop function if exists app.jobs_origin_is_immutable();
