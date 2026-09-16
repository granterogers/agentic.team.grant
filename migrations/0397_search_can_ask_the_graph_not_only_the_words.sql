begin;

-- ---------------------------------------------------------------------------
-- 0397 - search can ask the graph, not only the words (#37)
--
-- #37's last two acceptance criteria, left open since 0309 because they waited
-- on #29's edges:
--
--     [ ] Filter by kind, tag, collection, agent, contact and date
--     [ ] Relation queries: by producing agent, by related contact, by source
--
-- The edges exist now. 0310 built `app.relations_of`, which DERIVES the edges
-- the columns already hold - produced_by, produced_by_job, mirrors_document_id,
-- document_collections - and reads the stored `relations` rows beside them, so
-- traversal is symmetric without any fact being written twice. 0311 made the
-- derived edges speak the stored verb vocabulary.
--
-- ## One relation mechanism, not a second copy of the graph
--
-- The obvious implementation is a join per filter inside this function: a join
-- to `documents.produced_by` for the agent case, to `document_collections` for
-- the collection case, to `relations` for the contact case. That would be a
-- second description of the graph living next to `relations_of`, and the first
-- edge added to one and not the other is a search that silently stops finding
-- things. CLAUDE.md's `relations` entry is about precisely this.
--
-- So there is ONE relation filter - `related_to` - and it asks `relations_of`.
-- Every criterion above is a value of it:
--
--     by producing agent   -> {"kind": "agent",      "id": <staff_id>}
--     by related contact   -> {"kind": "contact",    "id": <contact_id>}
--     by source            -> {"kind": "document",   "id": <document_id>}
--     in a collection      -> {"kind": "collection", "id": <collection_id>}
--     from a job           -> {"kind": "job",        "id": <job_id>}
--
-- An edge added to `relations_of` tomorrow is a filter this search can use
-- the same day, with nothing changed here.
--
-- ## Why jsonb rather than eight parameters
--
-- Eight optional arguments would have to be repeated in the public wrapper and
-- in every caller, and CLAUDE.md records what changing a signature costs:
-- `create or replace` does not replace a function whose argument list changed,
-- it creates a SECOND OVERLOAD and every call becomes ambiguous - and the
-- public wrapper is the half that silently drops a new parameter. Both are
-- dropped by exact signature below for that reason.
--
-- An unknown key in `p_filters` is IGNORED rather than refused. A filter that
-- rejects what it does not understand turns a typo in a caller into a search
-- that returns nothing, which reads exactly like "there is nothing there".
-- ---------------------------------------------------------------------------

drop function if exists public.studio_search(text, uuid, integer);
drop function if exists app.studio_search(text, uuid, integer);

create or replace function app.studio_search(
  p_query   text,
  p_project uuid default null,
  p_limit   integer default 12,
  p_filters jsonb default '{}'::jsonb
)
returns table (
  kind    text,
  ref     uuid,
  title   text,
  snippet text,
  place   text,
  rank    real,
  at      timestamp with time zone
)
language sql
stable
security definer
set search_path = ''
as $function$
  with asked as (
    -- `websearch_to_tsquery`, not `to_tsquery`: quoting a phrase or typing
    -- "or" then does what a person expects rather than raising a syntax error
    -- the caller has to report as "no results".
    select websearch_to_tsquery('english', btrim(coalesce(p_query, ''))) as q
  ),
  f as (
    select coalesce(p_filters, '{}'::jsonb) as j
  ),
  want as (
    select
      case when (select j -> 'kinds' from f) is null then null
           else (select array(select jsonb_array_elements_text(j -> 'kinds') from f)) end as kinds,
      nullif(btrim(coalesce((select j ->> 'tag' from f), '')), '')      as tag,
      (select nullif(btrim(coalesce(j ->> 'since', '')), '')::timestamptz from f) as since,
      (select nullif(btrim(coalesce(j ->> 'until', '')), '')::timestamptz from f) as until,
      nullif(btrim(coalesce((select j #>> '{related_to,kind}' from f), '')), '') as rel_kind,
      (select nullif(btrim(coalesce(j #>> '{related_to,id}', '')), '')::uuid from f) as rel_id
  ),
  /*
    Everything the named thing is connected to, from the one definition of
    what "connected" means. Empty when no relation filter was asked for, and
    the predicates below only consult it when `rel_kind` is present - so an
    unrelated search does not pay for a traversal it does not need.
  */
  related as (
    select r.other_kind, r.other_id
      from want w
      cross join lateral app.relations_of(w.rel_kind, w.rel_id) r
     where w.rel_kind is not null and w.rel_id is not null
  ),
  hits as (
    select 'document'::text as kind,
           d.document_id as ref,
           coalesce(nullif(d.title, ''), '(untitled)') as title,
           ts_headline('english', coalesce(d.content, ''), a.q,
                       'MaxWords=22, MinWords=8, ShortWord=3, MaxFragments=1') as snippet,
           coalesce(p.name, 'No project') as place,
           -- `d.search`: generated, indexed, and WEIGHTED, so a title match
           -- outranks a passing mention instead of tying with it.
           ts_rank(d.search, a.q) as rank,
           d.created_at as at
      from public.documents d
      cross join asked a
      cross join want w
      left join public.projects p on p.project_id = d.project_id
     where a.q is not null
       and (p_project is null or d.project_id = p_project)
       and d.search @@ a.q
       and (w.kinds is null or 'document' = any(w.kinds))
       and (w.tag is null or w.tag = any(coalesce(d.tags, array[]::text[])))
       and (w.since is null or d.created_at >= w.since)
       and (w.until is null or d.created_at <= w.until)
       and (w.rel_kind is null
            or exists (select 1 from related r
                        where r.other_kind = 'document' and r.other_id = d.document_id))

    union all

    /*
      An output is reached through its JOB, which is what carries the project
      and the person - `outputs` has no `project_id` of its own, which is a
      column name this repository has guessed wrong before.

      Fixtures excluded: harness answers are not things Grant is looking for.
    */
    select 'answer'::text as kind,
           o.job_id as ref,
           coalesce(nullif(s.name, ''), 'The team')
             || ' on ' || coalesce(nullif(j.kind, ''), 'a job') as title,
           ts_headline('english', coalesce(o.body, ''), a.q,
                       'MaxWords=22, MinWords=8, ShortWord=3, MaxFragments=1') as snippet,
           coalesce(p.name, 'No project') as place,
           ts_rank(to_tsvector('english', coalesce(o.body, '')), a.q) as rank,
           o.created_at as at
      from public.outputs o
      cross join asked a
      cross join want w
      join public.jobs j on j.job_id = o.job_id
      left join public.projects p on p.project_id = j.project_id
      left join public.staff s on s.staff_id = o.staff_id
     where a.q is not null
       and not j.is_fixture
       and (p_project is null or j.project_id = p_project)
       and to_tsvector('english', coalesce(o.body, '')) @@ a.q
       and (w.kinds is null or 'answer' = any(w.kinds))
       and (w.since is null or o.created_at >= w.since)
       and (w.until is null or o.created_at <= w.until)
       /*
         An answer carries no tags, so a tag filter excludes every answer
         rather than ignoring itself. Asking for "documents tagged pricing"
         and being shown untagged answers would be the filter not applying.
       */
       and (w.tag is null)
       and (w.rel_kind is null
            or exists (select 1 from related r
                        where r.other_kind = 'job' and r.other_id = o.job_id))
  )
  select h.kind, h.ref, h.title, h.snippet, h.place, h.rank, h.at
    from hits h
   order by h.rank desc, h.at desc
   limit greatest(coalesce(p_limit, 12), 1)
$function$;

comment on function app.studio_search(text, uuid, integer, jsonb) is
  'Search the words inside things, narrowed by the graph (#37, 0397). '
  'p_filters takes kinds, tag, since, until and related_to {kind, id}. '
  'related_to asks app.relations_of, which is the ONE definition of what '
  'connected means - so by producing agent, by related contact, by source, by '
  'collection and by job are all the same filter, and an edge added to the '
  'traversal tomorrow works here the same day. An unknown key is ignored, '
  'because a filter that refuses a typo reads as "there is nothing there".';

create or replace function public.studio_search(
  p_query   text,
  p_project uuid default null,
  p_limit   integer default 12,
  p_filters jsonb default '{}'::jsonb
)
returns table (
  kind    text,
  ref     uuid,
  title   text,
  snippet text,
  place   text,
  rank    real,
  at      timestamp with time zone
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $function$ select * from app.studio_search(p_query, p_project, p_limit, p_filters) $function$;

revoke all on function public.studio_search(text, uuid, integer, jsonb) from public;
grant execute on function public.studio_search(text, uuid, integer, jsonb) to service_role;

commit;
