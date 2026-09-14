begin;

-- ---------------------------------------------------------------------------
-- 0355 - a job in a FIXTURE PROJECT is harness traffic (#212)
--
-- Third instance of one trap. 0342 taught `jobs.is_fixture` about
-- `%:verify-%` after `verify:addressing` ran 43 jobs for real; 0351 corrected
-- `telegram:4242` after gate-3's twenty-seven were reported to Grant as
-- Telegram DEGRADED. Neither covers this shape, and today there are
--
--     85 jobs whose PROJECT is a fixture and whose own is_fixture is false
--
-- the oldest from 7 September and the newest from this morning. Every reader
-- that filters `jobs.is_fixture` counts all 85 as real work.
--
-- ## What it was telling him
--
-- `app.undelivered()` - the list #202 built so he can see messages that never
-- arrived - was reporting two deliveries against a project literally named
-- `fixture-conversation-6i3ke8xs` as genuine failures. CLAUDE.md already says
-- why that costs more than a wrong number: a health reading that cries wolf
-- teaches him to ignore health readings, and this is inside the two features
-- built to make the office legible.
--
-- ## Why not fix the column
--
-- `jobs.is_fixture` is GENERATED, so it may only reference its own row - it
-- cannot see the project. A trigger-maintained copy would be worse: 0303 and
-- 0304 are the record of what a denormalised flag on a job costs when the
-- truth changes afterwards.
--
-- So it is DERIVED, in one place, and the three readers that report to Grant
-- ask that one place. The next reader inherits the definition instead of
-- re-deriving it, which is the half 0342 and 0351 each left undone.
-- ---------------------------------------------------------------------------

/*
  One definition of "this job is harness traffic".

  STABLE and cheap: the readers below are a 24-hour window, four channels and
  a list capped at 200 rows, so a per-row lookup on two indexed primary keys
  costs nothing measurable.

  NULL is not harness. `conversation_channels` counts inbound messages that
  may have no job at all, and 0304's rule applies: the absence of a fixture
  flag is not the presence of one. A message nobody could attribute is a real
  message, which is the safe direction for a thing that decides what to hide.
*/
create or replace function app.harness_job(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select coalesce(
    (select j.is_fixture or coalesce(p.is_fixture, false)
       from public.jobs j
       left join public.projects p on p.project_id = j.project_id
      where j.job_id = p_job_id),
    false)
$$;

comment on function app.harness_job(uuid) is
  'True when a job is harness traffic - by its own generated is_fixture, or '
  'because it belongs to a fixture PROJECT, which the generated column cannot '
  'see (#212). NULL job means not harness: an unattributable row is real.';

grant execute on function app.harness_job(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- The three readers that report to Grant
--
-- Reproduced from their live definitions with ONE predicate changed in each,
-- generated rather than retyped so there is no transcription error in a health
-- reading. Everything else is byte-for-byte what 0345, 0349 and 0351 left.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.undelivered(p_project_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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
         and not app.harness_job(j.job_id)
         and (p_project_id is null or j.project_id = p_project_id)
       order by d.updated_at desc
       limit greatest(1, least(coalesce(p_limit, 50), 200))
    ) x
$function$;

CREATE OR REPLACE FUNCTION app.conversation_channels()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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
     where not app.harness_job(c.job_id)
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
$function$;

CREATE OR REPLACE FUNCTION app.office_health(p_hours integer DEFAULT 24)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select jsonb_build_object(
    'window_hours', p_hours,
    'finished', count(*) filter (where state = 'complete'),
    'failed', count(*) filter (where state = 'failed'),
    'in_flight', count(*) filter (where state not in ('complete', 'failed', 'cancelled')),
    -- Named, because "3 failed" is a number and "3 failed, all notebook.generate"
    -- is something a person can act on.
    'failing_kinds', (
      select coalesce(jsonb_agg(jsonb_build_object('kind', k.kind, 'n', k.n)
             order by k.n desc), '[]'::jsonb)
        from (select kind, count(*) n
                from public.jobs
               where not app.harness_job(job_id) and state = 'failed'
                 and created_at > app.now_utc() - make_interval(hours => p_hours)
               group by kind order by count(*) desc limit 5) k
    ),
    /*
      Jobs nobody has taken (#112).

      NOT restricted to the window. A stall is measured from the job's own age
      against its duty's period, and the whole failure this comes from was a
      backlog growing older than any window you would pick to look through.
      Filtering it to 24 hours would hide exactly the case that has gone on
      longest.
    */
    'stalled', (select coalesce(sum(s.n), 0) from app.jobs_stuck_queued() s),
    'stalled_kinds', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'kind', s.kind, 'n', s.n, 'oldest_minutes', s.oldest_minutes,
               'period_minutes', s.period_minutes) order by s.n desc), '[]'::jsonb)
        from app.jobs_stuck_queued() s
    ),
    'excluded_fixtures', (
      select count(*) from public.jobs
       where app.harness_job(job_id)
         and created_at > app.now_utc() - make_interval(hours => p_hours)
    )
  )
    from public.jobs
   where not app.harness_job(job_id)
     and created_at > app.now_utc() - make_interval(hours => p_hours)
$function$;

commit;
