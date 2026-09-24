do $p$
declare j uuid; t jsonb;
begin
  select c.job_id into j from public.inbound_commands c where c.job_id is not null and app.harness_job(c.job_id) order by c.received_at desc limit 1;
  t := app.my_task_add(p_title => 'prove 0597 reminder', p_remind_at => app.now_utc() - interval '1 minute', p_job => j);
  insert into _result select format('harness task is_fixture=%s harness_task=%s | due reminders naming it: %s',
    (select is_fixture from public.tasks where task_id = (t->>'id')::uuid),
    (select app.harness_task(is_fixture, job_id) from public.tasks where task_id = (t->>'id')::uuid),
    (select count(*) from jsonb_array_elements(app.reminders_due()) x where x->>'id' = t->>'id'));
  t := app.my_task_add(p_title => 'prove 0597 real reminder', p_remind_at => app.now_utc() - interval '1 minute');
  insert into _result select format('CONTROL a real task is still reminded: %s',
    (select count(*) from jsonb_array_elements(app.reminders_due()) x where x->>'id' = t->>'id'));
end $p$;
