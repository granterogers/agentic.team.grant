begin;

-- ---------------------------------------------------------------------------
-- 0388 - harness traffic on two more tables Grant reads (#181, #241, #266)
--
-- The fifth and sixth instances of the same shape, and CLAUDE.md has the first
-- four: `public.jobs` (85 rows on fixture projects, 0355), `job_impediments`
-- (0303/0304), `public.tasks` (31 of 32, swept today), and the thirty archived
-- debris projects. Each time the rows were harmless until a new reader looked
-- at them without a filter, and then they read as the office failing.
--
--   public.lessons      155 of 195 rows written by a verification suite, on
--                       the ledger the Governance page renders
--   provider_health     45 of 46 rows are `probe_*` circuit-breaker fixtures
--
-- ## lessons gets a generated column, not a sweep
--
-- `app.learn` and `app.retract_lesson` are the write and the withdrawal, and
-- the table is the office's memory: deleting from it is deleting what the
-- office learned, which is not a tidy-up. So it gets `is_fixture`, GENERATED
-- from `learned_by` with the same predicate `jobs` and `tasks` already use, and
-- `hq_governance` - the reader Grant actually looks at - filters it.
--
-- Generated rather than a trigger-maintained copy, for 0303's reason: a copy
-- is a fact frozen at insert, and this one can be derived from the row itself.
--
-- ## provider_health gets swept, because it is state and not a record
--
-- It is the circuit breaker's current opinion of each provider, not a history.
-- A probe provider that no longer exists has no opinion worth keeping, and the
-- breaker writes a fresh row the first time it sees a provider again. The
-- name convention is what makes them identifiable, and it is the same
-- convention everything else here uses.
-- ---------------------------------------------------------------------------

alter table public.lessons
  add column if not exists is_fixture boolean
  generated always as (
    coalesce(learned_by, '') like 'verify:%'
    or coalesce(learned_by, '') like 'verify-%'
    or coalesce(learned_by, '') = 'verify'
    or coalesce(learned_by, '') like '%-verification'
    or coalesce(learned_by, '') like 'gate-%'
    or coalesce(learned_by, '') = 'probe'
    or coalesce(learned_by, '') like 'purge:%'
  ) stored;

comment on column public.lessons.is_fixture is
  'Harness traffic on the office''s memory (#181). GENERATED from learned_by '
  'with the same predicate jobs and tasks use, so it cannot go stale the way a '
  'trigger-maintained copy can (0303). The lessons are not deleted: this table '
  'is what the office learned, and a sweep of it would be deleting that.';

/*
  The VIEW, not the reader.

  `hq_governance` reads `public.lessons_live`, and so does everything else that
  wants the office's current memory. Filtering the view is one place; filtering
  the reader would have been the first of several, and the second one added
  next month would be the one nobody remembers — which is the same argument
  0355 makes about `app.harness_job` and its three readers.
*/
do $$
declare v_def text;
begin
  select pg_get_viewdef('public.lessons_live'::regclass, true) into v_def;
  if position('is_fixture' in v_def) > 0 then
    raise exception 'lessons_live already filters harness traffic';
  end if;
  if position('row_kind = ''lesson''::lesson_row_kind' in v_def) = 0 then
    raise exception 'lessons_live does not look as expected - read it before replacing';
  end if;
  execute 'create or replace view public.lessons_live as ' ||
    replace(v_def, 'WHERE row_kind = ''lesson''::lesson_row_kind',
                   'WHERE NOT l.is_fixture AND row_kind = ''lesson''::lesson_row_kind');
end
$$;

delete from public.provider_health where provider like 'probe\_%';

commit;
