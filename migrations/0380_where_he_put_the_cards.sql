begin;

-- ---------------------------------------------------------------------------
-- 0380 - where he put the cards (#25)
--
-- Grant: *"Support smooth movement around the workspace, appropriate zoom
-- controls, and persistent arrangements so the dashboard stays how I organized
-- it."*
--
-- Its own table rather than a nullable `project_id` on 0376's
-- `workspace_layouts`, for the reason 0376 already gives about itself: two
-- NULLs are distinct in a unique index, so a nullable key cannot express "the
-- one global arrangement" and "one arrangement per project" in the same table
-- without a partial index doing the work a primary key should do.
--
-- The payload is a map of node id to position, not a list of nodes. The nodes
-- come from `app.studio_plane` and change as the project does: a saved LIST
-- would go stale the moment a document is added, and a saved MAP simply has no
-- entry for the new one, which is exactly the right behaviour - it gets a
-- computed position and everything he moved stays where he moved it.
-- ---------------------------------------------------------------------------

create table if not exists public.plane_layouts (
  owner       text        not null,
  project_id  uuid        not null references public.projects(project_id) on delete cascade,
  at          jsonb       not null,
  view        jsonb       not null default '{}'::jsonb,
  updated_at  timestamptz not null default app.now_utc(),
  primary key (owner, project_id),
  constraint plane_layouts_at_is_an_object check (jsonb_typeof(at) = 'object'),
  constraint plane_layouts_view_is_an_object check (jsonb_typeof(view) = 'object')
);

comment on table public.plane_layouts is
  'Where Grant dragged each card on a project''s map, and how far he zoomed '
  '(#25, 0380). Keyed by node id rather than stored as a list, so a node the '
  'project gains later is simply absent and gets a computed position.';

create or replace function app.hq_plane_layout(p_project_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select coalesce(
    (select jsonb_build_object('at', l.at, 'view', l.view)
       from public.plane_layouts l
      where l.owner = 'grant' and l.project_id = p_project_id),
    jsonb_build_object('at', '{}'::jsonb, 'view', '{}'::jsonb))
$$;

create or replace function app.hq_plane_layout_set(p_project_id uuid, p_at jsonb, p_view jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if jsonb_typeof(p_at) is distinct from 'object' then
    return jsonb_build_object('error', 'the arrangement is a map of node id to position');
  end if;
  insert into public.plane_layouts (owner, project_id, at, view)
  values ('grant', p_project_id, p_at, coalesce(p_view, '{}'::jsonb))
  on conflict (owner, project_id) do update
    set at = excluded.at, view = excluded.view, updated_at = app.now_utc();
  return jsonb_build_object('saved', true, 'cards', (select count(*) from jsonb_object_keys(p_at)));
end;
$$;

create or replace function app.hq_plane_layout_reset(p_project_id uuid)
returns jsonb
language sql
security definer
set search_path = public, pg_catalog
as $$
  with gone as (
    delete from public.plane_layouts
     where owner = 'grant' and project_id = p_project_id
    returning 1)
  select jsonb_build_object('reset', true, 'had_one', exists (select 1 from gone))
$$;

create or replace function public.hq_plane_layout(p_project_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_catalog
as $$ select app.hq_plane_layout(p_project_id) $$;

create or replace function public.hq_plane_layout_set(p_project_id uuid, p_at jsonb, p_view jsonb)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.hq_plane_layout_set(p_project_id, p_at, p_view) $$;

create or replace function public.hq_plane_layout_reset(p_project_id uuid)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.hq_plane_layout_reset(p_project_id) $$;

revoke all on function public.hq_plane_layout(uuid) from public;
revoke all on function public.hq_plane_layout_set(uuid, jsonb, jsonb) from public;
revoke all on function public.hq_plane_layout_reset(uuid) from public;
grant execute on function public.hq_plane_layout(uuid) to service_role;
grant execute on function public.hq_plane_layout_set(uuid, jsonb, jsonb) to service_role;
grant execute on function public.hq_plane_layout_reset(uuid) to service_role;

commit;
