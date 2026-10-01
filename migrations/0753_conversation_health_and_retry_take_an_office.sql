-- 0753 - conversation, health and delivery retry take an office (multi-user P3, cluster e-views).
--
-- conversation_history / channels / growth, office_health and retry_job_deliveries (with retry_delivery beneath it).
-- A thread of another office and a thread that does not exist answer alike; a delivery of another office cannot be
-- retried. The size of the database and the backup reading are the deployment's and are shown to its operator only.

-- app.conversation_channels
create function app.conversation_channels(p_office uuid)
 returns jsonb
 language plpgsql
 STABLE SECURITY DEFINER
 set search_path to 'public', 'pg_catalog'
as $function$
begin
  perform app.require_office(p_office);
  return (
  with want as (
    select * from (values
      ('slack',    'Slack',    'Slack'),
      ('telegram', 'Telegram', 'Telegram'),
      ('voice',    'Voice',    'Twilio'),
      ('teamhq',   'This dashboard', null)
    ) as t(channel, label, health_service)
  ),
  cred as (
    select w.channel,
           min(case h.state
                 when 'dead' then 0 when 'missing' then 1 when 'unknown' then 2
                 when 'parked' then 3 when 'ok' then 4 when 'attested' then 5
                 else 6 end) filter (where h.state is not null) as rank,
           max(h.checked_at) as checked_at,
           (array_agg(h.detail order by
              case h.state when 'dead' then 0 when 'missing' then 1 else 9 end))[1] as detail
      from want w
      left join public.connection_health h on h.service = w.health_service and h.office_id = p_office
     group by w.channel
  ),
  traffic as (
    select c.origin_channel as channel,
           count(*) as messages,
           max(c.received_at) as last_at
      from public.inbound_commands c
      left join public.jobs j on j.job_id = c.job_id
     where c.office_id = p_office and not app.harness_job(c.job_id)
     group by c.origin_channel
  ),
  trouble as (
    select d.channel,
           count(*) as recent_failures,
           max(d.updated_at) as last_failure,
           (array_agg(d.error_code order by d.updated_at desc))[1] as last_error
      from public.deliveries d
      join public.jobs j on j.job_id = d.job_id
     where d.office_id = p_office and j.office_id = p_office
       and d.state = 'failed'
       and not app.harness_job(j.job_id)
       and d.updated_at > app.now_utc() - interval '24 hours'
     group by d.channel
  )
  select coalesce(jsonb_agg(row order by row->>'channel'), '[]'::jsonb)
    from (
      select jsonb_build_object(
        'channel', w.channel,
        'label',   w.label,
        'messages', coalesce(t.messages, 0),
        'last_at',  t.last_at,
        'recent_failures', coalesce(tr.recent_failures, 0),
        'last_error', tr.last_error,
        'checked_at', c.checked_at,
        'state', case
          when w.health_service is null then 'here'
          when c.rank is null then 'unchecked'
          when c.rank <= 1 then
            case when coalesce(t.messages, 0) > 0 then 'disconnected' else 'never' end
          when coalesce(tr.recent_failures, 0) > 0 then 'degraded'
          when coalesce(t.messages, 0) = 0 then 'quiet'
          else 'carrying'
        end,
        'says', case
          when w.health_service is null then
            'You are reading it. Everything said here is part of the same conversation.'
          when c.rank is null then
            case when coalesce(t.messages, 0) > 0
              then 'Carrying messages, but nothing here checks the credential — so this '
                   || 'is what the traffic says, not what a probe says.'
              else 'Nothing checks this one, and nothing has come through it.'
            end
          when c.rank <= 1 then
            case when coalesce(t.messages, 0) > 0
              then 'Not connected any more. Everything already said is kept — reconnect and it carries on.'
              else 'Not connected yet. Connect it and the office can reach you there.'
            end
          when coalesce(tr.recent_failures, 0) > 0 then
            'Connected, but the provider is refusing messages. Nothing is lost; they are waiting.'
          when coalesce(t.messages, 0) = 0 then
            'Connected and ready. Nothing has come through it yet.'
          else 'Connected and carrying the conversation.'
        end
      ) as row
        from want w
        left join cred c on c.channel = w.channel
        left join traffic t on t.channel = w.channel
        left join trouble tr on tr.channel = w.channel
    ) rows
  );
