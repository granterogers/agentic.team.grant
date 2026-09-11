-- Someone has to actually look at the folder.
--
-- Issue #62. 0194 gave a project a Drive folder and somewhere to keep its
-- cursor; `drive.watch` knows how to look. Nothing fires it.
--
-- This is the pattern the capacity report already had to learn the hard way:
-- *"`responsibilities` held the shape of a recurring duty and had no rows, and
-- nothing called `app.due_responsibilities()`"*. A watcher nobody runs is
-- indistinguishable from a folder nobody drops files in.
--
-- ## Ten minutes, not one
--
-- The duty pass runs every minute, and a Drive changes call every minute per
-- folder is 144 requests a day per project against a quota, to notice something
-- that happens a few times a week. Ten minutes is the granularity Grant would
-- actually feel — he drops a file and asks about it later, not in the following
-- sixty seconds — and `drive_folders_to_check` takes the interval as an
-- argument so it is one number to change.
--
-- ## Owned by the chief of staff
--
-- He said *"chief of staff is like, oh, we see that a file has been dropped"*.
-- The blocker this raises names Claire as the originating agent, and
-- `telegram.only_chief_speaks` means she is the one who can say it anyway.

begin;

insert into public.responsibilities
  (slug, staff_id, description, job_kind, period_minutes, enabled)
select
  'drive-watch',
  s.staff_id,
  'Watch each project''s Google Drive folder and ask Grant what to do with '
    || 'anything new that appears in it.',
  'drive.watch',
  10,
  true
from public.staff s
where s.slug = 'chief-of-staff'
on conflict (slug) do update
   set job_kind = excluded.job_kind,
       description = excluded.description,
       period_minutes = excluded.period_minutes,
       enabled = true,
       updated_at = app.now_utc();

commit;
