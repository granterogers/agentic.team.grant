-- 0287 — a task can be born a milestone
--
-- Issue #71's other half. 0286 established that a module IS a milestone task
-- that gathers documents, so making a module is making a milestone — and
-- `hq_task_add` could not make one. `hq_task_update` has taken `p_milestone`
-- since 0238, so the page's only route was add-then-promote: two round trips,
-- and a refusal on the second leaves a plain task on the board that nobody
-- asked for.
--
-- ## The argument list changes, so this drops first
--
-- CLAUDE.md, learned the hard way:
--
--   > *`create or replace function` does not replace a function whose argument
--   > list changed* — it creates a second overload and calls become ambiguous.
--   > `drop function` by exact signature first. **Check the public wrapper
--   > too:** it is the half that silently drops a new parameter.
--
-- Both halves are dropped by exact signature and both are recreated. The
-- wrapper is the one that bites: left alone it still compiles, still resolves,
-- and passes five of six arguments — so a milestone created through `hq-api`
-- would arrive as an ordinary task and nothing would say so.
--
-- ## `p_milestone` last, and defaulted
--
-- Every existing caller — `hq-api`'s action list, the worker, three verify
-- suites — passes five arguments positionally and must keep working unchanged.

begin;

drop function if exists public.hq_task_add(text, text, text, date, text);
drop function if exists app.hq_task_add(text, text, text, date, text);

create or replace function app.hq_task_add(
  p_project   text,
  p_title     text,
  p_detail    text default null,
  p_due_on    date default null,
  p_assignee  text default null,
  p_milestone boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
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

  /*
    A module belongs to a project (#71, 0286). `studio_modules` is asked for one
    project's milestones, so a milestone filed nowhere is a milestone that can
    never appear on any board — refused here rather than written and lost.
  */
  if coalesce(p_milestone, false) and v_project is null then
    return jsonb_build_object('error',
      'a module belongs to a dashboard project — say which one');
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

  insert into public.tasks
    (project_id, title, detail, due_on, assignee_staff, added_by, is_milestone)
  values (v_project, v_title, coalesce(btrim(p_detail), ''), p_due_on, v_staff, 'grant',
          coalesce(p_milestone, false))
  returning jsonb_build_object(
    'id', task_id, 'title', title, 'state', state, 'due_on', due_on,
    'milestone', is_milestone,
    'project', (select p.slug from public.projects p where p.project_id = v_project)
  ) into v;

  return v;
end;
$function$;

-- The wrapper, with all six. PostgREST only exposes `public`.
create or replace function public.hq_task_add(
  p_project   text,
  p_title     text,
  p_detail    text default null,
  p_due_on    date default null,
  p_assignee  text default null,
  p_milestone boolean default false
)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog
as $function$
begin
  return app.hq_task_add(p_project, p_title, p_detail, p_due_on, p_assignee, p_milestone);
end;
$function$;

grant execute on function app.hq_task_add(text, text, text, date, text, boolean) to ai_team_app;
grant execute on function public.hq_task_add(text, text, text, date, text, boolean) to ai_team_app;

commit;
