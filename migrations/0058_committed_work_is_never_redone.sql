-- 0058 — committed work is never redone (§18)
--
-- §18 requires that in every degradation case "canonical state is preserved and
-- duplicate substantive work is avoided". Writing the test for its named case —
-- *crash after commit but before notification* — found that the second half
-- does not hold.
--
-- 0006 handles a job stalled in `committed`: it resumes delivery rather than
-- retrying, with a comment explaining exactly why. What it does not handle is a
-- job stalled in **`notifying`**, which is the more likely of the two: a worker
-- spends microseconds in `committed` and however long a Slack call takes in
-- `notifying`. That state falls through to the retry branch, the job goes back
-- to `queued`, and a worker runs the handler again.
--
-- Measured, not inferred. A job crashed in `notifying` with one output row was
-- recovered, dequeued and re-run; the handler was invoked a second time and the
-- job finished with **two outputs**. That is precisely the duplicate
-- substantive work §18 forbids, and it cost one model call in a fixture and
-- would cost a real one in production.
--
-- ## The rule, restated so it cannot rot
--
-- The old rule keyed on the state name, and was therefore wrong the moment a
-- second state also implied committed work. The new rule keys on the evidence:
--
--   **If an output row exists, the work is done. Never retry it — resume
--   delivery.**
--
-- A state name is a summary of what happened; the output row IS what happened.
-- Keying on the fact rather than the summary means a future state between
-- `committing` and `complete` inherits the right behaviour without anyone
-- remembering to add it here.

begin;

create or replace function app.recover_stalled_jobs()
  returns table (
    job_id     uuid,
    from_state public.job_state,
    to_state   public.job_state,
    reason     text
  )
  language plpgsql
  set search_path = pg_catalog, app, public
as $$
declare
  r record;
  v_to public.job_state;
  v_reason text;
  v_has_output boolean;
begin
  for r in
    select j.job_id, j.state, j.attempt, j.max_attempts, j.leased_by
    from public.jobs j
    where j.state in (
      'running', 'output_created', 'quality_review', 'committing', 'committed', 'notifying'
    )
      and (j.leased_until is null or j.leased_until < now())
    order by j.created_at
    for update
  loop
    select exists (select 1 from public.outputs o where o.job_id = r.job_id)
      into v_has_output;

    if v_has_output then
      -- §18's case, keyed on the evidence rather than on a state name. The work
      -- is DURABLE - there is a row - so this resumes delivery. Retrying would
      -- redo committed work and spend a second model call to produce a second
      -- output; treating it as finished would mean Grant is never told. Both
      -- are wrong, and nine states could express neither.
      v_to := 'notifying';
      v_reason := 'recovery: committed work with delivery outstanding';

    elsif r.attempt >= r.max_attempts then
      v_to := 'failed';
      v_reason := format(
        'recovery: %s attempts exhausted while in %s', r.max_attempts, r.state
      );

    else
      v_to := 'retrying';
      v_reason := format(
        'recovery: worker %s died holding this in %s',
        coalesce(r.leased_by, '(unleased)'), r.state
      );
    end if;

    update public.jobs j
    set state        = v_to,
        state_reason = v_reason,
        leased_by    = null,
        leased_until = null
    where j.job_id = r.job_id;

    return query select r.job_id, r.state, v_to, v_reason;
  end loop;
end;
$$;

comment on function app.recover_stalled_jobs() is
  'Reconciles jobs a dead worker left in flight. Only touches expired leases, '
  'so it is safe to run while workers are active. A job WITH AN OUTPUT ROW '
  'resumes delivery rather than retrying, whatever state it stalled in - the '
  'row is the evidence that the work is durable, and a state name is only a '
  'summary of it (§18).';

-- --------------------------------------------------------------------------
-- Claiming a job whose delivery is outstanding
-- --------------------------------------------------------------------------
--
-- Recovery moves such a job to `notifying`, and until now nothing read that
-- state: `dequeue_job` only looks at `queued`. So the fix for the first defect
-- would have parked the job forever instead of duplicating it — the same
-- "sweep to nowhere" shape 0006's requeue was written to close, one layer up.
--
-- Leased like any other claim, so two workers cannot deliver the same output
-- twice. Delivery is separately idempotent through the dedupe key, but a lease
-- is what stops the second worker from making the attempt at all.

create or replace function app.claim_pending_notification(
  p_worker text,
  p_lease_seconds integer default 120
)
returns table (
  job_id         uuid,
  correlation_id uuid,
  project_id     uuid,
  kind           text,
  output_id      uuid
)
language plpgsql
set search_path = pg_catalog, app, public
as $$
declare
  r record;
begin
  select j.job_id, j.correlation_id, j.project_id, j.kind
    into r
  from public.jobs j
  where j.state = 'notifying'
    and (j.leased_until is null or j.leased_until < now())
  order by j.updated_at
  for update skip locked
  limit 1;

  if not found then
    return;
  end if;

  update public.jobs j
     set leased_by = p_worker,
         leased_until = now() + make_interval(secs => p_lease_seconds)
   where j.job_id = r.job_id;

  return query
    select r.job_id, r.correlation_id, r.project_id, r.kind,
           (select o.output_id from public.outputs o
             where o.job_id = r.job_id
             order by o.created_at desc limit 1);
end;
$$;

comment on function app.claim_pending_notification is
  'One job whose work is committed and whose delivery is outstanding. Leased, '
  'because delivery being idempotent stops a duplicate MESSAGE and a lease '
  'stops the duplicate ATTEMPT.';

revoke all on function app.claim_pending_notification(text, integer) from public;
grant execute on function app.claim_pending_notification(text, integer) to ai_team_app;

commit;
