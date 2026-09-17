/*
  0406 - the office gains a word for waiting, and a fifth reader stops
  counting harness traffic (#236).

  Two findings, both from asking what `app.office_health()` could have shown
  Grant during the fifteen-hour outage of 13-14 September, when eleven of his
  messages sat queued and nothing anywhere said so.

  ONE - "STALLED" IS MEASURED AGAINST A DUTY'S PERIOD, SO A PERSON WAITS AN
  HOUR IN SILENCE

  `app.jobs_stuck_queued` takes its threshold from `responsibilities.period_minutes`
  for the kind, falling back to sixty minutes for a kind no duty creates. The
  kind Grant's own messages arrive as - `office.instruction` - is exactly such
  a kind, so a question of his is not "stuck" until it has been ignored for an
  hour. That is a defensible threshold for a duty that runs daily and a poor
  one for somebody waiting for an answer.

  `verify:drains` already uses fifteen minutes and has since #236. The gate and
  the dashboard disagreeing about what "waiting" means is how a check goes red
  while the screen says the office is fine, so `waiting` reports the same
  fifteen minutes the gate does, beside `stalled` rather than instead of it.
  They answer different questions: `stalled` is "a duty is behind its own
  schedule", `waiting` is "a person has not been answered".

  TWO - IT FILTERS `is_fixture` RATHER THAN `app.harness_job`

  0355 derived the real answer once, in `app.harness_job`, precisely because
  the GENERATED column cannot see a job whose PROJECT is a fixture - and
  pointed the three readers that report to Grant at it. This is the fourth
  such reader and it was never carried across. Measured today: 2,262 jobs are
  real by the column and 2,122 by the derivation, so 140 rows disagree, and
  `stalled` and `stalled_kinds` go straight onto his dashboard.

  Fifth instance of harness traffic reaching a screen built to make the office
  legible. The cost is not the wrong number; it is that a health reading which
  cries wolf teaches him to ignore health readings.
*/

create or replace function app.jobs_stuck_queued(p_floor_minutes integer default 60)
returns table(kind text, n bigint, oldest_minutes integer, period_minutes integer)
language sql
stable security definer
set search_path = ''
as $$
  with limits as (
    -- One row per kind a duty creates, carrying how long is too long for it.
    -- Aggregated because two duties can share a kind, and the SHORTER period
    -- is the honest threshold: whichever duty fires more often is the one
    -- falling behind first.
    select r.job_kind as kind, min(r.period_minutes) as period
      from public.responsibilities r
     where r.enabled
     group by r.job_kind
  )
  select j.kind,
         count(*) as n,
         max(extract(epoch from (app.now_utc() - j.created_at)) / 60)::int as oldest_minutes,
         coalesce(l.period, p_floor_minutes) as period_minutes
    from public.jobs j
    left join limits l on l.kind = j.kind
   -- app.harness_job, not j.is_fixture (0355). The generated column cannot see
   -- a job whose PROJECT is a fixture, and 140 rows differ today.
   where not app.harness_job(j.job_id)
     and j.state = 'queued'
     and j.created_at < app.now_utc()
         - make_interval(mins => coalesce(l.period, p_floor_minutes))
   group by j.kind, l.period
   order by count(*) desc, j.kind
$$;

/*
  Never-started work, at the threshold a PERSON notices.

  Deliberately not a count of everything queued: a job created eight seconds
  ago is the queue working. What has no word today is work that was accepted
  and never picked up, which is none of failed, stalled, in_flight or
  finished - every one of those is about a job that started.

  `retrying` is included with `queued` because a job recovery moved back is
  still a person waiting; app.recover_stalled_jobs deliberately sends an
  abandoned job to `retrying` rather than `queued` so the lost attempt still
  counts, and from Grant's side the two are the same silence.
*/
create or replace function app.jobs_waiting(p_minutes integer default 15)
returns table(kind text, n bigint, oldest_minutes integer)
language sql
stable security definer
set search_path = ''
as $$
  select j.kind,
         count(*) as n,
         max(extract(epoch from (app.now_utc() - j.created_at)) / 60)::int as oldest_minutes
    from public.jobs j
   where not app.harness_job(j.job_id)
     and j.state in ('queued', 'retrying')
     and j.created_at < app.now_utc() - make_interval(mins => p_minutes)
   group by j.kind
   order by max(j.created_at) asc, j.kind
$$;

comment on function app.jobs_waiting(integer) is
  'Work accepted and never picked up, at the threshold a person notices. #236';

create or replace function app.office_health(p_hours integer default 24)
returns jsonb
language sql
stable security definer
set search_path = ''
as $$
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
               where not app.harness_job(job_id) and state = 'failed'
                 and created_at > app.now_utc() - make_interval(hours => p_hours)
               group by kind order by count(*) desc limit 5) k
    ),
    'stalled', (select coalesce(sum(s.n), 0) from app.jobs_stuck_queued() s),
    'stalled_kinds', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'kind', s.kind, 'n', s.n, 'oldest_minutes', s.oldest_minutes,
               'period_minutes', s.period_minutes) order by s.n desc), '[]'::jsonb)
        from app.jobs_stuck_queued() s
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
        from app.jobs_waiting(15) w
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
    'held_for_budget', app.held_for_budget(), 'excluded_fixtures', (
      select count(*) from public.jobs
       where app.harness_job(job_id)
         and created_at > app.now_utc() - make_interval(hours => p_hours)
    )
  )
    from public.jobs
   where not app.harness_job(job_id)
     and created_at > app.now_utc() - make_interval(hours => p_hours)
$$;
