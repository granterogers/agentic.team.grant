-- 0051 — the store is documents, not notebook sources (ADR-0013)
--
-- ADR-0013 decides that a project is a Postgres row and the documents attached
-- to it, and that every knowledge tool — NotebookLM, Notion, an upload, a URL —
-- is a connector feeding that row. This migration is that decision in the
-- schema, made now rather than after a second connector exists, because a
-- second connector written against a notebook-shaped table is how a schema
-- acquires a permanent apology.
--
-- Three changes:
--
--   1. `notebook_sources` becomes `documents`, with a `connector` column. The
--      rows are unchanged and they are all `notebooklm`, which is honest: they
--      came from there.
--   2. A connector registry, so adding Notion is a row and a §17 kill switch
--      rather than a schema change and a new table.
--   3. Full-text search over the content we already hold. No provider, no
--      quota, no credential, nothing anybody can revoke — ADR-0013's point 4,
--      and the reason the knowledge layer does not need a Google account.
--
-- ## The rename is a rename, not a copy
--
-- A copy would leave two tables that mean the same thing, and the sync path
-- would keep writing to the old one until somebody noticed. `alter table
-- rename` keeps every row, index, policy and grant, and breaks the code that
-- has not been updated — loudly, at once, which is the property wanted here.

begin;

-- --------------------------------------------------------------------------
-- 1. The connector registry (§17: every integration can be turned off, with
--    a reason, without taking anything else down)
-- --------------------------------------------------------------------------

create table public.knowledge_connectors (
  connector       text        primary key,
  name            text        not null,
  -- What it can do. A connector that can only be driven by hand is a real
  -- connector; pretending otherwise is how NotebookLM ended up with an
  -- unattended client against an interface that has no API.
  automated       boolean     not null,
  enabled         boolean     not null default true,
  disabled_reason text,
  notes           text        not null,
  created_at      timestamptz not null default app.now_utc(),
  updated_at      timestamptz not null default app.now_utc(),

  constraint knowledge_connectors_disabled_has_reason
    check (enabled or disabled_reason is not null),
  constraint knowledge_connectors_slug_format
    check (connector ~ '^[a-z0-9]+(_[a-z0-9]+)*$')
);

create trigger knowledge_connectors_touch_updated_at
  before update on public.knowledge_connectors
  for each row execute function app.touch_updated_at();

insert into public.knowledge_connectors (connector, name, automated, enabled, disabled_reason, notes)
values
  (
    'notebooklm', 'Google NotebookLM', false, false,
    'no public API; the unattended client that impersonated a browser session is what the account was banned for (ADR-0012, ADR-0013). Reinstatement reversed the penalty, not the policy.',
    'Connectable by hand: paste or upload a source and it is a document like any other. What is gone is the ten-minute unattended sync.'
  ),
  (
    'notion', 'Notion', true, true, null,
    'Official API, OAuth, documented rate limits, no policy exposure. The first-class connector under ADR-0013. Not yet implemented — a token from Grant is all it waits on.'
  ),
  (
    'upload', 'Direct upload', true, true, null,
    'A document handed to the system with no external system behind it. external_ref is null, which is why the uniqueness index is partial.'
  );

comment on table public.knowledge_connectors is
  'Where a document came from, and whether that route is currently open (§17). '
  'ADR-0013: the project is the source of truth and every knowledge tool is a '
  'connector to it, so adding one is a row here rather than a table.';

-- --------------------------------------------------------------------------
-- 2. notebook_sources -> documents
-- --------------------------------------------------------------------------

alter table public.notebook_sources rename to documents;
alter table public.documents rename column source_id to document_id;
alter table public.documents rename column remote_notebook_id to external_parent_ref;
alter table public.documents rename column remote_source_id to external_ref;
alter table public.documents rename column source_type to doc_type;

alter index notebook_sources_one_per_remote rename to documents_one_per_external_ref;
alter index notebook_sources_by_project rename to documents_by_project;
alter table public.documents rename constraint notebook_sources_fingerprint_sha256
  to documents_fingerprint_sha256;
alter table public.documents rename constraint notebook_sources_content_and_fingerprint_together
  to documents_content_and_fingerprint_together;
