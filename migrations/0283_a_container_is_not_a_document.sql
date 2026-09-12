-- 0283 — a container is not a document, and a page we wrote is not source material
--
-- Issues #19 and #20. One table, one sync path, and the same underlying
-- mistake: `duty:notion-sync` stores everything Notion hands it as source
-- material, and two of the things Notion hands it are not source material.
--
-- ## #19 — the containers
--
-- Legacy Coaching Course is attached to three Notion databases: Projects,
-- Tasks and Docs. Those are the project's plumbing — where the office WRITES.
-- `/search` returns them alongside the pages, `pageText` renders a database as
-- a bulleted list of its rows' titles, and the sync stored the result:
--
--   Tasks      1,086 chars    Docs   447 chars    Projects   214 chars
--
-- An index of a container is never material. It matches a search for any row
-- title and lands the reader on a list rather than the page, its fingerprint
-- changes whenever any row is renamed so it re-syncs for ever, and it inflates
-- every count Grant reads. The rule is exact and self-maintaining: **a Notion
-- object whose id is in `project_attachments.external_ref` for this project is
-- the attachment, not a document in it.**
--
-- Deliberately narrower than "no database is ever a document". Meetings, Notes
-- and People are shared databases that nothing is attached to, and deciding
-- those are worthless is a judgement #19 did not ask for.
--
-- ## #20 — the six pages the office wrote
--
-- `office.notion_import` (0166) authored six module pages into the Projects
-- database. The sync read them back and counted them as Grant's source
-- material. They are output.
--
-- #20 asks whether `documents` needs an origin — supplied / authored / mirror —
-- or whether these belong in `artifacts`. **Neither: the column already exists
-- and already has the right three words.** 0175 gave `documents.origin` the
-- values `yours | source | made`, and a module page the office wrote is `made`
-- by that vocabulary's own definition.
--
-- What is wrong is how `origin` gets its value. 0178 has the database derive it
-- from `connector` — "a row arriving with a connector IS a source, and that is
-- not a guess, it is the definition." It was the definition right up until the
-- office started writing INTO a connector and reading its own work back. So:
--
--   * `origin` is provenance: who made this.
--   * `connector` is location: where it lives now.
--
-- 0177 fused them by asserting `made` implies no connector. That was true when
-- it was written because nothing the office made had yet been pushed anywhere.
-- It is what #20 is. The invariant worth keeping is the other half — a `source`
-- must name where it came from — and that is kept exactly.
--
-- 0178's trigger needs no change: it only fills in `origin` when the caller
-- left it at the default, so a writer that says `made` is already left alone.
-- The writer that says it is `notion-import`, in the same statement that
-- creates the page — set at write time, never inferred afterwards, for the
-- reason 0169 gives about `mirrors_document_id`: a title Grant edits in Notion
-- would silently stop matching and the row would revert to source material.
--
-- ## The backfill
--
-- The six existing pages are found by the marker `office.notion_import` puts in
-- every module body it writes — `## Built from`, followed by the source titles
-- it drew on. Evidence from the writer rather than a list of titles typed here,
-- so it stays true if one was renamed.

begin;

-- ---------------------------------------------------------------------------
-- 1. Provenance is not location (#20)
-- ---------------------------------------------------------------------------

alter table public.documents
  drop constraint if exists connector_matches_origin;

alter table public.documents
  add constraint connector_matches_origin
  check (
    -- The half that was doing real work: nothing claims to have come from
    -- somewhere without saying where.
    (origin = 'source' and connector is not null and length(btrim(connector)) > 0)
    -- Grant's own upload came from nowhere else, and still must not name one.
    or (origin = 'yours' and (connector is null or btrim(connector) = ''))
    -- And something the office made may live anywhere — including inside a
    -- connector it wrote to. That is #20.
    or origin = 'made'
  );

comment on constraint connector_matches_origin on public.documents is
  '#20. `origin` is provenance (who made it), `connector` is location (where it '
  'lives). A source must name where it came from; something the office made may '
  'name where it was written to. 0177 fused the two, which is how six pages the '
  'office authored were counted as Grant''s source material.';

-- ---------------------------------------------------------------------------
-- 2. What the sync must not ingest (#19)
-- ---------------------------------------------------------------------------

/**
 * The connector objects that ARE this project's attachments.
 *
 * The sync asks for this once per pass and skips anything in it. In SQL rather
 * than in the TypeScript so there is one answer to the question "is this the
 * container or something in it", and so a check can ask it too.
 */
create or replace function app.container_refs(p_project_id uuid, p_connector text)
returns table (external_ref text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.external_ref
    from public.project_attachments a
   where a.project_id = p_project_id
     and a.connector = p_connector
     and a.external_ref is not null
$$;

comment on function app.container_refs is
  '#19. A Notion object whose id is one of these is the attachment itself — the '
  'database the office writes into — not a document in it. Storing one puts an '
  'index of row titles in the corpus, where it matches every search for any row '
  'and re-syncs for ever because its fingerprint tracks every rename.';

create or replace function public.container_refs(p_project_id uuid, p_connector text)
returns table (external_ref text)
language sql stable security definer set search_path = public, pg_catalog
as $$ select * from app.container_refs(p_project_id, p_connector) $$;

grant execute on function app.container_refs(uuid, text) to ai_team_app;
grant execute on function public.container_refs(uuid, text) to ai_team_app;

-- ---------------------------------------------------------------------------
-- 3. The six pages the office wrote are marked as its own work (#20)
-- ---------------------------------------------------------------------------

update public.documents d
   set origin = 'made',
       produced_by = coalesce(d.produced_by, 'office.notion_import')
 where d.connector = 'notion'
   and d.origin = 'source'
   and d.mirrors_document_id is null
   -- The marker office.notion_import writes into every module body.
   and d.content like '%' || chr(10) || '## Built from' || chr(10) || '%';

-- ---------------------------------------------------------------------------
-- 4. The container rows go (#19)
-- ---------------------------------------------------------------------------
--
-- Only the ones that are demonstrably an attachment. Not "every row whose
-- doc_type is database", which would also take three shared databases that
-- nothing is attached to and that nobody has ruled on.

delete from public.document_collections dc
 where dc.document_id in (
   select d.document_id
     from public.documents d
     join public.project_attachments a
       on a.project_id = d.project_id
      and a.connector = d.connector
      and a.external_ref = d.external_ref
 );

delete from public.documents d
 where exists (
   select 1 from public.project_attachments a
    where a.project_id = d.project_id
      and a.connector = d.connector
      and a.external_ref = d.external_ref
 );

commit;
