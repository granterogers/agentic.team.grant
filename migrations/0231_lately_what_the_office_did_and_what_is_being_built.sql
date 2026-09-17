-- Lately: what the office did, and what is being built.
--
-- Issue #68, ADR-0019. Six sections exist only on the plain page and two of
-- them are the same shape — a reverse-chronological list of what has happened.
--
--     "Everything that happened"     the office acting on Grant's work
--     "What Claude is building"      me, working on the office
--
-- They are read together and answer one question — *what has been going on* —
-- so they are one page in the studio with two columns rather than two rail
-- items. The canonical IA is explicit that navigation is two levels and never
-- three, and adding a rail entry per list is how a product ends up with nine.
--
-- ## Why the build diary is on Grant's dashboard at all
--
-- Grant: *"I want to see what it is that you're doing... so that I can pop into
-- the application and see what it is you're doing."* It is not office work and
-- it is not his work; it is a window on the person changing the thing. That is
-- why it sits beside the office's own history rather than inside Settings.
--
-- ## Job transitions are not events
--
-- `hq_activity` returns rows from `job_state_transitions` — every dequeue,
-- every state change, four rows per job. That is the right feed for debugging a
-- worker and the wrong one for a person: "drive.watch → notifying → complete"
-- three times is not what happened, it is how it happened. The office's own
-- history is `public.events`, which is written deliberately and carries a
-- rationale, so that is what this reads.

begin;

create or replace function app.hq_studio_lately(p_limit integer default 40)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with office as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', e.event_id,
             'who', e.actor,
             'kind', e.actor_kind,
             'verb', app.action_in_words(e.action_type) ->> 'verb',
             'what', app.action_in_words(e.action_type) ->> 'what',
             'why', e.rationale_summary,
             'project', p.name,
             'when', to_char(e.occurred_at, 'FMDD Mon HH24:MI'),
             'at', e.occurred_at,
             -- §6 again: whether there is a way back, and what it is. On a page
             -- of things that already happened this is the only actionable
             -- column, so it is not buried.
             'reversible', e.reversible,
             'undo_with', e.reversal_method
           ) order by e.occurred_at desc), '[]'::jsonb) as v
      from (select * from public.events ee
             order by ee.occurred_at desc
             limit greatest(coalesce(p_limit, 40), 1)) e
      left join public.projects p on p.project_id = e.project_id
  ),

  building as (
    select app.hq_build() as v
  ),

  -- One line for the top of the page, counted rather than asserted.
  today as (
    select jsonb_build_object(
      'events', (select count(*)::int from public.events e
                  where e.occurred_at > app.now_utc() - interval '24 hours'),
      'jobs_done', (select count(*)::int from public.jobs j
                     where not j.is_fixture and j.state = 'complete'
                       and j.updated_at > app.now_utc() - interval '24 hours'),
      'jobs_failed', (select count(*)::int from public.jobs j
                       where not j.is_fixture and j.state = 'failed'
                         and j.updated_at > app.now_utc() - interval '24 hours')
    ) as v
  )

  select jsonb_build_object(
    'office', (select v from office),
    'building', (select v from building),
    'today', (select v from today),
    'generated_at', app.now_utc()
  )
$$;

comment on function app.hq_studio_lately(integer) is
  'What the office did and what is being built, as one page (#68). Reads '
  'public.events rather than job_state_transitions: four rows per job is how '
  'something happened, not what happened.';

create or replace function public.hq_studio_lately(p_limit integer default 40)
returns jsonb language sql stable security definer set search_path = ''
as $$ select app.hq_studio_lately(p_limit) $$;

commit;
