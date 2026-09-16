begin;

-- ---------------------------------------------------------------------------
-- 0389 - the fixture filter belongs at the PAGE, not at retrieval (#181)
--
-- 0388 put `not is_fixture` inside `public.lessons_live`, on the reasoning that
-- one filter on the shared view beats one per reader. `verify:lessons` went
-- from 36/36 to 31/36 within the minute and it was right to.
--
-- `lessons_live` is not only what the Governance page renders. It is also what
-- `lessons_for` retrieves when a job is about to run — the office's memory
-- being handed to an agent — and a suite that writes a lesson as
-- `verify:lessons` and then asserts the office retrieves it is testing exactly
-- the right thing. Its traffic IS harness traffic, and the product excluding it
-- from RETRIEVAL means the suite can never prove that retrieval works.
--
-- CLAUDE.md, about the shape of this: *"A test whose subject the product
-- deliberately refuses is asserting against a safety rule... Validate the
-- SUBJECT of a test against the rules before reading its result as a defect."*
-- Here the suite is right and the product was wrong, which is the same
-- question answered the other way.
--
-- So the view carries the FLAG and applies no policy, and `hq_governance` —
-- the one reader whose audience is Grant — is where the filter goes. What he
-- reads is the office's memory; what an agent retrieves is all of it.
-- ---------------------------------------------------------------------------

do $$
declare v_def text;
begin
  select pg_get_viewdef('public.lessons_live'::regclass, true) into v_def;
  -- Postgres prints the predicate back WITHOUT the alias it was written with,
  -- so the string to look for is not the string that was executed. Asserting
  -- on the written form failed on a view that was exactly as expected.
  if position('WHERE NOT is_fixture AND' in v_def) = 0 then
    raise exception '0388 filter is not there - read the view before replacing';
  end if;
  execute 'create or replace view public.lessons_live as ' ||
    replace(replace(v_def, 'WHERE NOT is_fixture AND', 'WHERE'),
            '    created_at' || E'\n', '    created_at,' || E'\n' || '    is_fixture' || E'\n');
end
$$;

comment on view public.lessons_live is
  'Every current lesson, harness traffic included and LABELLED (#181, 0389). '
  'No policy here on purpose: `lessons_for` hands this to an agent about to '
  'work, and a suite that writes a lesson under a verify name and asserts it '
  'is retrieved is testing the right thing. The page Grant reads filters; '
  'retrieval does not.';

do $$
declare v_def text;
begin
  select pg_get_functiondef(oid) into v_def
    from pg_proc where oid = 'app.hq_governance(integer)'::regprocedure;
  if position('from (select * from public.lessons_live order by created_at desc' in v_def) = 0 then
    raise exception 'hq_governance does not read lessons_live as expected';
  end if;
  if position('not is_fixture' in v_def) > 0 then
    raise exception 'it already filters them';
  end if;
  v_def := replace(v_def,
    'from (select * from public.lessons_live order by created_at desc',
    'from (select * from public.lessons_live where not is_fixture order by created_at desc');
  execute v_def;
end
$$;

commit;
