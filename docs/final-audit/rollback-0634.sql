-- Rollback of 0634: owed_a_word answers for a failed turn only.
begin;
do $m$
declare v_def text;
begin
  v_def := pg_get_functiondef('app.owed_a_word(uuid)'::regprocedure);
  execute replace(v_def, E'and (j.state = ''failed''
          or (j.state = ''paused''
              and exists (select 1 from public.job_pauses p
                           where p.job_id = j.job_id and p.resumed_at is null and p.resumable = false)
              and not exists (select 1 from public.blockers b
                               where b.job_id = j.job_id and b.state = ''open'')))', E'and j.state = ''failed''');
end $m$;
commit;
