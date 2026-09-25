-- 0599 - One stalled job must not stop the office (ledger R48).
--
-- `app.recover_stalled_jobs` sent every stalled job that had an output to
-- `notifying`, including one stalled in `committing`, which by definition was
-- never committed. The state machine refuses committing -> notifying, the
-- function raised, and because the worker calls it at the start of every tick,
-- EVERY tick aborted before dequeuing anything. On 25 September a harness job
-- left in `committing` (the review gate refused its commit) stopped the
-- production office from 02:20 to 03:47: no mail read, no reminders, no sync,
-- 23 duties queued. CLAUDE.md already records the same shape stranding every
-- deploy for a day ("illegal job transition committing -> notifying").
--
-- Two changes, both local to the loop:
--   1. a job stalled in `committing` goes to `retrying` (or `failed` once its
--      attempts are spent) - both legal, both true;
--   2. each row's update runs in its own subtransaction, so a refused
--      transition on one job is a warning about that job, not an outage.

CREATE OR REPLACE FUNCTION app.recover_stalled_jobs()
 RETURNS TABLE(job_id uuid, from_state job_state, to_state job_state, reason text)
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'app', 'public'
AS $function$
declare
  r record;
  v_to public.job_state;
  v_reason text;
  v_has_output boolean;
  v_progressed boolean;
  v_since timestamptz;
  v_ceiling integer;
  v_grant integer;
begin
  v_ceiling := coalesce(
    (select value::text::integer from public.system_config
      where key = 'jobs.max_dequeues'), 60);

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
    -- Per row, or a grant made for one job would be applied to the next.
    v_grant := null;

    select exists (select 1 from public.outputs o where o.job_id = r.job_id)
      into v_has_output;

    -- Did THIS attempt get anywhere? The lease began at the most recent move
    -- into `running`; a checkpoint finished after that is work the next
    -- attempt will not repeat.
    select max(t.occurred_at) into v_since
      from public.job_state_transitions t
     where t.job_id = r.job_id and t.to_state = 'running';

    v_progressed := v_since is not null and exists (
      select 1 from public.job_steps s
       where s.job_id = r.job_id
         and s.finished_at is not null
         and s.finished_at >= v_since
    );

    /*
      0599: a job stalled in COMMITTING was never committed - the commit is the
      step that did not finish - so it cannot be "committed work with delivery
      outstanding", and committing -> notifying is refused by the state
      machine. One such job made this whole function raise, every tick
      aborted before dequeuing, and the office stopped for 86 minutes.
    */
    if r.state = 'committing' then
      if r.attempt >= r.max_attempts then
        v_to := 'failed';
        v_reason := format('recovery: %s attempts exhausted while committing', r.max_attempts);
      else
        v_to := 'retrying';
        v_reason := format('recovery: worker %s died while committing, before the commit landed',
          coalesce(r.leased_by, '(unleased)'));
      end if;
    elsif v_has_output or r.state in ('committed', 'notifying') then
      -- Section 18's case. Two conditions, neither redundant: an output row
      -- means the work is durable wherever it stalled and retrying would redo
      -- it; and `committed`/`notifying` cannot legally go to `retrying` at
      -- all, so the machine decides those regardless of what the evidence says.
      v_to := 'notifying';
      v_reason := case
        when v_has_output then 'recovery: committed work with delivery outstanding'
        else 'recovery: past the commit point with no output to deliver'
      end;

    elsif v_progressed and r.attempt < v_ceiling then
      -- 0536. The attempt ran out of wall clock having finished at least one
      -- checkpoint. That is what 0436 built resumption for, and it is not a
      -- failure, so it earns another slice rather than spending one.
      v_to := 'retrying';
      v_grant := greatest(r.max_attempts, r.attempt + 1);
      v_reason := format(
        'recovery: worker %s ran out of time mid-job, resuming from checkpoint (slice %s, ceiling now %s of at most %s)',
        coalesce(r.leased_by, '(unleased)'), r.attempt, v_grant, v_ceiling
      );

    elsif r.attempt >= r.max_attempts then
      v_to := 'failed';
      v_reason := case
        when v_progressed then format(
          'recovery: %s dequeues without finishing, which is the absolute ceiling', r.attempt)
        else format(
          'recovery: %s attempts exhausted while in %s', r.max_attempts, r.state)
      end;

    else
      v_to := 'retrying';
      v_reason := format(
        'recovery: worker %s died holding this in %s',
        coalesce(r.leased_by, '(unleased)'), r.state
      );
    end if;

    /*
      0599: ONE ROW MUST NOT STOP THE OFFICE. A refused transition on one job
      used to abort the function, and with it every tick. It is now contained
      to that row as a warning, and the sweep carries on.
    */
    begin
      update public.jobs j
      set state        = v_to,
          state_reason = v_reason,
          -- Only the resumption branch sets this. Everywhere else the ceiling
          -- is left exactly as it was.
          max_attempts = coalesce(v_grant, j.max_attempts),
          leased_by    = null,
          leased_until = null
      where j.job_id = r.job_id;

      return query select r.job_id, r.state, v_to, v_reason;
    exception when others then
      raise warning 'recover_stalled_jobs: % could not move % -> %: %',
        r.job_id, r.state, v_to, sqlerrm;
    end;
  end loop;
end;
$function$;
