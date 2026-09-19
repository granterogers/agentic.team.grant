/*
  0515 — a parent carries its subtasks (#259).

  0514 made subtasks creatable. `app.my_tasks` reports a `children` COUNT,
  which is enough to say "3 left" and not enough to show them — and a count
  with no way to see what it counts is a dead end on the one screen whose job
  is telling you what to do.

  Nesting cannot be assembled in the page from the flat list, either: a
  subtask due today and its parent due next week are in different buckets, so
  the renderer would nest what happens to be in the same answer and orphan the
  rest. That is the row-list-built-twice defect with a filter in front of it.

  So the parent carries its own children, from the database, whichever bucket
  it is in. One level only (0514 refuses to nest further), so this cannot grow
  a tree, and bounded to twenty because a parent with more than that has a
  project rather than a subtask list.

  Spliced from the LIVE definition: only the payload gains a key.
*/

do $splice$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'my_tasks';
  if v_def is null then
    raise exception '0515: app.my_tasks is missing';
  end if;

  v_def := replace(v_def,
    '           ''done_at'', k.done_at',
    '           /*'                                                      || chr(10) ||
    '             0515. The children themselves, not only how many. One level,'  || chr(10) ||
    '             because 0514 refuses to nest further, and capped so a parent'  || chr(10) ||
    '             with fifty is a project rather than a payload.'                || chr(10) ||
    '           */'                                                      || chr(10) ||
    '           ''subtasks'', (select coalesce(jsonb_agg(jsonb_build_object('     || chr(10) ||
    '                             ''id'', c.task_id, ''title'', c.title,'         || chr(10) ||
    '                             ''state'', c.state,'                            || chr(10) ||
    '                             ''done'', c.state = ''done'','                  || chr(10) ||
    '                             ''due_on'', c.due_on)'                          || chr(10) ||
    '                             order by (c.state = ''done''), c.due_on nulls last,' || chr(10) ||
    '                                      c.priority, c.created_at), ''[]''::jsonb)' || chr(10) ||
    '                         from public.tasks c'                                || chr(10) ||
    '                        where c.parent_task_id = k.task_id'                  || chr(10) ||
    '                        limit 20),'                                          || chr(10) ||
    '           ''done_at'', k.done_at');

  if position('''subtasks''' in v_def) = 0 then
    raise exception '0515: the payload anchor was not found, so the splice did nothing';
  end if;
  execute v_def;
end
$splice$;

do $drive$
declare
  v_parent uuid;
  v_child  uuid;
  v_row    jsonb;
begin
  v_parent := (app.my_task_add('Subtasks probe 0515 parent') ->> 'id')::uuid;
  v_child  := (app.my_task_add('Subtasks probe 0515 child',
                               p_parent => v_parent::text) ->> 'id')::uuid;

  select e into v_row
    from jsonb_array_elements(app.my_tasks('all', 200, 'Subtasks probe 0515 parent')) e
   limit 1;
  if v_row is null then
    raise exception '0515: the parent is not in the list at all';
  end if;
  if jsonb_array_length(v_row -> 'subtasks') <> 1 then
    raise exception '0515: the parent carries % subtask(s)',
      jsonb_array_length(v_row -> 'subtasks');
  end if;
  if (v_row -> 'subtasks' -> 0 ->> 'id')::uuid <> v_child then
    raise exception '0515: the parent carries somebody else''s child';
  end if;
  if (v_row -> 'subtasks' -> 0 ->> 'done')::boolean is not false then
    raise exception '0515: a new subtask is reported as done';
  end if;

  -- CONTROL: a task with no children carries an empty list, not null, so the
  -- renderer never has to ask which of the two it has.
  select e into v_row
    from jsonb_array_elements(app.my_tasks('all', 200, 'Subtasks probe 0515 child')) e
   limit 1;
  if v_row -> 'subtasks' <> '[]'::jsonb then
    raise exception 'CONTROL FAILED: a childless task carries %', v_row -> 'subtasks';
  end if;

  delete from public.tasks where title like 'Subtasks probe 0515%';
  raise notice '0515: a parent carries its children, and a childless task carries none';
end
$drive$;
