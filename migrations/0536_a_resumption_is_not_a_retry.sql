-- 0536 — A resumption is not a retry
--
-- The nightly backup is two attempts from failing again, and the trend is
-- visible in its own history:
--
--     date        attempts used   worker deaths   rows in the database
--     12-16 Sep   1               0                35k -> 78k
--     17 Sep      5  FAILED       4                ~90k
--     18 Sep      2               1               107k
--     19 Sep      2               1               119k
--     20 Sep      2               1               135k
--     21 Sep      3               2               135k
--
-- 0436's checkpointing is why the 18th onwards succeed at all: each attempt
-- resumes where the last was interrupted, so the job finishes across several
-- dequeues instead of restarting from nothing. The 17th predates it and has
-- zero rows in `job_steps`, which is exactly why it never finished.
--
-- ## What is actually wrong
--
-- `app.dequeue_job` increments `attempt` on every dequeue, and the lease is
-- 300 seconds. An edge worker is killed by its runtime long before a
-- 122-table backup is done, so the job is picked up, makes progress, dies,
-- and is recovered — three times last night. `max_attempts` is 5.
--
-- So `attempt` is carrying two meanings at once:
--
--   * how many times this job has FAILED, which is what a retry cap is for;
--   * how many times it has been PICKED UP, which for a checkpointed job is
--     just how far through it got.
--
-- CLAUDE.md records this shape twice — a fallback class and a real class
-- sharing one name, and a default value that is also a legitimate value —
-- and the consequence is the same both times: nothing downstream can tell
-- the two apart. Here the consequence is that **resumption, which 0436 built
-- deliberately, is defeated by the retry cap as the database grows.** The
-- work is getting bigger every day and the ceiling is not moving.
--
-- Invariant 6 is the one at stake: worker death or restart resumes durable
-- state. It does, for two more nights.
--
-- ## The fix
--
-- An interrupted attempt that FINISHED A CHECKPOINT STEP did not fail. It ran
-- out of wall clock, which is the condition 0436 exists to survive, and the
-- next attempt starts from where it reached. That is a continuation and it is
-- not spent against the ceiling.
--
-- An interrupted attempt that finished nothing is a genuine failure and still
-- counts, so a job that dies before it can do anything still dies after five
-- tries rather than for ever.
--
-- ## Why raising `max_attempts` was rejected
--
-- It is data and it would work tonight. It is also a number somebody has to
-- keep raising as the database grows, and nothing anywhere would say when —
-- the failure mode is a silent backup gap discovered days later, which is the
-- exact failure this run started from.
--
-- ## Why this cannot loop for ever
--
-- Two independent bounds. Progress is monotonic: a step recorded finished is
-- never re-run, so a job that keeps making progress keeps getting closer to
-- the end. And a job that stops making progress starts spending attempts
-- again immediately, so it dies normally. The absolute ceiling below is a
-- third bound for the pathological case of one step per attempt for ever,
-- and it is deliberately generous — a backup legitimately needs a handful.
--
-- ## How the slice is granted, and why the obvious version was wrong
--
-- The first draft of this migration simply sent a progressing job back to
-- `retrying` and left `max_attempts` alone. It applied cleanly. Driving it
-- found two separate reasons it could never have worked, and the second is
-- worse than the defect it was fixing:
--
--   1. `jobs_attempt_within_max` is `attempt <= max_attempts`, and
--      `app.dequeue_job` does `attempt = attempt + 1`. A job resumed at the
--      ceiling would have failed its next dequeue on a CHECK violation.
--   2. `app.requeue_retrying` only moves rows `where attempt < max_attempts`.
--      So the job would have sat in `retrying` FOR EVER — never requeued,
--      never failed, and invisible to every reading of the queue. That turns
--      a backup that fails loudly into one that silently stops.
--
-- CLAUDE.md records this exact shape: loosening a constraint does not loosen
-- the function that pre-checks it, and both halves were correct alone with
-- only their disagreement wrong. The lesson it draws is the one that applies
-- here — when you change a rule, grep for the other function that enforces
-- the same thing.
--
-- So a slice is granted by RAISING `max_attempts`, which satisfies the check,
-- satisfies `requeue_retrying`, and leaves the grant written on the row where
-- anybody can see how many slices a job has been given. `attempt` itself is
-- untouched: it stays the honest count of how many times the job was picked
-- up, and several readers show it.

begin;

insert into public.system_config (key, value, description)
values (
  'jobs.max_dequeues',
  '60'::jsonb,
  'Absolute ceiling on how many times one job may be dequeued, however much '
  'progress it makes. The third bound on a resumable job: the other two are '
  'that progress is monotonic and that an attempt finishing no step still '
  'spends against max_attempts. Generous on purpose — the nightly backup '
  'legitimately needs a handful of slices and a pathological job dies here.'
)
on conflict (key) do nothing;

create or replace function app.recover_stalled_jobs()
returns table(job_id uuid, from_state job_state, to_state job_state, reason text)
language plpgsql
set search_path to 'pg_catalog', 'app', 'public'
as $function$
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

    if v_has_output or r.state in ('committed', 'notifying') then
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
  end loop;
end;
$function$;

comment on function app.recover_stalled_jobs() is
  'Decide what to do with a job whose lease expired. An attempt that finished '
  'a checkpoint step ran out of wall clock rather than failing, so it resumes '
  'without spending against max_attempts (0536) — bounded by monotonic '
  'progress, by an attempt that finishes nothing spending normally, and by '
  'jobs.max_dequeues. The slice is granted by raising max_attempts, because '
  'jobs_attempt_within_max and app.requeue_retrying both enforce '
  'attempt <= max_attempts and neither would have let a bare requeue work.';

commit;
