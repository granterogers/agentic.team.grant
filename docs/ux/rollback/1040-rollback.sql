-- ROLLBACK for migration 1040 (a layout save can say which revision it was made from; #442).
--
-- Restores the four-argument writer exactly as migration 0711 (app) and its public wrapper left it, removes the reader, the
-- revision trigger, the column and the sequence. NO ARRANGEMENT ROW IS DELETED OR CHANGED (only the rev column is dropped).
--
-- ORDER OF A ROLLBACK: roll the PAGE back first (a page that sends p_expected_rev to a database without it gets an error from
-- PostgREST and falls back to the plain save only after one failed attempt), then the gateway (the `layout` section), then run
-- this file. Before running it, read the live definitions and compare them with the ones below:
--   select pg_get_functiondef('app.hq_dashboard_layout_set(uuid,text,jsonb,text,bigint)'::regprocedure);
-- Run as one transaction.

begin;

drop function if exists public.hq_dashboard_layout_get(uuid, text, text);
drop function if exists app.hq_dashboard_layout_get(uuid, text, text);
drop function if exists public.hq_dashboard_layout_set(uuid, text, jsonb, text, bigint);
drop function if exists app.hq_dashboard_layout_set(uuid, text, jsonb, text, bigint);

create function app.hq_dashboard_layout_set(p_office uuid, p_slug text, p_panels jsonb, p_surface text DEFAULT 'studio'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_project uuid;
begin
  perform app.require_office(p_office);
  select project_id into v_project from public.projects where slug = p_slug and office_id = p_office;
  if v_project is null then
    return jsonb_build_object('error', format('no project called %L', p_slug));
  end if;
  if coalesce(p_surface, '') not in ('studio', 'basecamp') then
    return jsonb_build_object('error', format('%L is not a surface', p_surface));
  end if;
  -- ADR-0021: an empty layout is a RESET, never a stored value. `[]` cannot be
  -- told apart from a layout that failed to load, so the row goes and the
  -- default comes back -- enforced here rather than only in the page.
  if p_panels is null or jsonb_typeof(p_panels) <> 'array'
     or jsonb_array_length(p_panels) = 0 then
    delete from public.dashboard_layouts
     where project_id = v_project and owner = app.office_actor(p_office) and surface = p_surface;
    return jsonb_build_object('ok', true, 'reset', true);
  end if;
  insert into public.dashboard_layouts (owner, project_id, surface, panels, updated_at)
  values (app.office_actor(p_office), v_project, p_surface, p_panels, app.now_utc())
  on conflict (owner, project_id, surface)
    do update set panels = excluded.panels, updated_at = excluded.updated_at;
  return jsonb_build_object('ok', true, 'panels', jsonb_array_length(p_panels));
end;
$function$;
revoke all on function app.hq_dashboard_layout_set(uuid, text, jsonb, text) from public, anon, authenticated, service_role;

create function public.hq_dashboard_layout_set(p_office uuid, p_slug text, p_panels jsonb, p_surface text DEFAULT 'studio'::text)
returns jsonb language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_dashboard_layout_set(p_office, p_slug, p_panels, p_surface) $f$;
revoke all on function public.hq_dashboard_layout_set(uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.hq_dashboard_layout_set(uuid, text, jsonb, text) to service_role;

-- The reset as migration 0711 left it (1040 added only an advisory lock to it).
create or replace function app.hq_dashboard_layout_reset(p_office uuid, p_slug text, p_surface text default 'studio')
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_project uuid;
begin
  perform app.require_office(p_office);
  select project_id into v_project from public.projects where slug = p_slug and office_id = p_office;
  if v_project is null then
    return jsonb_build_object('error', format('no project called %L', p_slug));
  end if;
  delete from public.dashboard_layouts
   where project_id = v_project and owner = app.office_actor(p_office) and surface = coalesce(p_surface, 'studio');
  return jsonb_build_object('ok', true, 'reset', true);
end;
$function$;

drop trigger if exists dashboard_layouts_rev on public.dashboard_layouts;
drop function if exists app.dashboard_layouts_rev();
alter table public.dashboard_layouts drop column if exists rev;
drop sequence if exists public.dashboard_layouts_rev_seq;

-- The migration ledger row (so migrate:one / migrate can apply it again later): remove it by name.
delete from app.schema_migrations where name = '1040_a_layout_save_can_say_which_revision_it_was_made_from.sql';

commit;
