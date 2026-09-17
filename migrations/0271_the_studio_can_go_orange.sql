-- 0271 — the studio can go orange
--
-- Issue #112's last clause: *"the live half also wants a red light in the
-- studio."*
--
-- 0270 taught `app.office_health()` to count jobs nobody has taken. Nothing
-- read it. The studio's payload carried the crew, the projects, what is waiting
-- on Grant and the connectors — and no health at all — so the state that went
-- unnoticed for eight hours would go unnoticed again, one layer further along.
--
-- That is #72's shape, produced a second time by the same issue: the mechanism
-- gets built, and the mouth does not.
--
-- The body below is `pg_get_functiondef` output with one key added. Rewriting a
-- function this size from memory is how a payload loses a section nobody
-- notices for a week.

begin;

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
    /*
      Whether the office is keeping up (#112, migration 0270).

      Only what a warning needs: how many nobody has taken, of what kind, and
      how long the oldest has waited. `finished` and the window belong on the
      Usage screen and would make this payload bigger on every single load.

      In THIS payload rather than a second fetch, because a second fetch is a
      second thing that can fail on its own -- and the way it fails is by
      quietly returning nothing, which renders as no warning, which is
      indistinguishable from a healthy office. The one state this must never
      have.
    */
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

commit;
