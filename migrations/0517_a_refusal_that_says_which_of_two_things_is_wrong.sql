/*
  0517 — a refusal that says which of two things is wrong (#259).

  Deleting the same task twice answered:

      no personal task by that id — the team's own work is not deleted from here

  Both halves of that sentence are in 0513 for a reason and only one of them is
  ever true at a time. Said about a task that has already gone, it implies the
  row might be the office's — so a person who deleted something, or whose tap
  registered twice, is told their task might belong to the team. A refusal for
  the wrong reason is the shape CLAUDE.md records under its own heading, and it
  costs most when the words are the only thing the person gets.

  Two answers now, because there are two facts:

  - no row at all — it is gone, which after a delete is the honest and
    reassuring thing to say;
  - a row that is the office's — the boundary #259's second invariant draws,
    stated only when it is actually the reason.

  Spliced from the LIVE definition: one branch becomes two.
*/

do $splice$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'my_task_delete';
  if v_def is null then
    raise exception '0517: app.my_task_delete is missing';
  end if;

  v_def := replace(v_def,
    '  select t.title into v_title' || chr(10) ||
    '    from public.tasks t' || chr(10) ||
    '   where t.task_id = v_id and t.assigned_to_human;',
    '  select t.title into v_title' || chr(10) ||
    '    from public.tasks t' || chr(10) ||
    '   where t.task_id = v_id and t.assigned_to_human;' || chr(10) ||
    chr(10) ||
    '  /*' || chr(10) ||
    '    0517. Which of the two it is, rather than both at once. Said about a' || chr(10) ||
    '    task that is already gone, the combined sentence implied the row might' || chr(10) ||
    '    be the office''s.' || chr(10) ||
    '  */' || chr(10) ||
    '  if v_title is null' || chr(10) ||
    '     and not exists (select 1 from public.tasks t where t.task_id = v_id) then' || chr(10) ||
    '    return jsonb_build_object(''ok'', false, ''gone'', true,' || chr(10) ||
    '      ''error'', ''that task is already gone'');' || chr(10) ||
    '  end if;');

  if position('already gone' in v_def) = 0 then
    raise exception '0517: the lookup anchor was not found, so the splice did nothing';
  end if;
  execute v_def;
end
$splice$;

do $drive$
declare
  v_id     uuid;
  v_theirs uuid;
  v_out    jsonb;
begin
  v_id := (app.my_task_add('Refusal probe 0517') ->> 'id')::uuid;
  if coalesce((app.my_task_delete(v_id::text) ->> 'ok')::boolean, false) is not true then
    raise exception '0517: the first delete was refused';
  end if;

  v_out := app.my_task_delete(v_id::text);
  if coalesce((v_out ->> 'gone')::boolean, false) is not true
     or position('already gone' in coalesce(v_out ->> 'error', '')) = 0 then
    raise exception '0517: deleting a gone task says "%"', v_out ->> 'error';
  end if;
  if position('team' in coalesce(v_out ->> 'error', '')) > 0 then
    raise exception '0517: it still tells them their task might be the office''s: %',
      v_out ->> 'error';
  end if;

  -- CONTROL: and the boundary is still stated when the boundary IS the reason.
  insert into public.tasks (title, assigned_to_human, added_by, state)
  values ('Refusal probe 0517 theirs', false, 'migration', 'todo') returning task_id into v_theirs;
  v_out := app.my_task_delete(v_theirs::text);
  if coalesce((v_out ->> 'ok')::boolean, true) is not false
     or position('team' in coalesce(v_out ->> 'error', '')) = 0 then
    raise exception 'CONTROL FAILED: the team''s own work is no longer protected: %', v_out;
  end if;
  if coalesce((v_out ->> 'gone')::boolean, false) is true then
    raise exception 'CONTROL FAILED: a task that is right there was called gone';
  end if;

  delete from public.tasks where title like 'Refusal probe 0517%';
  raise notice '0517: two facts, two sentences, and each only when it is true';
end
$drive$;
