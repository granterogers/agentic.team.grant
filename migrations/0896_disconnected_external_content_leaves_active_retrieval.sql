-- 0896 - what a disconnected source indexed leaves active retrieval; what Team HQ holds stays (ADR-0013, amended).
--
-- Grant's decision, 4 October 2026: externally indexed content that is disconnected leaves active retrieval; an
-- explicitly imported Team HQ copy remains durable and retrievable.
--
-- ADR-0013 said detaching a source loses the route and never the corpus, and the retrieval readers took that to mean
-- the documents the route fed stayed in every answer for ever. A person who disconnects a Notion database or a Drive
-- folder reasonably expects the office to stop answering from it. The corpus is still kept (nothing is deleted, the
-- passages stay, and re-attaching brings it all back), but it is no longer ACTIVE.
--
-- Two kinds of document, told apart by what the schema already records:
--   origin = 'source'   indexed from a connector (connector is required for it, `connector_matches_origin`);
--                       it exists because a route fed it, so it is only in play while a route is open.
--   origin = 'yours'    something a person gave Team HQ (an upload), and
--   origin = 'made'     something the office wrote, which includes an output a person explicitly imported
--                       (`app.import_output` files it as made, connector upload, no parent):
--                       a Team HQ copy. These are durable and are never tied to a connection.
--
-- A source document is OUT of play only when it is positively known to be disconnected: some attachment in its project
-- names its connector (and its parent, where the document has one) and none of them is enabled. A document no
-- attachment ever named is left alone: not being able to say which route fed it is not a reason to hide it, and a
-- reader that hides what it cannot attribute is the expensive direction (0304).
--
-- One predicate, `app.document_in_play`, and every retrieval reader asks it, so a reader added later has one thing to
-- call and the readers cannot drift. It is dynamic: re-attaching (the undo `hq_detach` offers) puts the documents back
-- with no copy and no re-index, because nothing was moved.
--
-- Spliced from the LIVE definitions (pg_get_functiondef), each replacement asserted to have landed, so a reader changed
-- by a later migration is not overwritten from memory.

create or replace function app.source_connected(
  p_origin text, p_project uuid, p_connector text, p_parent text)
returns boolean
language sql
stable
security definer
set search_path = 'public', 'pg_catalog'
as $f$
  select p_origin is distinct from 'source'
      or not exists (
           select 1 from public.project_attachments a
            where a.project_id = p_project
              and a.connector = p_connector
              and (p_parent is null or a.external_ref = p_parent))
      or exists (
           select 1 from public.project_attachments a
            where a.project_id = p_project
              and a.connector = p_connector
              and (p_parent is null or a.external_ref = p_parent)
              and a.enabled)
$f$;

comment on function app.source_connected(text, uuid, text, text) is
  'False only for a connector-indexed (origin source) document whose every naming attachment is disabled. Anything a person gave Team HQ or the office made (an imported output included), and a source document no attachment names, is true. ADR-0013 as amended 2026-10-04.';

create or replace function app.document_in_play(
  p_state text, p_origin text, p_project uuid, p_connector text, p_parent text)
returns boolean
language sql
stable
security definer
set search_path = 'public', 'pg_catalog'
as $f$
  select coalesce(p_state, '') <> 'archived' and app.source_connected(p_origin, p_project, p_connector, p_parent)
$f$;

comment on function app.document_in_play(text, text, uuid, text, text) is
  'Is this document in active retrieval: not archived, and not the indexed content of a disconnected source. The one predicate every retrieval reader asks.';

revoke all on function app.source_connected(text, uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function app.document_in_play(text, text, uuid, text, text) from public, anon, authenticated, service_role;

do $s$
declare
  v_def text;
  v_new text;
begin
  -- 1. free-text search over documents.
  v_def := pg_get_functiondef('app.search_documents(uuid, text, uuid, integer, text)'::regprocedure);
  v_new := replace(v_def,
    $a$and coalesce(d.state, '') <> 'archived'$a$,
    $a$and app.document_in_play(d.state, d.origin, d.project_id, d.connector, d.external_parent_ref)$a$);
  if v_new = v_def then raise exception '0896: search_documents splice did not land'; end if;
  execute v_new;

  -- 2. the passage reader.
  v_def := pg_get_functiondef('app.best_chunks(uuid, uuid[], text, integer)'::regprocedure);
  v_new := replace(v_def,
    $a$and coalesce(d.state, '') <> 'archived'$a$,
    $a$and app.document_in_play(d.state, d.origin, d.project_id, d.connector, d.external_parent_ref)$a$);
  if v_new = v_def then raise exception '0896: best_chunks splice did not land'; end if;
  execute v_new;

  -- 3. what the office says it holds for a project: a disconnected source's documents are not "indexed" any more.
  v_def := pg_get_functiondef('app.project_knowledge(uuid, uuid)'::regprocedure);
  v_new := replace(v_def,
    $a$and (coalesce(btrim(d.connector), '') <> ''$a$,
    $a$and app.source_connected(d.origin, d.project_id, d.connector, d.external_parent_ref)
       and (coalesce(btrim(d.connector), '') <> ''$a$);
  if v_new = v_def then raise exception '0896: project_knowledge splice did not land'; end if;
  execute v_new;
end $s$;
