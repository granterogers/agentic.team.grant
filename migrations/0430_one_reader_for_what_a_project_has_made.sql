-- One reader for what a project has made (#260).
--
-- 0429 added `app.artifacts_in`, which is `app.project_artifacts` with a kind
-- filter -- two functions answering one question, which is the duplication
-- 0311 was a whole migration spent undoing in a different vocabulary. It also
-- left `public.artifacts_in` with no caller at all, which `check:callers`
-- would have refused on the next run and rightly.
--
-- So: `project_artifacts` DELEGATES, the `public.artifacts_in` wrapper goes,
-- and the page reads the one that takes what a page has (a project) while the
-- handler reads the one that takes what a question has (a kind).
--
-- `project_artifacts` has sat in `check:callers`' baseline since the check was
-- written. Wiring it as the `artifacts` section is what takes it out.

drop function if exists public.artifacts_in(uuid, text[], integer);

create or replace function app.project_artifacts(p_project uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  -- No kinds: a page shows everything, and the filter is the question's
  -- business rather than the page's.
  select app.artifacts_in(p_project, null, 50);
$function$;

create or replace function public.project_artifacts(p_project uuid)
returns jsonb language sql security definer set search_path to ''
as $function$ select app.project_artifacts(p_project) $function$;
