-- ---------------------------------------------------------------------------
-- HISTORICAL PRECONDITION, applied immediately before migration 0516
--
-- This one is not about Grant's data. It is about TIME.
--
-- 0516's third control asserts that a task from two hours ago is not what
-- "that" means: it deletes its own probes, back-dates one row, and requires
-- `app.my_task_recent()` to answer null. On Grant's database that held, because
-- every other personal task was days old by the time 0516 ran.
--
-- In a replay the whole corpus applies in minutes, so a task an earlier
-- migration created — here 0400-something's "Reconnect google_calendar" — was
-- created seconds ago and is legitimately the most recent personal task. The
-- control then fails, naming a task that has nothing to do with it, about a
-- function that is working perfectly.
--
-- So this is a defect of REPLAY, not of the product, and the honest repair is
-- to restore the elapsed time the real history had rather than to delete
-- anything: back-date every personal task already present so it sits outside
-- the window the control is about. Deleting them would also pass, and would be
-- the harness quietly removing the rows that make its own assertion awkward.
--
-- Recorded separately from F-002 as F-003, because a fresh user who ran the
-- migrations one at a time over months would never see it, and one who ran
-- them in an afternoon always would.
-- ---------------------------------------------------------------------------
update public.tasks
   set created_at = app.now_utc() - interval '30 days'
 where assigned_to_human
   and created_at > app.now_utc() - interval '1 day';
