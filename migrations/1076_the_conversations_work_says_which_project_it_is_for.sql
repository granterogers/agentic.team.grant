begin;

-- Duplicate detection only considers work for the SAME project (priority 3; COS-033, COS-109; the requirement that an
-- unrelated instruction is not suppressed by work running on another project).
--
-- `app.conversation_work` returns the conversation's running and recently finished work to the duplicate guard. It
-- carried no project, so a request for one project could be treated as a repeat of work on another project in the
-- same chat. This adds the project of each job to the two lists it returns. The guard uses it in TypeScript; nothing
-- else about the function changes.
--
-- The new definition is spliced from the LIVE one (pg_get_functiondef), and every replacement is checked to have
-- happened exactly once, so a changed live definition fails here rather than silently producing a function that
-- does not carry the project.

do $$
declare
  v text := pg_get_functiondef('app.conversation_work(uuid,uuid,interval,uuid,interval)'::regprocedure);
  pairs text[][] := array[
    array['select j.job_id, j.state, j.kind, j.parent_job_id',
          'select j.job_id, j.state, j.kind, j.parent_job_id, j.project_id'],
    array['select k.job_id, k.state, k.kind, k.parent_job_id',
          'select k.job_id, k.state, k.kind, k.parent_job_id, k.project_id'],
    array['''job'', w.job_id, ''kind'', w.kind, ''state'', w.state,',
          '''job'', w.job_id, ''kind'', w.kind, ''project'', w.project_id, ''state'', w.state,'],
    array['''job'', w.job_id, ''kind'', w.kind,' || chr(10),
          '''job'', w.job_id, ''kind'', w.kind, ''project'', w.project_id,' || chr(10)]
  ];
  i int;
  n int;
begin
  for i in 1 .. array_length(pairs, 1) loop
    n := (length(v) - length(replace(v, pairs[i][1], ''))) / length(pairs[i][1]);
    if n <> 1 then
      raise exception '1076: expected one occurrence of % in the live conversation_work, found %', pairs[i][1], n;
    end if;
    v := replace(v, pairs[i][1], pairs[i][2]);
  end loop;
  execute v || ';';
end
$$;

commit;
