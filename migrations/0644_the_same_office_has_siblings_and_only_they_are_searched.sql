-- 0644 - which projects count as "the same office", said in one place.
--
-- Grant's decision 6: retrieval is project-first, and Claire or an agent may widen it to his OTHER projects when the
-- task genuinely needs them, with every hit saying which project it came from. Today that is one office, one person.
-- Tomorrow there may be more than one person, and the one rule that must then hold is that retrieval NEVER crosses
-- from one person's office to another's. So the question "which projects may a search from this project also reach?"
-- is answered here and nowhere else: no caller builds its own list, no caller searches "everything", and the day an
-- owner exists this is the one function that learns it.
--
--   * `app.sibling_projects(p_project)` - the active, non-fixture projects of the same office other than the one
--     asked from (a null asking project reads as the catch-all Unnamed project, as `retrieve` does), each marked
--     `account_level` when it is the catch-all that holds what belongs to no single project.
--   * `app.projects_named_in(p_text, p_project)` - the siblings the text names, by name or alias, as a whole phrase
--     of at least four characters. Naming a project is the clearest sign a question needs it.
--
-- Neither returns a document and neither searches: they only say where a search may look. The search itself stays
-- `app.search_documents`, one project at a time.

create function app.sibling_projects(p_project uuid)
returns table (project_id uuid, slug text, name text, account_level boolean)
language sql stable security definer set search_path to 'public', 'pg_catalog' as $f$
  select p.project_id, p.slug, p.name, (p.project_id = app.unnamed_project())
    from public.projects p
   where p.status = 'active'
     and not p.is_fixture
     and p.project_id is distinct from coalesce(p_project, app.unnamed_project())
     -- A test project has no office around it: a harness turn must not read a real project's documents.
     and not coalesce((select a.is_fixture from public.projects a where a.project_id = p_project), false)
$f$;

create function app.projects_named_in(p_text text, p_project uuid)
returns table (project_id uuid, slug text, name text, account_level boolean)
language sql stable security definer set search_path to 'public', 'pg_catalog' as $f$
  select s.project_id, s.slug, s.name, s.account_level
    from app.sibling_projects(p_project) s
   where exists (
     select 1
       from (select s.name as phrase
             union
             select a.alias from public.project_aliases a where a.project_id = s.project_id) n
      where length(btrim(n.phrase)) >= 4
        and lower(coalesce(p_text, '')) ~ ('\m' || regexp_replace(lower(btrim(n.phrase)), '([^a-z0-9 ])', '\\\1', 'g') || '\M')
   )
$f$;
