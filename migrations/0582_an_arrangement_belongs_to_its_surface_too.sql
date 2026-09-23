-- An arrangement belongs to the person AND to the surface they arranged.
--
-- ADR-0021 settled the first half in September: a layout is stored in Supabase
-- keyed by owner and dashboard project, never in `localStorage`, because Grant
-- uses more than one device and the whole point of arranging it is that it
-- stays arranged.
--
-- The experiment never got that. `web/studio/bc/layout.js` keeps the board in
-- `localStorage`, and its own Arrange panel said so out loud: "Kept on this
-- device for now. It cannot be kept in your office yet: a project holds one
-- arrangement and your current dashboard already uses it, so saving this there
-- would take panels off that." That is #341, and #299 is the reason it was
-- true.
--
-- WHY ONE ROW COULD NOT SERVE BOTH. They are not the same arrangement of the
-- same board. The studio's is three columns with heights in pixels; the
-- experiment's is twelve columns with heights in rows of 44. Same shape of
-- object, incompatible coordinates -- so a single row per (owner, project)
-- meant whichever board saved last corrupted the other.
--
-- So `surface` joins the key. Existing rows are the studio's, which is what the
-- default says, and no reader changes meaning for them.
--
-- #341, #299, ADR-0021.

alter table public.dashboard_layouts
  add column if not exists surface text not null default 'studio';

alter table public.dashboard_layouts
  drop constraint if exists dashboard_layouts_surface_known;
alter table public.dashboard_layouts
  add constraint dashboard_layouts_surface_known
  check (surface in ('studio', 'basecamp'));

alter table public.dashboard_layouts drop constraint if exists dashboard_layouts_pkey;
alter table public.dashboard_layouts
  add constraint dashboard_layouts_pkey primary key (owner, project_id, surface);

-- The writers gain the argument. `create or replace` does not replace a
-- function whose argument list changed -- it creates a second overload and
-- every call becomes ambiguous -- so the old signatures are dropped by hand
-- first, wrappers included, which is the half that is easy to forget.
drop function if exists public.hq_dashboard_layout_set(text, jsonb);
drop function if exists public.hq_dashboard_layout_reset(text);
drop function if exists app.hq_dashboard_layout_set(text, jsonb);
drop function if exists app.hq_dashboard_layout_reset(text);

