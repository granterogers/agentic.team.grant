-- A capability is not a result.
--
-- Grant, looking at the "Legacy Coaching Course" teamspace after a day of
-- green reports: *"notion is still empty.. you need to check against the
-- results of what im asking."*
--
-- He was right, and the diagnosis is the useful part. Every piece existed and
-- was verified: create a page (0163), append blocks, set a relation, upload a
-- file, avoid a duplicate, attach the databases (0164). Nothing composed them.
-- So the Chief of Staff could describe an import in fluent detail and could not
-- perform one, and every brief came back as prose about a workspace with
-- nothing in it.
--
-- `office.notion_import` is that composition: the project's documents become
-- Docs pages with their real content, a curriculum becomes Projects, and the
-- work that follows becomes Tasks, each related to the module that owns it.
--
-- Plain HTTPS to api.notion.com, so any worker can run it — no subprocess.

begin;

insert into public.job_kind_needs (kind, needs_subprocess, why)
values ('office.notion_import', false,
        'Writes a project''s source material into its attached Notion data '
        'sources as Projects, Docs and Tasks. Idempotent on page title, so a '
        'rerun adds what is missing and leaves the rest alone. Plain HTTPS.')
on conflict (kind) do update
  set needs_subprocess = excluded.needs_subprocess, why = excluded.why;

commit;
