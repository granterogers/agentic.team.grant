begin;

/**
 * The graph reads the facts it already has.
 *
 * Issue #29, under #25.
 *
 * ## What was there
 *
 * Nearly all of it. `collections` (per project, user-named, ordered),
 * `document_collections` (many-to-many, so an asset is in two at once with no
 * duplication), `documents.tags`, `doc_type`, `origin`, `produced_by`,
 * `produced_by_job`, `mirrors_document_id`, `mime_type` — and
 * `app.relations_of(kind, id)`, a typed-edge reader that walks both directions
 * and resolves each other end's title, with a comment noting that a dangling
 * edge yields null rather than dropping the row so the graph reports its own
 * damage.
 *
 * ## What was not
 *
 * **`public.relations` has never held a single row.** The edge table and its
 * reader exist and nothing in the repository writes one. So the relational
 * graph — the thing the IA document calls the point of the whole model — was
 * a well-built reader over an empty table, which is the same shape as
 * `consultations` before #65: code that looks finished and answers every
 * question with nothing.
 *
 * ## Why this does not backfill
 *
 * The obvious fix is to copy the facts into `relations` and write them going
 * forward. That would put every one of them in TWO places:
 * `documents.produced_by_job` says a job produced a document, and a
 * `job -[produced]-> document` row would say it again. Two witnesses that can
 * disagree, and 0303 is one migration away in this same file listing — the
 * copy is the one that goes stale, and nothing would ever tell us.
 *
 * So `relations_of` DERIVES the edges that a column already holds, and
 * `public.relations` keeps only the ones no column expresses. The graph is
 * real immediately, with no backfill, no trigger, and no second source of
 * truth. Adding a column later means adding a branch here; that is a smaller
 * cost than a duplicate that can rot.
 *
 * The rule, which is the one CLAUDE.md keeps restating in different clothes:
 * **do not store a fact you can already read.**
 *
 * ## The edges, and where each comes from
 *
 *     job       -produced->  document     documents.produced_by_job
 *     document  -mirrors->   document     documents.mirrors_document_id
 *     agent     -wrote->     document     documents.produced_by (a slug)
 *     collection-holds->     document     document_collections
 *     task      -gathers->   collection   collections.for_task_id
 *     task      -assigned->  agent        tasks.assignee_staff
 *     task      -came from-> job          tasks.job_id
 *     task      -under->     task         tasks.parent_task_id
 *     anything  -any verb->  anything     public.relations
 *
 * Contact edges are absent because `contacts` carries no link column and
 * nothing writes a contact relation yet — they will arrive through
 * `public.relations`, which is what it is for. Saying so here rather than
 * leaving the omission to be discovered.
 */

