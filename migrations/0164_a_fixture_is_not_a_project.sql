-- A fixture is not a project, and "use the teamspace" is a thing to DO.
--
-- Two faults from one exchange, both of them the system failing to act on what
-- Grant told it.
--
-- ## He told the agent the name, and nothing could use it
--
-- 14:19, Telegram: *"there is only one current notion teamspace you have access
-- to already, so i don't think you need the iD.. and it has no active projects
-- ATM .. otherwise, good to go."* 14:20: *"just work with what you have for
-- now."*
--
-- The message resolved to the right project. Then nothing happened, because
-- there is no verb for it. The office can answer about Notion and, since 0163,
-- write to it — but "attach this project to the Notion you already have" is a
-- configuration change, and the only thing that could make one was a human
-- running `notion:adopt` from a terminal. Which is what I did, which is me
-- doing the job rather than the team.
--
-- So: a job kind, and a handler that does what the script does.
--
-- ## And a test fixture answered him
--
-- 14:28, his message about the Notion API was filed against
-- `fixture-notion-mtu70bz6` — a project `verify:notion` had created two minutes
-- earlier and had not yet archived.
--
-- The exact route cannot be replayed now the fixture is gone, and it does not
-- matter: every resolution path filters on `status = 'active'`, and a fixture
-- mid-run is active. Whichever branch picked it, the fault is that a fixture was
-- eligible at all. His real conversation was answered against a throwaway
-- project created by a test that was running at the time.
--
-- Named by convention rather than by a flag somebody has to remember to set:
-- `fixture-%` and `verify-%` are what every harness in this repository already
-- uses, and `purge:fixtures` already sweeps on them. A generated column means
-- nothing new has to be maintained.

begin;

-- ---------------------------------------------------------------------------
-- What is a fixture
-- ---------------------------------------------------------------------------

alter table public.projects
  add column if not exists is_fixture boolean
  generated always as (
    slug like 'fixture-%' or slug like 'verify-%' or slug like 'ledger-proof-%'
  ) stored;

comment on column public.projects.is_fixture is
  'A project created by a verification harness. Generated from the slug, which '
  'is the convention every harness here already follows and the one '
  'purge:fixtures already sweeps on — so there is no flag to forget. Excluded '
  'from every resolution path: a fixture answered one of Grant''s real messages '
  'on 2026-09-09 because it happened to be active while a test ran (0164).';

create index if not exists projects_resolvable
  on public.projects (status) where not is_fixture;

-- ---------------------------------------------------------------------------
-- And it cannot be resolved
-- ---------------------------------------------------------------------------

create or replace function app.references_in(p_text text)
returns table (project_id uuid, slug text, name text, connector text, external_ref text)
language sql
stable
security definer
set search_path to ''
as $$
  with found as (
    select lower(m[1]) as ref
      from regexp_matches(
             coalesce(p_text, ''),
             '([0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12})',
             'g'
           ) as m
    union
    select lower(m[1] || '/' || m[2])
      from regexp_matches(
             coalesce(p_text, ''),
             '(?:github\.com[/:])?([A-Za-z0-9][\w-]{0,38})/([\w.-]{1,100}?)(?:\.git)?(?=[\s,)\]]|$)',
             'g'
           ) as m
  ),
  candidates as (
    select ref from found
    union
    select replace(ref, '-', '') from found
  )
  select distinct p.project_id, p.slug, p.name, a.connector, a.external_ref
    from public.project_attachments a
    join public.projects p on p.project_id = a.project_id
   where p.status = 'active'
     and not p.is_fixture
     and a.enabled
     and (
       lower(a.external_ref) in (select ref from candidates)
       or replace(lower(a.external_ref), '-', '') in (select ref from candidates)
     )
$$;

create or replace function app.resolve_project_by_name(p_text text)
returns table (
  project_id  uuid,
  slug        text,
  name        text,
  confidence  numeric,
  how         text
)
language sql
stable
security definer
set search_path to ''
as $$
  with asked as (
    select app.normalise_name(p_text) as n
  ),
  live as (
    -- One place the fixture rule is applied, rather than four.
    select p.* from public.projects p
     where p.status = 'active' and not p.is_fixture
  ),
  scored as (
    select p.project_id, p.slug, p.name, 1.00::numeric as confidence, 'slug'::text as how
      from live p
     cross join asked a
     where a.n is not null and app.normalise_name(p.slug) = a.n

    union all

    select p.project_id, p.slug, p.name,
           least(0.99, 0.90 + (al.confidence * 0.09))::numeric,
           case al.source when 'grant' then 'you call it that'
                          when 'name' then 'its name'
                          when 'slug' then 'its slug'
                          else 'a name we picked up' end
      from public.project_aliases al
      join live p on p.project_id = al.project_id
     cross join asked a
     where a.n is not null and al.normalised = a.n

    union all

    -- The name inside a sentence (0156).
    select p.project_id, p.slug, p.name,
           least(0.95, 0.86 + (al.confidence * 0.09))::numeric,
           case al.source when 'grant' then 'you called it that, in what you said'
                          when 'name' then 'its name, in what you said'
                          else 'a name we know, in what you said' end
      from public.project_aliases al
      join live p on p.project_id = al.project_id
     cross join asked a
     where a.n is not null
       and length(al.normalised) >= 4
       and al.normalised <> a.n
       and a.n ~ ('\m' || regexp_replace(al.normalised, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') || '\M')

    union all

    select p.project_id, p.slug, p.name,
           (0.40 + (0.45 * greatest(
              extensions.similarity(app.normalise_name(p.name), a.n),
              coalesce((select max(extensions.similarity(al2.normalised, a.n))
                          from public.project_aliases al2
                         where al2.project_id = p.project_id), 0),
              coalesce(extensions.similarity(app.normalise_name(coalesce(p.description, '')), a.n), 0) * 0.6,
              coalesce(extensions.similarity(app.normalise_name(coalesce(p.purpose, '')), a.n), 0) * 0.6
           )))::numeric,
           'a close match on the name'::text
      from live p
     cross join asked a
     where a.n is not null
       and greatest(
             extensions.similarity(app.normalise_name(p.name), a.n),
             coalesce((select max(extensions.similarity(al3.normalised, a.n))
                         from public.project_aliases al3
                        where al3.project_id = p.project_id), 0),
             coalesce(extensions.similarity(app.normalise_name(coalesce(p.description, '')), a.n), 0) * 0.6,
             coalesce(extensions.similarity(app.normalise_name(coalesce(p.purpose, '')), a.n), 0) * 0.6
           ) >= 0.34
  )
  select distinct on (s.project_id)
         s.project_id, s.slug, s.name, round(s.confidence, 3), s.how
    from scored s
   order by s.project_id, s.confidence desc
$$;

-- The switch, too. A harness that switches a scope to its fixture and dies
-- before cleaning up must not leave Grant's chat pointed at it.
create or replace function app.current_project(p_scope_kind project_scope_kind, p_scope_ref text)
returns uuid
language sql
stable
security definer
set search_path to ''
as $$
  select s.project_id
    from public.project_switches s
    join public.projects p on p.project_id = s.project_id
   where s.scope_kind = p_scope_kind
     and s.scope_ref = p_scope_ref
     and not p.is_fixture
$$;

-- ---------------------------------------------------------------------------
-- "Use the Notion you already have" becomes something the office can do
-- ---------------------------------------------------------------------------

insert into public.job_kind_needs (kind, needs_subprocess, why)
values ('office.notion_adopt', false,
        'Attaches a project to the Notion data sources shared with the '
        'integration. Plain HTTPS, so any worker can run it.')
on conflict (kind) do nothing;

commit;
