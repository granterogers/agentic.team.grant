-- Writing a skill down, reading it back, and finding out whether it helped.
--
-- Issue #50, second half. 0212 built the table and the ADR-0017 boundary; this
-- is the part an agent actually touches.
--
-- ## Retrieval says what is missing, and that is the whole route
--
-- `app.skills_for()` returns each skill with the tools it names AND whether the
-- person it was handed to actually holds them. Not because the prompt needs the
-- decoration, but because that column is the beginning of the only path the
-- office has to new capability without a coding session:
--
--   a step names a tool nobody holds
--     → app.cannot() records it as a typed impediment (0184)
--     → three in a fortnight becomes capability_missing (app.notice, 0210)
--     → it reaches Grant in the morning briefing, counted, in a sentence
--     → he grants the tool in one row on the Team page
--     → the skill works on the next job, unchanged.
--
-- Every piece of that existed already and none of it was joined up. The missing
-- link was something that could say "here is the procedure, and here is the one
-- part of it we cannot do."
--
-- ## Naming a tool still grants nothing
--
-- `holds` is computed by calling `app.staff_may_use()`, which reads
-- `tool_permissions` AND `staff_tools` and does not read skills. The arrow
-- points one way: authorisation informs retrieval, retrieval never informs
-- authorisation. Reversing it is how the boundary disappears, and
-- `verify:skills` fails structurally as well as behaviourally if it does.

begin;

-- ---------------------------------------------------------------------------
-- Only the current version of anything
-- ---------------------------------------------------------------------------
create or replace view public.skills_live as
  select s.*
    from public.skills s
   where s.row_kind = 'skill'
     -- Superseded by a newer version, or withdrawn. Either way, not current.
     and not exists (
       select 1 from public.skills n where n.supersedes = s.skill_id
     );

comment on view public.skills_live is
  'Skills that are current: not superseded by a later version and not retired. '
  'The table is append-only, so this is where every reader should look.';

grant select on public.skills_live to ai_team_app;

