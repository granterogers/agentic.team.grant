\set QUIET on
create table public.m_moved as select * from app.recover_stalled_jobs();
select app.requeue_retrying();
create table public.m_deq as select * from app.dequeue_job('matrix-live', false, false, null, 'teamhq:verify-matrix-healthy');
\set QUIET off
select c.label, c.want, j.state::text as got,
       (select count(*) from public.job_state_transitions t where t.job_id = c.job and t.to_state = 'running') as runs,
       case when c.want = j.state::text
              or (c.want = 'retrying' and j.state::text in ('retrying','queued'))
              or (c.want = 'running (dequeued)' and j.state::text = 'running')
            then 'ok' else 'WRONG' end as verdict
  from public.m_case c join public.jobs j on j.job_id = c.job order by c.label;
select 'healthy dequeued: ' || coalesce((select count(*)::text from public.m_deq), 'none') as dequeue_proof;
