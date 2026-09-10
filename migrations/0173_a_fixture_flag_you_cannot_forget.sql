-- A fixture flag you cannot forget.
--
-- 0171 gave `tasks.is_fixture` as a plain boolean, defaulting to false. That is
-- wrong, and the reason is a defect this repository has already reported to
-- Grant as a catastrophe: 264 "job failures" that were all harness traffic,
-- described to him as the office collapsing.
--
-- The fix that came out of that was not "remember to set the flag". It was to
-- DERIVE the flag from the identifier, so it cannot be forgotten and cannot be
-- set wrongly:
--
--   jobs      generated from `requested_by` — 'verify:%', 'probe', 'gate-%' …
--   projects  generated from `slug`         — 'fixture-%', 'verify-%' …
--
-- A plain boolean reintroduces exactly the hole those two closed: a test that
-- forgets it silently pollutes the office's health, and nobody notices until
-- the next time health is read aloud.
--
-- So `tasks.is_fixture` becomes generated from `added_by`, matching the shape
-- `jobs` already uses. A task written by a verification script says
-- `added_by = 'verify:tasks'` and is a fixture by construction.
--
-- The column is dropped and recreated rather than altered, because a plain
-- column cannot be converted to a generated one in place. It is one migration
-- old and holds nothing.

begin;

drop index if exists tasks_project_state_idx;
alter table public.tasks drop column if exists is_fixture;

alter table public.tasks add column is_fixture boolean
  generated always as (
    coalesce(added_by, '') like 'verify:%'
    or coalesce(added_by, '') = 'verify'
    or coalesce(added_by, '') like '%-verification'
    or coalesce(added_by, '') like 'gate-%'
    or coalesce(added_by, '') = 'probe'
    or coalesce(added_by, '') like 'purge:%'
  ) stored;

create index if not exists tasks_project_state_idx
  on public.tasks (project_id, state) where not is_fixture;

commit;
