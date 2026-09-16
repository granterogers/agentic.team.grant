begin;

-- ---------------------------------------------------------------------------
-- 0381 - what changed since you last looked (#122)
--
-- Grant's own framing of the gap: "Lately" is a feed you have to read in full
-- every time, and what is missing is the cheaper signal - WHICH PROJECTS have
-- something new on them - so the portfolio answers "where should I look" rather
-- than "here is everything".
--
-- ## The two rules the issue says decide whether this is useful or noise
--
-- 1. "The office's own work does not count as new until it is FINISHED. A job
--    starting is not something to look at; an output waiting on a decision is.
--    Otherwise every project is permanently marked and the mark means nothing."
--
--    So this counts outputs, documents, finished tasks and impediments - things
--    that have arrived - and never counts a job being queued or running. The
--    failure it names is real and this repository has already shipped it once:
--    a summary line told Grant four of six services needed attention when none
--    did, and a mark that is always on is a mark nobody reads.
--
-- 2. "It belongs in the office, not the browser... a 'new since' that resets
--    per machine tells him something is new because he last read it on the
--    laptop."
--
--    Hence a table rather than localStorage. Same argument as 0376 and 0380,
--    and the one place where those two deliberately went the other way is a
--    per-viewer convenience, which this is not.
--
-- ## Never seen is not everything ever
--
-- A project with no row has never been opened on any device, and counting its
-- entire history as unread would mark every project on the first load with a
-- number in the hundreds. The floor is the LATER of the project's creation and
-- seven days ago: a new project shows what has happened on it, and an old one
-- that has never been opened shows the last week rather than a year.
-- ---------------------------------------------------------------------------

create table if not exists public.project_seen (
  owner       text        not null,
  project_id  uuid        not null references public.projects(project_id) on delete cascade,
  at          timestamptz not null default app.now_utc(),
  primary key (owner, project_id)
);

comment on table public.project_seen is
  'When Grant last opened each dashboard project, per person (#122, 0381). In '
  'the office rather than the browser because he uses more than one device, '
  'and a "new since" that resets per machine reports the laptop as news.';

create or replace function app.studio_unseen()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
with mine as (
  select p.project_id, p.slug,
         greatest(
           coalesce((select s.at from public.project_seen s
                      where s.owner = 'grant' and s.project_id = p.project_id),
                    p.created_at),
           app.now_utc() - interval '7 days') as since
    from public.projects p
   where p.status = 'active' and not p.is_fixture
),
counted as (
  select m.slug,
         (select count(*) from public.documents d
           where d.project_id = m.project_id and d.created_at > m.since
             and coalesce(d.state, 'live') <> 'superseded') as docs,
         (select count(*) from public.tasks t
           where t.project_id = m.project_id and t.created_at > m.since
             and not coalesce(t.is_fixture, false)) as tasks,
         /*
           Outputs, through the job, because `outputs` has no project of its
           own - CLAUDE.md's own note about this join. An output exists only
           when a job produced one, which is the "finished" the first rule asks
           for: there is no such thing as an output from a job that is still
           thinking.
         */
         (select count(*) from public.outputs o
            join public.jobs j on j.job_id = o.job_id
           where j.project_id = m.project_id and o.created_at > m.since
             and not coalesce(app.harness_job(j.job_id), false)) as answers,
         (select count(*) from public.job_impediments i
           where i.project_id = m.project_id and i.created_at > m.since
             and not coalesce(i.is_fixture, false)) as walls
    from mine m
)
select coalesce(jsonb_object_agg(c.slug, jsonb_build_object(
         'n', c.docs + c.tasks + c.answers + c.walls,
         'docs', c.docs, 'tasks', c.tasks, 'answers', c.answers, 'walls', c.walls)),
       '{}'::jsonb)
  from counted c
 where c.docs + c.tasks + c.answers + c.walls > 0
$$;

comment on function app.studio_unseen() is
  'How much has arrived on each project since Grant last opened it (#122). '
  'Counts things that have ARRIVED - outputs, documents, tasks, impediments - '
  'and never a job that has merely started, because a mark that is always on '
  'is a mark nobody reads.';

create or replace function app.hq_project_seen(p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  insert into public.project_seen (owner, project_id, at)
  values ('grant', p_project_id, app.now_utc())
  on conflict (owner, project_id) do update set at = app.now_utc();
  return jsonb_build_object('seen', true);
end;
$$;

create or replace function public.studio_unseen()
returns jsonb language sql stable security definer set search_path = public, pg_catalog
as $$ select app.studio_unseen() $$;

create or replace function public.hq_project_seen(p_project_id uuid)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.hq_project_seen(p_project_id) $$;

revoke all on function public.studio_unseen() from public;
revoke all on function public.hq_project_seen(uuid) from public;
grant execute on function public.studio_unseen() to service_role;
grant execute on function public.hq_project_seen(uuid) to service_role;

commit;
