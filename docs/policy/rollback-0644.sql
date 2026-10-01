-- Rollback of 0644: retrieval returns to one project at a time (the caller falls back to no expansion).
begin;
drop function app.projects_named_in(text, uuid);
drop function app.sibling_projects(uuid);
commit;
