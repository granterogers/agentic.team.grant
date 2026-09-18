/*
  (Numbered 0492 because no migration 0492 exists: the resumable-backup change
  earlier today was code only, and the commits that call it "0492" mean the
  work, not a file. ADR-0042 is its durable reference. `check:migrations`
  refuses a gap, correctly, and caught this before it could become one.)

  0490 made `raise_proposals` refuse harness traffic — and made it refuse it
  even when the caller explicitly asked for it.

  `app.raise_proposals(p_days, p_min, p_include_fixtures)` has had that third
  argument since 0297, and it means *"count the harness traffic too"*. The
  tally honours it. 0490 spliced a new predicate into the same WHERE clause
  and did not:

      where staff_slug is not null
        and kind <> 'not_capable'
        and not app.harness_proposal(staff_slug, needed)   -- unconditional

  So `verify:proposes`, whose whole job is to drive the raise path and which
  passes `true` for exactly this reason, got nothing back and went red on four
  checks. The gate found it within the hour, which is the gate working; what
  it is reporting is a real defect in 0490, not a stale suite.

  This is CLAUDE.md's own trap wearing a new coat: *"loosening a constraint
  does not loosen the function that pre-checks it"*, in reverse — tightening a
  filter must respect the switch that already exists to turn it off.

  The reader is deliberately NOT given the same escape. `proposals_to_send`
  feeds the one voice Grant hears; a suite must never be able to ask the
  office to tell him about a gap it invented, and `verify:proposes` asserts
  that refusal rather than working around it.

  ## And the drive found that the reader had no filter AT ALL

  0490's splice looped over three functions replacing
  `app.harness_label(needed)`, and required only that it hit at least ONE of
  them. `proposals_to_send` never contained that string, so it took no
  predicate and nobody noticed — the loop reported success on two out of
  three. Its whole WHERE clause was:

      where state = 'open' and delivered_at is null

  So the batch Claire sends had no harness filter, and the moment the round
  started speaking (0489) a suite's invented gap could have reached Grant's
  phone. Caught by the last assertion in this migration's own drive, which is
  the argument for driving a function rather than reading it.

  **A splice loop must assert per TARGET, not in total.** 0490's did not, and
  the check that would have caught it is the one it skipped.
*/

do $splice$
declare
  v_def text;
  v_old text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'raise_proposals';

  v_old := 'and not app.harness_proposal(staff_slug, needed)';
  if position(v_old in v_def) = 0 then
    raise exception '0492: raise_proposals does not carry 0490 predicate; read it first';
  end if;

  execute replace(
    v_def, v_old,
    'and (coalesce(p_include_fixtures, false)' || E'\n' ||
    '          -- The switch that has meant "count the harness traffic too"' || E'\n' ||
    '          -- since 0297. 0490 tightened the filter and forgot it.' || E'\n' ||
    '          or not app.harness_proposal(staff_slug, needed))'
  ) || ';';
end
$splice$;

-- ---------------------------------------------------------------------------
-- The filter 0490 believed it had already added.
-- ---------------------------------------------------------------------------

do $splice$
declare
  v_def text;
  v_old text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'proposals_to_send';

  v_old := 'where state = ''open'' and delivered_at is null';
  if position(v_old in v_def) = 0 then
    raise exception '0492: proposals_to_send is not shaped the way this expects';
  end if;

  execute replace(
    v_def, v_old,
    'where state = ''open'' and delivered_at is null' || E'\n' ||
    '         -- No escape hatch here, unlike the raise path: this is the batch' || E'\n' ||
    '         -- the chief of staff actually sends, and a suite must never be' || E'\n' ||
    '         -- able to make the office tell Grant about a gap it invented.' || E'\n' ||
    '         and not app.harness_proposal(staff_slug, needed)'
  ) || ';';
end
$splice$;

do $drive$
declare
  v_fix   uuid;
  v_real  uuid;
  v_out   jsonb;
  v_need  text := 'drive-0492-need';
begin
  select job_id into v_fix from public.jobs where app.harness_job(job_id)
   order by created_at desc limit 1;
  select job_id into v_real from public.jobs where not app.harness_job(job_id)
   order by created_at desc limit 1;
  if v_fix is null or v_real is null then
    raise exception '0492: need one harness job and one real job';
  end if;

  -- Three occurrences on a HARNESS job, which is what a suite produces.
  for i in 1..3 loop
    insert into public.job_impediments
      (job_id, staff_slug, kind, needed_raw, detail, noticed_by, understood_as)
    values (v_fix, 'growth-director', 'missing_tool', v_need, 'drive', 'drive', 'drive');
  end loop;

  -- Default: refused, which is 0490 and is right.
  v_out := app.raise_proposals(30, 3, false);
  if exists (select 1 from public.proposals where needed = v_need) then
    raise exception '0492: harness traffic was raised on the DEFAULT path';
  end if;

  -- Asked for explicitly: raised, which is what the parameter has always meant.
  v_out := app.raise_proposals(30, 3, true);
  if not exists (select 1 from public.proposals where needed = v_need) then
    raise exception '0492: p_include_fixtures => true still raised nothing: %', v_out;
  end if;

  -- And the reader still refuses to put it in front of Grant, with no escape.
  if app.proposals_to_send(50)::text like ('%' || v_need || '%') then
    raise exception '0492: a harness proposal reached the batch Claire sends';
  end if;

  raise exception using errcode = 'ZZ000', message = '0492 drive: rolling back';
exception
  when others then
    if sqlerrm <> '0492 drive: rolling back' then raise; end if;
end
$drive$;
