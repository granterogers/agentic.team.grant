-- FROZEN COPY of app.dequeue_job as the efficiency workstream's UNAPPLIED migration 1030 would install it
-- (claude/efficiency-deep-optimization at a8bcff775b75bab159638b56e235d3fe1fbbfc0d, migrations/1030_the_dequeue_asks_the_self_improvement_ceiling_only_when_it_needs_it.sql).
-- It is NOT a migration and is never applied to a real database. scripts/isolated/dequeue-reconciled.ts installs it in a scratch schema as the CONTROL
-- that shows what applying that file after the V1 migration 1044 would do: it has no fairness term.

CREATE OR REPLACE FUNCTION app.dequeue_job(p_worker text, p_can_transcribe boolean DEFAULT true, p_can_subprocess boolean DEFAULT true, p_kinds text[] DEFAULT NULL::text[], p_requested_by text DEFAULT NULL::text)
 RETURNS TABLE(job_id uuid, kind text, correlation_id uuid, project_id uuid, idempotency_key text, attempt integer, pinned_config jsonb, office_id uuid)
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'app', 'public'
AS $function$
declare
  v_limit       integer;
  v_active      integer;
  v_lease       integer;
  v_job_id      uuid;
begin
  if p_worker is null or length(trim(p_worker)) = 0 then
    raise exception 'a worker identity is required to dequeue'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('ai_team_hq.job_dequeue'));

  v_limit := app.capacity_limit('max_concurrent_jobs', 3);
  select count(*) into v_active
  from public.jobs
  where state in (
    'running', 'output_created', 'quality_review', 'committing', 'committed', 'notifying'
  )
    and (p_requested_by is null or requested_by = p_requested_by);

  if v_active >= v_limit then
    return;
  end if;

  select j.job_id into v_job_id
  from public.jobs j
  where j.state = 'queued'
    and j.attempt < j.max_attempts
    and exists (select 1 from public.offices o where o.office_id = j.office_id and o.state = 'active')
    and (j.not_before is null or j.not_before <= now())
    and (
      p_can_transcribe
      or not exists (
        select 1 from public.inbound_commands c
         where c.job_id = j.job_id
           and c.voice_file_id is not null
           and coalesce(trim(c.transcript), '') = ''
      )
    )
    and (
      p_can_subprocess
      or not exists (
        select 1 from public.job_kind_needs n
         where n.kind = j.kind and n.needs_subprocess
      )
    )
    and (p_kinds is null or j.kind = any(p_kinds))
    and (p_requested_by is null or j.requested_by = p_requested_by)
    and (
      not exists (
        select 1 from public.self_improvement_kinds s where s.kind = j.kind
      )
      or (select app.self_improvement_within_budget())
    )
  order by j.priority asc, j.created_at asc
  for update skip locked
  limit 1;

  if v_job_id is null then
    return;
  end if;

  v_lease := coalesce(
    (select value::text::integer from public.system_config where key = 'jobs.lease_seconds'),
    300
  );

  update public.jobs j
  set state        = 'running',
      leased_by    = p_worker,
      leased_until = now() + make_interval(secs => v_lease),
      attempt      = j.attempt + 1,
      claim_gen    = greatest(j.claim_gen, j.attempt) + 1,
      state_reason = format('dequeued by %s', p_worker)
  where j.job_id = v_job_id;

  return query
    select j.job_id, j.kind, j.correlation_id, j.project_id,
           j.idempotency_key, j.attempt, j.pinned_config, j.office_id
    from public.jobs j
    where j.job_id = v_job_id;
end
$function$;
