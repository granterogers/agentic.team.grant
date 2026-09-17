-- A duty that keeps the diary matching the task list (#94, ADR-0020).
--
-- Marcus, for the same reason he owns `calendar-refresh`: §9 gives Operations
-- "sequencing, dependencies, capacity and follow-through", which is what a
-- diary is for.
--
-- Hourly, matching the reader. More often would spend quota on a list that
-- mostly does not move -- and the handler already costs nothing when nothing
-- has changed, because `calendar_task_plan` compares a hash and an unchanged
-- task produces no API call at all.
--
-- This is scheduled even though `calendar.sync_tasks` is FALSE. That is
-- deliberate: the duty runs, the writer reads the switch, sees it off, and
-- returns "switched off in Settings" without calling Google once (there is a
-- test for exactly that). So the day Grant turns it on, it starts working
-- within the hour with nothing else to do -- rather than the switch being on
-- and nothing happening because a second thing also had to be enabled, which
-- is the shape of every "I turned it on and it did not work".

insert into public.responsibilities
  (slug, staff_id, description, job_kind, period_minutes)
select
  'calendar-task-sync',
  s.staff_id,
  'Keep Google Calendar matching the task list: dated, open tasks appear as '
  'all-day events and come away again when they are done. One way only — the '
  'diary never changes a task.',
  'google.write_calendar_tasks',
  60
  from public.staff s
 where s.slug = 'operations-director'
on conflict (slug) do nothing;
