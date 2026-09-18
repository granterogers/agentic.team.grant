/*
  Two proposals about speaking fluent Welsh have been on Grant's Governance
  page since `verify:proposes` raised them, and 0489's sweep — which I wrote
  an hour ago — did not remove them.

  It said:

      delete from public.proposals where app.harness_label(needed);

  `app.harness_label` is separator-anchored: `^(fixture|verify|probe|gate|
  ledger-proof)[-_.:]`. The need is `speak fluent welsh q7mjvwn5`. It matches
  nothing, the delete removed zero rows, and the migration reported success —
  CLAUDE.md's *"a delete keyed on a name nobody checked deletes nothing and
  reports success"*, committed by the session that quotes it.

  ## Why the name will never work here

  `verify:proposes` names its subject to READ LIKE A REAL ONE on purpose.
  0476 made it do that, because the thing under test is a filter and #45's
  rule is that a suite testing a filter cannot name its subject the way the
  filter matches. So the suite is correct, the reader is correct, and they
  cannot both be satisfied by a pattern over the same string. A longer list of
  name shapes is the enumeration mistake this repository has paid for four
  times.

  ## What is actually true about these rows

  Their EVIDENCE is harness traffic. Every impediment behind them has
  `is_fixture` true, on a job `requested_by` `verify:proposes`, and
  `app.harness_job` agrees. That fact is derivable and cannot be written to
  read like something else, because a suite cannot make its own jobs look
  real without also making them real.

  So this derives it, once, the way 0355 derived `app.harness_job` and for the
  same reason — and the three readers that show Grant proposals ask it instead
  of guessing from a string.

  A proposal whose evidence has VANISHED is treated as real, not as harness:
  `job_impediments` is append-only so that case means the rows predate the
  join, and 0304's asymmetry says an absent witness must never be read as a
  confession.
*/

