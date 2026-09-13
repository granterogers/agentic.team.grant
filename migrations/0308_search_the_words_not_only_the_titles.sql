begin;

/**
 * Search the words, not only the titles.
 *
 * Issue #37, under #25.
 *
 * ## What was missing, and what was not
 *
 * The studio's command bar already searches across projects, documents, tasks,
 * contacts, sections and people — instantly, client-side, over the payload the
 * page already holds. That is genuinely most of #37's list and it is fast in
 * the way the specification asks for.
 *
 * It searches TITLES. So Grant can find a document called "WS02 pricing" and
 * cannot find the one that mentions WS02 pricing in its third paragraph — and
 * the second is what a person actually needs from search.
 *
 * `app.search_documents` has done full-text over `documents.content` since it
 * was written, and **has no public wrapper**. PostgREST exposes only `public`,
 * so nothing with a browser has ever been able to call it: the capability
 * existed and was unreachable. That is the trap in CLAUDE.md, and it is why
 * this migration is mostly a wrapper.
 *
 * ## Outputs as well as documents
 *
 * #37 names agent outputs among the things to search, and they are the half
 * Grant cannot otherwise get back to: a document has a title and a place in a
 * gallery, and an answer Emma wrote three weeks ago has neither. `outputs.body`
 * is the text; the job it hangs off is what gives it a project and a person.
 *
 * ## No index, deliberately
 *
 * A GIN index on `to_tsvector(content)` is the obvious next step and is not
 * taken here. The corpus is a few hundred documents on a 500 MB free tier, a
 * sequential scan answers in milliseconds, and an index on a generated tsvector
 * of every document's full text is real storage against a hard cap. When the
 * corpus makes it necessary the query does not change — which is the point of
 * putting this behind a function rather than in the page.
 *
 * §24's later requirement — that the retrieval layer can take embeddings
 * without changing its callers — is served the same way: callers ask
 * `studio_search`, and what it does inside is nobody else's business.
 */

/**
 * Everything with words in it, ranked.
 *
 * One shape for both halves so the page renders one list: `kind` says which it
 * is, `where` says which project, and `snippet` is the matched words in
 * context. `ref` is what the page navigates to — a document id for a document,
 * and the JOB id for an output, because an output has no screen of its own and
 * the job it came from does.
 */
create or replace function app.studio_search(
  p_query text,
  p_project uuid default null,
  p_limit int default 12)
returns table (
  kind text, ref uuid, title text, snippet text, place text, rank real, at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with asked as (
    /*
      `websearch_to_tsquery`, not `to_tsquery`: quoting a phrase or typing "or"
      then does what a person expects, instead of raising a syntax error that
      the caller has to report as "no results". Same reason `search_documents`
      uses it.
    */
    select websearch_to_tsquery('english', btrim(coalesce(p_query, ''))) as q
  ),
  hits as (
    select 'document'::text as kind,
           d.document_id as ref,
           coalesce(nullif(d.title, ''), '(untitled)') as title,
           ts_headline('english', coalesce(d.content, ''), a.q,
                       'MaxWords=22, MinWords=8, ShortWord=3, MaxFragments=1') as snippet,
           coalesce(p.name, 'No project') as place,
           ts_rank(to_tsvector('english',
                     coalesce(d.title, '') || ' ' || coalesce(d.content, '')), a.q) as rank,
           d.created_at as at
      from public.documents d
      cross join asked a
      left join public.projects p on p.project_id = d.project_id
     where a.q is not null
       and (p_project is null or d.project_id = p_project)
       and to_tsvector('english', coalesce(d.title, '') || ' ' || coalesce(d.content, '')) @@ a.q

    union all

    /*
      An output is reached through its JOB, which is what carries the project
      and the person — `outputs` has no `project_id` of its own, which is a
      column name this repository has guessed wrong before.

      Fixtures excluded: harness answers are not things Grant is looking for,
      and this is a search box rather than an audit.
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
      join public.jobs j on j.job_id = o.job_id
      left join public.projects p on p.project_id = j.project_id
      left join public.staff s on s.staff_id = o.staff_id
     where a.q is not null
       and not j.is_fixture
       and (p_project is null or j.project_id = p_project)
       and to_tsvector('english', coalesce(o.body, '')) @@ a.q
  )
  select h.kind, h.ref, h.title, h.snippet, h.place, h.rank, h.at
    from hits h
   order by h.rank desc, h.at desc
   limit greatest(coalesce(p_limit, 12), 1)
$$;

comment on function app.studio_search is
  '#37. Full text across documents and agent answers, for the studio command '
  'bar — which already searches titles client-side and could not see inside '
  'anything. No GIN index deliberately: a few hundred documents scan in '
  'milliseconds and the free tier is 500 MB. Behind a function so that adding '
  'one, or pgvector, changes no caller (§24). 0308.';

create or replace function public.studio_search(
  p_query text, p_project uuid default null, p_limit int default 12)
returns table (
  kind text, ref uuid, title text, snippet text, place text, rank real, at timestamptz)
language sql stable security definer set search_path = public, pg_catalog
as $$ select * from app.studio_search(p_query, p_project, p_limit) $$;

/*
  And the one that already existed and could not be reached.

  `app.search_documents` has done this since it was written and has no public
  wrapper, so PostgREST — which exposes only `public` — could never call it.
  A capability that exists and is unreachable is a capability nobody has.
*/
create or replace function public.search_documents(
  p_query text, p_project uuid default null, p_limit int default 10, p_match text default null)
returns table (
  document_id uuid, project_id uuid, connector text, title text, rank real, snippet text)
language sql stable security definer set search_path = public, pg_catalog
as $$ select * from app.search_documents(p_query, p_project, p_limit, p_match) $$;

grant execute on function app.studio_search(text, uuid, int) to ai_team_app;
grant execute on function public.studio_search(text, uuid, int) to ai_team_app;
grant execute on function public.search_documents(text, uuid, int, text) to ai_team_app;

commit;
