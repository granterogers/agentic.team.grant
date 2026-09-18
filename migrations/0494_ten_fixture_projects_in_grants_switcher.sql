/*
  Ten fixture projects were sitting in Grant's project switcher, one per gate
  run.

  Found by acting like him: asked *"what projects do we have open?"* the
  office answered with his four — and the same query, unfiltered, shows
  nineteen active projects, ten of them `fixture-recovers-<run>` created
  between 17 and 18 September.

  `verify:recovers` created a new project every run, hung four jobs on it, and
  tore down only the jobs. A job can never be deleted, so `app.project_delete`
  refuses those projects for ever: they are PERMANENT, and they were growing
  by one per gate run. That is CLAUDE.md's twenty-five-project pile rebuilding
  itself.

  The cause is fixed in the suite — one stable `fixture-recovers` project,
  reused, so nothing accumulates. This archives what is already there.

  **Archived, not deleted.** Each holds four jobs and a job cannot be removed,
  so deletion is not available at any price. Archiving is the honest thing
  that IS available: it takes them out of every active reader, and the rows
  keep their history.
*/

update public.projects
   set status = 'archived'
 where status = 'active'
   and is_fixture
   and slug like 'fixture-recovers-%'
   and slug <> 'fixture-recovers';

-- ---------------------------------------------------------------------------
-- And a reader, so the class is visible rather than discovered by accident.
--
-- `check:leaks` sweeps what it can DELETE. This answers the different
-- question: what is active, is harness traffic, and cannot be swept — which
-- is exactly the shape that accumulates silently.
-- ---------------------------------------------------------------------------

create or replace function app.stuck_fixture_projects()
returns table (slug text, name text, jobs int, age interval)
language sql
stable
security definer
set search_path = ''
as $$
  select p.slug, p.name,
         (select count(*)::int from public.jobs j where j.project_id = p.project_id),
         app.now_utc() - p.created_at
    from public.projects p
   where p.status = 'active'
     and p.is_fixture
     -- Holding a job is what makes it undeletable, which is what makes it
     -- accumulate. A fixture project with no jobs is swept by purge:fixtures
     -- and is nobody's problem.
     and exists (select 1 from public.jobs j where j.project_id = p.project_id)
   order by p.created_at
$$;

comment on function app.stuck_fixture_projects() is
  '0494. Active fixture projects that hold a job and therefore can never be '
  'deleted. Ten of these reached Grant''s switcher before anybody looked. '
  'check:leaks sweeps what it CAN remove; this names what it cannot.';

create or replace function public.stuck_fixture_projects()
returns table (slug text, name text, jobs int, age interval)
language sql stable security definer set search_path = ''
as $$ select * from app.stuck_fixture_projects() $$;

grant execute on function app.stuck_fixture_projects() to ai_team_app;
grant execute on function public.stuck_fixture_projects() to ai_team_app;

-- ---------------------------------------------------------------------------
-- Drive it.
-- ---------------------------------------------------------------------------

do $drive$
declare
  v_left int;
  v_seen int;
begin
  select count(*)::int into v_left
    from public.projects
   where status = 'active' and is_fixture and slug like 'fixture-recovers-%'
     and slug <> 'fixture-recovers';
  if v_left <> 0 then
    raise exception '0494: % per-run fixture project(s) are still active', v_left;
  end if;

  -- THE CONTROL: the reader must be able to SEE one, or it is a query that
  -- reports nothing because it can report nothing — the found-nothing shape.
  insert into public.projects (slug, name, status)
  values ('fixture-drive0494', 'Fixture: drive 0494', 'active');
  insert into public.project_attachments
    (project_id, connector, external_ref, display_name, role)
  select project_id, 'upload', 'fixture', 'drive', 'source'
    from public.projects where slug = 'fixture-drive0494';
  insert into public.jobs
    (correlation_id, project_id, idempotency_key, kind, requested_by, priority, announce)
  select gen_random_uuid(), project_id, 'drive-0494', 'office.noop', 'verify:drive0494', 100, false
    from public.projects where slug = 'fixture-drive0494';

  select count(*)::int into v_seen
    from app.stuck_fixture_projects() where slug = 'fixture-drive0494';
  if v_seen <> 1 then
    raise exception '0494: the reader cannot see a stuck fixture project it was handed';
  end if;

  raise exception using errcode = 'ZZ000', message = '0494 drive: rolling back';
exception
  when others then
    if sqlerrm <> '0494 drive: rolling back' then raise; end if;
end
$drive$;
