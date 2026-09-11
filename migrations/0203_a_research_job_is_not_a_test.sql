-- A research job is not a test.
--
-- Issue #55. `jobs.is_fixture` is GENERATED, and one of its terms classifies by
-- KIND rather than by who asked:
--
--     (requested_by LIKE 'verify:%') OR (requested_by LIKE '%-verification')
--  OR (requested_by LIKE 'gate-%')   OR (requested_by = 'probe')
--  OR (requested_by LIKE 'purge:%')  OR (kind LIKE 'verification.%')
--  OR (kind LIKE 'research.%')       <-- this one
--
-- Every other term identifies the REQUESTER as a harness. That one condemns a
-- whole category of real work. Emma is the Research Director; the moment she
-- runs a `research.*` job it is marked a fixture and disappears from
-- `app.office_health()`, from every tally, and from Grant's usage dashboard —
-- and `purge:fixtures` becomes entitled to retire it.
--
-- It has not bitten because every `research.%` job so far was created by a
-- verify suite. That is what makes it a landmine rather than a bug: it is
-- indistinguishable from correct until the day it is not, and #60 has just
-- taught the planner to admit it cannot do research, which is the request that
-- will produce the first real one.
--
-- ## Nothing loses its fixture status
--
-- The suites that create `research.*` jobs all stamp `requested_by` —
-- `verify:worker`, `verify:slack`, `verify:telegram` — so they stay caught by
-- the requester terms. Asserted below rather than assumed.
--
-- ## `verification.%` stays
--
-- Same shape of rule and a defensible one: nothing real would be called that,
-- and the word means "this exists to test". Kept deliberately rather than by
-- symmetry, so a future reader knows it was considered.
--
-- ## Rebuilding a generated column
--
-- It cannot be altered in place — drop and re-add. The values are recomputed
-- from the same rows, so the only thing that changes is which of them are
-- true, which is the point.

begin;

alter table public.jobs drop column is_fixture;

alter table public.jobs
  add column is_fixture boolean
  generated always as (
       coalesce(requested_by, '') like 'verify:%'
    or coalesce(requested_by, '') like 'verify'
    or coalesce(requested_by, '') like '%-verification'
    or coalesce(requested_by, '') like 'gate-%'
    or coalesce(requested_by, '') = 'probe'
    or coalesce(requested_by, '') like 'purge:%'
    or kind like 'verification.%'
  ) stored;

comment on column public.jobs.is_fixture is
  'Harness traffic, decided by WHO ASKED. `kind LIKE ''research.%''` was '
  'removed in 0203: it condemned a whole category of real work, and the day '
  'Emma ran a real research job it would have vanished from office_health and '
  'every tally (#55). `verification.%` stays — nothing real is called that.';

commit;