create or replace function app.harness_proposal(p_staff text, p_needed text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
           -- No evidence at all: not harness. See the header — an absent
           -- witness excludes nothing.
           when not exists (
             select 1 from public.job_impediments i
              where i.staff_slug = p_staff and i.needed = p_needed
           ) then false
           -- Harness only when EVERY impediment behind it is harness traffic.
           -- One real occurrence makes the proposal real, which is the safe
           -- direction: a genuine gap can never be hidden by a suite that
           -- happened to hit the same wall.
           else not exists (
             select 1
               from public.job_impediments i
               left join public.jobs j on j.job_id = i.job_id
              where i.staff_slug = p_staff
                and i.needed = p_needed
                and not (coalesce(i.is_fixture, false)
                         or coalesce(j.is_fixture, false)
                         or coalesce(app.harness_job(i.job_id), false))
           )
         end
     -- And the cheap half: a name that DOES announce itself still counts.
     or app.harness_label(p_needed)
$$;

comment on function app.harness_proposal(text, text) is
  '#49/#272. Whether a proposal is harness traffic, DERIVED from the '
  'impediments that evidenced it rather than guessed from its wording. '
  'verify:proposes names its subject to read like a real one on purpose (#45), '
  'so no pattern over `needed` can ever be right; what a suite cannot fake is '
  'the provenance of its own jobs.';

create or replace function public.harness_proposal(p_staff text, p_needed text)
returns boolean language sql stable security definer set search_path = ''
as $$ select app.harness_proposal(p_staff, p_needed) $$;

grant execute on function app.harness_proposal(text, text) to ai_team_app;
grant execute on function public.harness_proposal(text, text) to ai_team_app;

-- ---------------------------------------------------------------------------
-- The three readers that put proposals in front of Grant.
--
-- Spliced from their live definitions: each is long, this changes one
-- predicate, and CLAUDE.md records twice what transcribing from memory costs.
-- ---------------------------------------------------------------------------

do $splice$
declare
  r      record;
  v_def  text;
  v_new  text;
  v_hits int := 0;
begin
  for r in
    select p.oid, p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app'
       and p.proname in ('hq_governance', 'proposals_to_send', 'raise_proposals')
  loop
    v_def := pg_get_functiondef(r.oid);
    v_new := replace(
      v_def,
      'app.harness_label(needed)',
      'app.harness_proposal(staff_slug, needed)'
    );
    if v_new <> v_def then
      -- `pg_get_functiondef` emits no trailing semicolon. Recorded twice.
      execute v_new || ';';
      v_hits := v_hits + 1;
    end if;
  end loop;

  if v_hits = 0 then
    raise exception '0490: no reader named app.harness_label(needed); read them before editing';
  end if;
end
$splice$;

-- ---------------------------------------------------------------------------
-- And now the sweep 0489 meant to do.
-- ---------------------------------------------------------------------------

delete from public.proposals p where app.harness_proposal(p.staff_slug, p.needed);

-- ---------------------------------------------------------------------------
-- Drive it. Both directions, and the control that says the derivation
-- discriminates rather than simply refusing everything.
-- ---------------------------------------------------------------------------

do $drive$
declare
  v_job  uuid;
  v_real uuid;
  v_n    int;
begin
  if exists (select 1 from public.proposals
              where needed like '%fluent welsh%') then
    raise exception '0490: the harness proposals Grant can see were not swept';
  end if;

  -- A HARNESS proposal: evidenced only by a fixture job's impediment.
  select job_id into v_job from public.jobs where is_fixture order by created_at desc limit 1;
  if v_job is null then
    raise exception '0490: no fixture job to evidence the harness case with';
  end if;
  -- `needed` is GENERATED from `needed_raw` (lower(btrim(...))). Read from
  -- information_schema rather than guessed, after the first run was refused.
  insert into public.job_impediments (job_id, staff_slug, kind, needed_raw, detail, noticed_by, understood_as)
  values (v_job, 'growth-director', 'missing_tool', 'drive-0490-harness', 'drive', 'drive 0490', 'drive 0490');
  if not app.harness_proposal('growth-director', 'drive-0490-harness') then
    raise exception '0490: a need evidenced only by a fixture job read as real';
  end if;

  -- THE CONTROL, which is the half that matters: a need evidenced by a REAL
  -- job must read as real, or the derivation is just refusing everything.
  select job_id into v_real from public.jobs
   where not is_fixture and not app.harness_job(job_id)
   order by created_at desc limit 1;
  if v_real is null then
    raise exception '0490: no real job to build the control from';
  end if;
  -- `needed` is GENERATED from `needed_raw` (lower(btrim(...))). Read from
  -- information_schema rather than guessed, after the first run was refused.
  insert into public.job_impediments (job_id, staff_slug, kind, needed_raw, detail, noticed_by, understood_as)
  values (v_real, 'growth-director', 'missing_tool', 'drive-0490-real', 'drive', 'drive 0490', 'drive 0490');
  if app.harness_proposal('growth-director', 'drive-0490-real') then
    raise exception '0490: a need evidenced by a REAL job was called harness traffic';
  end if;

  -- One real occurrence among many fixtures still makes it real.
  -- `needed` is GENERATED from `needed_raw` (lower(btrim(...))). Read from
  -- information_schema rather than guessed, after the first run was refused.
  insert into public.job_impediments (job_id, staff_slug, kind, needed_raw, detail, noticed_by, understood_as)
  values (v_real, 'growth-director', 'missing_tool', 'drive-0490-harness', 'drive', 'drive 0490', 'drive 0490');
  if app.harness_proposal('growth-director', 'drive-0490-harness') then
    raise exception '0490: one real occurrence did not outweigh the fixtures';
  end if;

  -- An unevidenced need is real, never harness.
  if app.harness_proposal('growth-director', 'drive-0490-nothing-here') then
    raise exception '0490: an absent witness was read as a confession';
  end if;

  -- And a name that announces itself is still caught.
  if not app.harness_proposal('growth-director', 'verify-0490-named') then
    raise exception '0490: the cheap name check stopped working';
  end if;

  select count(*)::int into v_n from public.proposals;
  raise notice '0490: % proposal(s) remain', v_n;

  raise exception using errcode = 'ZZ000', message = '0490 drive: rolling back';
exception
  when others then
    if sqlerrm <> '0490 drive: rolling back' then raise; end if;
end
$drive$;
