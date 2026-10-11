-- 1062: the unified activity ledger, part 3 - the one place the office ACTS on a spending limit says so.
--
-- app.defer_over_budget() holds an over-budget office's (or agent's) background work until tomorrow: it moves not_before and writes the
-- reason onto each queued job, and changes no job STATE, so no transition is written and the ledger had nothing to show. Nothing else
-- records that a limit was reached, and the amount spent is derived (app.over_budget), not stored. This writes budget.threshold_reached
-- (taxonomy, 1060) once per office, agent and day, best effort: app.record_activity_safely never raises, never writes about its own
-- failure and writes nothing while activity.ledger_enabled is off, so this changes no behaviour of the function until the switch is on.
--
-- The body is the LIVE definition (pg_get_functiondef) with the one perform added, as this repository requires for a function that is
-- only being patched.
--
-- Rollback: create or replace app.defer_over_budget() with the same body less the perform. The events already written are append-only
-- history and stay.

create or replace function app.defer_over_budget()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_held int := 0;
  v_row  record;
  v_why  text;
  v_off  uuid[] := '{}';
begin
  for v_row in
    select distinct j.office_id, j.recipient_agent as agent
      from public.jobs j
     where j.state = 'queued'
       and (j.not_before is null or j.not_before <= app.now_utc())
       and app.budget_defers_kind(j.kind)
       and not coalesce(app.harness_job(j.job_id), false)
  loop
    v_why := app.over_budget(v_row.office_id, v_row.agent);
    continue when v_why is null;
    update public.jobs j
       set not_before = date_trunc('day', app.now_utc()) + interval '1 day',
           state_reason = v_why,
           updated_at = app.now_utc()
     where j.state = 'queued'
       and j.office_id = v_row.office_id
       and j.recipient_agent is not distinct from v_row.agent
       and (j.not_before is null or j.not_before <= app.now_utc())
       and app.budget_defers_kind(j.kind)
       and not coalesce(app.harness_job(j.job_id), false);
    v_held := v_held + 1;
    if not v_row.office_id = any(v_off) then
      v_off := v_off || v_row.office_id;
    end if;
    -- The limit that was reached, once per office, agent and day: the key carries the UTC day so tomorrow's crossing is a new event.
    -- Named arguments throughout, and the result is not used: a refusal is the writer's to count, never this function's to fail on.
    perform app.record_activity_safely(
      p_office => v_row.office_id,
      p_event_type => 'budget.threshold_reached',
      p_idempotency_key => 'budget:' || v_row.office_id::text || ':' || coalesce(v_row.agent, '-') || ':' || to_char(app.now_utc() at time zone 'utc', 'YYYY-MM-DD'),
      p_actor_kind => 'system',
      p_actor => 'worker',
      p_summary => 'Held back background work: ' || v_why,
      p_status => 'completed',
      p_agent_slug => v_row.agent,
      p_source_interface => 'worker',
      p_metadata => jsonb_build_object('scope', case when v_row.agent is null or v_why like 'the office%' then 'office' else 'agent' end));
  end loop;
  return jsonb_build_object('agents_held', v_held, 'offices_held', coalesce(array_length(v_off, 1), 0));
end;
$function$;
