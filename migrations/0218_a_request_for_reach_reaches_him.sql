-- The office asks for something, and it reaches him.
--
-- Issue #53, and the step that makes the rest of it worth having. 0215 built
-- the request, the approval and the durable decline, and nothing carried a
-- request to Grant — so the office could ask and he would never hear it. That
-- is the same failure as #52 shipping a noticing pass nobody read, in the same
-- week, which is why it is worth naming rather than quietly fixing: the shape
-- recurs. Build the mechanism, forget the mouth.
--
-- Copied programmatically from 0211, which copied it from 0188, with one CTE
-- added. Retyping this function by hand is how 0128 got two column names wrong.

begin;

create or replace function app.morning_briefing_facts()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with
  z as (select app.grant_timezone() as tz),
  -- The local day this briefing is FOR, which is not necessarily today in UTC.
  d as (select (app.now_utc() at time zone (select tz from z))::date as today),

  /*
    What needs him. First, because it is the only category he can unblock —
    the `needs_me` view's own comment says so, and it is not capped there
    deliberately: "a view that silently returned 7 of 40 would hide the thing
    worth knowing."
  */
  waiting as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'what', n.requested_action,
             'why', n.why_needed,
             'project', p.name,
             'overdue', n.overdue,
             'deadline', n.real_deadline,
             'if_delayed', n.consequences_of_delay,
             'work_continues', n.work_can_continue
           ) order by n.overdue desc, n.real_deadline nulls last, n.created_at), '[]'::jsonb) as v
      from public.needs_me n
      left join public.projects p on p.project_id = n.project_id
  ),

  -- What the office did while he slept. Fixtures excluded — 264 harness
  -- failures were once reported to him as the office falling over.
  overnight as (
    select jsonb_build_object(
             'finished', count(*) filter (where j.state = 'complete'),
             'failed',   count(*) filter (where j.state = 'failed'),
             'still_going', count(*) filter (where j.state in ('queued', 'running'))
           ) as v
      from public.jobs j
     where not j.is_fixture
       and j.updated_at >= app.now_utc() - interval '18 hours'
  ),

  -- What is stuck, and for how long. A blocked job with no stated reason is
  -- the failure Active Jobs was built to fix, so the reason comes with it.
  stuck as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'kind', j.kind,
             'project', p.name,
             'since_hours', round(extract(epoch from (app.now_utc() - j.updated_at)) / 3600),
             'why', coalesce(nullif(btrim(j.state_reason), ''), 'no reason recorded')
           ) order by j.updated_at), '[]'::jsonb) as v
      from public.jobs j
      left join public.projects p on p.project_id = j.project_id
     where not j.is_fixture
       and j.state in ('waiting_external', 'waiting_user', 'retrying', 'paused')
       and j.updated_at < app.now_utc() - interval '2 hours'
  ),

  -- His day. The calendar is already refreshed hourly by its own duty.
  diary as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'what', c.summary,
             'at', c.starts_at
           ) order by c.starts_at), '[]'::jsonb) as v
      from public.calendar_events c, z, d
     where (c.starts_at at time zone z.tz)::date = d.today
  ),

  /*
    What the office has asked to be able to reach (#53).

    Its own section rather than a recommendation, because it is a different
    kind of sentence: a recommendation is something he might act on, and this
    is a question waiting on an answer only he can give. The needs_me argument
    applies — burying a request under a status summary is how it gets missed.
  */
  wanted as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'tool', w.tool,
             'asked_by', w.asked_by,
             'what_for', w.what_for,
             'exists_yet', w.exists_yet,
             'days', round(extract(epoch from (app.now_utc() - w.raised_at)) / 86400)
           ) order by w.raised_at), '[]'::jsonb) as v
      from app.reach_wanted() w
  ),

  /*
    Recommendations, from the one place that computes them (#52), already
    ranked and already stripped of anything he has dismissed.
  */
  noticed as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'kind', n.kind,
             'body', n.body,
             'because', n.because,
             'weight', n.weight
           ) order by n.weight desc), '[]'::jsonb) as v
      from app.notice(6) n
  )

  select jsonb_build_object(
    'for_date', (select today from d),
    'timezone', (select tz from z),
    'generated_at', app.now_utc(),
    'waiting_on_you', (select v from waiting),
    'overnight', (select v from overnight),
    'stuck', (select v from stuck),
    'diary', (select v from diary),
    'noticed', (select v from noticed),
    'wanted', (select v from wanted)
  )
$$;

comment on function app.morning_briefing_facts() is
  'Everything the morning briefing is allowed to say, counted rather than '
  'inferred (#56). Recommendations come from app.notice() (#52) and open '
  'requests for reach from app.reach_wanted() (#53).';

commit;