alter table public.documents rename constraint notebook_sources_fetched_iff_content
  to documents_fetched_iff_content;

alter table public.documents
  add column connector text not null default 'notebooklm'
    references public.knowledge_connectors (connector);
-- The default was only ever for the backfill. Leaving it would make the
-- notebook the silent default for every future insert, which is the assumption
-- ADR-0013 removes.
alter table public.documents alter column connector drop default;

-- external_ref is null for an upload — there is no external system holding it —
-- so uniqueness is partial rather than a fabricated identifier.
drop index documents_one_per_external_ref;
create unique index documents_one_per_external_ref
  on public.documents (connector, external_parent_ref, external_ref)
  where external_ref is not null;
create index documents_by_connector on public.documents (connector);

comment on table public.documents is
  'Every document the system holds, whatever fed it in (ADR-0013). Postgres is '
  'the store; a connector is a route, and losing a route loses the route and '
  'not the corpus - which is exactly what 2026-09-04 demonstrated.';
comment on column public.documents.external_ref is
  'The id this document has in the system it came from, or null when it came '
  'from nowhere but here (an upload). Never a key this system relies on.';

-- --------------------------------------------------------------------------
-- 3. Full-text search, in the database we already back up
-- --------------------------------------------------------------------------

-- Title weighted above body: a document called "Pricing" is a better answer to
-- "pricing" than one that mentions the word forty times in passing.
alter table public.documents
  add column search tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(content, '')), 'B')
  ) stored;

create index documents_search on public.documents using gin (search);

comment on column public.documents.search is
  'ADR-0013 point 4: retrieval is ours. Generated, so it cannot drift from the '
  'content the way a trigger-maintained column silently can.';

create or replace function app.search_documents(
  p_query   text,
  p_project uuid default null,
  p_limit   integer default 10
)
returns table (
  document_id uuid,
  project_id  uuid,
  connector   text,
  title       text,
  rank        real,
  snippet     text
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select d.document_id,
         d.project_id,
         d.connector,
         d.title,
         ts_rank(d.search, websearch_to_tsquery('english', p_query)) as rank,
         ts_headline('english', coalesce(d.content, ''),
                     websearch_to_tsquery('english', p_query),
                     'MaxWords=40, MinWords=20, ShortWord=3, MaxFragments=2') as snippet
    from public.documents d
   where d.search @@ websearch_to_tsquery('english', p_query)
     and (p_project is null or d.project_id = p_project)
     -- A route being closed does not hide what it already brought in. §17 turns
     -- off a connector, not the documents it fed; forgetting a corpus because
     -- its source is offline is the amnesia ADR-0003 rules out.
   order by rank desc, d.updated_at desc
   limit greatest(1, least(p_limit, 100));
$$;

comment on function app.search_documents is
  'Retrieval over everything the system holds, whatever connector fed it. '
  'websearch_to_tsquery so a person can type quotes and OR and be understood, '
  'rather than have a syntax error reported as no results.';

revoke all on function app.search_documents(text, uuid, integer) from public;
grant execute on function app.search_documents(text, uuid, integer) to ai_team_app;

-- PostgREST only exposes `public`, so the read API needs a wrapper (0046).
create or replace function public.hq_search_documents(
  p_query text, p_project uuid default null, p_limit integer default 10
)
returns table (
  document_id uuid, project_id uuid, connector text,
  title text, rank real, snippet text
)
language sql stable security definer set search_path = public, pg_catalog
as $$ select * from app.search_documents(p_query, p_project, p_limit) $$;

revoke all on function public.hq_search_documents(text, uuid, integer) from public;
grant execute on function public.hq_search_documents(text, uuid, integer) to ai_team_app;

grant select, insert, update on public.knowledge_connectors to ai_team_app;
alter table public.knowledge_connectors enable row level security;
alter table public.knowledge_connectors force  row level security;
create policy knowledge_connectors_app_read on public.knowledge_connectors
  for select to ai_team_app using (true);
create policy knowledge_connectors_app_write on public.knowledge_connectors
  for update to ai_team_app using (true) with check (true);

commit;
