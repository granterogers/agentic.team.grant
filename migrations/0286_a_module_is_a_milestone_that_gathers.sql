-- 0286 — a module is a milestone that gathers, not a table
--
-- Issue #71.
--
-- ## What the issue asked for, and why the answer is different
--
-- > A `public.modules` table, keyed to a dashboard project, with whatever the
-- > IA says a module carries — read the specification, do not infer the columns
-- > from the tab.
--
-- Read it. The canonical IA — `docs/spec/project-dashboard-ia-2026-09-10.md` —
-- **does not contain the word "module" anywhere.** The frontend prompt does,
-- once, and means something else by it:
--
--   > *"Potential modules include: Overview, Current focus, Documents, Tasks,
--   > Milestones, Important dates, Notes, Research, Links, Decisions, Agent
--   > activity, Generated artifacts, Recommendations, History. Modules should
--   > be optional. Do not overwhelm every project with every possible module."*
--
-- Those are the PANELS of the project dashboard, and they are built: #81 and
-- migration 0250, `web/studio/panels.js`, `public.dashboard_layouts`. "Modules
-- should be optional" is the arrangement Grant composes per project.
--
-- So the section the studio renders is a THIRD thing, and the prototype says
-- what it is: numbered, named parts of the work with a state and counts —
--
--   { n: 1, name: 'Legacy Opening Assessment', state: 'done', docs: 2, tasks: 4 }
--
-- — which is the curriculum `office.notion_import` builds for the Legacy
-- Coaching Course. A named part of a project's work, with a state, gathering
-- documents and tasks.
--
-- ## Every piece of that already exists
--
-- CLAUDE.md, and #169's whole point:
--
--   > *Before inventing a noun — Skill, Capability, Tool, Plugin, Action,
--   > Integration, Agent, Workflow, Task, Evaluator — check whether this office
--   > already has one. It has all ten.*
--
--   | a module has        | the office already calls it                    |
--   |---------------------|------------------------------------------------|
--   | a name and an order | `tasks.title`, `tasks.priority`                |
--   | a state             | `tasks.state` — todo / doing / done            |
--   | its own tasks       | `tasks.parent_task_id`                         |
--   | being a heading     | `tasks.is_milestone`                           |
--   | its documents       | `collections` + `document_collections`         |
--
-- A `public.modules` table would be a twelfth column set restating eleven
-- existing ones, a second place a name and a state can disagree, and a task
-- that belongs to a module in one table and to a parent in another.
--
-- **A module is a milestone task that gathers documents.** The only thing
-- missing is the join between the two, and that is one nullable column.
--
-- ## Which side the column goes on
--
-- On `collections`, not on `tasks`. A collection can exist with no milestone —
-- it is a folder of documents and always was — while `tasks` already carries
-- twenty columns and is the busier table. "This folder belongs to that
-- milestone" also reads the right way round.
--
-- ## What this does NOT do
--
-- It adds no write action, because there is nothing to add: `task_add` makes
-- the task and `task_update` sets `p_milestone`. Both have existed since 0238
-- and both are already in `hq-api`'s action list. What was missing was a page
-- willing to draw the result, which is the other half of this Issue and lives
-- in `web/studio/app.js`.

begin;

alter table public.collections
  add column if not exists for_task_id uuid
    references public.tasks (task_id) on delete set null;

comment on column public.collections.for_task_id is
  '#71. The milestone whose documents these are, when the collection is a '
  'module''s shelf rather than a folder Grant made. `set null` on delete: '
  'losing the milestone must not destroy the documents'' grouping — ADR-0013''s '
  'rule that a route may close and the corpus is kept, one level down.';

/*
  One shelf per milestone.

  Two collections both claiming to be a module's documents is a module whose
  document count depends on which one the query happened to join, and there is
  no reading under which that is what somebody meant. Partial, so the many
  collections that are not a module's shelf are unaffected.
*/
create unique index if not exists collections_one_shelf_per_task
  on public.collections (for_task_id)
  where for_task_id is not null;

-- ---------------------------------------------------------------------------
-- What the page draws
-- ---------------------------------------------------------------------------

/**
 * A project's modules: its milestones, with what each one gathers.
 *
 * Derived rather than stored, which is the whole decision above. The counts are
 * computed at read time and therefore cannot drift from the tasks and documents
 * they count — a stored `docs` integer is wrong the first time somebody files a
 * document and forgets to bump it.
 *
 * `n` is the position, one-based, so the page can print "1" without inventing
 * it from an array index that changes when a milestone is reordered.
 */
create or replace function app.studio_modules(p_project_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.task_id,
           'n', m.n,
           'name', m.title,
           /*
             A module's state is its own, not its children's average.

             Deliberately: Grant ticks a milestone when the module is done, and
             deriving it from the children would mean a module with four tasks
             and one still open can never read Done however finished it is. The
             children are counted beside it, which is the honest way to show
             the same information.
           */
           'state', case m.state when 'done' then 'done'
                                 when 'doing' then 'doing'
                                 when 'blocked' then 'doing'
                                 else 'todo' end,
           'docs', m.docs,
           'tasks', m.tasks
         ) order by m.n), '[]'::jsonb)
    from (
      select tk.task_id, tk.title, tk.state,
             row_number() over (order by tk.priority desc nulls last,
                                         tk.due_on nulls last, tk.created_at) as n,
             (select count(*)::int
                from public.collections c
                join public.document_collections dc on dc.collection_id = c.collection_id
               where c.for_task_id = tk.task_id) as docs,
             (select count(*)::int from public.tasks ch
               where ch.parent_task_id = tk.task_id and not ch.is_fixture) as tasks
        from public.tasks tk
       where tk.project_id = p_project_id
         and tk.is_milestone
         and not tk.is_fixture
    ) m
$$;

comment on function app.studio_modules is
  '#71. A module is a milestone task that gathers documents — see 0286 for why '
  'this is derived and not a table. The counts are computed here so they cannot '
  'drift from what they count.';

create or replace function public.studio_modules(p_project_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_catalog
as $$ select app.studio_modules(p_project_id) $$;

grant execute on function app.studio_modules(uuid) to ai_team_app;
grant execute on function public.studio_modules(uuid) to ai_team_app;

-- ---------------------------------------------------------------------------
-- And the literal in hq_studio stops being a literal
-- ---------------------------------------------------------------------------
--
-- Patched from `pg_get_functiondef`. One line changes: the honestly-empty
-- `'[]'::jsonb as modules` — honest when there was nowhere for a module to be
-- written, and permanent for the same reason — becomes the call.
--
-- `hq_studio` is the wrapper 0285 added; this is `hq_studio_core`, the function
-- 0222 built section by section.

create or replace function app.hq_studio_core()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $function$
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
