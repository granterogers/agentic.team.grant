-- ---------------------------------------------------------------------------
-- HISTORICAL PRECONDITION, applied immediately before migration 0539
--
-- 0539 teaches `app.lessons_for` to exclude lessons a harness taught, and then
-- drives it both ways in the same migration -- which is the right thing to do
-- and the reason it cannot run on a blank database:
--
--     if v_harness <= v_default then
--       raise exception 'p_include_harness widened nothing: % with it, % without';
--
-- On Grant's database there were harness lessons to exclude, so asking with
-- `p_include_harness` returned MORE than asking without. On a fresh install
-- there are no lessons at all, both counts are zero, and a filter that widens
-- nothing is indistinguishable from a filter that does not work.
--
-- The migration is right and the database is empty; those two facts are
-- incompatible, which is F-002's exact shape. So this seeds the minimum
-- history the control needs: ONE lesson a harness taught. Nothing real is
-- invented -- a lesson whose author is a verify suite is precisely what the
-- new filter exists to hide, so the precondition is the thing being tested,
-- not a workaround for it.
-- ---------------------------------------------------------------------------

-- `global` is the scope whose target columns must all be null, which is what
-- a lesson with no project, no person and no job kind is. The control asks
-- `lessons_for(null, 'chief-of-staff', 'office.instruction', ...)`, and a
-- global lesson is returned to every caller -- so one row is enough to make
-- "with harness" wider than "without", which is the whole assertion.
insert into public.lessons (scope, body, learned_by)
values ('global', 'A harness taught this, and the office should not repeat it.',
        'verify:zero-state-precondition')
on conflict do nothing;
