-- 0351 — the office was not degraded; the harness was talking
--
-- #198's channel states and #202's `undelivered` both went live yesterday and
-- both immediately reported a real-looking fault: Telegram DEGRADED, nine
-- `chat_not_found` failures in a day, twenty-one undelivered messages. That
-- was reported to Grant as something worth his attention.
--
-- It was harness traffic. All twenty-one of it.
--
-- This is the trap CLAUDE.md records more often than any other — "harness
-- traffic was reported to Grant as the office collapsing" — occurring inside
-- the two features built to make the office legible. Which is the worst place
-- for it: a health reading that cries wolf teaches him to ignore health
-- readings.
--
-- ## Two separate holes, and neither is in the fixture rule itself
--
-- 1. `scripts/poc/gate-3.ts` posts a Telegram webhook impersonating Grant with
--    `from.id = 4242`. The adapter translates that to actor `4242` and
--    `enqueue_inbound` composes `requested_by` as `telegram:4242`. The
--    generated `is_fixture` expression has a `gate-%` branch — and it never
--    fires, because the channel prefix is in front of it.
--
--    Exactly `verify:addressing`'s defect, which cost 43 real jobs: a harness
--    believing its traffic is invisible while `requested_by` says otherwise.
--    0342 widened the rule to `%:verify-%` for that one. gate-3 predates it
--    and was never brought across.
--
--    Fixed by NAMING the traffic correctly rather than by widening the rule
--    again. A third pattern in a generated column is a sentinel accumulating;
--    `telegram:verify-gate3` matches the branch that already exists.
--
-- 2. A delivery with NO JOB counts as real, because both readers do
--    `left join jobs` and then `coalesce(j.is_fixture, false) = false`. An
--    orphan has no attribution at all — no project, no requester, nothing to
--    retry into — and the eight here have `error_code` literally ending
--    `(injected)`, which is a fault injection test saying so in the data.
--
--    An unattributable delivery is not evidence of anything a person can act
--    on. `coalesce(x, false) = false` is the same shape as 0304's lesson about
--    asymmetric witnesses: absence of a fixture flag is not presence of a real
--    one.

begin;

/*
  The attribution, corrected.

  `is_fixture` is GENERATED from `requested_by`, so this recomputes rather than
  being set — which is why the column is generated in the first place. 27 jobs,
  every one of them gate-3's, every one flipping to fixture.

  Nothing is deleted. A job can never be deleted (`job_state_transitions` is
  append-only) and this does not try: the rows stay, their history stays
  readable, and they stop being counted as the office's real work.
*/
update public.jobs
   set requested_by = 'telegram:verify-gate3'
 where requested_by = 'telegram:4242';

/*
  An orphan delivery is not a real failure (#202).

  Only two changes, both the same idea: a delivery has to be attributable
  before it can be reported as something wrong. `d.job_id is not null` is the
  whole of it.
*/
create or replace function app.undelivered(
  p_project_id uuid default null,
  p_limit integer default 50
) returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
  select coalesce(jsonb_agg(x.v order by x.at desc), '[]'::jsonb)
    from (
      select d.updated_at as at,
             jsonb_build_object(
               'delivery_id', d.delivery_id,
               'channel',     d.channel,
               'purpose',     d.purpose,
               'target',      d.target_ref,
               'attempt',     d.attempt,
               'error_code',  d.error_code,
               'job',         d.job_id,
               'project',     j.project_id,
               'at',          d.updated_at,
               -- A code nobody can act on is a code nobody reads.
               'says', case
                 when d.error_code like 'chat_not_found%'
                   then 'That chat no longer exists, or the bot was removed from it.'
                 when d.error_code like 'indeterminate%'
                   then 'The provider did not say whether it arrived.'
                 when d.error_code like '%rate%'
                   then 'The provider is rate-limiting us.'
                 when d.error_code like '%timeout%' or d.error_code like '%ECONN%'
                   then 'The provider could not be reached.'
                 else 'The provider refused it.'
               end
             ) as v
        from public.deliveries d
        join public.jobs j on j.job_id = d.job_id
       where d.state = 'failed'
         and not j.is_fixture
         and (p_project_id is null or j.project_id = p_project_id)
       order by d.updated_at desc
       limit greatest(1, least(coalesce(p_limit, 50), 200))
    ) x
$fn$;

/*
  And the same for the channel states (#198).

  An INNER join, for the same reason: a delivery nobody can attribute must not
  be able to turn a healthy channel amber. `left join` plus
  `coalesce(is_fixture, false) = false` reads as caution and behaves as the
  opposite — it treats "I know nothing about this" as "this is real".
*/
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
    select d.channel,
           count(*) as recent_failures,
           max(d.updated_at) as last_failure,
           (array_agg(d.error_code order by d.updated_at desc))[1] as last_error
      from public.deliveries d
      join public.jobs j on j.job_id = d.job_id
     where d.state = 'failed'
       and not j.is_fixture
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
$fn$;

commit;
