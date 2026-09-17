/*
  0476 — `t.kind` inside the query that produces `t`

  0474 narrowed the proposal round by splicing a condition into the loop:

      for t in select * from app.impediments_tally(…)
                where staff_slug is not null and t.kind <> 'not_capable'

  `t` is the loop's own record variable and does not exist yet while its source
  query runs. plpgsql accepts that at CREATE — a function body is parsed, not
  executed — and raises `55000: record "t" is not assigned yet` the first time
  the round runs. 0475 inherited it.

  Nothing was lost: the round had not run since (it is a daily duty and was
  created hours ago), and driving it is what found this. A migration that
  applies cleanly is not a function that works — CLAUDE.md's own line, earned
  again.

  The columns belong to the tally, so they are named plainly.
*/

do $splice$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'raise_proposals';

  if position('t.kind <> ''not_capable'' and not app.harness_label(t.needed)' in v_def) = 0 then
    raise exception '0476 cannot find the condition 0474 and 0475 spliced';
  end if;
  v_def := replace(
    v_def,
    't.kind <> ''not_capable'' and not app.harness_label(t.needed)',
    'kind <> ''not_capable'' and not app.harness_label(needed)');
  execute v_def || ';';
end
$splice$;

do $drive$
declare v_out jsonb;
begin
  -- Driven here, in the migration that fixes it, because the previous two
  -- were applied without ever being run.
  v_out := app.raise_proposals(3650, 1, false);
  raise notice '0476 drove the round: %', v_out;
end
$drive$;
