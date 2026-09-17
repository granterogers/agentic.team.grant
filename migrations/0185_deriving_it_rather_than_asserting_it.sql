-- Deriving it rather than asserting it, and the RPCs on top.
--
-- Issue #47. Two corrections to 0184, both places where the comment described a
-- guarantee the SQL did not provide. Writing them down here rather than editing
-- 0184, because a migration that has run is history.
--
-- ## 1. `is_fixture` was not generated, and the comment said it was
--
-- 0184 says:
--
--     GENERATED from the job, so it cannot be set wrongly.
--
-- It is a plain column with a default of false. A GENERATED column cannot read
-- another table, which is why it could not have been written that way — and the
-- consequence is that a fixture job's impediment defaults to counting as real.
-- That is exactly the failure `jobs.is_fixture` was created to prevent: 264
-- harness jobs once reported to Grant as the office collapsing. Here it would
-- manufacture proposals out of verification noise.
--
-- A BEFORE INSERT trigger copies it from the job and ignores whatever the caller
-- passed, which gets the same guarantee by the only means available.
--
-- ## 2. The two credential checks could still drift
--
-- 0184 extracted `app.reject_credential_text_on()` and said the two triggers
-- both call it "so the two cannot drift apart". Only the new one does; 0181's
-- still carries its own copy of the pattern. One protected table and one
-- protected-looking table is worse than two obvious copies, because nobody
-- re-reads the one that claims to be shared.

begin;

-- ---------------------------------------------------------------------------
-- 1. Derive the fixture flag from the job it is about
-- ---------------------------------------------------------------------------
create or replace function app.impediment_inherits_fixture()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The caller does not get a say. Harness traffic must not be able to present
  -- itself as the office struggling, whatever it passes.
  select j.is_fixture into new.is_fixture
    from public.jobs j where j.job_id = new.job_id;
  new.is_fixture := coalesce(new.is_fixture, false);
  return new;
end;
$$;

comment on function app.impediment_inherits_fixture() is
  'Copies jobs.is_fixture onto the impediment, overriding the caller. A '
  'GENERATED column cannot read another table, so this is how the same '
  'guarantee is reached.';

create trigger job_impediments_inherit_fixture
  before insert on public.job_impediments
  for each row execute function app.impediment_inherits_fixture();

-- ---------------------------------------------------------------------------
-- 2. One credential check, actually shared
-- ---------------------------------------------------------------------------
create or replace function app.reject_credential_text()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.reject_credential_text_on(new.body);
  return new;
end;
$$;

comment on function app.reject_credential_text() is
  'Lessons trigger. Delegates to app.reject_credential_text_on() so the '
  'pattern lives in exactly one place (0185).';

-- ---------------------------------------------------------------------------
-- Recording one
--
-- Named `cannot` because that is what an agent is saying, and a function an
-- agent is meant to reach for should be named the way the agent would think of
-- it. `app.record_job_impediment` is what it would be called if nobody expected
-- it to be used.
-- ---------------------------------------------------------------------------
create or replace function app.cannot(
  p_job_id        uuid,
  p_kind          public.impediment_kind,
  p_needed        text,
  p_noticed_by    text,
  p_detail        text default '',
  p_understood_as text default ''
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  j    public.jobs%rowtype;
  made public.job_impediments%rowtype;
begin
  select * into j from public.jobs where job_id = p_job_id;
  if not found then
    return jsonb_build_object('error', 'no such job');
  end if;

  insert into public.job_impediments
    (job_id, project_id, staff_slug, kind, needed_raw, detail, understood_as, noticed_by)
  values
    (p_job_id, j.project_id, j.recipient_agent, p_kind, p_needed,
     left(coalesce(p_detail, ''), 500), left(coalesce(p_understood_as, ''), 280),
     p_noticed_by)
  returning * into made;

  return jsonb_build_object(
    'impediment_id', made.impediment_id,
    'needed', made.needed,
    'counted', not made.is_fixture
  );
end;
$$;

comment on function app.cannot(uuid, public.impediment_kind, text, text, text, text) is
  'An agent saying what it could not do, typed so it can be counted (#47). The '
  'fixture flag is derived from the job, so a verification run cannot inflate '
  'the tally.';

-- ---------------------------------------------------------------------------
-- What keeps happening
--
-- The query #49 is built on. One row per (kind, needed, agent), with the count,
-- how long it has been going on, and a sample of the human-readable detail so a
-- proposal can quote something real rather than restating the handle.
-- ---------------------------------------------------------------------------
create or replace function app.impediments_tally(
  p_days     integer default 30,
  p_min      integer default 2
)
returns table (
  kind         public.impediment_kind,
  needed       text,
  staff_slug   text,
  times        integer,
  first_seen   timestamptz,
  last_seen    timestamptz,
  projects     integer,
  for_instance text
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.kind,
         i.needed,
         i.staff_slug,
         count(*)::int                        as times,
         min(i.created_at)                    as first_seen,
         max(i.created_at)                    as last_seen,
         count(distinct i.project_id)::int    as projects,
         -- The most recent detail that actually said something. A proposal that
         -- quotes a real sentence is read; one that restates a handle is not.
         (array_agg(i.detail order by i.created_at desc)
            filter (where btrim(i.detail) <> ''))[1] as for_instance
    from public.job_impediments i
   where not i.is_fixture
     and i.created_at >= app.now_utc() - make_interval(days => greatest(coalesce(p_days, 30), 1))
   group by i.kind, i.needed, i.staff_slug
  having count(*) >= greatest(coalesce(p_min, 2), 1)
   order by count(*) desc, max(i.created_at) desc
$$;

comment on function app.impediments_tally(integer, integer) is
  'Limitations that have RECURRED, which is the only honest basis for a '
  'proposal (#49). One failure is not a proposal. Fixtures excluded.';

-- ---------------------------------------------------------------------------
-- Public wrappers — PostgREST only exposes public
-- ---------------------------------------------------------------------------
create or replace function public.job_cannot(
  p_job_id uuid, p_kind public.impediment_kind, p_needed text, p_noticed_by text,
  p_detail text default '', p_understood_as text default ''
)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.cannot(p_job_id, p_kind, p_needed, p_noticed_by, p_detail, p_understood_as) $$;

create or replace function public.impediments_tally(
  p_days integer default 30, p_min integer default 2
)
returns table (
  kind public.impediment_kind, needed text, staff_slug text, times integer,
  first_seen timestamptz, last_seen timestamptz, projects integer, for_instance text
)
language sql stable security definer set search_path = ''
as $$ select * from app.impediments_tally(p_days, p_min) $$;

commit;
