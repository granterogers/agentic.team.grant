-- Recovery matrix: every stallable state, with and without an output, plus one
-- malformed row, beside one healthy queued job. Run on the isolated replica only.
create table public.m_case (label text, job uuid, want text);
create or replace function pg_temp.mk(p_label text, p_path text[], p_output boolean, p_attempt int default 1)
returns uuid language plpgsql as $$
declare v uuid; s text;
begin
  insert into public.jobs (kind, requested_by, project_id, idempotency_key, correlation_id)
  values ('office.instruction', 'teamhq:verify-matrix', app.unnamed_project(app.test_office()), 'verify-matrix-' || p_label, gen_random_uuid())
  returning job_id into v;
  foreach s in array p_path loop
    if s = 'output_created' and p_output then
      insert into public.outputs (job_id, body, confidence, evidence, deterministic) values (v, 'matrix ' || p_label, 'low', 'inferred', true);
    end if;
    update public.jobs set state = s::public.job_state, leased_by = 'matrix-dead', leased_until = now() + interval '1 hour', attempt = p_attempt where job_id = v;
  end loop;
  update public.jobs set leased_until = now() - interval '1 minute' where job_id = v and leased_by is not null;
  return v;
end $$;
insert into public.m_case select 'running',            pg_temp.mk('running',            array['running'], false), 'retrying';
insert into public.m_case select 'running+output',     pg_temp.mk('running-out',        array['running'], true), 'retrying';
insert into public.m_case select 'output_created',     pg_temp.mk('oc',                 array['running','output_created'], true), 'retrying';
insert into public.m_case select 'quality_review',     pg_temp.mk('qr',                 array['running','output_created','quality_review'], true), 'retrying';
insert into public.m_case select 'committing',         pg_temp.mk('committing',         array['running','output_created','quality_review','committing'], true), 'retrying';
insert into public.m_case select 'committing+spent',   pg_temp.mk('committing-spent',   array['running','output_created','quality_review','committing'], true, 5), 'failed';
insert into public.m_case select 'committed',          pg_temp.mk('committed',          array['running','output_created','quality_review','committing','committed'], true), 'notifying';
insert into public.m_case select 'notifying',          pg_temp.mk('notifying',          array['running','output_created','quality_review','committing','committed','notifying'], true), 'notifying';
insert into public.m_case select 'running+spent',      pg_temp.mk('running-spent',      array['running'], false, 5), 'failed';
-- A retried job whose EARLIER attempt left an output, stalled while running again.
insert into public.m_case select 'retried running+old output', pg_temp.mk('retried', array['running','output_created','retrying','queued','running'], true, 2), 'retrying';
-- States recovery must leave alone.
insert into public.m_case select 'queued',             pg_temp.mk('queued', array[]::text[], false), 'queued';
insert into public.m_case select 'paused',             pg_temp.mk('paused', array['running','paused'], false), 'paused';
insert into public.m_case select 'retrying',           pg_temp.mk('retrying', array['running','retrying'], false), 'retrying';
insert into public.m_case select 'complete',           pg_temp.mk('complete', array['running','output_created','quality_review','committing','committed','notifying','complete'], true), 'complete';
insert into public.m_case select 'failed',             pg_temp.mk('failed', array['running','failed'], false), 'failed';
insert into public.m_case select 'cancelled',          pg_temp.mk('cancelled', array['cancelled'], false), 'cancelled';
-- A healthy job that must still be dequeued after the sweep.
insert into public.m_case select 'healthy queued',     pg_temp.mk('healthy', array[]::text[], false), 'running (dequeued)';
update public.jobs set leased_until = null, leased_by = null where job_id in (select job from public.m_case where label in ('queued','healthy queued','complete','failed','cancelled'));
-- The malformed row: a job whose update the database refuses, as a corrupt or
-- constraint-violating row would. Test-only trigger, this database only.
insert into public.m_case select 'MALFORMED (refuses update)', pg_temp.mk('malformed', array['running'], false), 'running';
create or replace function public.m_refuse() returns trigger language plpgsql as $$
begin
  if old.job_id = (select job from public.m_case where label = 'MALFORMED (refuses update)') then
    raise exception 'malformed row % refuses to move', old.job_id;
  end if;
  return new;
end $$;
create trigger m_refuse before update on public.jobs for each row execute function public.m_refuse();
update public.jobs set requested_by = 'teamhq:verify-matrix-healthy' where job_id = (select job from public.m_case where label = 'healthy queued');
