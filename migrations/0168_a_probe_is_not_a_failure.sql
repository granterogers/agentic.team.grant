-- A probe is not a failure.
--
-- I told Grant, in as many words, that 264 jobs had failed in twenty-four
-- hours against 265 succeeded — that roughly half of everything the office
-- attempted was failing, and that nothing had surfaced it to him.
--
-- Every one of those 264 was my own test scaffolding. `verification.probe`
-- fixtures retired on purpose by `verify:jobs`, `research.explodes` and
-- `research.liar` deliberately failed by `verify:worker`, four `research` jobs
-- against a project literally called "Fixture: agent engine". Of the jobs
-- Grant himself caused — 97 from Telegram, 20 from voice, 9 from Slack — ONE
-- failed, and that one is fixed in the same change as this.
--
-- So the alarming number was an artefact of counting, and I passed it on
-- because the counting is what I read. That is the same defect 0164 fixed for
-- projects, one table over, and the same defect that has the Finance Director
-- reporting invented delivery failures against chat ids like -1009999123.
--
-- ## Generated from what the harnesses already do
--
-- `requested_by` is set by whoever enqueues, and every harness here already
-- writes 'verify:...', 'phase-N-verification', 'gate-N' or 'probe'. So this is
-- read off the existing convention rather than added as a flag somebody has to
-- remember — exactly the argument 0164 makes for deriving from the slug.
--
-- ## Suppressed from health, not from the record
--
-- The rows stay. `verify:jobs` still needs to find its own probes, and a
-- fixture failing when it was meant to succeed is a real signal to the harness
-- that produced it. What changes is what counts as the OFFICE's health — the
-- number a person reads and forms a judgement from.

begin;

alter table public.jobs
  add column if not exists is_fixture boolean
  generated always as (
    coalesce(requested_by, '') like 'verify:%'
    or coalesce(requested_by, '') like 'verify'
    or coalesce(requested_by, '') like '%-verification'
    or coalesce(requested_by, '') like 'gate-%'
    or coalesce(requested_by, '') = 'probe'
    or coalesce(requested_by, '') like 'purge:%'
    or kind like 'verification.%'
    or kind like 'research.%'
  ) stored;

comment on column public.jobs.is_fixture is
  'A job created by a verification harness rather than by the office doing its '
  'work. Generated from requested_by and kind, both of which every harness '
  'here already sets by convention, so there is no flag to forget. Excluded '
  'from every health figure a person reads — 264 of 265 "failures" in one day '
  'were these, and I reported them to Grant as the office falling over (0168).';

create index if not exists jobs_real_health
  on public.jobs (state, created_at) where not is_fixture;

-- ---------------------------------------------------------------------------
-- What the office's health actually is
-- ---------------------------------------------------------------------------
--
-- One function, so the call, the dashboard and the capacity report cannot
-- drift into three different answers to "how is it going" — which is how the
-- Finance Director came to be paging Grant about failures that never happened.

create or replace function app.office_health(p_hours integer default 24)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
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
               where not is_fixture and state = 'failed'
                 and created_at > app.now_utc() - make_interval(hours => p_hours)
               group by kind order by count(*) desc limit 5) k
    ),
    'excluded_fixtures', (
      select count(*) from public.jobs
       where is_fixture
         and created_at > app.now_utc() - make_interval(hours => p_hours)
    )
  )
    from public.jobs
   where not is_fixture
     and created_at > app.now_utc() - make_interval(hours => p_hours)
$function$;

comment on function app.office_health is
  'How the office is actually doing, with its own test scaffolding left out. '
  'One definition so the call, the dashboard and the capacity report cannot '
  'give three answers (0168).';

-- ---------------------------------------------------------------------------
-- And the call reads it, rather than counting for itself
-- ---------------------------------------------------------------------------

create or replace function app.voice_state()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select jsonb_build_object(
    'as_of', app.now_utc(),
    'projects', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'name', p.name,
               'purpose', left(coalesce(p.purpose, p.description, ''), 200),
               'documents', (select count(*) from public.documents d
                              where d.project_id = p.project_id),
               'connected_to', (select coalesce(string_agg(distinct a.connector, ', '), 'nothing')
                                  from public.project_attachments a
                                 where a.project_id = p.project_id and a.enabled),
               'last_output', (select max(o.created_at)
                                 from public.outputs o
                                 join public.jobs j on j.job_id = o.job_id
                                where j.project_id = p.project_id))
             order by p.name), '[]'::jsonb)
        from public.projects p
       where p.status = 'active' and not p.is_fixture
    ),
    'team', (
      select coalesce(jsonb_agg(jsonb_build_object('name', s.name, 'title', s.title)
             order by s.name), '[]'::jsonb)
        from public.staff s where s.active
    ),
    -- 0168: the office's own work, not the harnesses'. Claire told Grant the
    -- place was falling over because this counted probes.
    'today', app.office_health(24),
    'waiting_on_grant', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'what', left(n.requested_action, 160),
               'why', left(coalesce(n.why_needed, ''), 160),
               'project', pr.name,
               'work_goes_on', n.work_can_continue,
               'since', n.created_at) order by n.created_at), '[]'::jsonb)
        from public.needs_me n
        left join public.projects pr on pr.project_id = n.project_id
    ),
    'latest', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'who', coalesce(s.name, 'the office'),
               'project', pr.name,
               'headline', left(o.body, 220),
               'when', o.created_at) order by o.created_at desc), '[]'::jsonb)
        from (select ob.* from public.outputs ob
                join public.jobs jb on jb.job_id = ob.job_id
               where not jb.is_fixture
               order by ob.created_at desc limit 6) o
        left join public.staff s on s.staff_id = o.staff_id
        left join public.jobs j on j.job_id = o.job_id
        left join public.projects pr on pr.project_id = j.project_id
    )
  )
$function$;

create or replace function public.office_health(p_hours integer default 24)
returns jsonb language sql stable security definer set search_path = public, pg_catalog
as $$ select app.office_health(p_hours) $$;

revoke all on function public.office_health(integer) from public;
grant execute on function public.office_health(integer) to service_role;

-- ---------------------------------------------------------------------------
-- Prove the number it reports is the honest one
-- ---------------------------------------------------------------------------

do $$
declare
  v_all  bigint;
  v_real bigint;
  v      jsonb;
begin
  select count(*) into v_all from public.jobs
   where state = 'failed' and created_at > app.now_utc() - interval '24 hours';
  select count(*) into v_real from public.jobs
   where state = 'failed' and not is_fixture
     and created_at > app.now_utc() - interval '24 hours';

  -- The whole point. If these were equal the column would be doing nothing,
  -- and the day this was written they were 264 and 0.
  if v_all = v_real and v_all > 20 then
    raise exception
      'is_fixture excluded nothing: % failures counted both ways, so the harness '
      'traffic is still being reported as the office falling over', v_all;
  end if;

  v := app.office_health(24);
  if (v->>'failed')::bigint <> v_real then
    raise exception 'office_health says % failed, the table says %',
      v->>'failed', v_real;
  end if;

  -- And the call must be reading the same figure, not counting again.
  v := app.voice_state();
  if (v->'today'->>'failed')::bigint <> v_real then
    raise exception 'voice_state disagrees with office_health about failures';
  end if;
end
$$;

commit;
