-- 0349 — a channel with no health row is UNKNOWN, not connected
--
-- 0348 shipped with #90's own defect inside it, which is worth recording
-- rather than quietly patching: the status lied, in the reassuring direction.
--
-- The rank was computed as
--
--     min(case h.state when 'dead' then 0 ... else 6 end)
--
-- over a LEFT JOIN. When there is no matching health row, `h.state` is null,
-- the CASE falls through to `else 6`, and `min` returns 6 — which the state
-- logic reads as "better than ok". So Voice, which has no row in
-- `connection_health` at all because nothing probes Twilio, reported
-- "Connected and carrying the conversation" on the strength of never having
-- been checked.
--
-- That is exactly the failure #198 cites #90 for: *"status is read from a live
-- check, not from the presence of a stored credential"* — and reading it from
-- the ABSENCE of a check is worse than reading it from a stored credential,
-- because at least a credential is evidence of something.
--
-- Two changes. The rank is null when nothing was checked, and a fifth state
-- says so out loud rather than guessing in either direction. An unprobed
-- channel that is carrying traffic is not broken and not verified, and the
-- honest sentence says both.

begin;

create or replace function app.conversation_channels()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
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
           /*
             `filter (where h.state is not null)` is what makes the absence of
             a probe distinguishable from a good one. Without it the null rows
             the LEFT JOIN produces fall into the CASE's else branch and vote.
           */
           min(case h.state
                 when 'dead' then 0 when 'missing' then 1 when 'unknown' then 2
                 when 'parked' then 3 when 'ok' then 4 when 'attested' then 5
                 else 6 end) filter (where h.state is not null) as rank,
           max(h.checked_at) as checked_at,
           (array_agg(h.detail order by
              case h.state when 'dead' then 0 when 'missing' then 1 else 9 end))[1] as detail
      from want w
      left join public.connection_health h on h.service = w.health_service
     group by w.channel
  ),
  traffic as (
    select c.origin_channel as channel,
           count(*) as messages,
           max(c.received_at) as last_at
      from public.inbound_commands c
      left join public.jobs j on j.job_id = c.job_id
     where coalesce(j.is_fixture, false) = false
     group by c.origin_channel
  ),
  trouble as (
    -- Failing NOW, not ever. A delivery that failed a fortnight ago and was
    -- retried successfully is history, and reporting it as a current fault is
    -- an alarming word for a normal state.
    select d.channel,
           count(*) as recent_failures,
           max(d.updated_at) as last_failure,
           (array_agg(d.error_code order by d.updated_at desc))[1] as last_error
      from public.deliveries d
      left join public.jobs j on j.job_id = d.job_id
     where d.state = 'failed'
       and coalesce(j.is_fixture, false) = false
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
        /*
          Decided in one place and in this order, because order is the design:
          the most actionable truth is the one to say. A failing provider
          outranks a quiet one; a missing credential outranks both; and NEVER
          HAVING CHECKED outranks any conclusion drawn from traffic, because a
          conclusion drawn from no evidence is the thing #90 was about.
        */
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
$fn$;

commit;
