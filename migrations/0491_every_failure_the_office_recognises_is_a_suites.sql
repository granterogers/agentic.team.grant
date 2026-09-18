/*
  Grant's morning briefing was about to tell him his own messages had failed
  138 times.

  `public.failure_signatures` is #132's answer to *"this has failed the same
  way eleven times in three days is a recommendation"*. `app.recurring_failures`
  reads it, the noticing pass turns it into a suggestion weighted **75** — the
  second-highest weight there is — and `app.morning_briefing_facts` puts it in
  the message Grant reads every day.

  Every row in that table is harness traffic:

      job_kind             seen   requested_by
      office.instruction   138    teamhq:verify-sess-roster
      office.instruction    12    teamhq:verify-sequence-z31do1wg
      office.instruction    12    teamhq:verify-sess-laundering
      office.instruction     8    verify:acquire
      office.instruction     8    verify:history
      research.explodes      4    verify:trace          <- a suite whose whole
      research.explodes      3    verify:worker            job KIND is "explodes"

  `office.instruction` is how Grant's own messages are answered. In the last
  three days it has **14 complete, 6 cancelled and zero real failures**. The
  briefing would have told him the opposite, in the one message he reads daily
  and in the suggestions built to make the office legible.

  Sixth instance of the pattern CLAUDE.md names, and the worst placement of it
  yet: a health reading that cries wolf teaches him to ignore health readings.

  ## Why the table has no flag and should not get one

  `failure_signatures` is an aggregate keyed on `(job_kind, error_class,
  subject)`. A copied `is_fixture` would be 0303's frozen denormalised flag on
  a row that outlives the job it came from. So this fixes both ends of the
  pipe instead:

  - **the writer refuses** a harness job, so the tally can never be polluted
    again — `app.harness_job` is the same derivation 0355 built and the same
    one the three readers that report to Grant already use;
  - **the reader excludes** a signature whose last job is harness, which
    covers anything already recorded and anything a future path writes around
    the front door;
  - **and the existing rows are swept**, because all of them are debris and
    leaving them would keep the briefing wrong until they aged out.

  The reader's direction is the safe one, as 0304 argues: it can only ever
  hide a signature the office already knows is a suite's, and a genuine
  failure recurring for real will write a fresh row with a real job on it
  within the hour.
*/

-- ---------------------------------------------------------------------------
-- The writer: a suite's failure is not the office failing.
-- ---------------------------------------------------------------------------

do $splice$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'failure_seen';

  v_old := '  insert into public.failure_signatures';
  if position(v_old in v_def) = 0 then
    raise exception '0491: failure_seen is not shaped the way this expects; read it first';
  end if;

  v_new :=
    '  /*' || E'\n' ||
    '    Harness traffic is not counted (0491).' || E'\n' ||
    E'\n' ||
    '    A suite that deliberately fails -- `research.explodes` exists to --' || E'\n' ||
    '    was writing into the tally that feeds Grant''s morning briefing and a' || E'\n' ||
    '    weight-75 suggestion. The answer is still a jsonb the caller can log,' || E'\n' ||
    '    so a trace of a fixture job still says what happened; it simply does' || E'\n' ||
    '    not become a recommendation.' || E'\n' ||
    '  */' || E'\n' ||
    '  if p_job_id is not null and app.harness_job(p_job_id) then' || E'\n' ||
    '    return jsonb_build_object(' || E'\n' ||
    '      ''class'', v_class, ''subject'', v_subject, ''seen'', 0,' || E'\n' ||
    '      ''first_seen'', app.now_utc(), ''harness'', true,' || E'\n' ||
    '      ''note'', format(''%s failure on harness traffic, not counted'', v_class));' || E'\n' ||
    '  end if;' || E'\n' ||
    E'\n' ||
    v_old;

  execute replace(v_def, v_old, v_new) || ';';
end
$splice$;

-- ---------------------------------------------------------------------------
-- The reader: and anything already in there.
-- ---------------------------------------------------------------------------

do $splice$
declare
  v_def text;
  v_old text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'recurring_failures';

  -- Anchored on the WHERE it already has, so the predicate joins that clause
  -- rather than opening a second one. The first draft appended a `where` after
  -- the FROM and produced `syntax error at or near "where"` — the function is
  -- SQL-language, so Postgres refused it at creation, which is the good
  -- direction to be wrong in.
  v_old := 'where f.seen >= greatest(coalesce(p_least, 3), 2)';
  if position(v_old in v_def) = 0 then
    raise exception '0491: recurring_failures is not shaped the way this expects';
  end if;

  execute replace(
    v_def, v_old,
    '-- Belt and braces with the writer (0491): a signature whose last job is' || E'\n' ||
    '   -- a suite''s never reaches Grant, however it got into the table.' || E'\n' ||
    '   where (f.last_job_id is null or not app.harness_job(f.last_job_id))' || E'\n' ||
    '     and f.seen >= greatest(coalesce(p_least, 3), 2)'
  ) || ';';
end
$splice$;

-- ---------------------------------------------------------------------------
-- And the debris, which is all of it.
-- ---------------------------------------------------------------------------

delete from public.failure_signatures f
 where f.last_job_id is not null and app.harness_job(f.last_job_id);

-- ---------------------------------------------------------------------------
-- Drive it, both directions.
-- ---------------------------------------------------------------------------

do $drive$
declare
  v_fix  uuid;
  v_real uuid;
  v_out  jsonb;
  v_n    int;
begin
  if exists (select 1 from public.failure_signatures f
              where f.last_job_id is not null and app.harness_job(f.last_job_id)) then
    raise exception '0491: harness signatures survived the sweep';
  end if;

  select job_id into v_fix from public.jobs where app.harness_job(job_id)
   order by created_at desc limit 1;
  select job_id into v_real from public.jobs
   where not app.harness_job(job_id) order by created_at desc limit 1;
  if v_fix is null or v_real is null then
    raise exception '0491: need one harness job and one real job to drive both directions';
  end if;

  -- A suite's failure is answered, and counted as nothing.
  v_out := app.failure_seen('drive.0491', 'something broke', 'sub0491', v_fix);
  if coalesce((v_out ->> 'harness')::boolean, false) is not true then
    raise exception '0491: a harness job was still counted: %', v_out;
  end if;
  if exists (select 1 from public.failure_signatures where job_kind = 'drive.0491') then
    raise exception '0491: it wrote a row for harness traffic anyway';
  end if;

  -- THE CONTROL. A real failure must still be recorded and still recur, or
  -- this migration has simply switched #132 off.
  v_out := app.failure_seen('drive.0491', 'something broke', 'sub0491', v_real);
  if coalesce((v_out ->> 'harness')::boolean, false) then
    raise exception '0491: a REAL failure was dismissed as harness traffic: %', v_out;
  end if;
  if (v_out ->> 'seen')::int <> 1 then
    raise exception '0491: the real failure was not counted: %', v_out;
  end if;
  perform app.failure_seen('drive.0491', 'something broke', 'sub0491', v_real);
  perform app.failure_seen('drive.0491', 'something broke', 'sub0491', v_real);
  select count(*)::int into v_n
    from app.recurring_failures(3, 14) f where f.job_kind = 'drive.0491';
  if v_n <> 1 then
    raise exception '0491: three real failures did not surface as a recurrence (% found)', v_n;
  end if;

  raise exception using errcode = 'ZZ000', message = '0491 drive: rolling back';
exception
  when others then
    if sqlerrm <> '0491 drive: rolling back' then raise; end if;
end
$drive$;
