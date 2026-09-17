begin;

-- ---------------------------------------------------------------------------
-- 0385 - what each agent has actually done (#155)
--
-- Grant: *"Eight cards saying Available. Nothing says what Emma actually
-- produced this week, what she is good at, what she has been asked for most, or
-- what she failed at. It is an org chart where a team page should be."*
--
-- And the line that decides what goes on the card:
--
--   *"what they failed at - visible, not hidden, because a team page that only
--   shows wins is decoration."*
--
-- So `could_not` is a first-class number beside `answered`, not a detail behind
-- something. An office that reports only its successes is the same defect as a
-- health line that says everything is fine: it trains the reader to stop
-- looking.
--
-- ## Harness traffic is not work
--
-- `app.harness_job` (0355) is what tells them apart, and it is asked here for
-- the reason CLAUDE.md gives four separate times: a verification suite's
-- traffic reported as the office's work is how "the office collapsed" gets
-- said about a green office. A fixture job is not something Emma did.
--
-- One call for the whole roster rather than one per agent. Eight round trips
-- to draw one screen is eight chances for a slow one to make the page look
-- broken, and the numbers are cheap.
-- ---------------------------------------------------------------------------

create or replace function app.studio_team_work(p_days integer default 14)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
with since as (select app.now_utc() - make_interval(days => greatest(1, coalesce(p_days, 14))) as t),
real_jobs as (
  select j.job_id, j.recipient_agent, j.state, j.created_at, j.project_id
    from public.jobs j, since s
   where j.recipient_agent is not null
     and j.created_at > s.t
     and not coalesce(app.harness_job(j.job_id), false)
),
per as (
  select st.slug, st.name, st.title,
         (select count(*) from real_jobs r where r.recipient_agent = st.slug) as asked,
         (select count(*) from real_jobs r
           where r.recipient_agent = st.slug and r.state = 'complete') as answered,
         (select count(*) from real_jobs r
           where r.recipient_agent = st.slug and r.state = 'failed') as failed,
         (select count(*) from public.job_impediments i, since s
           where i.staff_slug = st.slug and i.created_at > s.t
             and not coalesce(i.is_fixture, false)) as could_not,
         (select count(*) from real_jobs r
           where r.recipient_agent = st.slug
             and r.state not in ('complete', 'failed', 'cancelled')) as in_hand
    from public.staff st
   where st.active
),
made as (
  select r.recipient_agent as slug,
         jsonb_agg(jsonb_build_object(
           'title', d.title,
           'at', d.created_at,
           'project', (select p.name from public.projects p where p.project_id = d.project_id))
           order by d.created_at desc) as items
    from public.documents d
    join real_jobs r on r.job_id = d.produced_by_job
   group by r.recipient_agent
),
/*
  What they could not do, in their own words.

  The impediment's `needed` is the sentence the agent wrote about what stopped
  it, which is more useful than a count and is the whole point of showing
  failures at all - "3 could not" tells him to look, and this is what he finds.
*/
walls as (
  select i.staff_slug as slug,
         jsonb_agg(jsonb_build_object('needed', i.needed, 'at', i.created_at)
                   order by i.created_at desc) as items
    from public.job_impediments i, since s
   where i.created_at > s.t and not coalesce(i.is_fixture, false)
   group by i.staff_slug
)
select coalesce(jsonb_object_agg(per.slug, jsonb_build_object(
         'name', per.name, 'title', per.title,
         'asked', per.asked, 'answered', per.answered,
         'failed', per.failed, 'could_not', per.could_not, 'in_hand', per.in_hand,
         -- Three is a card, not a list. The rest is one press away on the
         -- agent's own screen.
         'made', coalesce((select jsonb_agg(x) from jsonb_array_elements(
                    (select m.items from made m where m.slug = per.slug)) with ordinality t(x, i)
                    where i <= 3), '[]'::jsonb),
         'walls', coalesce((select jsonb_agg(x) from jsonb_array_elements(
                    (select w.items from walls w where w.slug = per.slug)) with ordinality t(x, i)
                    where i <= 2), '[]'::jsonb))), '{}'::jsonb)
  from per
$$;

comment on function app.studio_team_work(integer) is
  'What each agent has actually done lately (#155): asked, answered, in hand, '
  'and COULD NOT - which is on the card rather than behind it, because a team '
  'page that only shows wins is decoration. Harness traffic is excluded '
  'through app.harness_job, because a fixture job is not something Emma did.';

create or replace function public.studio_team_work(p_days integer default 14)
returns jsonb language sql stable security definer set search_path = public, pg_catalog
as $$ select app.studio_team_work(p_days) $$;

revoke all on function public.studio_team_work(integer) from public;
grant execute on function public.studio_team_work(integer) to service_role;

commit;
