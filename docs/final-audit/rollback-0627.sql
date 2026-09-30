-- Rollback of 0627: the previous delivery_refusal (its own copy of the predicate).
begin;
CREATE OR REPLACE FUNCTION app.delivery_refusal(p_job_id uuid, p_dedupe_key text, p_channel text, p_target_ref text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case
    when exists (select 1 from public.test_destinations t
                  where t.channel = p_channel and t.target_ref = p_target_ref
                    and t.retired_at is null) then null
    when p_job_id is null then
      case when exists (select 1 from public.operator_senders s
                         where s.namespace = split_part(coalesce(p_dedupe_key, ''), ':', 1))
           then null
           else 'no provenance: a delivery must name its job or a registered operator sender'
      end
    when not exists (select 1 from public.jobs j where j.job_id = p_job_id) then
      'no provenance: the job this delivery names does not exist'
    else
      case app.job_origin(p_job_id)
        when 'harness' then 'harness traffic may not reach a production destination'
        when 'unknown' then 'unknown origin: no production door or office process made this work'
        else null
      end
  end
$function$
;
delete from app.schema_migrations where name like '0627_%';
commit;
