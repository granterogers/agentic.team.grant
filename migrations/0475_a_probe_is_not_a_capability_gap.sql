/*
  0475 — the last twelve "real" impediments are a probe, and the round would
  have asked Grant about them

  0474 left `raise_proposals` reading `impediments_tally(…, include_fixtures
  => false)`, which excludes `job_impediments.is_fixture`. That flag is
  inherited from the job, and CLAUDE.md records three separate occasions where
  a harness job did not look like one: `telegram:4242`, `voice:grant`, and a
  job whose PROJECT was the fixture. This is the fourth.

  Every non-`not_capable` impediment the office holds that is not flagged as a
  fixture is named `probe-need-j4je9xrc…` — a circuit-breaker probe. Twelve
  rows, five distinct needs, all of them a test. With 0474 in place the round
  raises nothing today; the first time one of those probes recurs three times
  in a window it would raise five proposals asking Grant to grant a tool
  called `probe-need-j4je9xrc-missing_tool`.

  `app.harness_label` (0473) already knows that shape. The round asks it.

  Filtered HERE rather than in `impediments_tally`, deliberately: the tally
  feeds the "tried and could not" list, where a probe row is honest history
  about a probe. What must not happen is the office ASKING for it.
*/

do $splice$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'raise_proposals';

  if position('and t.kind <> ''not_capable''' in v_def) = 0 then
    raise exception '0475 expected 0474 to be in place';
  end if;
  v_def := replace(
    v_def,
    'and t.kind <> ''not_capable''',
    'and t.kind <> ''not_capable'' and not app.harness_label(t.needed)');
  execute v_def || ';';
end
$splice$;
