-- A task created by a harness turn must be flagged as one.
--
-- Issue #231, Campaign Three. `tasks.is_fixture` is GENERATED from `added_by`
-- and matches `verify:%`, `gate-%`, `probe` and two others. 0367's writer
-- passes `added_by => 'the office'` for every task an agent creates -- so a
-- task created by a HARNESS turn, in a fixture project, was flagged real and
-- would have appeared on Grant's board as genuine work.
--
-- This is the fourth instance of the shape CLAUDE.md records three times:
-- harness traffic invisible to the fixture rule because the rule reads a
-- column the harness does not control. 0342 taught `jobs.is_fixture` about
-- `%:verify-%`, 0351 corrected `telegram:4242`, 0355 derived it for fixture
-- PROJECTS. Same defect, new table.
--
-- ## Decided in the writer, not by the caller
--
-- `app.task_add` already takes `p_job`, so it can ask `app.harness_job` itself.
-- Making the handler work out its own attribution would put the decision in
-- the one place that cannot be trusted to remember it -- and CLAUDE.md's rule
-- from `record_consultation` applies: prefer the RPC doing the resolution over
-- every caller knowing the vocabulary.
--
-- ## And it preserves the evidence
--
-- The session harness used to DELETE the tasks it created, which destroyed the
-- only proof that `task.create` is reachable at all: `npm run levels` counts
-- surviving rows, so the capability read as never-exercised the morning after
-- it was proven end to end. A flagged task is invisible to every reader that
-- reports to Grant AND still countable, which is what a harness wants -- the
-- same argument 0297 makes about fixture impediments.

create or replace function app.task_add(
  p_project   uuid,
  p_title     text,
  p_detail    text default null,
  p_due_on    date default null,
  p_assignee  text default null,
  p_milestone boolean default false,
  p_added_by  text default 'grant',
  p_job       uuid default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_staff uuid;
  v_title text := btrim(coalesce(p_title, ''));
  v_by    text := coalesce(nullif(btrim(p_added_by), ''), 'grant');
  v       jsonb;
begin
  if v_title = '' then
    return jsonb_build_object('error', 'a task needs a title');
  end if;

  if p_project is not null
     and not exists (select 1 from public.projects
                      where project_id = p_project
                        and coalesce(status, '') <> 'archived') then
    return jsonb_build_object('error', 'that project does not exist or is archived');
  end if;

  if coalesce(p_milestone, false) and p_project is null then
    return jsonb_build_object('error',
      'a module belongs to a dashboard project - say which one');
  end if;

  if coalesce(btrim(p_assignee), '') <> '' then
    select staff_id into v_staff from public.staff where slug = btrim(p_assignee);
    if v_staff is null then
      return jsonb_build_object('error', format('nobody here is called %L', btrim(p_assignee)));
    end if;
  end if;

  /*
    Harness traffic names itself, here, once.

    `is_fixture` is GENERATED from `added_by`, so the prefix is the only way to
    set it -- and the job is the only thing that knows. A caller that had to
    remember this would forget, which is the whole history of this defect.
  */
  if p_job is not null and app.harness_job(p_job) then
    v_by := 'verify:' || v_by;
  end if;

  insert into public.tasks
    (project_id, title, detail, due_on, assignee_staff, added_by, is_milestone, job_id)
  values (p_project, v_title, coalesce(btrim(p_detail), ''), p_due_on, v_staff,
          v_by, coalesce(p_milestone, false), p_job)
  returning jsonb_build_object(
    'id', task_id, 'title', title, 'state', state, 'due_on', due_on,
    'milestone', is_milestone, 'fixture', is_fixture,
    'project', (select p.slug from public.projects p where p.project_id = p_project)
  ) into v;

  return v;
end;
$fn$;