end
$function$;
revoke all on function app.conversation_channels(uuid) from public, anon, authenticated, service_role;

-- public.conversation_channels
create function public.conversation_channels(p_office uuid)
 returns jsonb
 language sql
 STABLE SECURITY DEFINER
 set search_path to 'public', 'pg_catalog'
as $f$
 select app.conversation_channels(p_office) 
$f$;

-- app.conversation_growth
create function app.conversation_growth(p_office uuid)
 returns jsonb
 language plpgsql
 STABLE SECURITY DEFINER
 set search_path to 'public', 'pg_catalog'
as $function$
begin
  perform app.require_office(p_office);
  return (
  with per_surface as (
    select
      c.origin_channel as surface,
      count(*) as rows,
      min(c.received_at) as first_seen,
      max(c.received_at) as last_seen,
      -- At least one day, so a surface that started this morning reports its
      -- own count rather than dividing by zero and claiming infinity.
      greatest(
        1,
        ceil(extract(epoch from (max(c.received_at) - min(c.received_at))) / 86400.0)
      ) as days
      from public.inbound_commands c
      left join public.jobs j on j.job_id = c.job_id
     where c.office_id = p_office and coalesce(j.is_fixture, false) = false
     group by c.origin_channel
  ),
  -- The same measure across the whole deployment, which the capacity projection below needs and which only the
  -- deployment's operator is shown.
  all_surface as (
    select count(*) as rows,
           greatest(1, ceil(extract(epoch from (max(c.received_at) - min(c.received_at))) / 86400.0)) as days
      from public.inbound_commands c
      left join public.jobs j on j.job_id = c.job_id
     where coalesce(j.is_fixture, false) = false
     group by c.origin_channel
  ),
  sizes as (
    select
      pg_total_relation_size('public.inbound_commands') as inbound_bytes,
      pg_total_relation_size('public.outputs') as outputs_bytes,
      pg_database_size(current_database()) as db_bytes,
      (select count(*) from public.inbound_commands) as inbound_rows,
      (select count(*) from public.outputs) as output_rows
  ),
  rate as (
    select
      coalesce(sum(p.rows / p.days), 0) as messages_a_day
      from per_surface p
  ),
  rate_all as (
    select coalesce(sum(p.rows / p.days), 0) as messages_a_day from all_surface p
  )
  select jsonb_build_object(
    'measured_at', now(),
    'surfaces', coalesce(
      (select jsonb_agg(jsonb_build_object(
          'surface',   p.surface,
          'rows',      p.rows,
          'first_seen', p.first_seen,
          'last_seen',  p.last_seen,
          'a_day',     round((p.rows / p.days)::numeric, 1)
        ) order by p.rows desc)
         from per_surface p),
      '[]'::jsonb),
    'messages_a_day', round((select messages_a_day from rate)::numeric, 1),
    'bytes_a_message', case
      when not app.office_sees_the_deployment(p_office) then null
      when (select inbound_rows + output_rows from sizes) = 0 then 0
      else round(
        ((select inbound_bytes + outputs_bytes from sizes)::numeric
          / (select inbound_rows + output_rows from sizes)::numeric), 0)
    end,
    -- The size of the database is the deployment's, not an office's.
    'db_bytes', case when app.office_sees_the_deployment(p_office) then (select db_bytes from sizes) end,
    'tier_bytes', case when app.office_sees_the_deployment(p_office) then 500 * 1024 * 1024 end,
    /*
      Years of room at the CURRENT rate, which is the only honest projection —
      a rate measured over ten days cannot be extrapolated with a growth curve
      it has never demonstrated. Two message rows per message (his and the
      answer) is the assumption, and it is stated rather than buried.
    */
    'years_of_room', case
      when not app.office_sees_the_deployment(p_office) then null
      when (select messages_a_day from rate_all) <= 0 then null
      else round(
        ((500 * 1024 * 1024 - (select db_bytes from sizes))::numeric
          / greatest(1,
              (select messages_a_day from rate_all)::numeric * 2
              * greatest(1, case
                  when (select inbound_rows + output_rows from sizes) = 0 then 1
                  else ((select inbound_bytes + outputs_bytes from sizes)::numeric
                        / (select inbound_rows + output_rows from sizes)::numeric)
                end)
              * 365)
        ), 1)
    end
  )
  );
