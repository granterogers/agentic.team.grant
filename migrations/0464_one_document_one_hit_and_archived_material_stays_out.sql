-- Retrieval returns each document ONCE, and never an archived one (#257).
--
-- Two defects in the unified knowledge layer, both in the one function every
-- channel reaches through, and both found by asking the live index the
-- question #257 is about.
--
-- ## One: the same document came back twice
--
-- Searching the Legacy Coaching Course project for "client vision" returned
-- five hits that were three documents. "Journey VS Destination.pdf" appeared
-- as notebooklm and as notion, identical rank, adjacent rows -- and the notion
-- row carries mirrors_document_id, because the office WROTE it there.
--
-- 0169 already settled what that means: a document we wrote into a connector
-- is not new material. The rule existed and retrieval had never been told.
-- The cost is not cosmetic. DEFAULT_LIMIT is five hits and the context block
-- is capped at 8,000 characters, so a corpus with sixteen mirrors spends up to
-- half of a turn's evidence budget saying the same thing twice, and an answer
-- built on it cites one document as though it were two independent sources --
-- which is the shape of every provenance defect this repository has recorded.
--
-- Asymmetric on purpose: a mirror is only dropped when its ORIGINAL is also
-- visible in the same scope. If the original was never indexed, or belongs to
-- another project, the mirror is the only copy there is and hiding it would
-- lose the material to keep a rule tidy.
--
-- ## Two: archived material still answered searches
--
-- ADR-0040, decided by Grant on 2026-09-17: an upstream deletion
-- archive-and-hides. *"Deleted/stale material must not contaminate ordinary
-- retrieval."* Seven documents are archived today and every one of them was
-- still being offered to the model as current evidence.
--
-- Filtered HERE rather than in each caller, because a filter every reader
-- reimplements is one a reader will forget -- and #257's whole point is that
-- there is one retrieval interface. A caller that genuinely wants the archive
-- (a restore screen, an audit) reads public.documents directly, which is the
-- honest way to ask a different question.
--
-- Rebuilt from the live definition rather than retyped: CLAUDE.md records what
-- rewriting a function from memory costs, most recently app.pause_job losing
-- four behaviours including the lease release.

create or replace function app.search_documents(
  p_query text, p_project uuid default null::uuid,
  p_limit integer default 10, p_match text default 'all'::text)
returns table(document_id uuid, project_id uuid, connector text, title text,
              rank real, snippet text)
language sql
stable security definer
set search_path to 'public', 'pg_catalog'
as $function$
  with q as (
    select case
             when p_match = 'any' then
               nullif(
                 array_to_string(
                   tsvector_to_array(to_tsvector('english', coalesce(p_query, ''))), ' | '
                 ), ''
               )::tsquery
             else websearch_to_tsquery('english', coalesce(p_query, ''))
           end as tsq
  )
  select d.document_id,
         d.project_id,
         d.connector,
         d.title,
         ts_rank(d.search, q.tsq) as rank,
         ts_headline('english', coalesce(d.content, ''), q.tsq,
                     'MaxWords=40, MinWords=20, ShortWord=3, MaxFragments=2') as snippet
    from public.documents d, q
   -- A query with no lexemes at all - "the and of" - is null here, and the
   -- match operator against null is null, so it matches nothing. That is the
   -- correct answer and not an error: there was nothing to search for.
   where q.tsq is not null
     and d.search @@ q.tsq
     and (p_project is null or d.project_id = p_project)
     -- A route being closed does not hide what it already brought in. Section
     -- 17 turns off a connector, not the documents it fed.
     --
     -- ADR-0040: archived material keeps its row, its content and its
     -- relations, and leaves ordinary retrieval.
     and coalesce(d.state, '') <> 'archived'
     -- One document, one hit. A mirror steps aside only when the thing it
     -- mirrors is visible here too.
     and not exists (
       select 1 from public.documents o
        where o.document_id = d.mirrors_document_id
          and coalesce(o.state, '') <> 'archived'
          and (p_project is null or o.project_id = p_project)
     )
   order by rank desc, d.updated_at desc
   limit greatest(1, least(p_limit, 100));
$function$;

comment on function app.search_documents(text, uuid, integer, text) is
  'Project knowledge retrieval (#257). One hit per document -- a mirror the office '
  'wrote into a connector steps aside for its original (0169) -- and archived '
  'material is out of ordinary search (ADR-0040) while keeping its row, its '
  'content and its relations.';
