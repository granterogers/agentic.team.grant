-- `projects` has `status`, not `is_archived` (#11).
--
-- 0238 guarded the project lookup with `not is_archived`. There is no such
-- column: the real ones are
--
--   project_id, slug, name, status, notebook_ref, created_at, updated_at,
--   channel_prefix, description, purpose, notion_teamspace_name, is_fixture
--
-- and archiving is a value of `status`. `hq_task_add` therefore threw on every
-- call rather than refusing politely, which is the same class of mistake as
-- guessing `due_at` for `due_on` and `jobs.status` for `jobs.state` -- all
-- three are in CLAUDE.md and the rule above them says query
-- `information_schema` FIRST. I did not, again.
--
-- Archived is excluded by value, and fixtures with it: a task added to a
-- fixture project would be a task the harness owns, and those are exactly what
-- `is_fixture` exists to keep out of Grant's view.

create or replace function app.hq_task_add(
  p_project   text,
  p_title     text,
  p_detail    text default null,
  p_due_on    date default null,
  p_assignee  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_project uuid;
  v_staff   uuid;
  v_title   text := btrim(coalesce(p_title, ''));
  v         jsonb;
begin
  if v_title = '' then
    return jsonb_build_object('error', 'a task needs a title');
  end if;

  select project_id into v_project
    from public.projects
   where slug = p_project
     and coalesce(status, '') <> 'archived'
     and not is_fixture;
  if v_project is null then
    return jsonb_build_object('error', format('no dashboard project called %L', p_project));
  end if;

  -- `assignee_staff` is a UUID, not a slug, and the interface holds slugs.
  -- Resolved here so no caller has to know. An unknown slug is refused rather
  -- than silently leaving the task unassigned: an assignment that quietly did
  -- not happen is worse than one that was rejected.
  if coalesce(btrim(p_assignee), '') <> '' then
    select staff_id into v_staff from public.staff where slug = btrim(p_assignee);
    if v_staff is null then
      return jsonb_build_object('error', format('nobody here is called %L', btrim(p_assignee)));
    end if;
  end if;

  insert into public.tasks (project_id, title, detail, due_on, assignee_staff, added_by)
  values (v_project, v_title, coalesce(btrim(p_detail), ''), p_due_on, v_staff, 'grant')
  returning jsonb_build_object(
    'id', task_id, 'title', title, 'state', state, 'due_on', due_on
  ) into v;

  return v;
end;
$$;