end
$function$;
revoke all on function app.conversation_growth(uuid) from public, anon, authenticated, service_role;

-- public.conversation_growth
create function public.conversation_growth(p_office uuid)
 returns jsonb
 language sql
 STABLE SECURITY DEFINER
 set search_path to 'public', 'pg_catalog'
as $f$
 select app.conversation_growth(p_office) 
$f$;

-- app.conversation_history
create function app.conversation_history(p_office uuid, p_project_id uuid, p_limit integer DEFAULT 50, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone)
 returns jsonb
 language plpgsql
 STABLE SECURITY DEFINER
 set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_project uuid;
begin
  perform app.require_office(p_office);
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
        -- A voice note's transcript IS the message; the instruction column
        -- holds a placeholder for one. 0089's six-messages-in-43-seconds.
        'body',         coalesce(nullif(btrim(c.transcript), ''), c.instruction),
        'surface',      c.origin_channel,
        'addressed_to', c.addressed_to,
        'spoken',       c.voice_file_id is not null,
        -- 0340. Reconstructed history is marked so a reader can say so.
        'backfilled',   coalesce((c.context->>'backfilled')::boolean, false)
      ) as v
      from public.inbound_commands c
      left join public.jobs j on j.job_id = c.job_id
     where c.office_id = p_office
       and c.project_id = v_project
       and coalesce(j.is_fixture, false) = false
       -- 0602 (#378). is_fixture misses a harness turn that came through a real
       -- door; the canonical predicate follows the turn's session and lineage.
       -- A said row with no job yet has nothing to follow and stays visible.
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
        /*
          Whether this answer actually reached him (#202).

          A LEFT JOIN over the job's deliveries, aggregated — one answer can go
          to several surfaces, and #202 is explicit that one surface failing
          must not stop the others. So this reports the worst outcome across
          them rather than the first: an answer that reached Telegram and not
          Slack is partly delivered, and saying "delivered" would be a claim.

          Null when there are no delivery rows at all, which is the ordinary
          case for an answer read here in the studio — the studio is not a
          delivery, and marking every one of them "undelivered" would be the
          alarming wording for the normal state, which is #119's mistake.
        */
        'delivery',      dstate.worst,
        'undelivered',   coalesce(dstate.failed, 0)
      ) as v
      from public.outputs o
      join public.jobs j on j.job_id = o.job_id
      left join public.staff s on s.staff_id = o.staff_id
      left join lateral (
        select
          count(*) filter (where d.state = 'failed') as failed,
          case
            when count(*) filter (where d.state = 'failed') > 0 then 'failed'
            when count(*) filter (where d.state = 'claimed') > 0 then 'sending'
            when count(*) > 0 then 'sent'
            else null
          end as worst
          from public.deliveries d
         where d.job_id = o.job_id and d.office_id = p_office
      ) dstate on true
       -- An OR, not a coalesce: see 0344. A function wrapped around the column
       -- is opaque to the planner and reads every job in the table.
     where j.office_id = p_office
       and (
             j.project_id = v_project
             or (j.project_id is null and v_project is not null
                 and v_project = (select pu.project_id from public.projects pu
                                   where pu.slug = 'unnamed' and pu.office_id = p_office))
           )
       and not j.is_fixture
       and not app.harness_job(j.job_id)
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
  -- Named column in the aggregate, per 0306. Ascending, because the window was
  -- taken from the recent end but a conversation is read forwards.
  select coalesce(jsonb_agg(r.v order by r.at), '[]'::jsonb) from recent r
  );
