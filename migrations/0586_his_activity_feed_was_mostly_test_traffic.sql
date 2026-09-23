-- 58% of his Recent activity was test traffic (#356).
--
-- app.hq_studio_lately answers the studio's "what has the office been doing"
-- panel. Asked for 200, it returned 125 items and SEVENTY-THREE of them were
-- suites: "verify:pursues changed a autonomy", "verify-sess-pref-override
-- learned something", "verify:preferences-mucsvewq learned something". Six were
-- in the top twenty, which is the only part he actually sees.
--
-- BOTH HALVES OF ONE FUNCTION, and only one of them wrong. Its counters already
-- ask the right question --
--
--   'jobs_done',   ... where not app.harness_job(j.job_id) ...
--   'jobs_failed', ... where not app.harness_job(j.job_id) ...
--
-- while the FEED filters `p.project_id is null or not p.is_fixture`, which
-- excludes a fixture PROJECT and says nothing about who acted. #45 requires a
-- suite testing anything that filters fixtures to use a REAL project, so by
-- construction those suites' events carry a real project and walk straight
-- through. The numbers were clean and the list beneath them was not.
--
-- check:leaks has a "harness traffic on a table Grant reads" check and it
-- passed, because it does not know about this reader. A debris class with no
-- witness is one that comes back, so the check gains this surface too.
--
-- Filtered on the ACTOR with app.harness_label -- the shared predicate, not a
-- fourth way of asking -- which is separator-anchored, so `grant`, `office`,
-- `chief-of-staff` and `quality-director` are untouched. That anchor is what
-- keeps this out of the expensive direction: hiding a real entry from the one
-- panel that says what the office did is worse than showing a test one.

do $$
declare
  v_def  text;
  v_next text;
  v_feed constant text :=
    'where p.project_id is null or not p.is_fixture';
  v_feed_new constant text :=
    'where (p.project_id is null or not p.is_fixture)'
    || E'\n       and not app.harness_label(e.actor)';
  v_count constant text :=
    'where e.occurred_at > app.now_utc() - interval ''24 hours''';
  v_count_new constant text :=
    'where e.occurred_at > app.now_utc() - interval ''24 hours'''
    || E'\n                    and not app.harness_label(e.actor)';
begin
  select pg_get_functiondef('app.hq_studio_lately'::regproc) into v_def;

  if position(v_feed in v_def) = 0 then
    raise exception 'the feed filter is not where this migration expects it';
  end if;
  if position(v_count in v_def) = 0 then
    raise exception 'the 24-hour event count is not where this migration expects it';
  end if;

  v_next := replace(v_def, v_feed, v_feed_new);
  v_next := replace(v_next, v_count, v_count_new);

  if v_next = v_def then
    raise exception 'the replacement changed nothing';
  end if;

  execute v_next;
end $$;

-- Drive it, in both directions. The half that matters is that his own entries
-- survived: a filter that empties the panel is not an improvement.
do $$
declare
  v_items integer;
  v_harness integer;
  v_real integer;
begin
  select count(*),
         count(*) filter (where app.harness_label(x.who)),
         count(*) filter (where not app.harness_label(x.who))
    into v_items, v_harness, v_real
    from jsonb_array_elements(app.hq_studio_lately(200) -> 'office') e,
         jsonb_to_record(e) as x(who text);

  if v_harness > 0 then
    raise exception '% suite row(s) still on his activity panel', v_harness;
  end if;

  -- THE CONTROL. A found-nothing pass here would mean the panel is empty,
  -- which the filter could have caused rather than fixed.
  if v_real = 0 then
    raise exception 'the panel has nothing real left on it';
  end if;

  raise notice 'activity panel: % item(s), all real', v_items;
end $$;
