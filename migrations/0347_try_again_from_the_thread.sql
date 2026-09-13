-- 0347 — "Try again" from the thread, which knows a job and not a delivery
--
-- Issue #202. 0345 gave a person the door out of a failed delivery,
-- `app.retry_delivery(delivery_id)`. The thread cannot use it: a message in the
-- conversation is an OUTPUT, and an output knows its job. One answer can have
-- gone to several surfaces, so one job can hold several failed deliveries, and
-- a button that retried one of them would half-fix a problem while looking
-- like it had fixed it.
--
-- This is the vocabulary the caller HAS, which is the rule the `consultations`
-- trap taught: prefer an RPC that speaks the caller's language over one that
-- makes the caller learn the column types.

begin;

create or replace function app.retry_job_deliveries(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_id uuid;
  v_queued int := 0;
  v_skipped int := 0;
  v_result text;
begin
  if p_job_id is null then
    raise exception 'a job is required' using errcode = 'invalid_parameter_value';
  end if;

  /*
    Only the failed ones. A job whose Telegram delivery succeeded and whose
    Slack delivery did not must not have the Telegram message sent twice —
    which is #195's guarantee, and the cheapest way to keep it is not to ask.
  */
  for v_id in
    select d.delivery_id from public.deliveries d
     where d.job_id = p_job_id and d.state = 'failed'
     order by d.updated_at
  loop
    v_result := app.retry_delivery(v_id);
    if v_result = 'queued' then
      v_queued := v_queued + 1;
    else
      v_skipped := v_skipped + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'job', p_job_id,
    'queued', v_queued,
    'skipped', v_skipped,
    -- Said in words, because the studio shows this to a person and a pair of
    -- integers is not an answer.
    'says', case
      when v_queued = 0 and v_skipped = 0 then 'There was nothing waiting to be sent.'
      when v_queued = 0 then 'Nothing could be queued again.'
      when v_queued = 1 then 'Queued again. It will go out within a minute.'
      else 'Queued ' || v_queued::text || ' again. They will go out within a minute.'
    end
  );
end;
$fn$;

drop function if exists public.retry_job_deliveries(uuid);
create function public.retry_job_deliveries(p_job_id uuid)
returns jsonb
language sql
security definer
set search_path to 'public', 'pg_catalog'
as $fn$ select app.retry_job_deliveries(p_job_id) $fn$;

grant execute on function public.retry_job_deliveries(uuid) to anon, authenticated, service_role;

comment on function app.retry_job_deliveries(uuid) is
  'Issue #202. Queue every FAILED delivery of one job again. Deliveries that '
  'succeeded are left alone, so a retry cannot send twice.';

commit;
