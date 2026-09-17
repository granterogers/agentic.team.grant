/*
  0473 — every proposal on Grant's Governance page was harness debris

  `public.proposals` holds sixteen rows. Eleven are open, five are declined,
  and the `needed` of every single one is `verify-tool-…`, `fixture-need-…` or
  `probe-need-…`. The page built to make the office legible (#54) has been
  showing him nothing but test traffic, under the heading "What it wants".

  Sixth instance of the class CLAUDE.md records, and the worst placement of it
  yet: a measurement that cries wolf is one he learns to ignore.

  Three things, because a sweep alone is a fix that happens once:

  1. `app.harness_label(text)` — one predicate for "this name belongs to the
     harness", so the next reader that needs it does not invent a seventh
     spelling. The prefixes are exactly the ones `jobs.is_fixture` is generated
     from, which is why an enumeration is right here and wrong nearly
     everywhere else: this list IS the definition.
  2. `app.hq_governance` filters the proposals it returns through it, spliced
     from the live definition rather than transcribed.
  3. The sixteen rows go.

  And the thing underneath, which is why they were the only rows there:
  **`app.raise_proposals` has no caller.** The office records an impediment
  every time an agent cannot do something — 589 of them — and nothing has ever
  turned those into proposals, so the only proposals in the table are the ones
  suites raised with `p_include_fixtures => true`. #49's loop has never closed
  on real work. The duty below is its runner, and `src/handlers/propose.ts` is
  the handler.
*/

create or replace function app.harness_label(p_name text)
returns boolean
language sql
immutable
set search_path to ''
as $function$
  -- The same prefixes `jobs.is_fixture` is generated from, in one place.
  -- Separator-anchored, so a real capability called `verification_report`
  -- is not swept by a rule about `verify-`.
  select coalesce(p_name, '') ~ '^(fixture|verify|probe|gate|ledger-proof)[-_.:]'
      or coalesce(p_name, '') ~ ':(fixture|verify|probe|gate)[-_.:]'
$function$;

comment on function app.harness_label(text) is
  'Does this name belong to the harness (0473)? One predicate, so a reader '
  'that must keep test traffic off a page Grant reads does not invent its own.';

do $splice$
declare
  v_def text;
  v_old text := '          select * from public.proposals
           where state = ''open''';
  v_new text := '          select * from public.proposals
           where not app.harness_label(needed) and (state = ''open''';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'hq_governance';
  if position(v_old in v_def) = 0 then
    raise exception 'the proposals subquery does not look the way 0473 expects';
  end if;
  v_def := replace(v_def, v_old, v_new);
  -- The closing bracket for the condition opened above.
  v_def := replace(
    v_def,
    'or decided_at > app.now_utc() - interval ''30 days''',
    'or decided_at > app.now_utc() - interval ''30 days'')');
  -- pg_get_functiondef emits no trailing semicolon, twice recorded.
  execute v_def || ';';
end
$splice$;

-- ---------------------------------------------------------------------------
-- The sixteen
-- ---------------------------------------------------------------------------

do $sweep$
declare v_gone integer;
begin
  delete from public.proposals where app.harness_label(needed);
  get diagnostics v_gone = row_count;
  raise notice '0473 removed % harness proposal(s)', v_gone;
end
$sweep$;

-- ---------------------------------------------------------------------------
-- The runner that never existed
-- ---------------------------------------------------------------------------

/*
  Daily, and quiet. The proposals land on the Governance page where Grant
  already reads them; the handler does not announce, because eleven things the
  office cannot do arriving on his phone is the narration he has asked twice
  not to receive.
*/
insert into public.responsibilities
  (slug, staff_id, description, job_kind, period_minutes, enabled, created_by)
select 'proposal-round', s.staff_id,
       'Turn what the office could not do into proposals Grant can answer (#49).',
       'office.propose', 1440, true, 'migration'
  from public.staff s where s.slug = 'quality-director'
on conflict (slug) do update
  set job_kind = excluded.job_kind,
      period_minutes = excluded.period_minutes,
      enabled = excluded.enabled;
