-- 1102 — the catch-all project is called "Conversations", everywhere (naming, 20 November 2026)
--
-- The interface has shown this reserved project as "Conversations" (web/studio/data.js), but the stored name was "Unnamed",
-- and the agents were given that stored name: they answered "Unnamed" while the page said "Conversations". One name for it
-- now, in the database, so the page and the agents agree. The slug stays "unnamed": app.unnamed_project() and every
-- reference to it use the slug, so nothing that finds the project changes.
--
-- Idempotent: running it again changes nothing.

begin;

update public.projects
   set name = 'Conversations'
 where slug = 'unnamed'
   and name <> 'Conversations';

commit;
