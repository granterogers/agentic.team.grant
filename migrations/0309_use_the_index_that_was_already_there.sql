begin;

/**
 * Use the index that was already there.
 *
 * 0308, an hour old, wrote `to_tsvector('english', title || content) @@ q` for
 * the document half of `studio_search`, and put a comment on it explaining
 * that no index was being added on purpose.
 *
 * `public.documents` has had a GENERATED tsvector column called `search` for a
 * long time, with a `documents_search` index on it, and
 * `app.search_documents` — the function 0308 was written beside — uses it. So
 * the comment was wrong twice over: an index existed, and the new query could
 * not use it, because a computed expression that merely resembles a generated
 * column is not the same expression.
 *
 * Two costs, and the second is the one that would have been noticed last:
 *
 *   * every search became a sequential scan with a `to_tsvector` per row,
 *     against an index that was sitting right there;
 *   * the generated column is WEIGHTED — the title is setweight 'A' and the
 *     body is 'B' — and the hand-rolled expression concatenated them flat. So
 *     a document whose TITLE was the thing you searched for ranked equal with
 *     one that mentioned it once in passing, which is the single most
 *     important thing a search ranking has to get right.
 *
 * `outputs` has no such column and gets the computed form, which is correct:
 * there is nothing to reuse, the bodies are short, and adding a generated
 * column plus an index to a table nobody has complained about is speculative
 * work against a 500 MB cap.
 *
 * The rule this is an instance of is already in CLAUDE.md about nouns and is
 * really about columns too: **before writing an expression, check whether the
 * table already computes it.**
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
    -- `websearch_to_tsquery`, not `to_tsquery`: quoting a phrase or typing
    -- "or" then does what a person expects rather than raising a syntax error
    -- the caller has to report as "no results".
    select websearch_to_tsquery('english', btrim(coalesce(p_query, ''))) as q
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
      left join public.projects p on p.project_id = d.project_id
     where a.q is not null
       and (p_project is null or d.project_id = p_project)
       and d.search @@ a.q

    union all

    /*
      An output is reached through its JOB, which is what carries the project
      and the person — `outputs` has no `project_id` of its own, which is a
      column name this repository has guessed wrong before.

      Computed rather than read off a column, because there is no column here
      and adding one is speculative: these bodies are short and few.

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
  'bar — which already searched titles client-side and could not see inside '
  'anything. Documents are matched on the GENERATED, indexed, weighted '
  'documents.search column so a title match outranks a passing mention; 0308 '
  'recomputed it flat and used neither the index nor the weights (0309). '
  'Behind a function so adding pgvector changes no caller (§24).';

commit;
