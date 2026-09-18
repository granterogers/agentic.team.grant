/*
  0483 — the team's work and Grant's own are not one list (#259, ADR-0041).

  0482 made personal tasks real: a `public.tasks` row with `assigned_to_human`
  true. That immediately creates the defect #259's third invariant forbids by
  name — *"Never show a second list or the same canonical task twice"* —
  because the two readers that already list tasks do not know the difference.

  `app.hq_portfolio_tasks` is the office's cross-project list, drawn on the
  global Tasks screen, and it filters only `is_fixture`. So the first personal
  task Grant added would appear there AND in My Tasks, and the screen built to
  tell him what the TEAM is doing would be showing him his own errands.

  `app.studio_tasks` is the project's Tasks tab, and there the answer is the
  opposite: #259 asks for *"Project dashboards show their relevant personal
  tasks"*, so it keeps both and gains a flag saying which is which. A list that
  mixes them without saying is the same defect in the other direction.

  ADR-0041 named this as the one failure one table can produce, and it is
  asymmetric: a personal task missing from My Tasks is an annoyance, and the
  office's work in Grant's personal list is what stops him trusting the list.
  So the portfolio reader EXCLUDES, which is the safe direction, and the
  project reader MARKS, which is the informative one.

  Spliced from the live definitions rather than transcribed. `hq_portfolio_tasks`
  is long, CLAUDE.md records what rewriting a function from memory cost
  (`pause_job` lost four behaviours in one go), and `pg_get_functiondef` emits
  no trailing semicolon — paid for twice.
*/

do $splice$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'hq_portfolio_tasks';
  if v_def is null then
    raise exception '0483: app.hq_portfolio_tasks is not there to splice';
  end if;
  if position('assigned_to_human' in v_def) > 0 then
    raise notice '0483: the portfolio reader already knows the difference';
    return;
  end if;
  if position('where not t.is_fixture' in v_def) = 0 then
    raise exception '0483: the splice point moved — the fixture filter has been rewritten';
  end if;
  v_def := replace(v_def,
    'where not t.is_fixture',
    -- The team's work, and only the team's. A personal task belongs to My
    -- Tasks (#259 invariant 3) and showing it here would be the same canonical
    -- row in two lists.
    'where not t.is_fixture and not t.assigned_to_human');
  execute v_def || ';';
end $splice$;

do $splice2$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'studio_tasks';
  if v_def is null then
    raise exception '0483: app.studio_tasks is not there to splice';
  end if;
  if position('''mine''' in v_def) > 0 then
    raise notice '0483: the project reader already marks them';
    return;
  end if;
  if position(E'\'parent\', tk.parent_task_id' in v_def) = 0 then
    raise exception '0483: the splice point moved — studio_tasks has been rewritten';
  end if;
  v_def := replace(v_def,
    E'\'parent\', tk.parent_task_id',
    E'\'parent\', tk.parent_task_id,\n'
    || E'           -- Grant''s own, on the project it belongs to (#259). Marked\n'
    || E'           -- rather than hidden: the project is where he decides, and a\n'
    || E'           -- list that mixes his errands with the team''s work without\n'
    || E'           -- saying which is which is the same defect as showing them twice.\n'
    || E'           \'mine\', tk.assigned_to_human,\n'
    || E'           \'labels\', to_jsonb(tk.labels)');
  execute v_def || ';';
end $splice2$;

/*
  Driven, in both directions, because a filter is only proved by the row it
  keeps out. A suite of positives passes against a reader that returns
  everything — ADR-0041 says so and this is where it is cheapest to check.
*/
do $drive$
declare
  v_project uuid;
  v_mine uuid;
  v_theirs uuid;
  v_mine_loose uuid;
  v_theirs_loose uuid;
  v_portfolio jsonb;
  v_project_tasks jsonb;
begin
  insert into public.projects (slug, name, purpose, status)
  values ('fixture-tasksplit-' || substr(md5(random()::text), 1, 8),
          'Task split drive', 'Rolled back inside 0483', 'paused')
  returning project_id into v_project;

  insert into public.tasks (project_id, title, state, assigned_to_human)
  values (v_project, 'Grant rings the venue 0483', 'todo', true)
  returning task_id into v_mine;
  insert into public.tasks (project_id, title, state, assigned_to_human)
  values (v_project, 'The office drafts the note 0483', 'todo', false)
  returning task_id into v_theirs;

  /*
    The portfolio half uses tasks with NO project.

    `hq_portfolio_tasks` requires `project_id is null or p.status = 'active'`,
    and the drive's project is PAUSED so nothing that fires on an active
    project can see it. The first run of this block asserted the team's task
    was in the list and it was not — the test was wrong, not the reader, which
    is the most-used rule in CLAUDE.md. A project-less pair exercises the same
    filter with nothing else in the way, and #139's proposals land exactly
    there anyway.
  */
  insert into public.tasks (project_id, title, state, assigned_to_human)
  values (null, 'Grant books the train 0483', 'todo', true)
  returning task_id into v_mine_loose;
  insert into public.tasks (project_id, title, state, assigned_to_human)
  values (null, 'The office checks the figures 0483', 'todo', false)
  returning task_id into v_theirs_loose;

  v_portfolio := app.hq_portfolio_tasks(500) -> 'tasks';
  if exists (select 1 from jsonb_array_elements(v_portfolio) e
              where (e ->> 'id')::uuid = v_mine_loose) then
    raise exception '0483: a personal task is in the team''s cross-project list';
  end if;
  if not exists (select 1 from jsonb_array_elements(v_portfolio) e
                  where (e ->> 'id')::uuid = v_theirs_loose) then
    raise exception '0483: the team''s own task fell out of the team''s list';
  end if;

  v_project_tasks := app.studio_tasks(v_project);
  if not exists (select 1 from jsonb_array_elements(v_project_tasks) e
                  where (e ->> 'id')::uuid = v_mine and (e ->> 'mine')::boolean) then
    raise exception '0483: the project tab does not show Grant''s own task, marked';
  end if;
  if exists (select 1 from jsonb_array_elements(v_project_tasks) e
              where (e ->> 'id')::uuid = v_theirs and (e ->> 'mine')::boolean) then
    raise exception '0483: the team''s task is marked as Grant''s';
  end if;
  if not exists (select 1 from jsonb_array_elements(app.my_tasks('all', 500)) e
                  where (e ->> 'id')::uuid = v_mine) then
    raise exception '0483: the personal task is not in My Tasks';
  end if;
  if exists (select 1 from jsonb_array_elements(app.my_tasks('all', 500)) e
              where (e ->> 'id')::uuid = v_theirs) then
    raise exception '0483: the team''s task is in My Tasks';
  end if;

  raise notice '0483: both readers agree about which list a task belongs in';

  delete from public.tasks
   where task_id in (v_mine, v_theirs, v_mine_loose, v_theirs_loose);
  delete from public.events where project_id = v_project;
  delete from public.projects where project_id = v_project;
end $drive$;
