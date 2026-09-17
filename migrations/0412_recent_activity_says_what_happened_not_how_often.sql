-- Recent activity becomes legible (#14).
--
-- #14 asks that an activity item answer *who did what, for which project, why,
-- when, what happened, and what was produced*. Measured on the live office this
-- afternoon, the page answered none of it, because of two separate defects in
-- one function.
--
-- ## 1. One duty drowned everything else
--
-- 285 of the 372 events in the last 24 hours are `finding.committed`, written
-- by the noticing pass every ten minutes. The top forty rows of Grant's Recent
-- activity page were forty of them, alternating between two agents:
--
--     chief-of-staff       finding.committed   17:20
--     chief-of-staff       finding.committed   17:09
--     operations-director  finding.committed   17:02
--     ... thirty-seven more
--
-- Everything else the office did that day — six tool requests, two grants, two
-- revocations, a skill written, 74 things learned — was below the fold of a
-- page that only holds forty. A feed where one row repeats is a feed nobody
-- reads, which is #14's complaint exactly.
--
-- So: the two newest of any (actor, action, project) are kept as they are, and
-- the rest of that group collapses into ONE summary row carrying how many there
-- were. Two rather than one, because a repeat is information the first time —
-- "she is doing this again" — and noise the twentieth.
--
-- ## Why the kept rows are kept individually
--
-- `events.reversible` and `reversal_method` are the only actionable column on a
-- page of things that have already happened, and undo belongs to ONE event. A
-- summary row therefore says `reversible: false` and offers no undo, because
-- "undo these twenty-three things" is not something the ledger can do and
-- offering it would be a control claiming what nothing performs (0298's
-- defect). The two kept rows keep theirs.
--
-- ## 2. The day's counts read harness traffic as real
--
-- `today` counted `not j.is_fixture`, which 0355 records as the flag that
-- cannot see a job whose PROJECT is a fixture — it is GENERATED, so it may only
-- reference its own row. Three readers were moved to `app.harness_job` then and
-- this one was missed. It is one job out today and it is the same defect;
-- the events list had no fixture filter at all, and 11 of the last 24 hours'
-- 372 events are on fixture projects.
--
-- Fifth time harness traffic has been about to be reported to Grant as the
-- office working or failing, and the second inside a surface built to make the
-- office legible.

create or replace function app.hq_studio_lately(p_limit integer default 40)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  with
  -- A window to summarise from, deliberately wider than the page: collapsing
  -- forty rows into eight and then showing eight is a shorter page, not a
  -- better one.
  recent as (
    select e.event_id, e.actor, e.actor_kind, e.action_type, e.rationale_summary,
           e.project_id, e.occurred_at, e.reversible, e.reversal_method,
           p.name as project_name
      from public.events e
      left join public.projects p on p.project_id = e.project_id
     where p.project_id is null or not p.is_fixture
     order by e.occurred_at desc
     limit greatest(coalesce(p_limit, 40), 1) * 10
  ),
  ranked as (
    select r.*,
           row_number() over (partition by r.actor, r.action_type, r.project_id
                              order by r.occurred_at desc) as n
      from recent r
  ),
  kept as (
    select jsonb_build_object(
             'id', k.event_id,
             'who', k.actor,
             'kind', k.actor_kind,
             'verb', app.action_in_words(k.action_type) ->> 'verb',
             'what', app.action_in_words(k.action_type) ->> 'what',
             'why', k.rationale_summary,
             'project', k.project_name,
             'when', to_char(k.occurred_at, 'FMDD Mon HH24:MI'),
             'at', k.occurred_at,
             'reversible', k.reversible,
             'undo_with', k.reversal_method
           ) as v, k.occurred_at as at
      from ranked k
     where k.n <= 2
  ),
  -- The rest of each group, as one row that says how many and when the last of
  -- them was. Placed at the newest of the ones it stands for, so it sits
  -- directly under the two that are shown rather than at the bottom of the day.
  folded as (
    select jsonb_build_object(
             'id', null,
             'who', f.actor,
             'kind', min(f.actor_kind),
             'verb', app.action_in_words(f.action_type) ->> 'verb',
             'what', app.action_in_words(f.action_type) ->> 'what',
             'why', null,
             'project', min(f.project_name),
             'when', to_char(max(f.occurred_at), 'FMDD Mon HH24:MI'),
             'at', max(f.occurred_at),
             'times', count(*)::int,
             'reversible', false,
             'undo_with', null
           ) as v, max(f.occurred_at) as at
      from ranked f
     where f.n > 2
     group by f.actor, f.action_type, f.project_id
  ),
  office as (
    select coalesce(jsonb_agg(x.v order by x.at desc), '[]'::jsonb) as v
      from (
        select v, at from kept
        union all
        select v, at from folded
        order by at desc
        limit greatest(coalesce(p_limit, 40), 1)
      ) x
  ),
  building as (select app.hq_build() as v),
  today as (
    select jsonb_build_object(
      'events', (select count(*)::int
                   from public.events e
                   left join public.projects p on p.project_id = e.project_id
                  where e.occurred_at > app.now_utc() - interval '24 hours'
                    and (p.project_id is null or not p.is_fixture)),
      'jobs_done', (select count(*)::int from public.jobs j
                     where not app.harness_job(j.job_id) and j.state = 'complete'
                       and j.updated_at > app.now_utc() - interval '24 hours'),
      'jobs_failed', (select count(*)::int from public.jobs j
                       where not app.harness_job(j.job_id) and j.state = 'failed'
                         and j.updated_at > app.now_utc() - interval '24 hours')
    ) as v
  )
  select jsonb_build_object(
    'office', (select v from office),
    'building', (select v from building),
    'today', (select v from today),
    'generated_at', app.now_utc()
  )
$function$;
