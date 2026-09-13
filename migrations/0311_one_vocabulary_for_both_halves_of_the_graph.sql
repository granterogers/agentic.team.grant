begin;

/**
 * One vocabulary for both halves of the graph.
 *
 * 0310 derived edges from the columns that already hold them, and gave them
 * verbs it invented on the spot: `wrote`, `holds`, `gathers`, `assigned to`,
 * `came from`, `under`. `public.relations.verb` has a CHECK constraint with a
 * fixed vocabulary — `produced`, `derived_from`, `attached_to`, `mentions`,
 * `assigned_to`, `blocks`, `mirrors`, `input_to`, `output_of`, `about` — and
 * the derived half spoke none of it except `produced` and `mirrors`.
 *
 * Nothing failed. Both halves came back from the same call and read fine to a
 * person. But a caller filtering `verb = 'assigned_to'` would have got the
 * stored edges and silently missed every derived one, and a caller writing
 * `assigned to` would have been refused by the constraint. Two dialects of one
 * language, which is the two-witnesses trap (0303, 0304) with the disagreement
 * moved into the words.
 *
 * So the derived edges speak the stored vocabulary:
 *
 *     agent      -produced->    document     was `wrote`
 *     document   -attached_to-> collection   was collection `holds` document
 *     collection -about->       task         was task `gathers` collection
 *     task       -assigned_to-> agent        was `assigned to`, with a space
 *     task       -output_of->   job          was `came from`
 *     task       -under->       task         added to the constraint
 *
 * Only one word is new. `under` is a parent-child edge and nothing in the
 * existing list means it — `blocks` is a different claim and `about` is
 * vaguer than the fact. The rest map onto words that were already there, which
 * is the test of whether a vocabulary was well chosen: five of six fitted.
 *
 * Direction matters and is chosen to read as a sentence from the subject:
 * a document IS attached to a collection, and a collection IS about a task.
 * `relations_of` returns both directions of every edge regardless, so the
 * choice only decides which way round the verb reads.
 */

alter table public.relations drop constraint if exists relations_verb_check;
alter table public.relations add constraint relations_verb_check
  check (verb = any (array[
    'produced', 'derived_from', 'attached_to', 'mentions', 'assigned_to',
    'blocks', 'mirrors', 'input_to', 'output_of', 'about',
    -- 0311: a parent-child edge, which nothing above expresses.
    'under'
  ]));

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
    -- traversal is symmetric without anything being written twice. The verbs
    -- are the ones the CHECK constraint allows, so a caller filtering on a
    -- verb gets both halves (0311).
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

    -- agent -produced-> document. `produced_by` is a SLUG, not a staff_id, and
    -- 0284 made it NOT NULL DEFAULT '' — so the empty string means nobody and
    -- must be excluded, or every uploaded document claims an author.
    union all
    select 'out', 'produced', 'document', d.document_id
      from public.documents d
      join public.staff s on s.slug = d.produced_by
     where p_kind = 'agent' and s.staff_id = p_id and coalesce(d.produced_by, '') <> ''
    union all
    select 'in', 'produced', 'agent', s.staff_id
      from public.documents d
      join public.staff s on s.slug = d.produced_by
     where p_kind = 'document' and d.document_id = p_id and coalesce(d.produced_by, '') <> ''

    -- document -attached_to-> collection
    union all
    select 'out', 'attached_to', 'collection', dc.collection_id
      from public.document_collections dc
     where p_kind = 'document' and dc.document_id = p_id
    union all
    select 'in', 'attached_to', 'document', dc.document_id
      from public.document_collections dc
     where p_kind = 'collection' and dc.collection_id = p_id

    -- collection -about-> task (#71's modules)
    union all
    select 'out', 'about', 'task', c.for_task_id
      from public.collections c
     where p_kind = 'collection' and c.collection_id = p_id and c.for_task_id is not null
    union all
    select 'in', 'about', 'collection', c.collection_id
      from public.collections c
     where p_kind = 'task' and c.for_task_id = p_id

    -- task -assigned_to-> agent
    union all
    select 'out', 'assigned_to', 'agent', t.assignee_staff
      from public.tasks t
     where p_kind = 'task' and t.task_id = p_id and t.assignee_staff is not null
    union all
    select 'in', 'assigned_to', 'task', t.task_id
      from public.tasks t
     where p_kind = 'agent' and t.assignee_staff = p_id

    -- task -output_of-> job
    union all
    select 'out', 'output_of', 'job', t.job_id
      from public.tasks t
     where p_kind = 'task' and t.task_id = p_id and t.job_id is not null
    union all
    select 'in', 'output_of', 'task', t.task_id
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
  'that rots. Derived and stored edges use ONE verb vocabulary, the CHECK '
  'constraint''s, so filtering on a verb returns both halves (0310, 0311).';

commit;
