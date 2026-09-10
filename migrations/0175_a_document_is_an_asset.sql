-- A document is an asset.
--
-- Issue #29. Grant's IA, verbatim:
--
--   "Do not design Documents purely as a conventional filesystem. Use a
--    flexible underlying Project Asset concept."
--
--   "Folders/collections may exist for familiar navigation, but categorization
--    should not depend solely on physical folder location."
--
-- `documents` is already close: it has a project, a title, content, a
-- fingerprint, a connector and `mirrors_document_id`. What it cannot do is say
-- where something CAME from, what state it is in, or what it relates to. So
-- this extends it rather than building a parallel table — §29 of the frontend
-- prompt: *"do not create unnecessary parallel systems"*, and every existing
-- read keeps working.
--
-- ## Three things, and why each is a column rather than a convention
--
-- `origin` — yours | source | made. This is what makes the Made workspace (#28)
-- possible at all. Today the difference between a file Grant uploaded and one
-- Oliver produced is a guess from `added_by`, and a guess is not something a
-- review gate can be built on.
--
-- `state` — draft | review | approved | archived. The review gate itself. An
-- artifact an agent produced sits in `review` and a human action moves it to
-- `approved`; nothing an agent makes joins the project silently.
--
-- `derived_from` — the assets this one came out of. Grant: *"Preserve the
-- relationship between the source document, agent job and resulting output."*
-- With `produced_by_job` that relationship is stored rather than described.
--
-- ## Collections are a join table, not a path
--
-- Because his rule above forbids categorisation depending on folder location,
-- and because *"multiple logical collections without unnecessary duplication"*
-- is impossible with a path column. An asset in "Module 2" and "For the 16 Sep
-- interviews" is two rows in `document_collections`, not two copies of a file.
--
-- ## Tags are text, on purpose
--
-- Not an enum, not a lookup table with an admin screen. Grant defines his own
-- labels in the UI already (`web/studio/people.js`); a tag that needs a
-- migration to invent is a tag he does not have.

begin;

-- --- the asset fields --------------------------------------------------------

alter table public.documents
  add column if not exists origin text not null default 'yours'
    check (origin in ('yours', 'source', 'made')),
  add column if not exists state text not null default 'approved'
    check (state in ('draft', 'review', 'approved', 'archived')),
  -- Who or what produced it: 'grant', a staff slug, or a connector name.
  add column if not exists produced_by text not null default '',
  add column if not exists produced_by_job uuid references public.jobs(job_id) on delete set null,
  add column if not exists tags text[] not null default '{}';

-- Existing rows: anything that arrived through a connector is a source, and a
-- source is approved by definition — it exists whether or not Grant likes it.
update public.documents
   set origin = 'source'
 where connector is not null and connector <> '' and origin = 'yours';

/*
  The one invariant worth enforcing at the table.

  Only something the team MADE can sit in review. A file Grant uploaded is his
  and is approved the moment it exists; a mirror of a Notion page is not
  something he approves either. Without this, `state` drifts into meaning
  "unread" and the Made workspace loses the only thing it is for.
*/
alter table public.documents
  drop constraint if exists only_made_things_await_review;
alter table public.documents
  add constraint only_made_things_await_review
  check (state <> 'review' or origin = 'made');

create index if not exists documents_origin_state_idx
  on public.documents (project_id, origin, state);
create index if not exists documents_tags_idx
  on public.documents using gin (tags);

-- --- collections -------------------------------------------------------------

create table if not exists public.collections (
  collection_id uuid primary key default extensions.gen_random_uuid(),
  project_id    uuid not null references public.projects(project_id) on delete cascade,
  name          text not null check (length(btrim(name)) > 0),
  -- Ordering is Grant's, not alphabetical: "Research, Planning, Reference,
  -- Meetings, Archive" is a sequence he wrote down, and sorting it by name
  -- would scramble it into "Archive, Meetings, Planning…".
  position      int  not null default 0,
  created_at    timestamptz not null default now(),
  unique (project_id, name)
);

create table if not exists public.document_collections (
  document_id   uuid not null references public.documents(document_id) on delete cascade,
  collection_id uuid not null references public.collections(collection_id) on delete cascade,
  added_at      timestamptz not null default now(),
  primary key (document_id, collection_id)
);

create index if not exists document_collections_by_collection
  on public.document_collections (collection_id);

-- --- the relational graph ----------------------------------------------------

/*
  One typed edge table, not thirteen foreign keys.

  Grant lists thirteen relationships he wants — Task → Document, Task → Agent,
  Task → Contact, Document → Agent, Document → Source, Agent → Job, Agent →
  Document, Agent → Task, Contact → Document, Contact → Task, Source →
  Document, Job → Input documents, Job → Output documents — and adds:

    "These objects should NOT be isolated silos. Everything should be capable
     of relating to everything else where appropriate."

  Thirteen columns across five tables cannot express "everything else", and
  every new object type would need another migration. One edge table with a
  typed subject and object can, and a new relationship is a new row.

  The cost is honest: no referential integrity to the target, because the target
  is polymorphic. `app.link()` checks existence instead, and `app.relations()`
  resolves titles by joining per kind — so a dangling edge shows as a missing
  title rather than a crash.
*/
create table if not exists public.relations (
  relation_id uuid primary key default extensions.gen_random_uuid(),
  project_id  uuid not null references public.projects(project_id) on delete cascade,

  from_kind   text not null check (from_kind in
    ('document', 'task', 'contact', 'agent', 'source', 'job', 'collection')),
  from_id     uuid not null,
  -- What the edge MEANS. Free text with a check, because "mentions" and
  -- "produced" are different questions and an untyped edge answers neither.
  verb        text not null check (verb in
    ('produced', 'derived_from', 'attached_to', 'mentions', 'assigned_to',
     'blocks', 'mirrors', 'input_to', 'output_of', 'about')),
  to_kind     text not null check (to_kind in
    ('document', 'task', 'contact', 'agent', 'source', 'job', 'collection')),
  to_id       uuid not null,

  made_by     text not null default 'grant',
  created_at  timestamptz not null default now(),

  -- The same edge twice is not two facts.
  unique (from_kind, from_id, verb, to_kind, to_id)
);

-- Traversal in BOTH directions is the whole point — "what did Emma produce" and
-- "who produced this" are the same edge read from opposite ends.
create index if not exists relations_forward
  on public.relations (from_kind, from_id, verb);
create index if not exists relations_backward
  on public.relations (to_kind, to_id, verb);
create index if not exists relations_by_project
  on public.relations (project_id);

commit;
