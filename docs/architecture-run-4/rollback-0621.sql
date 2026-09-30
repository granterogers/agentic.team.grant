-- Rollback for 0621: the pre-0621 gate (the enum value 'superseded' stays; nothing reads it once the worker is rolled back).
CREATE OR REPLACE FUNCTION app.enforce_review_gate()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
  -- prevent, dressed as compliance.
  if exists (
    select 1 from public.outputs
    where job_id = new.job_id and reviewer_status = 'rejected'
  ) then
    raise exception
      'job % cannot reach committed: at least one output was REJECTED by review. '
      'Committing work its own reviewer rejected is the failure the gate exists '
      'to prevent.', new.job_id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$function$;
