-- 0281 — a task with no project can be created
--
-- 0280 made `tasks.project_id` nullable so that "renew the domain" has
-- somewhere to live. Nothing can create one: `hq_task_add` requires a project
-- slug and refuses anything that does not resolve, so the nullable column is
-- reachable only by a direct INSERT — which is to say, by me and not by Grant.
--
-- That is #72's shape one more time: the mechanism built, the mouth forgotten.
-- A column nothing can write to is a column that does not exist.
--
-- ## An empty project means none, and an unknown one is still an error
--
-- The distinction matters. `''` and null are Grant saying "this is not about a
-- project"; `'coching-corse'` is a typo, and silently filing that under "no
-- project" would lose the task somewhere he is not looking. So the empty case
-- is explicit and everything else still has to resolve.
--
-- Rest of the function is 0238's, reproduced from `pg_get_functiondef`.

begin;

create or replace function app.hq_task_add(
  p_project text, p_title text, p_detail text default null,
  p_due_on date default null, p_assignee text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_project uuid;
  v_staff   uuid;
  v_title   text := btrim(coalesce(p_title, ''));
  v         jsonb;
begin
  if v_title = '' then
    return jsonb_build_object('error', 'a task needs a title');
  end if;

  /*
    No project is a real answer now (0280, #173), and it is spelled as an empty
    string or null rather than as a slug that fails to resolve -- a typo must
    not quietly become a task filed nowhere.
  */
  if coalesce(btrim(p_project), '') <> '' then
    select project_id into v_project
      from public.projects
     where slug = btrim(p_project)
       and coalesce(status, '') <> 'archived'
       and not is_fixture;
    if v_project is null then
      return jsonb_build_object('error', format('no dashboard project called %L', p_project));
    end if;
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
    'id', task_id, 'title', title, 'state', state, 'due_on', due_on,
    'project', (select p.slug from public.projects p where p.project_id = v_project)
  ) into v;

  return v;
end;
$function$;

commit;
