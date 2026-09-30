/*
  0621 - a retried job can commit (Run 4, D7)

  WHAT WAS WRONG. The commit gate (§10) refuses a job while ANY of its outputs is pending or rejected. But a
  job is retried precisely because an attempt did not finish or a reviewer said try again - and the earlier
  attempt's output stays behind, pending (it died before review) or rejected (it was reviewed and refused). So the
  retry, having done everything right, could not commit: it stranded in `committing`, which can only go to
  `failed`. Production shows the size of it: 138 jobs have a rejected output, and all 138 are `failed`; none is
  complete. "Back to the queue, not onward" (worker.ts) has never once been able to end in a delivery, because the
  thing that sent it back was also what stopped it. Found by the Run 4 fence test, where a stale worker's output and
  its successor's met.

  WHAT THIS DOES. It changes what the gate counts, not whether it counts:

    * a new reviewer verdict, `superseded`, for an output a LATER ATTEMPT of the same job replaced before it was
      reviewed (the worker writes it; see runJob). It is neither pending nor rejected, and it is not deterministic:
      no claim is made that anyone approved it;
    * a rejected output blocks the commit only while nothing approved has come AFTER it. The rejection stays on the
      row, in the ledger and in the review notes; what changes is that the retry the rejection asked for is allowed
      to be approved on its own merits. The retry's own output still has to pass review, and if it is rejected too,
      the gate refuses exactly as before.

  Nothing else in the gate changes: a job with no outputs commits freely, and a pending, non-deterministic output
  that nothing supersedes still refuses.

  Compatibility. An old worker never writes `superseded`; its retried jobs behave as before except that a later
  approval now clears an earlier rejection. A new worker on the old schema fails the supersede update inside a
  swallowed catch and behaves as before. Deploy the migration first. Rollback at the foot.
*/

alter type public.reviewer_status add value if not exists 'superseded';

create or replace function app.enforce_review_gate()
returns trigger
language plpgsql
as $function$
declare
  v_unreviewed integer;
  v_total integer;
begin
  if new.state <> 'committed' or old.state = 'committed' then
    return new;
  end if;

  select count(*), count(*) filter (
    where reviewer_status = 'pending' and not deterministic
  )
  into v_total, v_unreviewed
  from public.outputs where job_id = new.job_id;

  -- A job with no outputs at all commits freely: plenty of work produces no
  -- substantive output, and requiring one would make the gate a nuisance
  -- rather than a control.
  if v_total = 0 then
    return new;
  end if;

  if v_unreviewed > 0 then
    raise exception
      'job % cannot reach committed: % of % output(s) are unreviewed. §10: the '
      'commit step reads reviewer_status, and an output without it cannot be '
      'committed. Review them, or mark them deterministic if they came from a '
      'deterministic path.', new.job_id, v_unreviewed, v_total
      using errcode = 'check_violation';
  end if;

  -- A rejected output is not a reviewed output for this purpose. Committing
  -- work whose own reviewer rejected it is the failure the gate exists to
  -- prevent, dressed as compliance. But a rejection is answered by a RETRY
  -- (0621): what blocks the commit is a rejection nothing approved has come
  -- after. The retry's own output still has to pass review.
  if exists (
    select 1 from public.outputs r
    where r.job_id = new.job_id and r.reviewer_status = 'rejected'
      and not exists (
        select 1 from public.outputs a
         where a.job_id = new.job_id
           and a.reviewer_status in ('approved', 'approved_with_reservations')
           and a.created_at > r.created_at)
  ) then
    raise exception
      'job % cannot reach committed: at least one output was REJECTED by review '
      'and nothing approved has replaced it. Committing work its own reviewer '
      'rejected is the failure the gate exists to prevent.', new.job_id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$function$;

/*
  ROLLBACK: restore the pre-0621 body of app.enforce_review_gate (the rejected clause without the "nothing
  approved has come after" test). The enum value stays: a value cannot be removed from an enum, and nothing
  reads it once the worker is rolled back.
*/
