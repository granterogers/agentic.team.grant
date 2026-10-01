-- SAFE ONLY TOGETHER WITH THE CODE ROLLBACK: the worker that shipped with this migration calls what it removes. A
-- database-only rollback leaves a worker that fails (0640/0643) or degrades to its own project (0644) or reports that it
-- could not offer the teaching (0645); roll the worker back to the previous version first, then run this.
-- Rollback of 0644: retrieval returns to one project at a time (the retrieval code catches the missing function and answers from the asking project alone, but the OTHER callers noted below do not).
begin;
drop function app.projects_named_in(text, uuid);
drop function app.sibling_projects(uuid);
commit;
