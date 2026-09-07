-- 0059 — the evidence rule needs the state rule too
--
-- 0058 replaced "if the state is `committed`, resume delivery" with "if an
-- output row exists, resume delivery", on the reasoning that a state name is a
-- summary and the output row is the fact. The reasoning holds. Dropping the
-- old condition did not.
--
-- `verify:jobs` failed immediately with `illegal job transition committed ->
-- retrying`. A job in `committed` with no output row — which its fixture
-- creates deliberately, to test exactly this seam — fell through to the retry
-- branch, and ADR-0008's machine has no such edge: `committed` may only go to
-- `notifying` or `failed`.
--
-- So the rule is both halves, and each covers what the other cannot:
--
--   * **an output row exists** — the work is durable wherever it stalled, and
--     retrying would redo it (0058's defect, measured: two outputs);
--   * **the state is `committed` or `notifying`** — the machine forbids
--     retrying from there, whatever the evidence says.
--
-- The second is not redundant with the first. A job can reach `committed`
-- without an output row through a path that commits nothing, and the state
-- machine's answer for it is `notifying` or `failed`, never `retrying`.
-- `deliverPending` then finds it has nothing to deliver and fails it with that
-- reason, which is the honest end for a job that committed nothing.
--
-- The lesson, for the next person tempted by a cleaner rule: a constraint that
-- has been in the schema since 0005 is a fact about the system, not a detail
-- the new abstraction gets to ignore.

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

    if v_has_output or r.state in ('committed', 'notifying') then
      -- §18's case. Two conditions, neither redundant: an output row means the
      -- work is durable wherever it stalled and retrying would redo it; and
      -- `committed`/`notifying` cannot legally go to `retrying` at all, so the
      -- machine decides those regardless of what the evidence says.
      v_to := 'notifying';
      v_reason := case
        when v_has_output then 'recovery: committed work with delivery outstanding'
        else 'recovery: past the commit point with no output to deliver'
      end;

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
  'so it is safe to run while workers are active. Resumes delivery rather than '
  'retrying when an output row exists (the work is durable) OR when the state '
  'is committed/notifying (the machine forbids retrying from there) - §18.';

commit;
