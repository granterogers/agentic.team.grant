/*
  Forty-two per cent of Grant's Connections page was test debris.

  `app.hq_studio_settings` builds the Connections list straight from
  `public.knowledge_connectors` with no fixture filter, and five rows named
  **"Fixture connector"** had been sitting there since 17 September — left by
  crashed runs of `verify:connectors` over two days. Twelve cards, five of them
  harness.

  This is the class CLAUDE.md records more than any other, in its worst place:
  harness traffic presented to Grant as his own office, on a settings page. A
  connections page that lists five services he has never heard of is one he
  stops reading, and the two real problems on it go with them.

  ## Three sides, because any two alone leave it open

  **The reader filters the class.** Not this run's names — the next suite picks
  a prefix nobody listed. `fixture_%` is what `app.hq_create_connector` derives
  for a harness connector and what the five rows carry.

  **The rows go.** They are disabled, referenced by nothing, and created by a
  suite; there is nothing to preserve. Unlike a job or a skill this table is
  not append-only and a connector that never connected has no history.

  **The debris gets a witness.** `check:leaks` counts probe providers, fixture
  tasks, harness tools and retired fixture specialists — and had no idea this
  table existed, which is exactly why five accumulated unseen. A class with no
  counter is a class that comes back.

  ## Why the filter and not only the sweep

  A sweep fixes today. The filter is what makes the next crashed run invisible
  to Grant rather than visible for two days until somebody happens to look at
  the page — and `verify:connectors` deliberately creates real connectors
  because it is testing the real path, so the debris will happen again.
*/

/*
  The sweep first, so the count below is honest about what it removed rather
  than reporting a filter that hid them.
*/
do $sweep$
declare v_gone integer;
begin
  /*
    Bounded by AGE as well as by shape, and that is not caution for its own
    sake: `verify:knowledge` creates one of these mid-run and asserts against
    it seconds later. A sweep with no age bound, applied while the gate is
    running, would delete a suite's subject underneath it — which would look
    exactly like the product losing a connector.

    Thirty minutes is the same bound the suite's own teardown uses, for the
    same reason: what separates a test subject from real configuration is that
    one of them is gone in seconds (0419).
  */
  delete from public.knowledge_connectors
   where connector like 'fixture\_%'
     and not enabled
     and created_at < now() - interval '30 minutes';
  get diagnostics v_gone = row_count;
  raise notice 'swept % fixture connector(s)', v_gone;

  /*
    An enabled fixture connector would be a suite that left something LIVE, and
    deleting that quietly is a different and worse act than clearing disabled
    debris. Named rather than swept.
  */
  if exists (select 1 from public.knowledge_connectors
              where connector like 'fixture\_%' and enabled
                and created_at < now() - interval '30 minutes') then
    raise warning 'an ENABLED fixture connector survives and was deliberately not swept';
  end if;
end
$sweep$;

/*
  The filter, spliced from the live definition rather than rewritten — this
  function is 200 lines of payload and CLAUDE.md records what rewriting one
  from memory cost. `pg_get_functiondef` emits no trailing semicolon; fifth
  instance.
*/
do $splice$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'hq_studio_settings';
  if v_def is null then
    raise exception 'app.hq_studio_settings is gone, so this splice would be silent';
  end if;

  /*
    Anchored AFTER the lateral join, not after the FROM.

    The first attempt inserted the WHERE straight after
    `from public.knowledge_connectors k`, which is where a reader's eye goes —
    and the next line is `left join lateral`, so the function became
    `from ... where ... left join ...` and Postgres said
    `syntax error at or near "left"`. A clause has to go where the grammar
    puts it, not where the table name is.
  */
  if position(') h on true' in v_def) = 0 then
    raise exception 'the connections join has moved, so this splice would land wrongly';
  end if;

  v_def := replace(
    v_def,
    '      ) h on true' || chr(10) || '  ),',
    '      ) h on true' || chr(10) ||
    '     -- A harness connector is not one of Grant''s (0505). Filtered by the' || chr(10) ||
    '     -- CLASS rather than by a run''s names: the next crashed suite picks a' || chr(10) ||
    '     -- prefix nobody listed, and five of these sat on his Connections page' || chr(10) ||
    '     -- for two days because nothing was looking.' || chr(10) ||
    '     where k.connector not like ''fixture\_%''' || chr(10) || '  ),'
  );

  if position('not like ''fixture' in v_def) = 0 then
    raise exception 'the splice did not land, so this migration would be silent';
  end if;

  execute v_def || ';';
end
$splice$;

/*
  Driven, because a migration that applies cleanly is not a function that
  works — and this one edits a 200-line payload by string replacement, which is
  the shape most able to produce a function that parses and returns nonsense.
*/
do $drive$
declare v_all int; v_fix int;
begin
  select jsonb_array_length(app.hq_studio_settings() -> 'connections') into v_all;
  select count(*) into v_fix
    from jsonb_array_elements(app.hq_studio_settings() -> 'connections') e
   where e ->> 'key' like 'fixture%';

  if v_fix > 0 then
    raise exception 'the page still shows % fixture connector(s)', v_fix;
  end if;
  -- CONTROL: the filter must not have emptied the list. A reader that returns
  -- nothing passes every "no fixtures" check ever written.
  if v_all < 5 then
    raise exception 'only % connection(s) survive, which is the filter matching too much', v_all;
  end if;
  raise notice 'connections page: % cards, 0 of them harness', v_all;
end
$drive$;
