-- 0850 - the functions the worker calls to hang work on a job take the claimed job's office (multi-user P3, k-worker-internal).
--
-- The worker holds a claimed job and acts on it. Everything in this file takes ids that can originate in a payload, in
-- model output or in a recorded config (a deferred sibling's `approval_next`, a handoff's `from_output`, a blocker's
-- `on_answer`), so the trusted worker's own argument is not enough to trust them: the office is handed in first and every
-- id is checked against it.
--
--   app.enqueue_child(p_office, p_parent, ...)        a child is hung on a parent OF THIS OFFICE, in a project of this office,
--   app.enqueue_child_once(p_office, p_parent, ...)   on behalf of a caller that is this office's. A parent, a project or a
--                                                     caller of another office is refused with the sentence a missing one gets.
--   app.job_plan_set(p_office, p_job_id, ...)         \
--   app.step_begin(p_office, p_job, ...)               \  a plan, a checkpoint and a trace line are written only under a job of
--   app.step_done(p_office, p_job, ...)                /  this office; another office's job (or none) is "no such job".
--   app.job_trace_add(p_office, p_job_id, ...)        /
--   app.skill_used(p_office, p_skill_id, p_job_id)    the skill and the job must both be this office's; otherwise nothing is written
--
-- The old signatures are dropped here. The two database functions that called the old enqueue_child are respliced from their
-- LIVE definitions inside this migration, asserting that the splice landed: app.fan_in_over (the office it was handed) and
-- app.hq_answer_blocker (the blocker's own job's office - hq_answer_blocker belongs to the governance cluster; if that cluster
-- redefines it after this file it must call the office-explicit signature).
--
-- DEFECTS FOUND IN THE ORIGINALS (reported, fixed here):
--   * a plan, a step or a trace for a job that does not exist raised a foreign-key violation (23503), and for a job that
--     does exist in ANOTHER office was written without complaint: two different answers, one of them a write across offices.
--     Both now answer the same neutral error and write nothing.
--   * enqueue_child_once's unique_violation branch looked the live child up by idempotency key alone; it is the office's now.
--   * app.step_done found its step by (job, step) with no office, so a payload-derived job id finished another office's step.

