-- The notes nobody read.
--
-- Grant shared twenty items with the Notion integration. The connector works
-- and is verified thirteen ways. `documents` holds nine notebook sources, one
-- MCP page, and no Notion at all, because nothing has ever called the sync
-- outside a verification run — and the Set up page has been telling him "0
-- pages synced, share a page with the integration" about pages he already
-- shared.
--
-- The same shape as `office.sync` before 0138 and the arrival trigger before
-- 0107: every segment works and nothing traverses it. Three instances of one
-- defect in two days is a pattern, and the pattern is that a capability with
-- no scheduled caller is a capability nobody has.
--
-- ## The decision it does not make
--
-- Which project the pages belong to. That is a filing decision about somebody
-- else's notes, and the wrong answer puts personal pages in a work project and
-- sets the team reading them. `notion.project_slug` is unset, and the handler
-- says so in a sentence every time it runs rather than choosing.
--
-- ## Why switching it on unattended is safe
--
-- 0107 ignores the first documents of a project — an import is not news — so
-- the first sync of twenty pages convenes nobody. The twenty-first page, later,
-- is news.

begin;

insert into public.system_config (key, value, description)
values
  ('notion.project_slug', to_jsonb(''::text),
   'The project shared Notion pages are filed under. Empty means undecided, '
   'and the duty reports that rather than guessing — filing somebody''s own '
   'notes into the wrong project is a mess to undo.')
on conflict (key) do nothing;

insert into public.responsibilities
  (slug, staff_id, description, job_kind, period_minutes, enabled)
select 'notion-sync', s.staff_id,
       'Read the Notion pages shared with the integration, so notes Grant '
       'writes there reach the team without being pasted anywhere.',
       'office.notion_sync', 120, true
  from public.staff s where s.slug = 'operations-director'
on conflict (slug) do update
  set enabled = true, job_kind = excluded.job_kind,
      period_minutes = excluded.period_minutes,
      description = excluded.description;

commit;
