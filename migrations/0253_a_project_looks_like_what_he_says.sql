-- A project looks like what he says it looks like (#83).
--
-- Grant: *"Support uploading a custom image or choosing from approximately 30
-- familiar SVG icons, with selectable icon colors."*
--
-- Three columns, and the order they fall back in is image, then icon, then the
-- generated art -- so a project nobody has touched keeps exactly the cover it
-- has today and nothing needs migrating.
--
-- ## The image is a data URL in a column, and that is deliberate
--
-- The obvious home is Supabase Storage. It is not the right one here, for a
-- reason that outranks tidiness: uploading from the browser needs a storage
-- credential IN the browser, and the studio has exactly one bearer token and
-- CLAUDE.md forbids adding an auth system. A signed-upload flow would be a
-- second credential path for a 12 KB thumbnail.
--
-- So the page resizes to 256px, encodes WebP, and sends a data URL, which is
-- capped here at 96 KB. At six dashboard projects that is at most half a
-- megabyte against a 500 MB tier currently holding 31 MB. If projects ever
-- number in the hundreds this is the wrong answer and the column becomes a
-- storage path -- the constraint below is what will make that obvious rather
-- than gradual.
--
-- The cap is a CHECK rather than a page-side guard because the page is not the
-- only possible caller, and a guard in one caller is a guard in one caller.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS icon     text,
  ADD COLUMN IF NOT EXISTS icon_hue text,
  ADD COLUMN IF NOT EXISTS image    text;

-- The palette, so an icon colour is always one a project could already be.
ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_icon_hue_known;
ALTER TABLE public.projects ADD CONSTRAINT projects_icon_hue_known
  CHECK (icon_hue is null or icon_hue in
    ('p-rust', 'p-amber', 'p-moss', 'p-slate', 'p-iris', 'p-plum'));

-- An image is a data URL and a small one. Anything else is a mistake that
-- should fail loudly at the moment it is made.
ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_image_is_small_data_url;
ALTER TABLE public.projects ADD CONSTRAINT projects_image_is_small_data_url
  CHECK (image is null or (image like 'data:image/%' and length(image) <= 98304));

-- Setting the look. Every argument is optional and null MEANS null -- clearing
-- an icon is as much a choice as picking one -- so `p_clear` says which of the
-- three the caller is actually addressing. Without it there is no way to say
-- "remove the image and leave the icon alone", which is the commonest edit
-- after "set an image".
CREATE OR REPLACE FUNCTION app.hq_project_look(
  p_slug  text,
  p_icon  text default null,
  p_hue   text default null,
  p_image text default null,
  p_clear text[] default array[]::text[]
)
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

  if p_hue is not null and p_hue not in
     ('p-rust', 'p-amber', 'p-moss', 'p-slate', 'p-iris', 'p-plum') then
    return jsonb_build_object('error', format('%s is not one of the palette colours', p_hue));
  end if;

  if p_image is not null and length(p_image) > 98304 then
    return jsonb_build_object('error',
      'that image is too large once encoded -- it is resized to 256px before it is sent, '
      || 'so an image this big means the resize did not run');
  end if;

  update public.projects
     set icon     = case when 'icon'  = any(p_clear) then null
                         else coalesce(p_icon, icon) end,
         icon_hue = case when 'hue'   = any(p_clear) then null
                         else coalesce(p_hue, icon_hue) end,
         image    = case when 'image' = any(p_clear) then null
                         else coalesce(p_image, image) end
   where project_id = v_project;

  return (
    select jsonb_build_object('ok', true, 'slug', p_slug,
             'icon', pr.icon, 'hue', pr.icon_hue,
             -- Never the image itself. It is up to 96 KB and this answer goes
             -- into a log line and a page's console.
             'image', case when pr.image is null then null else 'set' end)
      from public.projects pr where pr.project_id = v_project
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.hq_project_look(
  p_slug text, p_icon text default null, p_hue text default null,
  p_image text default null, p_clear text[] default array[]::text[]
)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
AS $function$ select app.hq_project_look(p_slug, p_icon, p_hue, p_image, p_clear) $function$;

REVOKE ALL ON FUNCTION public.hq_project_look(text, text, text, text, text[]) FROM public;
GRANT EXECUTE ON FUNCTION public.hq_project_look(text, text, text, text, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION app.hq_project_look(text, text, text, text, text[]) TO service_role;

-- And the mouth: the live definition with one line added, for the reason 0240,
-- 0246 and 0250 all record.

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
            where l.project_id = p.project_id and l.owner = 'grant') as layout,

          -- What the project LOOKS like, when he has said (#83). Null all
          -- three and the generated cover art stands, which is what every
          -- project has today.
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
