-- 1112 — app.references_in refuses an office that is null or does not exist, like every other office function (gate fix, 21 November 2026)
--
-- It was a SQL function that answered a null office with no rows. Every other office function refuses it with no_office
-- (app.require_office). The query is unchanged; the office check now comes first. No grant is added: it was never
-- executable by the service role, and the ownership rules keep it that way.

create or replace function app.references_in(p_office uuid, p_text text)
returns table(project_id uuid, slug text, name text, connector text, external_ref text)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  perform app.require_office(p_office);
  return query
with found as (
    select lower(m[1]) as ref
      from regexp_matches(
             coalesce(p_text, ''),
             '([0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12})',
             'g'
           ) as m
    union
    select lower(m[1] || '/' || m[2])
      from regexp_matches(
             coalesce(p_text, ''),
             '(?:github\.com[/:])?([A-Za-z0-9][\w-]{0,38})/([\w.-]{1,100}?)(?:\.git)?(?=[\s,)\]]|$)',
             'g'
           ) as m
  ),
  candidates as (
    select ref from found
    union
    select replace(ref, '-', '') from found
  )
  select distinct p.project_id, p.slug, p.name, a.connector, a.external_ref
    from public.project_attachments a
    join public.projects p on p.project_id = a.project_id
   where p.office_id = app.require_office(p_office)
     and p.status = 'active'
     and not p.is_fixture
     and a.enabled
     and (
       lower(a.external_ref) in (select ref from candidates)
       or replace(lower(a.external_ref), '-', '') in (select ref from candidates)
     );
end
$function$;

revoke all on function app.references_in(uuid, text) from public, anon, authenticated;
