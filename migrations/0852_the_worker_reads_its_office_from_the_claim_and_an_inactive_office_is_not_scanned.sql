-- 0852 - the claim names its office; resolvers take the office of the row they belong to; a disabled office is not swept
-- (multi-user P3, k-worker-internal).
--
-- 1. app.dequeue_job / public.dequeue_job return the claimed job WHOLE, with its `office_id` as the last column. The worker
--    passes that office to every later call (it used to read it back with a second query). The columns it already named are
--    unchanged and in the same order, so a worker of the old shape keeps working.
--
-- 2. Resolvers that were handed a bare id now take the office the id must belong to:
--      app.command_account(p_office, p_command)       the Telegram bot account a press came through
--      app.command_principal(p_office, p_command)     the person a command was recorded as (a job's pinned command_id is DATA)
--      app.approval_for_delivery(p_office, p_delivery)  the question a delivery announced
--      app.request_undo / app.claim_undo (p_office, ...) an undo is claimed for an action of THAT office only
--    A command, a delivery or an action of another office reads exactly as one that does not exist.
--    app.hq_undo and app.open_questions_for_reply (both already office-explicit) are respliced to pass their office.
--
-- 3. Old overloads with no caller left in the database are dropped:
--      app.unnamed_project()            every database caller already passes an office (the one-argument form)
--      app.search_documents(text, uuid, integer, text)
--      app.resolve_project_by_name(text, boolean)
--      app.undo_offer(text, text, jsonb, integer)
--    KEPT, with the one caller that still needs it: app.learn(lesson_scope, text, text, uuid, text, text, uuid, numeric, uuid)
--    is called by app.decide_suggestion (governance cluster); it is revoked from every browser role here.
--
-- 4. THE SCANS SKIP AN OFFICE THAT IS NOT ACTIVE (0681 did this for dequeue_job and claim_pending_notification alone). A
--    disabled office's data is untouched and nothing of it runs, so the sweeps that MOVE work toward running, or write a row
--    on its behalf, now carry the same predicate:
--      requeue_retrying, resume_paused, resumable_now, settle_exhausted_jobs, recover_stalled_jobs, enqueue_orphans,
--      provision_missing_channels, chores_for_credentials
--    (dispatch_due_responsibilities already joined an active office through app.due_responsibilities; chores_for_backups
--    loops app.operator_offices(), which is active offices only.) Pure housekeeping by the clock - expire_undo_offers,
--    mcp_expire_codes, recover_stalled_syncs, job_trace_prune, proposals_undeliver - changes no job and starts nothing, and
--    stays global.
--
-- 5. No browser role (anon, authenticated, public) may execute any worker-side app function in this cluster; the public
--    wrappers keep service_role only. A definer function that calls one runs as its owner and does not need the grant.

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. dequeue_job returns the office
-- ---------------------------------------------------------------------------------------------------------------------
drop function public.dequeue_job(text, boolean, boolean, text[], text);
drop function app.dequeue_job(text, boolean, boolean, text[], text);

create function app.dequeue_job(p_worker text, p_can_transcribe boolean default true, p_can_subprocess boolean default true, p_kinds text[] default null::text[], p_requested_by text default null::text)
 returns table(job_id uuid, kind text, correlation_id uuid, project_id uuid, idempotency_key text, attempt integer, pinned_config jsonb, office_id uuid)
 language plpgsql
 set search_path to 'pg_catalog', 'app', 'public'
as $function$
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
    -- A disabled office's work waits where it is: its data is untouched and nothing of it runs (P3).
    and exists (select 1 from public.offices o where o.office_id = j.office_id and o.state = 'active')
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
      claim_gen    = greatest(j.claim_gen, j.attempt) + 1,
      state_reason = format('dequeued by %s', p_worker)
  where j.job_id = v_job_id;

  -- The job whole, with the office it belongs to. The worker passes this office to every later call.
  return query
    select j.job_id, j.kind, j.correlation_id, j.project_id,
           j.idempotency_key, j.attempt, j.pinned_config, j.office_id
    from public.jobs j
    where j.job_id = v_job_id;
end
$function$;
revoke all on function app.dequeue_job(text, boolean, boolean, text[], text) from public, anon, authenticated, service_role;

create function public.dequeue_job(p_worker text, p_can_transcribe boolean default true, p_can_subprocess boolean default true, p_kinds text[] default null::text[], p_requested_by text default null::text)
 returns table(job_id uuid, kind text, correlation_id uuid, project_id uuid, idempotency_key text, attempt integer, pinned_config jsonb, office_id uuid)
 language sql
 security definer
 set search_path to 'public', 'pg_catalog'
as $function$
  select * from app.dequeue_job(p_worker, p_can_transcribe, p_can_subprocess, p_kinds, p_requested_by)
$function$;
revoke all on function public.dequeue_job(text, boolean, boolean, text[], text) from public, anon, authenticated;
grant execute on function public.dequeue_job(text, boolean, boolean, text[], text) to service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. resolvers that take the office of the row they belong to
-- ---------------------------------------------------------------------------------------------------------------------
create function app.command_account(p_office uuid, p_command uuid)
returns text
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select case when c.origin_channel::text = 'telegram'
               and c.dedupe_key ~ '^telegram:(message|callback):[0-9]+:'
              then split_part(c.dedupe_key, ':', 3) end
    from public.inbound_commands c
   where c.command_id = p_command and c.office_id = app.require_office(p_office)
$function$;
revoke all on function app.command_account(uuid, uuid) from public, anon, authenticated, service_role;

create function app.command_principal(p_office uuid, p_command uuid)
returns text
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce(c.subject, c.actor) from public.inbound_commands c
   where c.command_id = p_command and c.office_id = app.require_office(p_office)
$function$;
revoke all on function app.command_principal(uuid, uuid) from public, anon, authenticated, service_role;

create function app.approval_for_delivery(p_office uuid, p_delivery uuid)
returns uuid
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select case
    when d.blocker_id is not null then d.blocker_id
    -- Provable and bounded: a message from before this migration, whose job had exactly one question by then.
    when d.created_at < coalesce((select (value #>> '{}')::timestamptz from public.system_config where key = 'delivery.bindings_from'), '-infinity')
         and (select count(*) from public.blockers b where b.job_id = d.job_id and b.office_id = d.office_id and b.created_at <= d.created_at) = 1
      then (select b.blocker_id from public.blockers b where b.job_id = d.job_id and b.office_id = d.office_id and b.created_at <= d.created_at)
  end
    from public.deliveries d
   where d.delivery_id = p_delivery and d.office_id = app.require_office(p_office)
$function$;
revoke all on function app.approval_for_delivery(uuid, uuid) from public, anon, authenticated, service_role;

create function app.claim_undo(p_office uuid, p_action_id uuid, p_requested_by text, p_source text default null::text, out outcome undo_status, out won boolean)
 returns record
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_action public.undoable_actions;
begin
  perform app.require_office(p_office);
  -- An action of another office is an action that does not exist: the same sentence, the same code.
  select * into v_action from public.undoable_actions where action_id = p_action_id and office_id = p_office;
  if not found then
    raise exception 'no undoable action %', p_action_id
      using errcode = 'no_data_found';
  end if;

  -- Decide first, so the claim row can be written once and never touched again
  -- (0030: the table is append-only without exception).
  if v_action.status = 'not_undoable' then
    outcome := 'not_undoable';
  elsif v_action.status = 'undone' then
    outcome := 'undone';
  elsif v_action.status = 'expired'
     or (v_action.undo_deadline is not null and v_action.undo_deadline <= app.now_utc()) then
    outcome := 'expired';
  else
    outcome := 'undone';
  end if;

  -- The serialisation point. Exactly one caller inserts.
  insert into public.undo_requests (action_id, requested_by, source, outcome)
  values (p_action_id, p_requested_by, p_source, outcome)
  on conflict (action_id) do nothing;

  if not found then
    -- A duplicate. Report the action's current status and, crucially, that
    -- this caller is not the one that acts.
    won := false;
    outcome := (select status from public.undoable_actions where action_id = p_action_id and office_id = p_office);
    return;
  end if;

  won := true;

  -- We won the claim, so we are the one that changes the world.
  if outcome = 'undone' and v_action.status <> 'undone' then
    update public.undoable_actions
    set status = 'undone', undone_at = app.now_utc()
    where action_id = p_action_id and office_id = p_office;
  elsif outcome = 'expired' and v_action.status <> 'expired' then
    update public.undoable_actions set status = 'expired' where action_id = p_action_id and office_id = p_office;
  end if;
end;
$function$;
revoke all on function app.claim_undo(uuid, uuid, text, text) from public, anon, authenticated, service_role;

create function app.request_undo(p_office uuid, p_action_id uuid, p_requested_by text, p_source text default null::text)
returns undo_status
language sql
security definer
set search_path to ''
as $function$ select outcome from app.claim_undo(p_office, p_action_id, p_requested_by, p_source) $function$;
revoke all on function app.request_undo(uuid, uuid, text, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. splice the database callers of what changed, from their LIVE definitions, and assert each splice landed once
-- ---------------------------------------------------------------------------------------------------------------------
do $m$
declare
  v text;
  r record;
begin
  for r in
    select * from (values
      ('app.hq_undo(uuid,text)'::text,
       'app.request_undo(v_id, app.office_actor(p_office), ''studio'')',
       'app.request_undo(p_office, v_id, app.office_actor(p_office), ''studio'')'),
      ('app.open_questions_for_reply(uuid,uuid)',
       'app.command_account(c.command_id)',
       'app.command_account(p_office, c.command_id)'),
      -- the sweeps: an office that is not active is not swept
      ('app.requeue_retrying()',
       'where j.state = ''retrying''',
       'where j.state = ''retrying'' and exists (select 1 from public.offices o where o.office_id = j.office_id and o.state = ''active'')'),
      ('app.resume_paused(text[])',
       'where j.state = ''paused''',
       'where j.state = ''paused'' and exists (select 1 from public.offices o where o.office_id = j.office_id and o.state = ''active'')'),
      ('app.resumable_now()',
       'where j.state = ''paused''',
       'where j.state = ''paused'' and exists (select 1 from public.offices o where o.office_id = j.office_id and o.state = ''active'')'),
      ('app.settle_exhausted_jobs()',
       'where j.state in (''queued'', ''retrying'')',
       'where j.state in (''queued'', ''retrying'') and exists (select 1 from public.offices o where o.office_id = j.office_id and o.state = ''active'')'),
      ('app.recover_stalled_jobs()',
       'and (j.leased_until is null or j.leased_until < now())',
       'and (j.leased_until is null or j.leased_until < now()) and exists (select 1 from public.offices o where o.office_id = j.office_id and o.state = ''active'')'),
      ('app.enqueue_orphans()',
       'where c.job_id is null',
       'where c.job_id is null and exists (select 1 from public.offices o where o.office_id = c.office_id and o.state = ''active'')'),
      ('app.provision_missing_channels()',
       'where p.status = ''active''',
       'where p.status = ''active'' and exists (select 1 from public.offices o where o.office_id = p.office_id and o.state = ''active'')'),
      ('app.chores_for_credentials()',
       'from public.connection_health',
       'from public.connection_health where exists (select 1 from public.offices o where o.office_id = public.connection_health.office_id and o.state = ''active'')')
    ) as x(fn, anchor, repl)
  loop
    v := pg_get_functiondef(r.fn::regprocedure);
    if (length(v) - length(replace(v, r.anchor, ''))) / length(r.anchor) <> 1 then
      raise exception '0852 splice anchor for % must occur exactly once', r.fn;
    end if;
    v := replace(v, r.anchor, r.repl);
    execute v;
  end loop;
end
$m$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. the old signatures
-- ---------------------------------------------------------------------------------------------------------------------
drop function app.command_account(uuid);
drop function app.command_principal(uuid);
drop function app.approval_for_delivery(uuid);
drop function app.request_undo(uuid, text, text);
drop function app.claim_undo(uuid, text, text);
drop function app.unnamed_project();
drop function app.search_documents(text, uuid, integer, text);
drop function app.resolve_project_by_name(text, boolean);
drop function app.undo_offer(text, text, jsonb, integer);

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. no browser role reaches a worker-side function
-- ---------------------------------------------------------------------------------------------------------------------
do $m$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app'
       and p.prokind = 'f'
       and p.proname in (
         -- job-bound
         'job_depth', 'job_held', 'job_origin', 'renew_lease', 'pause_job', 'resume_job', 'stop_requested',
         'open_approval_for_job', 'job_plan', 'cannot', 'understood', 'job_forwarded', 'owed_a_word', 'staff_behind_job',
         'approval_binds',
         -- deployment scans and classification predicates
         'dequeue_job', 'dispatch_due_responsibilities', 'recover_stalled_jobs', 'recover_stalled_syncs',
         'requeue_retrying', 'resumable_now', 'resume_paused', 'settle_exhausted_jobs', 'enqueue_orphans',
         'expire_undo_offers', 'mcp_expire_codes', 'provision_missing_channels', 'proposals_undeliver',
         'chores_for_backups', 'chores_for_credentials', 'job_trace_prune', 'defer_over_budget',
         'claim_pending_notification', 'harness_job', 'harness_suggestion',
         -- resolvers
         'job_office', 'delivery_office', 'operator_chat', 'principal_refusal')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', r.sig);
  end loop;
end
$m$;
revoke all on function app.learn(public.lesson_scope, text, text, uuid, text, text, uuid, numeric, uuid)
  from public, anon, authenticated, service_role;

-- the public wrappers of the scans: service_role only
revoke all on function public.dispatch_due_responsibilities() from public, anon, authenticated;
grant execute on function public.dispatch_due_responsibilities() to service_role;
revoke all on function public.chores_for_credentials() from public, anon, authenticated;
grant execute on function public.chores_for_credentials() to service_role;
