-- Rollback of 0635: Stop only stamps the request, as before, and the wrapper names 'grant' by default again.
begin;
create or replace function app.request_stop(p_job uuid, p_who text)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare
  v_state text;
begin
  select state::text into v_state from public.jobs where job_id = p_job;
  if v_state is null then
    return jsonb_build_object('error', 'there is no job by that id');
  end if;
  if v_state in ('complete', 'failed', 'cancelled') then
    return jsonb_build_object('ok', false, 'note',
      'that job already finished, so there is nothing to stop');
  end if;
  update public.jobs
     set stop_requested_at = coalesce(stop_requested_at, app.now_utc()),
         stop_requested_by = coalesce(stop_requested_by, nullif(trim(coalesce(p_who, '')), '')),
         updated_at = app.now_utc()
   where job_id = p_job;
  return jsonb_build_object('ok', true, 'state', v_state);
end;
$function$;
create or replace function public.request_stop(p_job uuid, p_who text default 'grant')
 returns jsonb language sql security definer set search_path to ''
as $function$ select app.request_stop(p_job, p_who) $function$;
commit;
