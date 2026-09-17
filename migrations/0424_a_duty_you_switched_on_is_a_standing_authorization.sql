-- A duty you switched on is a standing authorization (#15).
--
-- 0423 let work a PERSON asked for proceed without asking again. That leaves
-- the other half: work the office does on a schedule. `calendar-task-sync`
-- fires every sixty minutes and writes to Grant's diary -- `calendar.write`,
-- level 2 -- and the matrix at `suggest` says `ask`. Wiring the policy into it
-- without this row would have made the office raise a question sixteen times a
-- day about a duty Grant deliberately switched on, which is the interruption
-- #15 exists to remove, delivered by the feature meant to remove it.
--
-- So: switching a duty on IS the authorization. Not as a special case in the
-- resolver -- a second rule nobody can see -- but as a ROW, on the page beside
-- every other exception, with the duty named in its reason. Revoking it makes
-- that duty start asking, which is a real and useful thing to be able to do
-- and would be impossible if the exception were code.
--
-- Only `calendar-task-sync` is seeded, because only it is an enabled duty that
-- writes outward through a handler this change gates:
--
--   * `drive-watch` asks TODAY, and Grant has not said otherwise. Seeding it
--     would be granting a permission on his behalf.
--   * `notion-sync` writes outward and has no dry-run plan yet, so it is not
--     gated at all; gating it before it can say what it would do would be an
--     approval request nobody could read (#131).
--   * every other enabled duty is level 0 or internal.
--
-- Written through `app.grant_standing` rather than as an INSERT, so the
-- trigger, the unique index and the replace-rather-than-collide behaviour all
-- apply. `granted_by` is the migration, not 'grant': he did switch the duty on,
-- and saying he wrote this row would be putting words in his mouth.

do $$
declare v_on boolean;
begin
  select enabled into v_on from public.responsibilities where slug = 'calendar-task-sync';
  if coalesce(v_on, false) then
    perform app.grant_standing(
      'calendar.write', null,
      'You have the hourly calendar-task-sync duty switched on, so the office '
      'keeps the diary in step without asking. Revoke this and it will ask '
      'before each change instead.',
      'migration 0424', null);
  end if;
end;
$$;
