/*
  0625 - a child has an author, and an attempt has a name that is never reused (Run 5, #398).

  Run 4's fence was (leased_by, attempt). resume_job refunds an attempt number for the two bounded waits
  (dependency_wait, scheduled_wait), so the pair could name two different claims and a zombie of "the same attempt"
  passed. `jobs.claim_gen` is bumped by every claim and never lowered: (leased_by, claim_gen) names one claim, ever.

    * app.dequeue_job bumps it; app.job_held and app.renew_lease take it (a 4th argument defaulting to null, so an
      old worker calling with three still works - and asks the old question).
    * app.enqueue_child and app.enqueue_child_once take the CALLER: the job making the call, the worker holding it
      and its claim_gen. A caller that no longer holds its job is refused ('stale caller', 40001): a stale worker
      can no longer take a slot in the live attempt and make the live worker's identical call a duplicate. A
      deferral (a sibling re-enqueueing itself under the same parent) is keyed on its OWN caller and claim, so a
      child that retries and defers again finds the deferral it made instead of taking the next slot.
    * a job that is cancelled or failed cannot be given children at all, caller or not: calling a conversation off
      must not be undone by the worker that had not yet noticed.
    * job_child_slots.attempt holds the claim_gen for a new caller-aware call (the column is the slot's claim; it
      was named for the attempt number that used to be the claim). A call with no caller keeps the attempt number.

  Nothing about state, leases, outputs or any existing row changes; claim_gen starts at the attempt already spent,
  so a job mid-flight at deploy keeps a fence its holder can be asked about.

  ROLLBACK: docs/architecture-run-5/rollback-0625.sql (tested on a replica).
*/
alter table public.jobs add column if not exists claim_gen bigint not null default 0;
update public.jobs set claim_gen = attempt where claim_gen = 0 and attempt > 0;

CREATE OR REPLACE FUNCTION app.dequeue_job(p_worker text, p_can_transcribe boolean DEFAULT true, p_can_subprocess boolean DEFAULT true, p_kinds text[] DEFAULT NULL::text[], p_requested_by text DEFAULT NULL::text)
 RETURNS TABLE(job_id uuid, kind text, correlation_id uuid, project_id uuid, idempotency_key text, attempt integer, pinned_config jsonb)
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'app', 'public'
AS $function$
declare
  v_limit       integer;
  v_active      integer;
  v_lease       integer;
  v_job_id      uuid;
  v_may_reflect boolean;
