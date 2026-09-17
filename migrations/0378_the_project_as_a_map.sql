begin;

-- ---------------------------------------------------------------------------
-- 0378 - the project dashboard as a living map (#25)
--
-- Grant, 15 September 2026, verbatim in
-- `docs/spec/project-dashboard-design-direction-2026-09-15.md`:
--
--   "I want to see my agents, their connected third-party services, and the
--   tasks and documents associated with their work, understand how they
--   relate, and interact with them directly."
--
--   "Make meaningful relationships visible through clear connection lines, so I
--   can understand which agents use which services and how their work
--   connects."
--
-- and the line that decides how this function is written:
--
--   "Use existing project data and functionality. Items should open real tasks
--   and documents, statuses should reflect actual activity, and connections
--   should represent supported relationships."
--
--   "Drawing a connection must not falsely imply that access has been granted
--   or setup has succeeded."
--
-- ## Why one function rather than a graph table
--
-- 0310 settled this argument already and its reasoning applies unchanged:
-- `public.relations` holds only what no column expresses, and everything else
-- is DERIVED, because a copy of a fact is the one that rots. Every edge below
-- is read from the column that already holds it:
--
--   agent -> document   documents.produced_by_job -> jobs.recipient_agent
--   agent -> task       tasks.assignee_staff -> staff.slug
--   service -> document documents.connector + external_parent_ref
--   agent -> service    DERIVED transitively, and labelled as derived
--
-- The last one is the one Grant actually asked to see, and it is the only one
-- no column holds. It is honest because it is computed from two edges that
-- are real - this agent wrote that document, and that document came from that
-- source - and it carries `derived: true` plus the sentence explaining it, so
-- the interface can say so rather than drawing a line that implies a
-- credential.
--
-- ## The states
--
-- Never colour alone (§30 of the QA standard, and Grant's own "keep status
-- understandable without colour alone"). Every node carries a WORD.
--
--   agent    working / needs attention / done / idle
--   service  connected / needs attention / not connected
--   task     blocked / open / done
--   document ready
--
-- A service's health comes from `connection_health`, whose vocabulary is
-- service NAMES ("Google", "Notion") while an attachment carries a CONNECTOR
-- ("drive", "notion"). Where the two cannot be matched confidently the state
-- is `connected` with a null detail rather than a guess - 0177's sentinel
-- lesson: a value that satisfies the shape and lies is worse than a null.
-- ---------------------------------------------------------------------------

create or replace function app.studio_plane(p_project_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
with
-- Which staff have actually touched this project. Not the whole roster: a map
-- of eight people where three have ever done anything is a map of the org
-- chart, and Grant asked for a map of the project.
touched as (
  select distinct s.staff_id, s.slug, s.name, s.title
    from public.staff s
   where exists (select 1 from public.jobs j
                  where j.project_id = p_project_id and j.recipient_agent = s.slug
                    and not coalesce(app.harness_job(j.job_id), false))
      or exists (select 1 from public.tasks t
                  where t.project_id = p_project_id and t.assignee_staff = s.staff_id
                    and not coalesce(t.is_fixture, false))
      or exists (select 1 from public.documents d
                  join public.jobs j2 on j2.job_id = d.produced_by_job
                 where d.project_id = p_project_id and j2.recipient_agent = s.slug)
),
agent_state as (
  select t.*,
         (select count(*) from public.jobs j
           where j.project_id = p_project_id and j.recipient_agent = t.slug
             and j.state not in ('complete','cancelled','failed')) as live,
         (select count(*) from public.job_impediments i
           where i.project_id = p_project_id and i.staff_slug = t.slug
             and not coalesce(i.is_fixture, false)) as walls,
         (select count(*) from public.documents d
           join public.jobs j3 on j3.job_id = d.produced_by_job
          where d.project_id = p_project_id and j3.recipient_agent = t.slug) as made
    from touched t
),
agents as (
  select jsonb_build_object(
           'id',    'agent:' || a.slug,
           'kind',  'agent',
           'ref',   a.slug,
           'name',  a.name,
           'sub',   a.title,
           'state', case when a.live  > 0 then 'working'
                         when a.walls > 0 then 'needs attention'
                         when a.made  > 0 then 'done'
                         else 'idle' end,
           'says',  case when a.live  > 0 then a.live::text  || ' in hand'
                         when a.walls > 0 then a.walls::text || ' could not be done'
                         when a.made  > 0 then a.made::text  || ' made'
                         else 'nothing yet' end
         ) as n, a.slug
    from agent_state a
),
-- The project's own attachments. `ref_kind` separates a live connector from a
-- reference (0306, #35): a bookmark never fails and nothing syncs it, so it
-- must not be drawn as a connection that could be healthy.
attach as (
  select pa.attachment_id, pa.connector, pa.external_ref, pa.display_name,
         pa.external_url, pa.enabled, pa.last_synced_at,
         coalesce(pa.ref_kind, 'connector') as ref_kind,
         (select ch.state from public.connection_health ch
           where lower(ch.service) = case pa.connector
                                       when 'drive'      then 'google'
                                       when 'notion'     then 'notion'
                                       when 'github'     then 'github'
                                       when 'notebooklm' then 'google'
                                       else null end
           limit 1) as health
    from public.project_attachments pa
   where pa.project_id = p_project_id
),
services as (
  select jsonb_build_object(
           'id',    'service:' || a.attachment_id::text,
           'kind',  case when a.ref_kind = 'connector' then 'service' else 'reference' end,
           'ref',   a.attachment_id::text,
           'name',  coalesce(nullif(a.display_name, ''), a.connector),
           'sub',   a.connector,
           'url',   a.external_url,
           'state', case when a.ref_kind <> 'connector'  then 'a pointer'
                         when a.enabled is not true      then 'not connected'
                         when a.health = 'failing'       then 'needs attention'
                         else 'connected' end,
           -- The page already turns a timestamp into "6 minutes ago" everywhere
           -- else (`when.words`), so this hands over the instant and not a
           -- sentence. Two places that phrase the same fact is how a product
           -- ends up with two vocabularies for one thing (0311).
           'says',  case when a.ref_kind <> 'connector' then 'nothing reads this'
                         when a.last_synced_at is null  then 'never read'
                         else null end,
           'at',    a.last_synced_at
         ) as n, a.attachment_id, a.connector, a.external_ref
    from attach a
),
open_tasks as (
  select t.task_id, t.title, t.state, t.assignee_staff, t.due_on,
         jsonb_build_object(
           'id',    'task:' || t.task_id::text,
           'kind',  'task',
           'ref',   t.task_id::text,
           'name',  t.title,
           'sub',   case when t.due_on is null then null else 'due ' || to_char(t.due_on, 'FMDD Mon') end,
           'state', case when t.state = 'done' then 'done'
                         when t.blocked_on is not null then 'blocked'
                         else 'open' end,
           'says',  t.state
         ) as n
    from public.tasks t
   where t.project_id = p_project_id
     and not coalesce(t.is_fixture, false)
     and t.state <> 'done'
   order by t.due_on nulls last, t.created_at desc
   limit 12
),
recent_docs as (
  select d.document_id, d.title, d.connector, d.external_parent_ref,
         d.produced_by_job, d.produced_by,
         jsonb_build_object(
           'id',    'doc:' || d.document_id::text,
           'kind',  'document',
           'ref',   d.document_id::text,
           'name',  d.title,
           'sub',   nullif(d.produced_by, ''),
           'state', 'ready',
           'says',  coalesce(d.doc_type, 'document')
         ) as n
    from public.documents d
   where d.project_id = p_project_id
     and coalesce(d.state, 'live') <> 'superseded'
   order by d.updated_at desc nulls last
   limit 12
),
-- --- the edges, each read from the column that already holds it -------------
e_made as (
  select jsonb_build_object('from', 'agent:' || j.recipient_agent,
                            'to',   'doc:' || d.document_id::text,
                            'verb', 'produced', 'derived', false) as e,
         j.recipient_agent as slug, d.document_id
    from recent_docs d
    join public.jobs j on j.job_id = d.produced_by_job
   where j.recipient_agent is not null
     and exists (select 1 from agents a where a.slug = j.recipient_agent)
),
e_task as (
  select jsonb_build_object('from', 'agent:' || s.slug,
                            'to',   'task:' || t.task_id::text,
                            'verb', 'assigned_to', 'derived', false) as e
    from open_tasks t
    join public.staff s on s.staff_id = t.assignee_staff
   where exists (select 1 from agents a where a.slug = s.slug)
),
e_from as (
  select jsonb_build_object('from', 'service:' || sv.attachment_id::text,
                            'to',   'doc:' || d.document_id::text,
                            'verb', 'came_from', 'derived', false) as e,
         sv.attachment_id, d.document_id
    from recent_docs d
    join services sv
      on sv.connector = d.connector
     and (d.external_parent_ref is null or d.external_parent_ref = sv.external_ref)
),
-- The one Grant asked for, and the only one no column holds. Derived from two
-- real edges and labelled as such, so the interface can say WHY the line is
-- there rather than implying a credential.
e_uses as (
  select distinct jsonb_build_object(
           'from', 'agent:' || m.slug,
           'to',   'service:' || f.attachment_id::text,
           'verb', 'uses', 'derived', true,
           'because', 'wrote something that came from here') as e
    from e_made m
    join e_from f on f.document_id = m.document_id
)
select jsonb_build_object(
  'nodes', coalesce((select jsonb_agg(x.n) from (
             select n from agents
             union all select n from services
             union all select n from open_tasks
             union all select n from recent_docs) x), '[]'::jsonb),
  'edges', coalesce((select jsonb_agg(y.e) from (
             select e from e_made
             union all select e from e_task
             union all select e from e_from
             union all select e from e_uses) y), '[]'::jsonb)
)
$$;

comment on function app.studio_plane(uuid) is
  'The project as a graph the dashboard can draw (#25): agents who have '
  'actually worked here, the project''s own attachments, its open tasks and '
  'recent documents, and the edges between them. Every edge is DERIVED from '
  'the column that already holds the fact (0310''s rule); the one edge that no '
  'column holds - which agent uses which service - is computed from two real '
  'edges and carries derived=true plus the sentence that explains it, because '
  'a line that implies a credential nobody granted is the failure Grant named.';

create or replace function public.studio_plane(p_project_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_catalog
as $$ select app.studio_plane(p_project_id) $$;

revoke all on function public.studio_plane(uuid) from public;
grant execute on function public.studio_plane(uuid) to service_role;

commit;
