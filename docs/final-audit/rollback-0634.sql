-- Rollback of 0634: owed_a_word answers for a failed turn only.
begin;
do $m$
declare v_def text;
begin
  v_def := pg_get_functiondef('app.owed_a_word(uuid)'::regprocedure);
  v_def := replace(v_def, E'and (j.parent_job_id is null or j.state = ''paused'')', E'and j.parent_job_id is null');
  v_def := replace(v_def, E'      on c.command_id = coalesce((j.pinned_config ->> ''command_id'')::uuid,\n                                 (select ic.command_id from public.inbound_commands ic\n                                   where ic.job_id = coalesce(j.root_job_id, j.job_id) limit 1))', E'      on c.command_id = (j.pinned_config ->> ''command_id'')::uuid');
  execute replace(v_def, E'and (j.state = ''failed''
          or (j.state = ''paused''
              and exists (select 1 from public.job_pauses p
                           where p.job_id = j.job_id and p.resumed_at is null and p.resumable = false)
              and not exists (select 1 from public.blockers b
                               where b.job_id = j.job_id and b.state = ''open'')
              and not app.harness_job(j.job_id)))', E'and j.state = ''failed''');
end $m$;
do $m$
declare v_def text;
begin
  v_def := pg_get_functiondef('app.conversation_work(uuid,interval,uuid,interval)'::regprocedure);
  v_def := replace(v_def, E'         and (exists (select 1 from public.jobs k where k.parent_job_id = c.job_id)\n              or exists (select 1 from public.job_pauses pz where pz.job_id = c.job_id and pz.resumed_at is null and pz.resumable = false))', E'         and exists (select 1 from public.jobs k where k.parent_job_id = c.job_id)');
  v_def := replace(v_def, E'       where b.state = ''open''), 0)\n      + coalesce((\n      select count(*)::int from turns t2\n        join public.job_pauses p2 on p2.job_id = t2.job_id\n        join public.jobs j2 on j2.job_id = t2.job_id\n       where p2.resumed_at is null and p2.resumable = false and j2.state = ''paused''), 0))', E'       where b.state = ''open''), 0))');
  execute v_def;
end $m$;
commit;
