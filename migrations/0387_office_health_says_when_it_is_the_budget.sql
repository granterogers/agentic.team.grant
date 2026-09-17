begin;

-- ---------------------------------------------------------------------------
-- 0387 - office_health says when the quiet is the budget (#134)
--
-- The issue's first requirement, and the reason it is first:
--
--   *"A refusal must be visible. A budget that silently defers work is
--   indistinguishable from an office that has quietly stopped - which is
--   exactly #112, where nine jobs sat queued for eight hours and nothing was
--   red. Deferred-for-budget needs its own state and its own line in
--   office_health()."*
--
-- So `held_for_budget` is its own key, carrying the count, the sentence and the
-- time it lifts. Not folded into `stalled`, which would be the same mistake
-- from the other direction: nothing is stalled, the office reached a limit it
-- was given, and a reader who sees "stalled" goes looking for a fault.
--
-- Patched from the live definition rather than transcribed. CLAUDE.md records
-- what transcribing an 8,000-character function costs, and the assertion below
-- is what makes the patch safe.
-- ---------------------------------------------------------------------------

do $$
declare v_def text;
begin
  select pg_get_functiondef(oid) into v_def
    from pg_proc where oid = 'app.office_health(integer)'::regprocedure;

  if position('''excluded_fixtures''' in v_def) = 0 then
    raise exception 'office_health does not look as expected - read it before replacing';
  end if;
  if position('held_for_budget' in v_def) > 0 then
    raise exception 'the budget line is already there';
  end if;

  v_def := replace(v_def, '''excluded_fixtures''',
                          '''held_for_budget'', app.held_for_budget(), ''excluded_fixtures''');
  execute v_def;
end
$$;

commit;
