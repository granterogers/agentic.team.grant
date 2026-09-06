-- 0060 — a question is not a search box
--
-- `app.search_documents` uses `websearch_to_tsquery`, which ANDs every term.
-- That is right for `npm run search`, where a person types two or three
-- deliberate words and would be surprised to get documents containing only one
-- of them.
--
-- It is close to useless for retrieval. Wiring the knowledge layer into
-- `npm run ask` and asking *"What does our material say about the difference
-- between coaching and mentoring?"* returned nothing, from a corpus whose one
-- document is a long article about coaching and mentoring:
--
--   websearch:      'materi' & 'say' & 'differ' & 'coach' & 'mentor'   -> 0 rows
--   or-of-lexemes:  'coach' | 'differ' | 'materi' | 'mentor' | 'say'   -> 1 row
--
-- Every word of a natural question has to appear, including the ones that carry
-- no meaning — "material", "say", "difference". A ten-word question is ten
-- conditions, and it matches nothing. The retrieval was not weak; it was
-- answering a different question from the one asked.
--
-- ## The fix, and why not just "always OR"
--
-- A parameter, defaulting to the existing behaviour. OR-everything is worse for
-- a deliberate search: typing `pricing model` and getting every document that
-- mentions `model` is the failure people complain about in search boxes. The
-- two callers want genuinely different semantics, and `ts_rank` sorts the OR
-- case so documents matching more terms come first — which is what makes OR
-- tolerable for retrieval and intolerable for search.
--
-- `tsvector_to_array(to_tsvector(...))` rather than splitting the string
-- ourselves: it gives Postgres's own lexemes, already stemmed and stripped of
-- stop words, so `the` and `about` never become conditions and `mentoring`
-- matches `mentor`. Hand-rolled tokenising would have to reimplement all of it
-- and would drift from the index it is querying.

begin;

-- Dropped BEFORE the new arity is created, not after. Both existing at once
-- makes every `grant` and `revoke` naming `app.search_documents` ambiguous
-- ("function name is not unique"), and two functions differing only in arity is
-- also how a caller ends up on the old semantics by accident. The wrapper goes
-- first because it depends on the one underneath it.
drop function if exists public.hq_search_documents(text, uuid, integer);
drop function if exists app.search_documents(text, uuid, integer);

create or replace function app.search_documents(
  p_query   text,
  p_project uuid default null,
  p_limit   integer default 10,
  -- 'all': every term must appear (a deliberate search).
  -- 'any': any term may, ranked so more matches win (retrieval from a question).
  p_match   text default 'all'
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
   -- A query with no lexemes at all - "the and of" - is null here, and `@@`
   -- against null is null, so it matches nothing. That is the correct answer
   -- and not an error: there was nothing to search for.
   where q.tsq is not null
     and d.search @@ q.tsq
     and (p_project is null or d.project_id = p_project)
     -- A route being closed does not hide what it already brought in. §17 turns
     -- off a connector, not the documents it fed.
   order by rank desc, d.updated_at desc
   limit greatest(1, least(p_limit, 100));
$$;

comment on function app.search_documents is
  'Retrieval over every document, whatever connector fed it. p_match ''all'' '
  '(default) ANDs the terms, for a deliberate search; ''any'' ORs them and lets '
  'ts_rank sort, for retrieval from a natural-language question - where ANDing '
  'ten words including "material" and "say" matches nothing at all.';

revoke all on function app.search_documents(text, uuid, integer, text) from public;
grant execute on function app.search_documents(text, uuid, integer, text) to ai_team_app;

create or replace function public.hq_search_documents(
  p_query text, p_project uuid default null, p_limit integer default 10, p_match text default 'all'
)
returns table (
  document_id uuid, project_id uuid, connector text,
  title text, rank real, snippet text
)
language sql stable security definer set search_path = public, pg_catalog
as $$ select * from app.search_documents(p_query, p_project, p_limit, p_match) $$;

revoke all on function public.hq_search_documents(text, uuid, integer, text) from public;
grant execute on function public.hq_search_documents(text, uuid, integer, text) to ai_team_app;

commit;