end
$function$;
revoke all on function app.conversation_history(uuid, uuid, integer, timestamp with time zone) from public, anon, authenticated, service_role;

-- public.conversation_history
create function public.conversation_history(p_office uuid, p_project_id uuid, p_limit integer DEFAULT 50, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone)
 returns jsonb
 language sql
 STABLE SECURITY DEFINER
 set search_path to 'public', 'pg_catalog'
as $f$
 select app.conversation_history(p_office, p_project_id, p_limit, p_before) 
$f$;

-- app.office_health
create function app.office_health(p_office uuid, p_hours integer DEFAULT 24)
 returns jsonb
 language plpgsql
 STABLE SECURITY DEFINER
 set search_path to ''
as $function$
begin
  perform app.require_office(p_office);
  return (
  select jsonb_build_object(
    'window_hours', p_hours,
    'finished', count(*) filter (where state = 'complete'),
    'failed', count(*) filter (where state = 'failed'),
    'in_flight', count(*) filter (where state not in ('complete', 'failed', 'cancelled')),
    'failing_kinds', (
      select coalesce(jsonb_agg(jsonb_build_object('kind', k.kind, 'n', k.n)
             order by k.n desc), '[]'::jsonb)
        from (select kind, count(*) n
                from public.jobs
               where office_id = p_office and not app.harness_job(job_id) and state = 'failed'
                 and created_at > app.now_utc() - make_interval(hours => p_hours)
               group by kind order by count(*) desc limit 5) k
    ),
    'stalled', (select coalesce(sum(s.n), 0) from app.jobs_stuck_queued(p_office) s),
    'stalled_kinds', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'kind', s.kind, 'n', s.n, 'oldest_minutes', s.oldest_minutes,
               'period_minutes', s.period_minutes) order by s.n desc), '[]'::jsonb)
        from app.jobs_stuck_queued(p_office) s
    ),
    /*
      The reading the fifteen-hour outage had no word for (#236).

      `oldest_minutes` is the one to read: eleven messages waiting two minutes
      is a busy queue and one message waiting nine hours is an office that has
      stopped. A count alone cannot tell those apart, which is part of why
      nothing noticed.
    */
    'waiting', (
      select jsonb_build_object(
        'jobs', coalesce(sum(w.n), 0),
        'oldest_minutes', coalesce(max(w.oldest_minutes), 0),
        'threshold_minutes', 15,
        'kinds', coalesce(jsonb_agg(jsonb_build_object('kind', w.kind, 'n', w.n)
                 order by w.n desc) filter (where w.kind is not null), '[]'::jsonb))
        from app.jobs_waiting(p_office, 15) w
    ),
    -- Why a morning of failures happened, when the answer is "it could not
    -- think". Empty when every provider is reachable, which is the common case
    -- and the one that should add nothing to the reading.
    'cannot_think', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'provider', h.provider,
               'since', h.opened_at,
               'next_probe_at', h.next_probe_at,
               'said', left(coalesce(h.last_error, ''), 200)) order by h.opened_at), '[]'::jsonb)
        from public.provider_health h
       where h.state = 'open'
         and h.provider not like 'probe_%'
    ),
    'backup', case when app.office_sees_the_deployment(p_office) then app.backup_health() end,
    'progress', app.last_progress(p_office),
    'held_for_budget', app.held_for_budget(p_office),
    'excluded_fixtures', (
      select count(*) from public.jobs
       where office_id = p_office and app.harness_job(job_id)
         and created_at > app.now_utc() - make_interval(hours => p_hours)
    )
  )
    from public.jobs
   where office_id = p_office and not app.harness_job(job_id)
     and created_at > app.now_utc() - make_interval(hours => p_hours)
  );
