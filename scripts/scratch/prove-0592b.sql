-- the double-send pair from production: second job asks for the same title
insert into _result select 'repeat in same conversation: '||app.my_task_add(p_title=>'Ring the plumber about the boiler', p_job=>'55941a8f-00d5-4903-b776-52aed7ff1a7f'::uuid)::text;
insert into _result select 'control, another conversation: repeated='||coalesce(app.my_task_add(p_title=>'Ring the plumber about the boiler', p_job=>'82b38ff4-9272-43ab-8874-b0f62e778724'::uuid)->>'repeated','none');