-- ---------------------------------------------------------------------------
-- Writing one down
--
-- The tools come in as an array and go out as rows, and an unknown tool is a
-- REFUSAL rather than a silently dropped element. A skill whose third step
-- quietly lost its tool is a skill that will fail confusingly at the one moment
-- it matters, and the author — who may be an agent — gets told which name was
-- wrong while it can still fix it.
-- ---------------------------------------------------------------------------
create or replace function app.teach_skill(
  p_name        text,
  p_when_to_use text,
  p_procedure   text,
  p_authored_by text,
  p_scope       public.lesson_scope default 'global',
  p_project_id  uuid default null,
  p_staff_slug  text default null,
  p_job_kind    text default null,
  p_tools       text[] default '{}',
  p_from_job    uuid default null,
  p_supersedes  uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  prior   public.skills%rowtype;
  made    public.skills%rowtype;
  next_v  integer := 1;
  unknown text;
begin
  if p_supersedes is not null then
    select * into prior from public.skills where skill_id = p_supersedes;
    if not found then
      return jsonb_build_object('error', 'nothing to supersede: ' || p_supersedes::text);
    end if;
    if exists (select 1 from public.skills where supersedes = p_supersedes) then
      return jsonb_build_object('error', 'that skill has already been revised');
    end if;
    next_v := prior.version + 1;
  end if;

  -- Named before anything is written, so the error is about the tool rather
  -- than about a foreign key on a table the author has never heard of.
  select t into unknown
    from unnest(coalesce(p_tools, '{}'::text[])) as t
   where not exists (select 1 from public.tool_permissions tp where tp.tool = t)
   limit 1;
  if unknown is not null then
    return jsonb_build_object(
      'error', 'no such tool: ' || unknown ||
               '. A skill may only name tools that already exist; ask for a new '
               'one rather than inventing it (ADR-0017).');
  end if;

  insert into public.skills
    (row_kind, scope, project_id, staff_slug, job_kind, name, when_to_use,
     procedure, authored_by, from_job, version, supersedes)
  values
    ('skill', p_scope, p_project_id, p_staff_slug, p_job_kind, p_name,
     p_when_to_use, p_procedure, p_authored_by, p_from_job, next_v, p_supersedes)
  returning * into made;

  insert into public.skill_tools (skill_id, tool)
  select made.skill_id, t from unnest(coalesce(p_tools, '{}'::text[])) as t
  on conflict do nothing;

  return jsonb_build_object(
    'skill_id', made.skill_id,
    'version', made.version,
    'replaced', p_supersedes,
    'tools', coalesce(p_tools, '{}'::text[])
  );
end;
$$;

comment on function app.teach_skill(text, text, text, text, public.lesson_scope, uuid, text, text, text[], uuid, uuid) is
  'Write down a reusable procedure (#50). Refuses a procedure containing an '
  'address or a credential, and refuses to name a tool that does not exist. '
  'Never updates: a new version supersedes (ADR-0017).';

-- ---------------------------------------------------------------------------
-- Withdrawing one
--
-- Grant must be able to retire a skill from the dashboard, for the same reason
-- he must be able to retract a lesson (#54): a procedure he cannot withdraw is
-- a rule he never agreed to. A retirement is a row, because the table refuses
-- UPDATE and because who withdrew it and why is worth keeping.
-- ---------------------------------------------------------------------------
create or replace function app.retire_skill(
  p_skill_id uuid,
  p_by       text,
  p_reason   text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  prior public.skills%rowtype;
begin
  select * into prior from public.skills where skill_id = p_skill_id;
  if not found then
    return jsonb_build_object('error', 'no such skill: ' || p_skill_id::text);
  end if;
  if exists (select 1 from public.skills where supersedes = p_skill_id) then
    return jsonb_build_object('error', 'that skill has already been revised or retired');
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 8 then
    return jsonb_build_object('error', 'a retirement needs a reason');
  end if;

  insert into public.skills
    (row_kind, scope, project_id, staff_slug, job_kind, name, when_to_use,
     procedure, authored_by, version, supersedes)
  values
    ('retirement', prior.scope, prior.project_id, prior.staff_slug, prior.job_kind,
     prior.name,
     'Retired. ' || btrim(p_reason),
     'This skill was withdrawn and is no longer used. Reason given: '
       || btrim(p_reason),
     p_by, prior.version + 1, p_skill_id);

  return jsonb_build_object('retired', p_skill_id, 'by', p_by);
end;
$$;

comment on function app.retire_skill(uuid, text, text) is
  'Withdraw a skill, with a reason and an author. A row rather than a flag: '
  'the table refuses UPDATE, and who withdrew it is worth keeping (#54).';

-- ---------------------------------------------------------------------------
-- What this job should know how to do
-- ---------------------------------------------------------------------------
create or replace function app.skills_for(
  p_staff_slug text default null,
  p_job_kind   text default null,
  p_project_id uuid default null,
  p_limit      integer default 4
)
returns table (
  skill_id    uuid,
  name        text,
  scope       public.lesson_scope,
  when_to_use text,
  procedure   text,
  tools       text[],
  missing     text[],
  authored_by text,
  version     integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.skill_id, s.name, s.scope, s.when_to_use, s.procedure,
         coalesce(t.all_tools, '{}') as tools,
         coalesce(t.not_held, '{}') as missing,
         s.authored_by, s.version
    from public.skills_live s
    left join lateral (
      select array_agg(st.tool order by st.tool) as all_tools,
             array_remove(array_agg(
               -- The one column that turns a procedure into a request. Computed
               -- by asking the authorisation path; the authorisation path is
               -- never asked to look the other way (ADR-0017).
               case when app.staff_may_use(coalesce(p_staff_slug, ''), st.tool)
                    then null else st.tool end
               order by st.tool), null) as not_held
        from public.skill_tools st
       where st.skill_id = s.skill_id
    ) t on true
   where (s.scope = 'global')
      or (s.scope = 'staff'   and s.staff_slug = p_staff_slug)
      or (s.scope = 'kind'    and s.job_kind   = p_job_kind)
      or (s.scope = 'project' and s.project_id = p_project_id)
   order by
     -- Same ranking rule as lessons: the specific one is what nobody knew, the
     -- general one is usually already reflected in how the office is built.
     case s.scope when 'staff' then 0 when 'kind' then 1 when 'project' then 2 else 3 end,
     s.created_at desc
   limit greatest(coalesce(p_limit, 4), 0)
$$;

comment on function app.skills_for(text, text, uuid, integer) is
  'The procedures a job should be shown, with the tools each names and which '
  'of those the person does not hold. `missing` is the start of the route to '
  'new capability: it becomes an impediment, then a briefing line (#50).';

-- ---------------------------------------------------------------------------
-- Recording that it was shown, and asking whether it helped
-- ---------------------------------------------------------------------------
create or replace function app.skill_used(p_skill_id uuid, p_job_id uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.skill_uses (skill_id, job_id)
  values (p_skill_id, p_job_id)
  on conflict do nothing
$$;

/*
  Did it help?

  Compared against the office's own completion rate over the same window rather
  than against nothing, because a raw "68% complete" is unreadable — the only
  question worth answering is whether jobs shown this skill did better or worse
  than jobs in general.

  Fixtures excluded, for the fifth or sixth time in this repository: harness
  traffic in a quality measure would make a good skill look bad on the day
  someone runs the test suite twice.

  `uses` is reported alongside the rate so a difference computed from two jobs
  is visibly a difference computed from two jobs.
*/
create or replace function app.skill_effect(p_days integer default 60)
returns table (
  skill_id     uuid,
  name         text,
  uses         integer,
  completed    integer,
  failed       integer,
  their_rate   numeric,
  office_rate  numeric,
  difference   numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with window_jobs as (
    select j.job_id, j.state
      from public.jobs j
     where not j.is_fixture
       and j.updated_at > app.now_utc() - (greatest(coalesce(p_days, 60), 1) || ' days')::interval
       and j.state in ('complete', 'failed')
  ),
  baseline as (
    select case when count(*) = 0 then null
                else round(count(*) filter (where state = 'complete')::numeric
                           / count(*), 3) end as rate
      from window_jobs
  )
  select s.skill_id, s.name,
         count(*)::integer as uses,
         count(*) filter (where w.state = 'complete')::integer as completed,
         count(*) filter (where w.state = 'failed')::integer as failed,
         round(count(*) filter (where w.state = 'complete')::numeric / count(*), 3) as their_rate,
         (select rate from baseline) as office_rate,
         round(count(*) filter (where w.state = 'complete')::numeric / count(*), 3)
           - coalesce((select rate from baseline), 0) as difference
    from public.skill_uses su
    join window_jobs w on w.job_id = su.job_id
    join public.skills s on s.skill_id = su.skill_id
   group by s.skill_id, s.name
   order by count(*) desc
$$;

comment on function app.skill_effect(integer) is
  'Whether a skill improved outcomes, against the office''s own rate over the '
  'same window (#50). A library of procedures nobody has checked is worse than '
  'none: expensive to read, and it looks like competence.';

-- ---------------------------------------------------------------------------
-- Public wrappers — PostgREST only exposes `public`, and the wrapper is the
-- half that silently drops a new parameter, so these are written out in full.
-- ---------------------------------------------------------------------------
create or replace function public.teach_skill(
  p_name text, p_when_to_use text, p_procedure text, p_authored_by text,
  p_scope public.lesson_scope default 'global', p_project_id uuid default null,
  p_staff_slug text default null, p_job_kind text default null,
  p_tools text[] default '{}', p_from_job uuid default null,
  p_supersedes uuid default null
)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.teach_skill(p_name, p_when_to_use, p_procedure, p_authored_by,
                             p_scope, p_project_id, p_staff_slug, p_job_kind,
                             p_tools, p_from_job, p_supersedes) $$;

create or replace function public.retire_skill(p_skill_id uuid, p_by text, p_reason text)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.retire_skill(p_skill_id, p_by, p_reason) $$;

create or replace function public.skills_for(
  p_staff_slug text default null, p_job_kind text default null,
  p_project_id uuid default null, p_limit integer default 4
)
returns table (
  skill_id uuid, name text, scope public.lesson_scope, when_to_use text,
  procedure text, tools text[], missing text[], authored_by text, version integer
)
language sql stable security definer set search_path = ''
as $$ select * from app.skills_for(p_staff_slug, p_job_kind, p_project_id, p_limit) $$;

create or replace function public.skill_effect(p_days integer default 60)
returns table (
  skill_id uuid, name text, uses integer, completed integer, failed integer,
  their_rate numeric, office_rate numeric, difference numeric
)
language sql stable security definer set search_path = ''
as $$ select * from app.skill_effect(p_days) $$;

commit;
