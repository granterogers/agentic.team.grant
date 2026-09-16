begin;

-- ---------------------------------------------------------------------------
-- 0402 - a story with the probe runs left in is not the story (#156)
--
-- 0401's header says harness traffic is excluded. It excluded fixture TASKS
-- and nothing else, and the first real project it was run against told this
-- story:
--
--     08 Sep  [source]  Coaching - Wikipedia (scenario A mtt6oeha)
--     08 Sep  [source]  Coaching - Wikipedia (scenario A mtt6rbir)
--     08 Sep  [source]  Coaching - Wikipedia (scenario A mtt72zg7)
--     08 Sep  [source]  Coaching - Wikipedia (scenario A mtt7ao7t)
--     12 Sep  [source]  Where the project stands ... (scenario A mty9izdi)
--     ... six more of the same
--
-- Ten of eighteen entries were one probe document imported over and over.
-- **A comment claiming a property is worth nothing without a check**, and this
-- is the sixth time that sentence has been earned in this repository - this
-- time in the view built to make a project legible, which is where noise costs
-- most.
--
-- `public.documents` has no `is_fixture`. What it has is `added_by`, and the
-- harness writes its own name there: `verify:scenario-a`, `probe-w`. The same
-- convention `jobs.is_fixture` is generated from.
--
-- Matched as a SHAPE rather than as a list of names, because a list of harness
-- prefixes is a list that goes stale the first time a suite picks a new one -
-- and an entry wrongly kept is noise, while a real document wrongly dropped is
-- a hole in the story, so the pattern is anchored at the START and deliberately
-- narrow.
-- ---------------------------------------------------------------------------

do $$
declare v_def text;
begin
  select pg_get_functiondef(oid) into v_def
    from pg_proc where oid = 'app.project_history(uuid, integer)'::regprocedure;
  if position('and coalesce(d.state, '''') <> ''archived''' in v_def) = 0 then
    raise exception 'project_history is not shaped as expected - read it before patching';
  end if;
  if position('added_by' in v_def) > 0 then
    raise exception 'it already filters harness documents';
  end if;
  v_def := replace(v_def,
    'and coalesce(d.state, '''') <> ''archived''',
    'and coalesce(d.state, '''') <> ''archived''' || E'\n' ||
    '       -- Harness material is not part of how the project got here.' || E'\n' ||
    '       and coalesce(d.added_by, '''') !~ ''^(verify|probe|fixture|gate|ledger-proof)[:-]''');
  execute v_def;
end
$$;

comment on function app.project_history(uuid, integer) is
  'How a project got here, oldest first (#156; harness documents excluded in '
  '0402). The events that CHANGED it, not everything that happened in it. '
  'Derived from the timestamps the rows already carry, because public.events '
  'holds agent actions and no project lifecycle. Status changes are NOT in it: '
  'projects.status has no history and inventing one would be the office '
  'remembering what nobody wrote down.';

commit;