-- ---------------------------------------------------------------------------------------------------------------------
-- enqueue_child
-- ---------------------------------------------------------------------------------------------------------------------
create function app.enqueue_child(
  p_office uuid, p_parent uuid, p_kind text, p_payload jsonb default '{}'::jsonb, p_delay interval default '00:00:00'::interval,
  p_announce boolean default true, p_project uuid default null::uuid, p_caller uuid default null::uuid,
  p_caller_worker text default null::text, p_caller_gen bigint default null::bigint)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
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
  perform app.require_office(p_office);
  -- A parent of another office is a parent that does not exist: the same sentence, the same code.
  select * into v_parent from public.jobs where job_id = p_parent and office_id = p_office for share;
  if not found then
    raise exception 'no job % to hang a child on', p_parent using errcode = '23503';
  end if;
  -- The child belongs to its parent's office, and so does everything it is hung on (P3): a project another office
  -- owns is not a project this parent may give work to, and is refused as a project that does not exist.
  if p_project is not null and not exists (
    select 1 from public.projects pr where pr.project_id = p_project and pr.office_id = p_office) then
    raise exception 'no project % to give a child', p_project using errcode = '23503';
  end if;
  -- A job called off is given no more work: whoever had not yet noticed cannot undo the stop.
  if v_parent.state = 'cancelled' then
    raise exception 'job % is % and cannot be given children', p_parent, v_parent.state using errcode = '55000';
  end if;
  -- The caller is asked, when it says who it is: a worker that no longer holds its job takes no slot anywhere.
  if (p_caller is not null or p_caller_worker is not null or p_caller_gen is not null)
     and (p_caller is null or p_caller_worker is null or p_caller_gen is null) then
    raise exception 'an incomplete caller: name the job, the worker and the claim, or none' using errcode = '22023';
  end if;
  if p_caller is not null then
    select * into v_caller from public.jobs where job_id = p_caller and office_id = p_office for share;
    if not found
       or not app.job_held(p_caller, p_caller_worker, v_caller.attempt, p_caller_gen) then
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
   where c.parent_job_id = p_parent and c.office_id = p_office and c.kind = p_kind
     and c.idempotency_key like v_key || '-%' and c.state not in ('failed', 'cancelled')
     and not exists (
       select 1 from public.jobs s2
        where s2.parent_job_id = p_parent and s2.office_id = p_office and s2.kind = p_kind
          and s2.idempotency_key like 'child-' || left(p_kind, 40) || '-' || left(v_hash, 16) || '-%'
          and s2.state in ('failed', 'cancelled') and s2.created_at > c.created_at)
   order by c.created_at limit 1;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.jobs
    (office_id, parent_job_id, correlation_id, project_id, idempotency_key, kind,
     requested_by, priority, pinned_config, not_before, announce)
  values (
    p_office, p_parent, v_parent.correlation_id,
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
revoke all on function app.enqueue_child(uuid, uuid, text, jsonb, interval, boolean, uuid, uuid, text, bigint)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- enqueue_child_once
-- ---------------------------------------------------------------------------------------------------------------------
create function app.enqueue_child_once(
  p_office uuid, p_parent uuid, p_kind text, p_request text, p_payload jsonb default '{}'::jsonb,
  p_announce boolean default true, p_project uuid default null::uuid, p_caller uuid default null::uuid,
  p_caller_worker text default null::text, p_caller_gen bigint default null::bigint)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_parent public.jobs;
  v_key text;
  v_id uuid;
  v_live uuid;
  v_payload jsonb;
  v_caller public.jobs;
begin
  perform app.require_office(p_office);
  select * into v_parent from public.jobs where job_id = p_parent and office_id = p_office for share;
  if not found then
    raise exception 'no job % to hang a child on', p_parent using errcode = '23503';
  end if;
  if p_project is not null and not exists (
    select 1 from public.projects pr where pr.project_id = p_project and pr.office_id = p_office) then
    raise exception 'no project % to give a child', p_project using errcode = '23503';
  end if;
  if v_parent.state = 'cancelled' then
    raise exception 'job % is % and cannot be given children', p_parent, v_parent.state using errcode = '55000';
  end if;
  if (p_caller is not null or p_caller_worker is not null or p_caller_gen is not null)
     and (p_caller is null or p_caller_worker is null or p_caller_gen is null) then
    raise exception 'an incomplete caller: name the job, the worker and the claim, or none' using errcode = '22023';
  end if;
  if p_caller is not null then
    select * into v_caller from public.jobs where job_id = p_caller and office_id = p_office for share;
    if not found
       or not app.job_held(p_caller, p_caller_worker, v_caller.attempt, p_caller_gen) then
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
     and office_id = p_office
     and idempotency_key = v_key
     and state = 'complete'
   order by created_at desc
   limit 1;
  if v_live is not null then
    return jsonb_build_object('job_id', v_live, 'created', false, 'reused', true);
  end if;

  begin
    insert into public.jobs
      (office_id, parent_job_id, correlation_id, project_id, idempotency_key, kind,
       requested_by, priority, pinned_config, announce)
    values (
      p_office, p_parent, v_parent.correlation_id,
      coalesce(p_project, v_parent.project_id),
      v_key, p_kind, v_parent.requested_by, v_parent.priority,
      v_payload, p_announce)
    returning job_id into v_id;
    return jsonb_build_object('job_id', v_id, 'created', true);
  exception when unique_violation then
    select job_id into v_live from public.jobs
     where idempotency_key = v_key
       and office_id = p_office
       and state not in ('complete', 'cancelled', 'failed')
     limit 1;
    return jsonb_build_object('job_id', v_live, 'created', false);
  end;
end;
$function$;
revoke all on function app.enqueue_child_once(uuid, uuid, text, text, jsonb, boolean, uuid, uuid, text, bigint)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- job_plan_set, step_begin, step_done, job_trace_add, skill_used
-- ---------------------------------------------------------------------------------------------------------------------
create function app.job_plan_set(p_office uuid, p_job_id uuid, p_tool text, p_reaches text[], p_steps jsonb, p_summary text, p_writes integer)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare v_bad int;
begin
  perform app.require_office(p_office);
  -- Another office's job and a job that does not exist are the same answer, and neither writes.
  if not exists (select 1 from public.jobs j where j.job_id = p_job_id and j.office_id = p_office) then
    return jsonb_build_object('error', 'no such job');
  end if;
  if jsonb_typeof(p_steps) <> 'array' then
    return jsonb_build_object('error', 'steps must be an array');
  end if;

  -- `coalesce(..., 'missing')`, because `jsonb_typeof(e -> 'k')` is NULL when
  -- the key is ABSENT and a NULL comparison is dropped by the where clause --
  -- so a step missing a field entirely would pass a naive check. Migration
  -- 0251 learned this the hard way on the dashboard layout.
  select count(*) into v_bad
    from jsonb_array_elements(p_steps) e
   where coalesce(jsonb_typeof(e), 'missing') <> 'object'
      or coalesce(e ->> 'verb', '') not in ('create', 'update', 'remove', 'send')
      or coalesce(jsonb_typeof(e -> 'what'), 'missing') <> 'string'
      or coalesce(jsonb_typeof(e -> 'where'), 'missing') <> 'string'
      or coalesce(jsonb_typeof(e -> 'writes'), 'missing') <> 'number';
  if v_bad > 0 then
    return jsonb_build_object('error',
      format('%s step(s) are not {verb, what, where, writes} -- nothing was recorded', v_bad));
  end if;

  insert into public.job_plans
    (job_id, tool, reaches, steps, summary, planned_writes, planned_at)
  values (p_job_id, p_tool, coalesce(p_reaches, array[]::text[]), p_steps,
          p_summary, greatest(coalesce(p_writes, 0), 0), app.now_utc())
  on conflict (job_id) do update
    set tool = excluded.tool, reaches = excluded.reaches, steps = excluded.steps,
        summary = excluded.summary, planned_writes = excluded.planned_writes,
        planned_at = excluded.planned_at;

  return jsonb_build_object('ok', true, 'steps', jsonb_array_length(p_steps));
end;
$function$;
revoke all on function app.job_plan_set(uuid, uuid, text, text[], jsonb, text, integer)
  from public, anon, authenticated, service_role;

create function app.step_begin(p_office uuid, p_job uuid, p_step text, p_ordinal integer, p_effect_kind text, p_schema integer, p_code text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare v public.job_steps%rowtype;
begin
  perform app.require_office(p_office);
  if not exists (select 1 from public.jobs j where j.job_id = p_job and j.office_id = p_office) then
    return jsonb_build_object('error', 'no such job');
  end if;
  if coalesce(btrim(p_step), '') = '' then
    return jsonb_build_object('error', 'a step needs a name');
  end if;
  if p_effect_kind not in ('none', 'local', 'external') then
    return jsonb_build_object('error', format('%L is not a kind of effect', p_effect_kind));
  end if;

  select * into v from public.job_steps where job_id = p_job and step = p_step;

  if not found then
    insert into public.job_steps
      (job_id, step, ordinal, effect_kind, schema_version, code_version)
    values (p_job, p_step, p_ordinal, p_effect_kind, p_schema, p_code);
    return jsonb_build_object('do', true, 'first', true);
  end if;

  -- A checkpoint from different code is not a checkpoint this run may reason
  -- about, finished or not.
  if v.schema_version <> p_schema then
    return jsonb_build_object('stale', true,
      'was', v.schema_version, 'now', p_schema,
      'why', format('step %L was recorded by schema %s and this is %s',
                    p_step, v.schema_version, p_schema));
  end if;

  -- And the CODE version, which this function stored and never read
  -- until 0527. The comment above has always said "finished or not",
  -- and it means it: an outcome recorded by code that is no longer
  -- running is one this run may not reason about, however complete.
  if coalesce(v.code_version, '') is distinct from coalesce(p_code, '') then
    return jsonb_build_object('stale', true,
      'was', v.code_version, 'now', p_code,
      'why', format('step %L was recorded by %s and this is %s',
                    p_step, coalesce(v.code_version, 'nothing'),
                    coalesce(p_code, 'nothing')));
  end if;

  if v.finished_at is not null then
    return jsonb_build_object('skip', true, 'outcome', coalesce(v.outcome, '{}'::jsonb),
                              'effect_ref', v.effect_ref, 'at', v.finished_at);
  end if;

  if v.effect_kind = 'external' then
    return jsonb_build_object('park', true,
      'why', format('step %L started at %s and never finished, and it acts outside the '
                    'office -- whether it committed cannot be known from here',
                    p_step, v.began_at));
  end if;

  -- Safe to run again: nothing outside the office happened.
  update public.job_steps set began_at = app.now_utc()
   where step_id = v.step_id;
  return jsonb_build_object('do', true, 'again', true);
end;
$function$;
revoke all on function app.step_begin(uuid, uuid, text, integer, text, integer, text)
  from public, anon, authenticated, service_role;

create function app.step_done(p_office uuid, p_job uuid, p_step text, p_outcome jsonb default '{}'::jsonb, p_effect_ref text default null::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare v public.job_steps%rowtype;
begin
  perform app.require_office(p_office);
  -- The step is found THROUGH the job and the job through the office: another office's step is a step never begun.
  select s.* into v from public.job_steps s
    join public.jobs j on j.job_id = s.job_id and j.office_id = p_office
   where s.job_id = p_job and s.step = p_step;
  if not found then
    return jsonb_build_object('error', format('step %L was never begun on this job', p_step));
  end if;
  if v.finished_at is not null then
    -- Idempotent on purpose: finishing twice is a retry, not an error.
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  update public.job_steps
     set finished_at = app.now_utc(),
         outcome = coalesce(p_outcome, '{}'::jsonb),
         effect_ref = nullif(btrim(coalesce(p_effect_ref, '')), '')
   where step_id = v.step_id;
  return jsonb_build_object('ok', true);
end;
$function$;
revoke all on function app.step_done(uuid, uuid, text, jsonb, text)
  from public, anon, authenticated, service_role;

create function app.job_trace_add(
  p_office uuid, p_job_id uuid, p_kind text, p_detail jsonb default '{}'::jsonb, p_tokens_in integer default null::integer,
  p_tokens_out integer default null::integer, p_cost_pence numeric default null::numeric, p_ms integer default null::integer)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_step int;
begin
  perform app.require_office(p_office);
  -- Another office's job and a job that does not exist both record nothing and both answer null.
  if not exists (select 1 from public.jobs j where j.job_id = p_job_id and j.office_id = p_office) then
    return null;
  end if;

  select coalesce(max(step), 0) + 1 into v_step
    from public.job_traces where job_id = p_job_id;

  insert into public.job_traces
    (job_id, step, kind, detail, tokens_in, tokens_out, cost_pence, ms)
  values
    (p_job_id, v_step, p_kind, coalesce(p_detail, '{}'::jsonb),
     p_tokens_in, p_tokens_out, p_cost_pence, p_ms);

  update public.jobs
     set trace_steps  = v_step,
         trace_tokens = coalesce(trace_tokens, 0)
                        + coalesce(p_tokens_in, 0) + coalesce(p_tokens_out, 0),
         trace_pence  = coalesce(trace_pence, 0) + coalesce(p_cost_pence, 0),
         trace_ms     = coalesce(trace_ms, 0) + coalesce(p_ms, 0)
   where job_id = p_job_id and office_id = p_office;

  return v_step;
end;
$function$;
revoke all on function app.job_trace_add(uuid, uuid, text, jsonb, integer, integer, numeric, integer)
  from public, anon, authenticated, service_role;

create function app.skill_used(p_office uuid, p_skill_id uuid, p_job_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  perform app.require_office(p_office);
  -- A skill or a job of another office is not used here: nothing is written, whichever one it was and whether or not it exists.
  insert into public.skill_uses (skill_id, job_id)
  select s.skill_id, j.job_id
    from public.skills s, public.jobs j
   where s.skill_id = p_skill_id and s.office_id = p_office
     and j.job_id = p_job_id and j.office_id = p_office
  on conflict do nothing;
end;
$function$;
revoke all on function app.skill_used(uuid, uuid, uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- The database callers of the old enqueue_child, respliced from their live definitions.
-- ---------------------------------------------------------------------------------------------------------------------
do $m$
declare
  v text;
  r record;
begin
  for r in
    select * from (values
      ('app.fan_in_over(uuid,uuid,text,jsonb,text,timestamp with time zone,uuid,text,bigint)'::text,
       'app.enqueue_child(p_parent, p_synthesis_kind,',
       'app.enqueue_child(p_office, p_parent, p_synthesis_kind,'),
      ('app.hq_answer_blocker(uuid,text,text)',
       'app.enqueue_child(b.job_id, b.on_answer',
       'app.enqueue_child(app.job_office(b.job_id), b.job_id, b.on_answer')
    ) as x(fn, anchor, repl)
  loop
    v := pg_get_functiondef(r.fn::regprocedure);
    if (length(v) - length(replace(v, r.anchor, ''))) / length(r.anchor) <> 1 then
      raise exception '0850 splice anchor for % must occur exactly once', r.fn;
    end if;
    v := replace(v, r.anchor, r.repl);
    execute v;
  end loop;
end
$m$;

-- The old signatures: dropped by their exact argument lists.
drop function app.enqueue_child(uuid, text, jsonb, interval, boolean, uuid, uuid, text, bigint);
drop function app.enqueue_child_once(uuid, text, text, jsonb, boolean, uuid, uuid, text, bigint);
drop function app.job_plan_set(uuid, text, text[], jsonb, text, integer);
drop function app.step_begin(uuid, text, integer, text, integer, text);
drop function app.step_done(uuid, text, jsonb, text);
drop function app.job_trace_add(uuid, text, jsonb, integer, integer, numeric, integer);
drop function app.skill_used(uuid, uuid);
