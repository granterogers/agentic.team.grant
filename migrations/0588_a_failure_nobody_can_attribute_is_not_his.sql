-- A failure nobody can attribute is not his (#357).
--
-- Two readers that report to Grant ask the question slightly wrong, and both
-- errors lean the same way: towards telling him something is his when the
-- office cannot establish that it is.
--
-- 1. app.recurring_failures guards with
--
--      where (f.last_job_id is null or not app.harness_job(f.last_job_id))
--
--    The `is null` branch means a signature the office CANNOT CHECK is reported
--    as a real recurring failure. That is 0304's asymmetry with the sign
--    reversed: the absence of a fixture flag is not the presence of a real one,
--    and the same `coalesce(flag, false) = false` shape already put eight
--    fault-injection deliveries on his undelivered list. Driven inside a
--    rollback before this migration was written: a signature with no job comes
--    back from recurring_failures(3,14) as real.
--
--    app.failure_seen has the identical hole on the writing side --
--    `if p_job_id is not null and app.harness_job(p_job_id)` -- so a signature
--    with no job is neither refused going in nor filtered coming out. Two
--    guards, one blind spot, which is the shape #354 was about.
--
--    Safe to exclude, and checked rather than assumed: the only caller in the
--    product is src/jobs/worker.ts and it always passes the job. A null
--    last_job_id therefore means a row nothing in the normal path wrote.
--
-- 2. app.morning_briefing_facts counts what the office did overnight with
--    `where not j.is_fixture` -- the weak predicate, GENERATED from
--    requested_by -- where the canonical one is app.harness_job. 0355's whole
--    argument is that the three readers reporting to him must ask that
--    function, and this is a fourth nobody carried it across to. Measured over
--    ten days the overcount peaks at 11 of 373, about 3%: small, real, and
--    wrong in the direction of flattering the office.

do $$
declare
  v_def  text;
  v_next text;
  v_old  constant text :=
    'where (f.last_job_id is null or not app.harness_job(f.last_job_id))';
  v_new  constant text :=
    'where f.last_job_id is not null'
    || E'\n     and not app.harness_job(f.last_job_id)';
begin
  select pg_get_functiondef('app.recurring_failures'::regproc) into v_def;
  if position(v_old in v_def) = 0 then
    raise exception 'the attribution guard is not where this migration expects it';
  end if;
  v_next := replace(v_def, v_old, v_new);
  if v_next = v_def then raise exception 'the replacement changed nothing'; end if;
  execute v_next;
end $$;

do $$
declare
  v_def  text;
  v_next text;
  v_n    integer;
begin
  select pg_get_functiondef('app.morning_briefing_facts'::regproc) into v_def;

  v_n := (length(v_def) - length(replace(v_def, 'where not j.is_fixture', ''))) / length('where not j.is_fixture');
  if v_n <> 2 then
    raise exception 'expected 2 weak filters in the briefing facts, found %', v_n;
  end if;

  v_next := replace(v_def, 'where not j.is_fixture',
                    'where not app.harness_job(j.job_id)');
  execute v_next;
end $$;

-- Drive both. The unattributable signature must NOT come back, and a properly
-- attributed real one still must -- a filter that silences the whole reader is
-- not a fix.
do $$
declare
  v_kind text;
  v_job  uuid;
  v_orphan integer;
  v_real   integer;
begin
  begin
    select j.kind, j.job_id into v_kind, v_job
      from public.jobs j
     where not app.harness_job(j.job_id) and not j.is_fixture
     order by j.created_at desc limit 1;

    if v_job is null then raise exception 'no real job to drive with'; end if;

    insert into public.failure_signatures
      (job_kind, error_class, subject, seen, first_seen, last_seen, last_job_id)
    values (v_kind, 'timeout', 'orphanproof', 5,
            app.now_utc() - interval '3 days', app.now_utc(), null);

    insert into public.failure_signatures
      (job_kind, error_class, subject, seen, first_seen, last_seen, last_job_id)
    values (v_kind, 'timeout', 'attributedproof', 5,
            app.now_utc() - interval '3 days', app.now_utc(), v_job);

    select count(*) into v_orphan from app.recurring_failures(3, 14)
     where subject = 'orphanproof';
    select count(*) into v_real from app.recurring_failures(3, 14)
     where subject = 'attributedproof';

    if v_orphan <> 0 then
      raise exception 'a signature nobody can attribute is still reported as his';
    end if;
    if v_real <> 1 then
      raise exception 'a properly attributed real failure stopped surfacing';
    end if;

    raise exception 'ROLLBACK_FIXTURES';
  exception when others then
    if sqlerrm <> 'ROLLBACK_FIXTURES' then raise; end if;
  end;
end $$;