create or replace function app.relations_of(p_kind text, p_id uuid)
returns table (direction text, verb text, other_kind text, other_id uuid, other_title text)
language sql
stable
security definer
set search_path = ''
as $$
  with edges as (
    -- Stored edges: anything no column already expresses.
    select 'out'::text as direction, r.verb, r.to_kind as other_kind, r.to_id as other_id
      from public.relations r
     where r.from_kind = p_kind and r.from_id = p_id
    union all
    select 'in'::text, r.verb, r.from_kind, r.from_id
      from public.relations r
     where r.to_kind = p_kind and r.to_id = p_id

    -- ---------------------------------------------------------------------
    -- Derived edges. Each pair is the same fact read from both ends, so the
    -- traversal is symmetric without anything being written twice.
    -- ---------------------------------------------------------------------

    -- job -produced-> document
    union all
    select 'out', 'produced', 'document', d.document_id
      from public.documents d
     where p_kind = 'job' and d.produced_by_job = p_id
    union all
    select 'in', 'produced', 'job', d.produced_by_job
      from public.documents d
     where p_kind = 'document' and d.document_id = p_id and d.produced_by_job is not null

    -- document -mirrors-> document. Both directions off one column, and they
    -- read differently on purpose: what this mirrors, and what mirrors this.
    union all
    select 'out', 'mirrors', 'document', d.mirrors_document_id
      from public.documents d
     where p_kind = 'document' and d.document_id = p_id and d.mirrors_document_id is not null
    union all
    select 'in', 'mirrors', 'document', d.document_id
      from public.documents d
     where p_kind = 'document' and d.mirrors_document_id = p_id

    -- agent -wrote-> document. `produced_by` is a SLUG, not a staff_id, and
    -- 0284 made it NOT NULL DEFAULT '' — so the empty string means nobody and
    -- must be excluded, or every uploaded document claims an author.
    union all
    select 'out', 'wrote', 'document', d.document_id
      from public.documents d
      join public.staff s on s.slug = d.produced_by
     where p_kind = 'agent' and s.staff_id = p_id and coalesce(d.produced_by, '') <> ''
    union all
    select 'in', 'wrote', 'agent', s.staff_id
      from public.documents d
      join public.staff s on s.slug = d.produced_by
     where p_kind = 'document' and d.document_id = p_id and coalesce(d.produced_by, '') <> ''

    -- collection -holds-> document
    union all
    select 'out', 'holds', 'document', dc.document_id
      from public.document_collections dc
     where p_kind = 'collection' and dc.collection_id = p_id
    union all
    select 'in', 'holds', 'collection', dc.collection_id
      from public.document_collections dc
     where p_kind = 'document' and dc.document_id = p_id

    -- task -gathers-> collection (#71's modules)
    union all
    select 'out', 'gathers', 'collection', c.collection_id
      from public.collections c
     where p_kind = 'task' and c.for_task_id = p_id
    union all
    select 'in', 'gathers', 'task', c.for_task_id
      from public.collections c
     where p_kind = 'collection' and c.collection_id = p_id and c.for_task_id is not null

    -- task -assigned-> agent
    union all
    select 'out', 'assigned to', 'agent', t.assignee_staff
      from public.tasks t
     where p_kind = 'task' and t.task_id = p_id and t.assignee_staff is not null
    union all
    select 'in', 'assigned to', 'task', t.task_id
      from public.tasks t
     where p_kind = 'agent' and t.assignee_staff = p_id

    -- task -came from-> job
    union all
    select 'out', 'came from', 'job', t.job_id
      from public.tasks t
     where p_kind = 'task' and t.task_id = p_id and t.job_id is not null
    union all
    select 'in', 'came from', 'task', t.task_id
      from public.tasks t
     where p_kind = 'job' and t.job_id = p_id

    -- task -under-> task
    union all
    select 'out', 'under', 'task', t.parent_task_id
      from public.tasks t
     where p_kind = 'task' and t.task_id = p_id and t.parent_task_id is not null
    union all
    select 'in', 'under', 'task', t.task_id
      from public.tasks t
     where p_kind = 'task' and t.parent_task_id = p_id
  )
  select e.direction, e.verb, e.other_kind, e.other_id,
         -- Resolved here so six callers cannot disagree about how to do it.
         -- A dangling edge yields null rather than dropping the row, so the
         -- graph reports its own damage instead of hiding it.
         coalesce(d.title, t.title, s.name, c.name, j.kind) as other_title
    from edges e
    left join public.documents   d on e.other_kind = 'document'   and d.document_id = e.other_id
    left join public.tasks       t on e.other_kind = 'task'       and t.task_id = e.other_id
    left join public.staff       s on e.other_kind = 'agent'      and s.staff_id = e.other_id
    left join public.collections c on e.other_kind = 'collection' and c.collection_id = e.other_id
    left join public.jobs        j on e.other_kind = 'job'        and j.job_id = e.other_id
   order by e.direction, e.verb
$$;

comment on function app.relations_of is
  '#29. Every relation an object has, both directions. Edges a COLUMN already '
  'holds are derived here rather than copied into public.relations: storing '
  'them twice makes two witnesses that can disagree, and the copy is the one '
  'that rots. public.relations carries only what no column expresses. 0310, '
  'after the table was found to have never held a single row.';

commit;
