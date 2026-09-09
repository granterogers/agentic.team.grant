-- The old signature was still answering.
--
-- 0153 gave `hq_create_project` a fifth parameter, `p_force`, using
-- `create or replace`. That does not replace anything when the argument list
-- changes — it creates a SECOND function beside the first, and Postgres then
-- has two candidates for a three-argument call:
--
--     ERROR: function app.hq_create_project(unknown, unknown, unknown)
--            is not unique
--
-- Caught by `verify:identity` on its first run, which is the check earning its
-- keep: every path that creates a project from the dashboard was broken by
-- 0153 and nothing in the unit tests could have noticed, because the fault is
-- in the catalogue rather than in any file.
--
-- 0153 got this right for `app.resolve_project` — it drops the three-argument
-- form before creating the four-argument one, with a comment explaining why —
-- and then made the identical mistake sixty lines further down. The lesson is
-- not "remember to drop"; it is that a widened signature is a DROP and a
-- CREATE, and `create or replace` reads like it handles that and does not.
--
-- ## And the wrapper, which mattered more
--
-- `public.hq_create_project` is the one the dashboard actually reaches, because
-- PostgREST exposes only `public`. It was still the four-argument version, and
-- its body still called the four-argument `app` function — so even once the
-- ambiguity was resolved, a page passing `p_force: true` would have had it
-- silently dropped on the floor, and "no, it really is a new project" would
-- have done nothing at all.
--
-- A quiet no-op is worse than the error above. The error stopped a test; this
-- would have stopped Grant, in the middle of the one flow 0153 exists to fix.

begin;

-- The superseded forms. Dropped by exact signature rather than by name, so a
-- typo removes nothing instead of removing everything.
drop function if exists app.hq_create_project(text, text, text, text);
drop function if exists public.hq_create_project(text, text, text, text);

-- The wrapper, forwarding every argument including the new one. `p_display`
-- and `p_force` both keep their defaults, so an existing three-argument caller
-- is unaffected and gets the ask-first behaviour, which is the default 0153
-- wanted everywhere.
create or replace function public.hq_create_project(
  p_name      text,
  p_connector text,
  p_ref       text,
  p_display   text default null,
  p_force     boolean default false
)
returns jsonb
language sql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select app.hq_create_project(p_name, p_connector, p_ref, p_display, p_force)
$function$;

commit;
