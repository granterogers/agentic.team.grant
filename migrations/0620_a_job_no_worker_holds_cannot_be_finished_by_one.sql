/*
  0620 - a job no worker holds cannot be finished by one; and none is left with nowhere to go (Run 4, lifecycle)

  Six defects, each REPRODUCED on the isolated replica before this was written (Run 4 recon, scripts in
  scripts/isolated/job-lifecycle.ts), and none yet seen corrupting a real job - production held no non-terminal
  real job when they were found, which is why they are cheap to close now and expensive later.

  D1  NO FENCE, NO RENEWAL. `dequeue_job` leases a job for 300 seconds and nothing ever renews it, and the worker's
      state writes are `update jobs set state = ... where job_id = ...`: they never ask who holds the job. A handler
      that runs past its lease is swept to `retrying`, re-queued and claimed by a second worker; the first, waking
      later, then completed the job over the top of the second (every edge it took was legal), and the second's own
      writes were refused after ITS effects had run. This adds `app.job_held` (does this worker still hold this
      attempt?) and `app.renew_lease`; the worker checks the first on every state write and the outputs insert, and
      renews while it works. No new state, no fencing token beyond what the row already has: the pair
      (leased_by, attempt) IS the token, because `dequeue_job` writes the first and increments the second.
  D2  AN ANSWERED QUESTION COULD BE A DEAD LETTER. `dequeue_job` claims only `attempt < max_attempts`, and answering
      an approval put the job back in the queue having spent an attempt on the wait - so a job that had asked its
      fifth question was `queued` for ever. A wait is not an attempt (0609 already says so for two pause reasons);
      an approval is a third. `let_job_go` gives the attempt back and closes the pause row it was answering.
  D3  `retrying` OR `queued` WITH NO ATTEMPTS LEFT WAS STUCK FOR EVER. The worker decides "retryable" from a literal 4,
      not from the job's own `max_attempts`, so a job with a ceiling of 1 or 3 could be left `retrying` at its
      ceiling, which `requeue_retrying` and `dequeue_job` both refuse and no sweep fails. `app.settle_exhausted_jobs`
      fails it, with the reason in its own words, so the existing terminal-failure path tells the person who asked.
  D4  A RETRIED PARENT MADE ITS CHILD AGAIN. `enqueue_child` keyed every child on a random uuid, so a parent that died
      after creating a child and before finishing created a second on retry. The child is now keyed on what it IS
      (parent, kind, payload) and WHICH ONE of that kind the attempt has asked for (a counter per parent attempt), so
      the retry finds the child it already made and returns it. Two identical children in ONE attempt are still two;
      a deferral that re-enqueues a sibling with the same payload takes the next slot, so is still a new job; a child
      that FAILED or was CANCELLED is not returned - a retry may try again. NOT closed: a CHILD that retries and
      defers again (a sibling under the same parent) takes a new slot each time, because the parent cannot tell who
      is asking; those deferrals carry their own claims (notebook.generate) and the residual is recorded.
  D5  AN ANSWER THAT ARRIVED WHILE THE JOB WAS BEING PARKED WAS LOST. `raiseBlocker` commits first and `pause_job` runs
      later, so a person who answered in between resolved the blocker while the job was still `running`:
      `let_job_go` found nothing to release, `pause_job` then parked the job as waiting on a question that was already
      answered, and nothing would ever wake it. `pause_job` now looks for a blocker on this job resolved since this
      attempt began and, finding one, parks and releases in the same breath.
  D6  (worker side, no SQL) an output from a worker that no longer holds the job is refused, so it cannot become the
      newest output a later delivery reads.

  Also: `app.job_situation(job)` - the minimum truthful answer to "what is happening to this?", in the words a
  dashboard needs: working, waiting_for_grant, retrying, ambiguous_external, stalled, stuck, failed, complete...
  It never says complete for anything but a job that reached `complete`.

  Compatibility. Every function here is new or a replacement that keeps its signature. An old worker never calls
  the new functions and its writes are unfenced exactly as before; a new worker on the old schema cannot call them
  and (see src/jobs/fence.ts) falls back to unfenced writes rather than stopping. Deploy the migration first.
  Rollback at the foot of this file.
*/

/* ---- D1: who holds this job? ------------------------------------------------------------------------------ */

