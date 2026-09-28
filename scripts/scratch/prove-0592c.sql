do $p$
declare j uuid; t jsonb; r jsonb;
begin
  select c.job_id into j from public.inbound_commands c where c.job_id is not null and app.harness_job(c.job_id) order by c.received_at desc limit 1;
  t := app.my_task_add(p_title => 'prove 0592c stamp', p_job => j);
  r := app.my_task_add(p_title => 'prove 0592c real');
  insert into _result select format('harness job task: added_by=%s is_fixture=%s | real (no job): added_by=%s is_fixture=%s',
    (select added_by from public.tasks where task_id = (t->>'id')::uuid), (select is_fixture from public.tasks where task_id = (t->>'id')::uuid),
    (select added_by from public.tasks where task_id = (r->>'id')::uuid), (select is_fixture from public.tasks where task_id = (r->>'id')::uuid));
end $p$;
