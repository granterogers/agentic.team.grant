-- 1072 - Team HQ can show whether Hermes is available, label the answers Hermes wrote, and not show the notes it left while it worked (Hermes, M6).
--
-- Three things, all reads, none of them changes what the office does:
--
--   1. app.engine_status(p_office) and its public wrapper hq_engine_status: the one question the composer asks before it draws a choice of
--      engine. { hermes: { enabled, available, because, runs_today, daily_runs, host } }. `enabled` is "this office is in the setting
--      engine.hermes.offices": when it is false the page draws nothing at all, so an office that has not been given Hermes sees no change.
--      `because` is the sentence engine_available already composes, never a new one. The host is described by name, last contact and
--      health, never by its identifier or any credential.
--
--   2. app.conversation_history, spliced from its LIVE definition with exactly two changes, both in the same two places the thread reader
--      already builds its rows:
--        - every row carries `engine`: a person's message says which engine they chose for it (inbound_commands.engine); an answer says
--          'hermes' only when an engine run produced it (read from the run, never from the text), otherwise 'team';
--        - an output a job wrote while its Hermes run was still going is NOT an answer. The handler parks the job each time it looks and
--          every look writes one "Hermes is working on it" row (reviewed, never delivered; migration 1070's note, D-22). Left in, a thread
--          would show a dozen of them. A job with an engine run shows only an output written AFTER the run finished. A job with no run is
--          untouched, which includes the sentence "I haven't sent this to Hermes: ..." (no run was opened, and it is the office speaking).
--
-- The signature, the return type, the search path and every other line are unchanged. CREATE OR REPLACE is safe.
--
-- ROLLBACK. Remove the four additions to app.conversation_history (the two `engine` keys, the engine_runs join and its one predicate; the diff against
-- the previous live definition is exactly those lines) and drop app.engine_status and public.hq_engine_status. Nothing else reads them. A page that
-- has not been given the new code ignores the extra `engine` key.

create function app.engine_status(p_office uuid) returns jsonb
 language plpgsql stable security definer set search_path to ''
as $f$
declare v_enabled boolean; v_avail jsonb; v_host record; v_used integer; v_daily integer;
begin
  perform app.require_office(p_office);
  v_enabled := app.engine_enabled(p_office, 'hermes');
  v_avail := app.engine_available(p_office, 'hermes');
  select b.last_seen_at, b.healthy, k.display_name into v_host
    from public.engine_bridges b
    join public.mcp_clients k on k.client_id = b.mcp_client_id and k.office_id = b.office_id
   where b.office_id = p_office and b.engine = 'hermes' and b.enabled
   order by b.last_seen_at desc nulls last limit 1;
  v_daily := app.engine_setting('engine.hermes.daily_runs', 20, 0, 1000);
  select count(*) into v_used from public.engine_runs r
   where r.office_id = p_office and r.engine = 'hermes'
     and r.created_at >= date_trunc('day', app.now_utc() at time zone 'utc') at time zone 'utc';
  return jsonb_build_object('hermes', jsonb_build_object(
    'enabled', v_enabled,
    'available', coalesce((v_avail ->> 'available')::boolean, false),
    'because', v_avail ->> 'because',
    'runs_today', v_used,
    'daily_runs', v_daily,
    'host', case when v_host.display_name is null then null
                 else jsonb_build_object('name', v_host.display_name, 'last_seen_at', v_host.last_seen_at, 'healthy', v_host.healthy) end));
end
$f$;
revoke all on function app.engine_status(uuid) from public, anon, authenticated, service_role;

create function public.hq_engine_status(p_office uuid) returns jsonb
 language sql stable security definer set search_path to ''
as $f$ select app.engine_status(p_office => p_office) $f$;
revoke all on function public.hq_engine_status(uuid) from public, anon, authenticated;
grant execute on function public.hq_engine_status(uuid) to service_role;

CREATE OR REPLACE FUNCTION app.conversation_history(p_office uuid, p_project_id uuid, p_limit integer DEFAULT 50, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_project uuid;
begin
  perform app.require_office(p_office);
  if exists (select 1 from public.offices o where o.office_id = p_office and o.kind = 'sample') then
    return '[]'::jsonb;
  end if;
  select pj.project_id into v_project from public.projects pj where pj.project_id = p_project_id and pj.office_id = p_office;
  return (
  with bounded as (select greatest(1, least(coalesce(p_limit, 50), 200)) as n),
  said as (
    select
      c.received_at as at,
      jsonb_build_object(
        'message_id',   c.command_id,
        'kind',         'said',
        'at',           c.received_at,
        'from',         app.office_actor(p_office),
        'name',         (select o.name from public.offices o where o.office_id = p_office),
        'body',         coalesce(nullif(btrim(c.transcript), ''), c.instruction),
        'surface',      c.origin_channel,
        'addressed_to', c.addressed_to,
        'spoken',       c.voice_file_id is not null,
        'backfilled',   coalesce((c.context->>'backfilled')::boolean, false),
        'engine',       c.engine
      ) as v
      from public.inbound_commands c
      left join public.jobs j on j.job_id = c.job_id
     where c.office_id = p_office
       and c.project_id = v_project
       and coalesce(j.is_fixture, false) = false
       and (c.job_id is null or not app.harness_job(c.job_id))
       and (p_before is null or c.received_at < p_before)
     order by c.received_at desc
     limit (select n from bounded)
  ),
  answered as (
    select
      o.created_at as at,
      jsonb_build_object(
        'message_id',    o.output_id,
        'kind',          'answered',
        'at',            o.created_at,
        'from',          coalesce(s.slug, 'the-office'),
        'name',          coalesce(s.name, 'The team'),
        'body',          o.body,
        'confidence',    o.confidence::text,
        'evidence',      o.evidence::text,
        'deterministic', o.deterministic,
        'job',           o.job_id,
        'delivery',      dstate.worst,
        'undelivered',   coalesce(dstate.failed, 0),
        'engine',        case when er.run_id is null then 'team' else er.engine end
      ) as v
      from public.outputs o
      join public.jobs j on j.job_id = o.job_id
      left join public.staff s on s.staff_id = o.staff_id
      left join public.engine_runs er on er.job_id = o.job_id and er.office_id = p_office
      left join lateral (
        select
          x.failed as failed,
          case
            when x.failed > 0 and x.failed = x.unsure then 'unconfirmed'
            when x.failed > 0 then 'failed'
            when x.claimed > 0 then 'sending'
            when x.total > 0 then 'sent'
            else null
          end as worst
          from (
            select
              count(*) filter (where d.state = 'failed' and coalesce(d.error_code, '') not like 'superseded:%') as failed,
              count(*) filter (where d.state = 'failed' and coalesce(d.error_code, '') like 'indeterminate:%') as unsure,
              count(*) filter (where d.state = 'claimed') as claimed,
              count(*) filter (where coalesce(d.error_code, '') not like 'superseded:%') as total
              from public.deliveries d
             where d.job_id = o.job_id and d.office_id = p_office
          ) x
      ) dstate on true
     where j.office_id = p_office
       and (
             j.project_id = v_project
             or (j.project_id is null and v_project is not null
                 and v_project = (select pu.project_id from public.projects pu
                                   where pu.slug = 'unnamed' and pu.office_id = p_office))
           )
       and not j.is_fixture
       and not app.harness_job(j.job_id)
       -- A job with a Hermes run shows only what it wrote AFTER the run finished: the rows it wrote while waiting are notes, not answers.
       and (er.run_id is null or (er.finished_at is not null and o.created_at >= er.finished_at))
       and (p_before is null or o.created_at < p_before)
     order by o.created_at desc
     limit (select n from bounded)
  ),
  recent as (
    select at, v
      from (select at, v from said union all select at, v from answered) both_sides
     order by at desc
     limit (select n from bounded)
  )
  select coalesce(jsonb_agg(r.v order by r.at), '[]'::jsonb) from recent r
  );
end
$function$;