create or replace function app.job_held(p_job uuid, p_worker text, p_attempt integer)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  /*
    Held: this attempt, leased to this worker - OR parked by its own handler. A handler that asks a question
    pauses its own job (which clears the lease) and the worker then still has an output to write and review;
    that is the same attempt, and only its holder can be running it. The attempt number is what keeps a stale
    worker out: whoever claims the job next has a higher one.
  */
  select exists (
    select 1 from public.jobs j
     where j.job_id = p_job
       and j.attempt = p_attempt
       and ((j.leased_by = p_worker
             and j.state in ('running', 'output_created', 'quality_review', 'committing', 'committed', 'notifying'))
            or (j.leased_by is null and j.state = 'paused')))
$fn$;

create or replace function app.renew_lease(p_job uuid, p_worker text, p_attempt integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_seconds integer;
  v_rows integer;
begin
  v_seconds := coalesce((select (value #>> '{}')::integer from public.system_config where key = 'jobs.lease_seconds'), 300);
  update public.jobs
     set leased_until = now() + make_interval(secs => v_seconds)
   where job_id = p_job
     and leased_by = p_worker
     and attempt = p_attempt
     and state in ('running', 'output_created', 'quality_review', 'committing', 'committed', 'notifying');
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$fn$;

/* ---- D3: a job with nowhere to go ------------------------------------------------------------------------- */

create or replace function app.settle_exhausted_jobs()
returns table (job_id uuid, from_state public.job_state, reason text)
language plpgsql
security definer
set search_path = 'pg_catalog', 'public'
as $fn$
declare
  r record;
  v_reason text;
begin
  for r in
    select j.job_id, j.state, j.attempt, j.max_attempts
      from public.jobs j
     where j.state in ('queued', 'retrying')
       and j.attempt >= j.max_attempts
       -- a job waiting on its own clock is not stuck; one that has been ready for a while and cannot start is
       and (j.not_before is null or j.not_before < now())
       and j.updated_at < now() - interval '5 minutes'
     order by j.created_at
       for update skip locked
  loop
    v_reason := format('no attempts left: %s of %s used, and nothing can start it again', r.attempt, r.max_attempts);
    begin
      update public.jobs j set state = 'failed', state_reason = v_reason, leased_by = null, leased_until = null
       where j.job_id = r.job_id and j.state = r.state;
      job_id := r.job_id; from_state := r.state; reason := v_reason;
      return next;
    exception when others then
      -- one row must not stop the sweep (0599's rule)
      raise warning 'settle_exhausted_jobs: % refused: %', r.job_id, sqlerrm;
    end;
  end loop;
end;
$fn$;

/* ---- D2 and the pause row: a person's answer is a reason for another go ------------------------------------ */

create or replace function app.let_job_go(p_job uuid, p_why text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_was text;
  v_reason text;
begin
  if p_job is null then return; end if;
  select state::text into v_was from public.jobs where job_id = p_job;
  if v_was is null then return; end if;
  /*
    A resolved blocker whose job is still parked in waiting_user is a job
    nothing will ever pick up. But waiting_user -> queued is not an edge, and
    0290 says why it should not be: queued means nobody has looked at this yet.
    So: park it, then queue it. Both transitions are written to
    job_state_transitions by the trigger, and the ledger reads as what
    happened.
  */
  if v_was in ('waiting_user', 'waiting_external') then
    update public.jobs
       set state = 'paused', state_reason = p_why, updated_at = app.now_utc()
     where job_id = p_job;
    v_was := 'paused';
  end if;
  if v_was = 'paused' then
    select p.reason into v_reason from public.job_pauses p
     where p.job_id = p_job and p.resumed_at is null order by p.at desc limit 1;
    -- The pause this answer ends is closed, as resume_job closes it: the record says it was resumed, and why.
    update public.job_pauses
       set resumed_at = app.now_utc(), resumed_why = left(coalesce(p_why, ''), 400)
     where job_id = p_job and resumed_at is null;
    -- A question is not an attempt (0609's rule, for the third bounded wait): without this a job that had asked
    -- its last question was queued and could never be claimed.
    update public.jobs
       set state = 'queued', state_reason = p_why, updated_at = app.now_utc(),
           waiting_on = null,
           attempt = case when v_reason in ('awaiting_approval', 'awaiting_human_action')
                          then greatest(attempt - 1, 0) else attempt end
     where job_id = p_job;
  end if;
end;
$fn$;

/* ---- D5: parked after it was already answered ------------------------------------------------------------- */

create or replace function app.pause_job(p_job uuid, p_reason text, p_detail text, p_resume_when text,
                                         p_resumable boolean default true,
                                         p_until timestamptz default null,
                                         p_expires_at timestamptz default null,
                                         p_binds_to text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_state text;
  v_since timestamptz;
  v_answered uuid;
begin
  select state::text into v_state from public.jobs where job_id = p_job;
  if v_state is null then
    return jsonb_build_object('error', 'no such job');
  end if;
  if v_state = 'paused' then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  if p_reason = 'awaiting_approval' and coalesce(p_binds_to, '') !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('error',
      'an approval has to bind to the exact action it approves — pass the '
      'fingerprint of what the job is promising to do');
  end if;

  insert into public.job_pauses
    (job_id, reason, detail, resume_when, resumable, expires_at, binds_to)
  values (p_job, p_reason, p_detail, p_resume_when, coalesce(p_resumable, true),
          p_expires_at, p_binds_to);

  update public.jobs
     set state = 'paused',
         state_reason = left(p_reason || ': ' || p_detail, 500),
         waiting_on = left(p_resume_when, 500),
         not_before = coalesce(p_until, not_before),
         leased_by = null,
         leased_until = null
   where job_id = p_job;

  /*
    D5. The question was raised by a write that committed before this one, so a person could answer in the gap:
    the blocker is resolved, `let_job_go` found the job still running and released nothing, and this then parked
    it on an answer already given. Look for exactly that - a blocker of this job, resolved since this attempt
    began, with none still open - and release. The pause row above is closed by let_job_go, so the ledger reads
    parked, answered, queued, in that order.
  */
  if p_reason in ('awaiting_approval', 'awaiting_human_action') then
    select max(t.occurred_at) into v_since
      from public.job_state_transitions t where t.job_id = p_job and t.to_state = 'running';
    select b.blocker_id into v_answered from public.blockers b
     where b.job_id = p_job and b.state <> 'open' and b.resolved_at >= coalesce(v_since, '-infinity')
     order by b.resolved_at desc limit 1;
    if v_answered is not null
       and not exists (select 1 from public.blockers b where b.job_id = p_job and b.state = 'open') then
      perform app.let_job_go(p_job, 'answered while it was being parked');
      return jsonb_build_object('ok', true, 'was', v_state, 'released', v_answered);
    end if;
  end if;

  return jsonb_build_object('ok', true, 'was', v_state);
end;
$fn$;

/* ---- D4: a retried parent does not make its child twice ------------------------------------------------------ */

/*
  WHICH child of this kind is this, within this attempt? A retry runs the same code in the same order, so its
  first identical child is the same work as the first one the dead attempt made. The slot is counted per
  (parent, parent's attempt, kind + payload): the Nth identical request of an attempt is slot N, and slot N is
  the same child on every attempt. Counted in a table, because the answer has to survive the process that
  asked; serialised per parent so two concurrent calls cannot both be "the first".
*/
create table if not exists public.job_child_slots (
  job_id   uuid    not null references public.jobs (job_id),
  attempt  integer not null,
  slot_key text    not null,
  used     integer not null default 0,
  primary key (job_id, attempt, slot_key)
);
alter table public.job_child_slots enable row level security;
revoke all on public.job_child_slots from public, anon, authenticated;

create or replace function app.enqueue_child(p_parent uuid, p_kind text,
                                             p_payload jsonb default '{}'::jsonb,
                                             p_delay interval default '00:00:00'::interval,
                                             p_announce boolean default true,
                                             p_project uuid default null)
returns uuid
language plpgsql
security definer
set search_path = 'public', 'pg_catalog'
as $fn$
declare
  v_parent public.jobs;
  v_id uuid;
  v_hash text;
  v_slot text;
  v_n integer;
  v_key text;
begin
  select * into v_parent from public.jobs where job_id = p_parent;
  if not found then
    raise exception 'no job % to hang a child on', p_parent using errcode = '23503';
  end if;

  perform pg_advisory_xact_lock(hashtext('enqueue_child:' || p_parent::text));
  v_hash := md5(coalesce(p_payload, '{}'::jsonb)::text);
  v_slot := left(p_kind, 40) || ':' || v_hash;
  insert into public.job_child_slots as s (job_id, attempt, slot_key, used)
  values (p_parent, v_parent.attempt, v_slot, 1)
  on conflict (job_id, attempt, slot_key) do update set used = s.used + 1
  returning s.used - 1 into v_n;
  v_key := format('child-%s-%s-%s', left(p_kind, 40), left(v_hash, 16), v_n);

  -- One parent, one kind, one payload, one slot: this is the child the parent already made, if it did and it
  -- did not fail. A failed or cancelled child is not reused - the retry is entitled to try again.
  select c.job_id into v_id from public.jobs c
   where c.parent_job_id = p_parent and c.kind = p_kind
     and c.idempotency_key like v_key || '-%' and c.state not in ('failed', 'cancelled')
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
$fn$;

/* ---- what is happening to this job? -------------------------------------------------------------------------- */

create or replace function app.job_situation(p_job uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  j public.jobs;
  p public.job_pauses;
  v_what text;
  v_detail text;
begin
  select * into j from public.jobs where job_id = p_job;
  if not found then return jsonb_build_object('situation', 'unknown', 'detail', 'no such job'); end if;
  if j.state = 'paused' then
    select * into p from public.job_pauses where job_id = p_job and resumed_at is null order by at desc limit 1;
    v_what := case
      when p.reason in ('awaiting_approval', 'awaiting_human_action') then 'waiting_for_grant'
      when p.reason in ('needs_reconciliation', 'checkpoint_stale') then 'ambiguous_external'
      when p.reason = 'credential_required' then 'needs_a_credential'
      else 'waiting' end;
    v_detail := coalesce(p.detail, j.state_reason);
  elsif j.state = 'complete' then v_what := 'complete'; v_detail := j.state_reason;
  elsif j.state = 'failed' then v_what := 'failed'; v_detail := j.state_reason;
  elsif j.state = 'cancelled' then v_what := 'cancelled'; v_detail := j.state_reason;
  elsif j.state in ('queued', 'retrying') and j.attempt >= j.max_attempts then
    v_what := 'stuck'; v_detail := format('no attempts left (%s of %s)', j.attempt, j.max_attempts);
  elsif j.state = 'retrying' then v_what := 'retrying'; v_detail := j.state_reason;
  elsif j.state = 'queued' then v_what := 'queued'; v_detail := j.waiting_on;
  elsif j.state in ('committed', 'notifying') then v_what := 'delivering'; v_detail := j.state_reason;
  elsif j.leased_until is not null and j.leased_until < now() then
    v_what := 'stalled'; v_detail := format('held by %s, whose lease ran out', coalesce(j.leased_by, '(nobody)'));
  else v_what := 'working'; v_detail := j.state_reason;
  end if;
  return jsonb_build_object('situation', v_what, 'detail', v_detail, 'state', j.state,
                            'attempt', j.attempt, 'max_attempts', j.max_attempts);
end;
$fn$;

/*
  The place a person or a client asks "what is happening to this?" already exists: an MCP client polls
  `mcp_job_status`. It said `state`, which is the machine's word - `paused` covers a question waiting for Grant, an
  outage, and a needs-reconciliation stop that nobody must retry blind, and `running` covers a live worker and one
  whose lease ran out. `situation` is the truthful one, from `app.job_situation`; `state` stays exactly as it was.
*/
create or replace function app.mcp_job_status(p_job_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = 'public', 'pg_catalog'
as $fn$
  select coalesce(
    (select jsonb_build_object(
              'job_id', j.job_id, 'kind', j.kind, 'state', j.state,
              'situation', (app.job_situation(j.job_id) ->> 'situation'),
              'reason', j.state_reason, 'created_at', j.created_at,
              'finished_at', j.finished_at,
              'output', (select left(o.body, 4000) from public.outputs o
                          where o.job_id = j.job_id order by o.created_at desc limit 1)
            )
       from public.jobs j where j.job_id = p_job_id),
    jsonb_build_object('error', 'no such job'))
$fn$;

revoke all on function app.job_held(uuid, text, integer) from public, anon, authenticated;
revoke all on function app.renew_lease(uuid, text, integer) from public, anon, authenticated;
revoke all on function app.settle_exhausted_jobs() from public, anon, authenticated;
revoke all on function app.job_situation(uuid) from public, anon, authenticated;

/*
  ROLLBACK (verified on the replica): drop the four new functions; restore app.let_job_go, app.pause_job and
  app.enqueue_child to the bodies in docs/architecture-run-4/rollback-0620.sql (their pre-0620 definitions,
  dumped from the live database before this ran).
*/
