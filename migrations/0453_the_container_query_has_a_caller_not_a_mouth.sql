-- A wrapper for a sweep nobody browses (#272).
--
-- `app.containers_stored_as_documents` now has a real caller: `npm run
-- check:leaks` reports documents that are really containers, beside the other
-- hygiene it already reports.
--
-- Its PUBLIC wrapper does not, and should not. PostgREST's `public` schema is
-- the mouth for things with a browser in front of them, and this is a sweep an
-- operator runs — putting a door on the page for it would be a control nobody
-- presses, which is the defect this Issue exists to remove rather than add.

drop function if exists public.containers_stored_as_documents();
