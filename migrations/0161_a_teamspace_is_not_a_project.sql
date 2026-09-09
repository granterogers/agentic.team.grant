-- A teamspace is not a project.
--
-- Grant, setting out the canonical hierarchy:
--
--     Agentic Team
--       → top-level project / domain      (Money Mastery, Wellness, AI Team HQ)
--         → Notion Teamspace
--           → Notion Projects             (Plugin Architecture, Retreat Planning)
--             → tasks, pages, research, documentation
--
-- and the rule that goes with it: *"Do not reorganize the Agentic Team's
-- conceptual model merely to match Notion's terminology. Notion is an external
-- service connected to the Agentic Team. The Agentic Team's project model
-- remains canonical, and the integration layer maps that model onto Notion."*
--
-- He also named the specific smell: `notion.project_slug` holding something
-- that is not a project slug. *"Configuration and database fields must use
-- terminology that reflects what they actually reference."*
--
-- ## What the API can actually address, which changes the answer
--
-- He asked for the mapping to use Notion's stable identifier for the teamspace.
-- Probed before designing, the way §9 taught:
--
--     GET /v1/teamspaces                    404/403 — no such endpoint
--     search, Notion-Version 2022-06-28     no teamspace field anywhere
--     search, Notion-Version 2025-09-03     no teamspace field anywhere
--     top-level databases                   parent: {"type":"workspace"}
--
-- **Notion's public API does not expose teamspaces.** They cannot be listed,
-- created, or named as a parent. A database sitting inside a teamspace reports
-- its parent as the workspace, and the teamspace it lives in is invisible.
--
-- So a column called `notion_teamspace_id` would be the exact mistake he
-- objected to, one level along: a field named for something it does not
-- contain. There is no id to put in it.
--
-- ## What is stored instead
--
-- The teamspace by NAME, because that is genuinely all Notion will tell us and
-- a human-readable label he chose is honest — and, separately, the ids of the
-- databases inside it, because those are what the API can actually read and
-- write. The mapping survives a teamspace rename in the only way available:
-- the database ids are stable and they are what the work goes through.
--
-- The database-per-purpose model already existed and already fits. A Notion
-- attachment with `role = 'home'` and `artifact_kind = 'task'` IS the Tasks
-- database for that project, and `project_attachments_one_home_per_kind`
-- already enforces one of each. Nothing new was needed there, which is the
-- point of checking before building.
--
-- ## Agents are not scoped to a teamspace
--
-- *"Agents may work across multiple Notion Teamspaces. They must not assume
-- that the Teamspace in which they are currently operating defines their
-- identity, role, or permanent scope."*
--
-- Nothing in `staff` carries a teamspace today, so there is nothing to undo —
-- the value here is writing the rule down beside the schema so the next person
-- who wants a `staff.teamspace` column meets an argument rather than an empty
-- field.

begin;

-- ---------------------------------------------------------------------------
-- The misnamed key
-- ---------------------------------------------------------------------------
--
-- Never held a value: the duty asked every two hours for days and refused to
-- guess, which is the only reason removing it is free.

delete from public.system_config where key = 'notion.project_slug';

-- ---------------------------------------------------------------------------
-- What an external_ref actually IS
-- ---------------------------------------------------------------------------
--
-- The API call differs by kind — a database is queried, a page has blocks
-- appended, a data source is the 2025-09-03 name for what used to be a
-- database. Storing the id without the kind means guessing at the call site.

alter table public.project_attachments
  add column if not exists ref_kind text;

alter table public.project_attachments
  drop constraint if exists project_attachments_ref_kind_known;
alter table public.project_attachments
  add constraint project_attachments_ref_kind_known
  check (ref_kind is null or ref_kind in ('database', 'data_source', 'page', 'notebook', 'repository'));

comment on column public.project_attachments.ref_kind is
  'What external_ref names, because the API call depends on it: a Notion '
  'database is queried, a page has blocks appended, a repository is read by '
  'owner/name. Null on older rows that predate 0161.';

-- Backfill what is already known from the connector.
update public.project_attachments set ref_kind = 'notebook'
 where connector = 'notebooklm' and ref_kind is null;
update public.project_attachments set ref_kind = 'repository'
 where connector = 'github' and ref_kind is null;

-- ---------------------------------------------------------------------------
-- The teamspace, by the only handle Notion gives us
-- ---------------------------------------------------------------------------

alter table public.projects
  add column if not exists notion_teamspace_name text;

comment on column public.projects.notion_teamspace_name is
  'The Notion Teamspace this top-level project corresponds to, BY NAME — '
  'because Notion''s public API exposes no teamspace id, no teamspace endpoint, '
  'and reports a teamspace''s contents as children of the workspace (probed '
  '2026-09-09, API versions 2022-06-28 and 2025-09-03). The durable handles are '
  'the database ids in project_attachments; this is the label a person uses. '
  'Deliberately not called *_id: there is no id to hold (0161).';

-- ---------------------------------------------------------------------------
-- The hierarchy, written where the code will look
-- ---------------------------------------------------------------------------

insert into public.system_config (key, value, description)
values (
  'notion.hierarchy',
  to_jsonb(
    'Agentic project = Notion Teamspace; Notion Project = an initiative inside it'::text
  ),
  'Agentic Team → top-level project → Notion Teamspace → Notion Projects → '
  'tasks, pages, research, docs. A Notion "Project" is an initiative or '
  'workstream WITHIN a teamspace (Money Mastery → Plugin Architecture, Mobile '
  'UX Redesign), not a peer of an Agentic project. Supabase stays the canonical '
  'registry; Notion is mapped onto it, never the other way round.'
)
on conflict (key) do update
  set value = excluded.value, description = excluded.description;

insert into public.system_config (key, value, description)
values (
  'notion.agents_are_not_scoped_to_a_teamspace',
  to_jsonb(true),
  'Agents work across teamspaces. The teamspace an agent is currently operating '
  'in does not define its identity, role or permanent scope — a developer '
  'contributes to Money Mastery, Wellness and AI Team HQ as required. Recorded '
  'as a setting so a future staff.teamspace column meets an argument rather '
  'than an empty field (0161).'
)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- The duty stops asking the wrong question
-- ---------------------------------------------------------------------------

update public.responsibilities
   set description = 'Read the Notion databases each project is attached to and '
                     'file what is there. A project maps to a Notion Teamspace '
                     'by name and to that teamspace''s databases by id (0161); '
                     'a project with no Notion attachment is skipped rather '
                     'than guessed at.'
 where slug = 'notion-sync';

commit;