create or replace function app.hq_dashboard_layout_set(
  p_slug text, p_panels jsonb, p_surface text default 'studio'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_project uuid;
begin
  select project_id into v_project from public.projects where slug = p_slug;
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
     where project_id = v_project and owner = 'grant' and surface = p_surface;
    return jsonb_build_object('ok', true, 'reset', true);
  end if;
  insert into public.dashboard_layouts (owner, project_id, surface, panels, updated_at)
  values ('grant', v_project, p_surface, p_panels, app.now_utc())
  on conflict (owner, project_id, surface)
    do update set panels = excluded.panels, updated_at = excluded.updated_at;
  return jsonb_build_object('ok', true, 'panels', jsonb_array_length(p_panels));
end;
$fn$;

create or replace function app.hq_dashboard_layout_reset(p_slug text, p_surface text default 'studio')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_project uuid;
begin
  select project_id into v_project from public.projects where slug = p_slug;
  if v_project is null then
    return jsonb_build_object('error', format('no project called %L', p_slug));
  end if;
  delete from public.dashboard_layouts
   where project_id = v_project and owner = 'grant' and surface = coalesce(p_surface, 'studio');
  return jsonb_build_object('ok', true, 'reset', true);
end;
$fn$;

create or replace function public.hq_dashboard_layout_set(
  p_slug text, p_panels jsonb, p_surface text default 'studio'
)
returns jsonb language sql security definer set search_path = ''
as $$ select app.hq_dashboard_layout_set(p_slug, p_panels, p_surface) $$;

create or replace function public.hq_dashboard_layout_reset(p_slug text, p_surface text default 'studio')
returns jsonb language sql security definer set search_path = ''
as $$ select app.hq_dashboard_layout_reset(p_slug, p_surface) $$;

grant execute on function public.hq_dashboard_layout_set(text, jsonb, text)
  to anon, authenticated, service_role;
grant execute on function public.hq_dashboard_layout_reset(text, text)
  to anon, authenticated, service_role;

-- And the payload carries both, spliced from the live definition rather than
-- retyped: this function is 142 lines and the change is one select.
CREATE OR REPLACE FUNCTION app.hq_studio_core()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  with people as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'slug', s.slug,
             'name', s.name,
             'role', s.title,
             'avatar_ref', s.avatar_ref,
             'expertise', coalesce(s.expertise, array[]::text[]),
             'state', case when j.running > 0 then 'busy' else 'idle' end,
             'doing', j.doing
           ) order by case s.slug when 'chief-of-staff' then 0 else 1 end, s.name),
           '[]'::jsonb) as v
      from public.staff s
      left join lateral (
        select count(*) as running,
               (array_agg(jj.kind order by jj.updated_at desc))[1] as doing
          from public.jobs jj
         where jj.recipient_agent = s.slug
           and jj.state in ('running', 'queued')
           and not jj.is_fixture
      ) j on true
     where s.active and s.slug not like 'fixture-%'
  ),

  projects as (
    select coalesce(jsonb_agg(t order by t.name), '[]'::jsonb) as v
      from (
        select
          p.project_id as id,
          p.slug, p.name,
          coalesce(nullif(btrim(p.purpose), ''), '') as purpose,

          coalesce((
            select array_agg(distinct app.connector_label(a.connector)
                             order by app.connector_label(a.connector))
              from public.project_attachments a
             where a.project_id = p.project_id and a.enabled
          ), array[]::text[]) as connectors,

          (select count(*)::int from public.documents d
            where d.project_id = p.project_id) as docs,
          (select count(*)::int from public.tasks tk
            where tk.project_id = p.project_id and not tk.is_fixture
              and tk.state = 'done') as done,
          (select count(*)::int from public.tasks tk
            where tk.project_id = p.project_id and not tk.is_fixture) as total,

          (select format('%s by %s', left(tk.title, 40), to_char(tk.due_on, 'FMDD Mon'))
             from public.tasks tk
            where tk.project_id = p.project_id and not tk.is_fixture
              and tk.due_on is not null and tk.state in ('todo', 'doing')
            order by tk.due_on limit 1) as next,

          app.studio_documents(p.project_id) as documents,
          app.studio_tasks(p.project_id)     as tasks,
          app.studio_sources(p.project_id)   as sources,
          app.studio_activity(p.project_id)  as activity,
          /*
            What is waiting on Grant, in the project (#151, migration 0289).

            The landing page has shown this since 0240 and a project never did,
            so the one genuinely urgent category was visible exactly where he
            could not act on it. Same view, same order — a list that disagreed
            with the banner would make "the urgent one" depend on which room he
            was standing in.
          */
          app.studio_waiting(p.project_id) as waiting,
          /*
            Real, since #71 and migration 0286. This was an honest empty literal
            because there was nowhere for a module to be written — and honest
            or not it was permanent, which is what the Issue objected to.

            It is not a new table. A module is a MILESTONE that gathers
            documents; 0286's header has the mapping and the reasoning.
          */
          app.studio_modules(p.project_id) as modules,
          -- Contacts are real now (#24, migration 0245). This was an honest
          -- empty literal because there was no table; there is one, and the
          -- function returns it in the shape the contact card already draws.
          app.studio_contacts(p.project_id) as contacts,
          -- Real work, not an empty array (0228). AI Team went honestly empty
          -- when data.js was replaced, and an empty tab because nothing was
          -- asked looks identical to one because nobody wired it.
          app.studio_requests(p.project_id) as requests,

          -- The arrangement he made, so it is his on every device (#81).
          (select l.panels from public.dashboard_layouts l
            where l.project_id = p.project_id and l.owner = 'grant'
              and l.surface = 'studio') as layout,

          -- And the experiment's, which is a DIFFERENT arrangement of a
          -- different board: twelve columns and heights in rows, where the
          -- studio's is three columns and heights in pixels. One row per
          -- surface is what #299 was waiting for; before it, saving one would
          -- have taken panels off the other.
          (select l.panels from public.dashboard_layouts l
            where l.project_id = p.project_id and l.owner = 'grant'
              and l.surface = 'basecamp') as layout_board,

          -- What the project LOOKS like, when he has said (#83).
          p.icon, p.icon_hue as "iconHue", p.image

        from public.projects p
        where p.status = 'active' and not p.is_fixture
      ) t
  ),

  waiting as (
    select case when n.blocker_id is null then null else jsonb_build_object(
             'what', n.requested_action,
             'who', coalesce(n.originating_agent, 'The team'),
             'when', to_char(n.created_at, 'FMDD Mon'),
             'slug', (select p.slug from public.projects p where p.project_id = n.project_id),
             'blocker', n.blocker_id,
             'note', case when n.work_can_continue
                          then 'Everything else on that project is carrying on.'
                          else 'Nothing else on that project moves until you answer.' end
           ) end as v
      from (select * from public.needs_me
             order by overdue desc, real_deadline nulls last limit 1) n
     union all select null limit 1
  )

  select jsonb_build_object(
    'crew', (select v from people),
    'projects', (select v from projects),
    'waiting', (select v from waiting),
    'avatar_base', (select value #>> '{}' from public.system_config
                     where key = 'staff.avatar_base_url'),
    'connectors', (select coalesce(jsonb_agg(jsonb_build_object(
                            'connector', k.connector,
                            'name', app.connector_label(k.connector),
                            'enabled', k.enabled
                          ) order by k.name), '[]'::jsonb)
                     from public.knowledge_connectors k),
    'health', (
      select jsonb_build_object(
        'stalled', coalesce(sum(s.n), 0),
        'kinds', coalesce(jsonb_agg(jsonb_build_object(
                   'kind', s.kind, 'n', s.n,
                   'oldest_minutes', s.oldest_minutes) order by s.n desc)
                 filter (where s.kind is not null), '[]'::jsonb))
        from app.jobs_stuck_queued() s
    ),
    'generated_at', app.now_utc()
  )
$function$;