end
$function$;
revoke all on function app.office_health(uuid, integer) from public, anon, authenticated, service_role;

-- public.office_health
create function public.office_health(p_office uuid, p_hours integer DEFAULT 24)
 returns jsonb
 language sql
 STABLE SECURITY DEFINER
 set search_path to 'public', 'pg_catalog'
as $f$
 select app.office_health(p_office, p_hours) 
$f$;

-- app.retry_delivery
create function app.retry_delivery(p_office uuid, p_delivery_id uuid)
 returns text
 language plpgsql
 SECURITY DEFINER
 set search_path to ''
as $function$
declare
  v_row public.deliveries;
begin
  perform app.require_office(p_office);
  select * into v_row from public.deliveries
    where delivery_id = p_delivery_id and office_id = p_office for update;
  if not found then
    raise exception 'no delivery %', p_delivery_id using errcode = 'no_data_found';
  end if;

  if v_row.state = 'sent' then
    return 'already_sent';
  end if;
  if v_row.state = 'suppressed' then
    -- Suppression is a decision somebody made about whether this SHOULD be
    -- sent. Undoing it here would let a retry button override a policy.
    return 'suppressed';
  end if;

  update public.deliveries
     set state = 'claimed',
         attempt = 1,
         lease_expires_at = app.now_utc()
   where delivery_id = p_delivery_id and office_id = p_office;

  return 'queued';
end;
$function$;
revoke all on function app.retry_delivery(uuid, uuid) from public, anon, authenticated, service_role;

-- public.retry_delivery
create function public.retry_delivery(p_office uuid, p_delivery_id uuid)
 returns text
 language sql
 SECURITY DEFINER
 set search_path to 'public', 'pg_catalog'
as $f$
 select app.retry_delivery(p_office, p_delivery_id) 
$f$;

-- app.retry_job_deliveries
create function app.retry_job_deliveries(p_office uuid, p_job_id uuid)
 returns jsonb
 language plpgsql
 SECURITY DEFINER
 set search_path to ''
as $function$
declare
  v_id uuid;
  v_queued int := 0;
  v_skipped int := 0;
  v_result text;
begin
  perform app.require_office(p_office);
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
     where d.job_id = p_job_id and d.office_id = p_office and d.state = 'failed'
     order by d.updated_at
  loop
    v_result := app.retry_delivery(p_office, v_id);
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
$function$;
revoke all on function app.retry_job_deliveries(uuid, uuid) from public, anon, authenticated, service_role;

-- public.retry_job_deliveries
create function public.retry_job_deliveries(p_office uuid, p_job_id uuid)
 returns jsonb
 language sql
 SECURITY DEFINER
 set search_path to 'public', 'pg_catalog'
as $f$
 select app.retry_job_deliveries(p_office, p_job_id) 
$f$;

do $g$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('conversation_channels', 'conversation_growth', 'conversation_history', 'office_health', 'retry_delivery', 'retry_job_deliveries')
              and (pg_get_function_arguments(p.oid)) like 'p_office uuid%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $g$;

-- the old signatures go: nothing may ask without saying whose
drop function app.conversation_channels();
drop function public.conversation_channels();
drop function app.conversation_growth();
drop function public.conversation_growth();
drop function app.conversation_history(uuid, integer, timestamp with time zone);
drop function public.conversation_history(uuid, integer, timestamp with time zone);
drop function public.office_health(integer);
drop function app.retry_delivery(uuid);
drop function public.retry_delivery(uuid);
drop function app.retry_job_deliveries(uuid);
drop function public.retry_job_deliveries(uuid);
