-- The arrangement is his, not the browser's (#81).
--
-- Grant asked for a customisable project dashboard and was explicit about
-- where the arrangement lives: *"Layout is per person, per dashboard project,
-- and persists. Not `localStorage`: he uses more than one device and the whole
-- point of arranging it is that it stays arranged."*
--
-- The prototype kept it in `localStorage`, which meant a dashboard he composed
-- on the laptop was the default arrangement again on the phone.
--
-- ## One row per person per dashboard project
--
-- `owner` is text and defaults to 'grant'. There is one bearer token and no
-- user system, and CLAUDE.md forbids adding one -- so this is not pretending
-- to be authentication. It is the column the table needs the day there is
-- more than one person, put in now because adding a key column to a primary
-- key later is the migration nobody wants to write.
--
-- ## The panels are jsonb, deliberately
--
-- A panel is `{id, x, y, w, h}` and the set of kinds is defined in
-- `web/studio/panels.js`. Modelling five integers as five columns would put
-- the page's layout vocabulary in the schema, and every new panel property --
-- a colour, a collapsed flag -- would then be a migration. The shape is
-- checked where it is written instead.

CREATE TABLE IF NOT EXISTS public.dashboard_layouts (
  project_id  uuid        not null references public.projects(project_id) on delete cascade,
  owner       text        not null default 'grant',
  panels      jsonb       not null,
  updated_at  timestamptz not null default now(),
  primary key (owner, project_id),
  -- An array, and not an empty one: saving `[]` is what "remove the last
  -- panel" produces, and a stored empty array is indistinguishable from a
  -- layout that failed to load. Removing every panel resets instead.
  constraint dashboard_layouts_panels_is_array
    check (jsonb_typeof(panels) = 'array' and jsonb_array_length(panels) > 0)
);

ALTER TABLE public.dashboard_layouts ENABLE ROW LEVEL SECURITY;

-- Set the arrangement for one dashboard project.
--
-- Takes the SLUG, because that is what the page has -- and resolves it here
-- rather than trusting a project_id from a browser. `p_panels` is validated
-- for shape: every entry must carry an id and four numbers, or nothing is
-- written. A layout that half-saved would be worse than one that did not.
CREATE OR REPLACE FUNCTION app.hq_dashboard_layout_set(p_slug text, p_panels jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_project uuid;
  v_bad     int;
begin
  select project_id into v_project
    from public.projects
   where slug = p_slug and status = 'active';
  if v_project is null then
    return jsonb_build_object('error', format('no active dashboard project called %s', p_slug));
  end if;

  if jsonb_typeof(p_panels) <> 'array' then
    return jsonb_build_object('error', 'panels must be an array');
  end if;

  -- Nothing left on the board is a reset, not a layout.
  if jsonb_array_length(p_panels) = 0 then
    delete from public.dashboard_layouts
     where project_id = v_project and owner = 'grant';
    return jsonb_build_object('ok', true, 'panels', 0, 'note', 'the board was emptied, so it is back to its default');
  end if;

  select count(*) into v_bad
    from jsonb_array_elements(p_panels) e
   where jsonb_typeof(e) <> 'object'
      or jsonb_typeof(e -> 'id') <> 'string'
      or jsonb_typeof(e -> 'x') <> 'number'
      or jsonb_typeof(e -> 'y') <> 'number'
      or jsonb_typeof(e -> 'w') <> 'number'
      or jsonb_typeof(e -> 'h') <> 'number';
  if v_bad > 0 then
    return jsonb_build_object('error',
      format('%s panel(s) are not {id, x, y, w, h} -- nothing was saved', v_bad));
  end if;

  insert into public.dashboard_layouts (project_id, owner, panels, updated_at)
  values (v_project, 'grant', p_panels, now())
  on conflict (owner, project_id)
    do update set panels = excluded.panels, updated_at = now();

  return jsonb_build_object('ok', true, 'panels', jsonb_array_length(p_panels));
end;
$function$;

-- Put it back to the default: forget the row, do not store an empty one.
CREATE OR REPLACE FUNCTION app.hq_dashboard_layout_reset(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_project uuid;
begin
  select project_id into v_project
    from public.projects
   where slug = p_slug and status = 'active';
  if v_project is null then
    return jsonb_build_object('error', format('no active dashboard project called %s', p_slug));
  end if;
  delete from public.dashboard_layouts
   where project_id = v_project and owner = 'grant';
  return jsonb_build_object('ok', true);
end;
$function$;

-- PostgREST only exposes `public`, so every app.* RPC needs a wrapper. Bitten
-- often enough that it is in CLAUDE.md.
CREATE OR REPLACE FUNCTION public.hq_dashboard_layout_set(p_slug text, p_panels jsonb)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
AS $function$ select app.hq_dashboard_layout_set(p_slug, p_panels) $function$;

CREATE OR REPLACE FUNCTION public.hq_dashboard_layout_reset(p_slug text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
AS $function$ select app.hq_dashboard_layout_reset(p_slug) $function$;

-- And the mouth. The live `pg_get_functiondef` output with one column added,
-- for the reason 0240 and 0246 both record: rewriting a function of this size
-- from memory is how the first attempt at that one failed on a column that
-- does not exist.

CREATE OR REPLACE FUNCTION app.hq_studio()
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

          -- Honestly empty. Contacts have no table (#24) and modules have none
          -- either; both are in the canonical IA. Returning something plausible
          -- would be a dashboard that invents a client.
          '[]'::jsonb as modules,
          -- Contacts are real now (#24, migration 0245). This was an honest
          -- empty literal because there was no table; there is one, and the
          -- function returns it in the shape the contact card already draws.
          app.studio_contacts(p.project_id) as contacts,
          -- Real work, not an empty array (0228). AI Team went honestly empty
          -- when data.js was replaced, and an empty tab because nothing was
          -- asked looks identical to one because nobody wired it.
          app.studio_requests(p.project_id) as requests,

          -- The arrangement he made, so it is his on every device (#81).
          -- `localStorage` was the prototype's answer and Grant named it as
          -- the wrong one: he uses more than one machine and the whole point
          -- of arranging a dashboard is that it stays arranged. Null when he
          -- has never moved anything, which is how `panels.js` knows to draw
          -- the default rather than an empty board.
          (select l.panels from public.dashboard_layouts l
            where l.project_id = p.project_id and l.owner = 'grant') as layout

        from public.projects p
        where p.status = 'active' and not p.is_fixture
      ) t
  ),

  waiting as (
    select case when n.blocker_id is null then null else jsonb_build_object(
             'what', n.requested_action,
             'who', coalesce(n.originating_agent, 'The team'),
             'when', to_char(n.created_at, 'FMDD Mon'),
             -- Where it is (#105). Without these the button on the busiest
             -- line in the interface had nothing to navigate to: the payload
             -- carried what, who, when and note, and no reference to anything.
             -- `needs_me` has had project_id all along; it never travelled.
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
    -- What the page may offer to change. Read from the same place the API
    -- enforces it, so a button that cannot work is never drawn.
    'connectors', (select coalesce(jsonb_agg(jsonb_build_object(
                            'connector', k.connector,
                            'name', app.connector_label(k.connector),
                            'enabled', k.enabled
                          ) order by k.name), '[]'::jsonb)
                     from public.knowledge_connectors k),
    'generated_at', app.now_utc()
  )
$function$;