begin
  if p_worker is null or length(trim(p_worker)) = 0 then
    raise exception 'a worker identity is required to dequeue'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('ai_team_hq.job_dequeue'));

  /*
    The same limit, counted over the same work the claim can reach.

    Unscoped, that is the whole queue, exactly as it has always been. Scoped,
    it is that scope's own jobs — because a caller that cannot CLAIM another
    scope's work should not be BLOCKED by it either, which is the whole of
    #184.
  */
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

  -- 0216: asked once per dequeue rather than once per candidate row. A
  -- stable function in a WHERE clause is not guaranteed to be hoisted, and
  -- the budget cannot change during a single call anyway.
  v_may_reflect := app.self_improvement_within_budget();

  select j.job_id into v_job_id
  from public.jobs j
  where j.state = 'queued'
    and j.attempt < j.max_attempts
    -- 0074: a delayed job is not a queued job yet.
    and (j.not_before is null or j.not_before <= now())
    -- 0125: an untranscribed voice note needs a worker that can hear. The Edge
    -- worker cannot — no subprocesses, no Python — and it reports that about
    -- itself at GET /functions/v1/worker. Tests the TRANSCRIPT rather than the
    -- audio, so a note already transcribed is ordinary work any worker may
    -- finish.
    and (
      p_can_transcribe
      or not exists (
        select 1 from public.inbound_commands c
         where c.job_id = j.job_id
           and c.voice_file_id is not null
           and coalesce(trim(c.transcript), '') = ''
      )
    )
    -- 0137: and the same argument for everything else that needs a local
    -- process. A kind not in the table runs anywhere.
    and (
      p_can_subprocess
      or not exists (
        select 1 from public.job_kind_needs n
         where n.kind = j.kind and n.needs_subprocess
      )
    )
    -- 0147: and the most obvious form of the same rule, which was missing.
    -- A worker that holds five handlers must not claim a job needing a sixth.
    -- Null means "everything", which is what every caller meant before this
    -- argument existed.
    and (p_kinds is null or j.kind = any(p_kinds))
    -- 0329: and one step further, for #184. A worker that exists to run ONE
    -- job must not claim a different one, however well it could handle it.
    and (p_requested_by is null or j.requested_by = p_requested_by)
    /*
      0216: and the office does not keep thinking about itself once today's
      budget is spent (#53, ADR-0018).

      Here rather than in the handlers because a check in the caller is a check
      in one of the callers. Work FOR Grant is untouched — only the kinds in
      `self_improvement_kinds` wait, and they wait rather than fail, so the
      queue drains itself when the rolling window moves.
    */
    and (
      v_may_reflect
      or not exists (
        select 1 from public.self_improvement_kinds s where s.kind = j.kind
      )
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
      claim_gen    = j.claim_gen + 1,
      state_reason = format('dequeued by %s', p_worker)
  where j.job_id = v_job_id;

  return query
    select j.job_id, j.kind, j.correlation_id, j.project_id,
           j.idempotency_key, j.attempt, j.pinned_config
    from public.jobs j
    where j.job_id = v_job_id;
end
$function$;
drop function app.renew_lease(uuid, text, integer);
drop function app.job_held(uuid, text, integer);
create function app.job_held(p_job uuid, p_worker text, p_attempt integer, p_gen bigint default null)
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $fn$
  /*
    Held: this attempt, this claim, leased to this worker - OR parked by its own handler at the same claim. The claim
    (claim_gen, never lowered) is what keeps a stale worker out; the attempt number can be refunded by a wait, so it
    is compared as well but no longer trusted alone. A null claim asks the old question.
  */
  select exists (
    select 1 from public.jobs j
     where j.job_id = p_job
       and j.attempt = p_attempt
       and (p_gen is null or j.claim_gen = p_gen)
       and ((j.leased_by = p_worker
             and j.state in ('running', 'output_created', 'quality_review', 'committing', 'committed', 'notifying'))
            or (j.leased_by is null and j.state = 'paused')))
$fn$;
create function app.renew_lease(p_job uuid, p_worker text, p_attempt integer, p_gen bigint default null)
 returns boolean
 language plpgsql
 security definer
 set search_path to ''
as $fn$
declare
  v_seconds integer;
begin
  v_seconds := coalesce((select (value #>> '{}')::integer from public.system_config where key = 'jobs.lease_seconds'), 300);
  update public.jobs
     set leased_until = now() + make_interval(secs => v_seconds)
   where job_id = p_job
     and leased_by = p_worker
     and attempt = p_attempt
     and (p_gen is null or claim_gen = p_gen)
     and state in ('running', 'output_created', 'quality_review', 'committing', 'committed', 'notifying');
  return app.job_held(p_job, p_worker, p_attempt, p_gen);
end;
$fn$;
revoke all on function app.job_held(uuid, text, integer, bigint) from public, anon, authenticated;
revoke all on function app.renew_lease(uuid, text, integer, bigint) from public, anon, authenticated;

drop function app.enqueue_child(uuid, text, jsonb, interval, boolean, uuid);
CREATE OR REPLACE FUNCTION app.enqueue_child(p_parent uuid, p_kind text, p_payload jsonb DEFAULT '{}'::jsonb, p_delay interval DEFAULT '00:00:00'::interval, p_announce boolean DEFAULT true, p_project uuid DEFAULT NULL::uuid, p_caller uuid DEFAULT NULL::uuid, p_caller_worker text DEFAULT NULL::text, p_caller_gen bigint DEFAULT NULL::bigint)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_parent public.jobs;
  v_id uuid;
  v_hash text;
  v_slot text;
  v_n integer;
  v_key text;
  v_caller public.jobs;
  v_scope text := '';
  v_slot_attempt integer;
begin
  select * into v_parent from public.jobs where job_id = p_parent;
  if not found then
    raise exception 'no job % to hang a child on', p_parent using errcode = '23503';
  end if;
  -- A job called off, or dead, is given no more work: whoever had not yet noticed cannot undo the stop.
  if v_parent.state in ('cancelled', 'failed') then
    raise exception 'job % is % and cannot be given children', p_parent, v_parent.state using errcode = '55000';
  end if;
  -- The caller is asked, when it says who it is: a worker that no longer holds its job takes no slot anywhere.
  if p_caller is not null and p_caller_worker is not null then
    select * into v_caller from public.jobs where job_id = p_caller;
    if not found or not app.job_held(p_caller, p_caller_worker, v_caller.attempt, p_caller_gen) then
      raise exception 'stale caller: % no longer holds job %', p_caller_worker, p_caller using errcode = '40001';
    end if;
    if p_caller <> p_parent then v_scope := p_caller::text; end if;
  end if;
  v_slot_attempt := coalesce(p_caller_gen, v_parent.attempt)::integer;

  perform pg_advisory_xact_lock(hashtext('enqueue_child:' || p_parent::text));
  -- Identity of the request: kind, payload MINUS ids that are minted afresh by every attempt (a handoff carries the
  -- uuid of the output it hands on, and a retry writes a new output), and the project it is for.
  v_hash := md5((coalesce(p_payload, '{}'::jsonb) - 'from_output')::text || '|' || coalesce(coalesce(p_project, v_parent.project_id)::text, '') || '|' || v_scope);
  v_slot := left(p_kind, 40) || ':' || v_hash;
  insert into public.job_child_slots as s (job_id, attempt, slot_key, used)
  values (p_parent, v_slot_attempt, v_slot, 1)
  on conflict (job_id, attempt, slot_key) do update set used = s.used + 1
  returning s.used - 1 into v_n;
  v_key := format('child-%s-%s-%s', left(p_kind, 40), left(v_hash, 16), v_n);

  -- One parent, one kind, one request, one slot: this is the child the parent already made, if it did and it did
  -- not fail. A failed or cancelled child is not reused - the retry is entitled to try again - and neither is a
  -- child whose LATER sibling of the same request failed: a deferral that completed having only scheduled the work
  -- has not done it (notebook.generate defers itself as a sibling).
  select c.job_id into v_id from public.jobs c
   where c.parent_job_id = p_parent and c.kind = p_kind
     and c.idempotency_key like v_key || '-%' and c.state not in ('failed', 'cancelled')
     and not exists (
       select 1 from public.jobs s2
        where s2.parent_job_id = p_parent and s2.kind = p_kind
          and s2.idempotency_key like 'child-' || left(p_kind, 40) || '-' || left(v_hash, 16) || '-%'
          and s2.state in ('failed', 'cancelled') and s2.created_at > c.created_at)
   order by c.created_at limit 1;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.jobs
    (parent_job_id, correlation_id, project_id, idempotency_key, kind,
     requested_by, priority, pinned_config, not_before, announce)
  values (
    p_parent, v_parent.correlation_id,
    coalesce(p_project, v_parent.project_id),
    v_key || '-' || left(gen_random_uuid()::text, 8),
    p_kind, v_parent.requested_by, v_parent.priority,
    coalesce(p_payload, '{}'::jsonb),
    case when p_delay <= interval '0' then null else now() + p_delay end,
    p_announce
  )
  returning job_id into v_id;

  return v_id;
end;
$function$;

drop function app.enqueue_child_once(uuid, text, text, jsonb, boolean, uuid);
CREATE OR REPLACE FUNCTION app.enqueue_child_once(p_parent uuid, p_kind text, p_request text, p_payload jsonb DEFAULT '{}'::jsonb, p_announce boolean DEFAULT true, p_project uuid DEFAULT NULL::uuid, p_caller uuid DEFAULT NULL::uuid, p_caller_worker text DEFAULT NULL::text, p_caller_gen bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_parent public.jobs;
  v_key text;
  v_id uuid;
  v_live uuid;
  v_payload jsonb;
  v_caller public.jobs;
begin
  select * into v_parent from public.jobs where job_id = p_parent;
  if not found then
    raise exception 'no job % to hang a child on', p_parent using errcode = '23503';
  end if;
  if v_parent.state in ('cancelled', 'failed') then
    raise exception 'job % is % and cannot be given children', p_parent, v_parent.state using errcode = '55000';
  end if;
  if p_caller is not null and p_caller_worker is not null then
    select * into v_caller from public.jobs where job_id = p_caller;
    if not found or not app.job_held(p_caller, p_caller_worker, v_caller.attempt, p_caller_gen) then
      raise exception 'stale caller: % no longer holds job %', p_caller_worker, p_caller using errcode = '40001';
    end if;
  end if;

  v_key := app.obligation_key(p_parent, p_kind, p_request);
  v_payload := coalesce(p_payload, '{}'::jsonb);
  if coalesce(btrim(p_request), '') <> ''
     and not (v_payload ? 'request' or v_payload ? 'brief' or v_payload ? 'instruction') then
    v_payload := v_payload || jsonb_build_object('request', p_request);
  end if;

  /*
    0595: THE SAME PARENT'S FINISHED CHILD IS THIS ATTEMPT'S CHILD.

    The live-key index stops a second LIVE child and deliberately allows one
    after the first finishes (#316: asking again later is a new request). A
    parent RETRY is not asking again - it is the same job doing its work a
    second time - and it re-enqueued a child that attempt one had already
    completed: behavioural remediation, 24 September 2026, one margin
    question answered twice by the operations director. Scoped to this
    parent and to a COMPLETE child; a failed or cancelled one is re-run, and
    a different parent asking the same thing is untouched.
  */
  select job_id into v_live from public.jobs
   where parent_job_id = p_parent
     and idempotency_key = v_key
     and state = 'complete'
   order by created_at desc
   limit 1;
  if v_live is not null then
    return jsonb_build_object('job_id', v_live, 'created', false, 'reused', true);
  end if;

  begin
    insert into public.jobs
      (parent_job_id, correlation_id, project_id, idempotency_key, kind,
       requested_by, priority, pinned_config, announce)
    values (
      p_parent, v_parent.correlation_id,
      coalesce(p_project, v_parent.project_id),
      v_key, p_kind, v_parent.requested_by, v_parent.priority,
      v_payload, p_announce)
    returning job_id into v_id;
    return jsonb_build_object('job_id', v_id, 'created', true);
  exception when unique_violation then
    select job_id into v_live from public.jobs
     where idempotency_key = v_key
       and state not in ('complete', 'cancelled', 'failed')
     limit 1;
    return jsonb_build_object('job_id', v_live, 'created', false);
  end;
end;
$function$;
