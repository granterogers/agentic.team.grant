begin;

/**
 * A source has a name too.
 *
 * 0315 gave `approve_document` its fourth field and writes
 * `document -derived_from-> source`. `relations_of` resolves the other end's
 * title by joining five tables — documents, tasks, staff, collections, jobs —
 * and `source` is not one of them, so every edge 0315 writes comes back with a
 * null title.
 *
 * The function's own comment says what that means: *"a dangling edge yields
 * null rather than dropping the row, so the graph reports its own damage
 * instead of hiding it."* It would have been reporting damage this migration
 * caused, correctly, and the report would have looked like a broken source
 * rather than a missing join.
 *
 * A source is two tables — an authenticated `project_attachments` row or a
 * plain `project_references` one (#35) — and either can be the other end, so
 * both are coalesced in. `relations.to_kind` has allowed `'source'` since it
 * was written with nothing ever using it, the same way `input_to` was waiting
 * for #27.
 */

create or replace function app.relations_of(p_kind text, p_id uuid)
returns table (direction text, verb text, other_kind text, other_id uuid, other_title text)
language sql
stable
security definer
set search_path = ''
as $$
  with edges as (
    select 'out'::text as direction, r.verb, r.to_kind as other_kind, r.to_id as other_id
      from public.relations r
     where r.from_kind = p_kind and r.from_id = p_id
    union all
    select 'in'::text, r.verb, r.from_kind, r.from_id
      from public.relations r
     where r.to_kind = p_kind and r.to_id = p_id

    -- Derived edges — the same fact read from both ends, so traversal is
    -- symmetric without anything being written twice (0310), speaking the
    -- stored verb vocabulary so a filter returns both halves (0311).

    union all
    select 'out', 'produced', 'document', d.document_id
      from public.documents d
     where p_kind = 'job' and d.produced_by_job = p_id
    union all
    select 'in', 'produced', 'job', d.produced_by_job
      from public.documents d
     where p_kind = 'document' and d.document_id = p_id and d.produced_by_job is not null

    union all
    select 'out', 'mirrors', 'document', d.mirrors_document_id
      from public.documents d
     where p_kind = 'document' and d.document_id = p_id and d.mirrors_document_id is not null
    union all
    select 'in', 'mirrors', 'document', d.document_id
      from public.documents d
     where p_kind = 'document' and d.mirrors_document_id = p_id

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

    union all
    select 'out', 'attached_to', 'collection', dc.collection_id
      from public.document_collections dc
     where p_kind = 'document' and dc.document_id = p_id
    union all
    select 'in', 'attached_to', 'document', dc.document_id
      from public.document_collections dc
     where p_kind = 'collection' and dc.collection_id = p_id

    union all
    select 'out', 'about', 'task', c.for_task_id
      from public.collections c
     where p_kind = 'collection' and c.collection_id = p_id and c.for_task_id is not null
    union all
    select 'in', 'about', 'collection', c.collection_id
      from public.collections c
     where p_kind = 'task' and c.for_task_id = p_id

    union all
    select 'out', 'assigned_to', 'agent', t.assignee_staff
      from public.tasks t
     where p_kind = 'task' and t.task_id = p_id and t.assignee_staff is not null
    union all
    select 'in', 'assigned_to', 'task', t.task_id
      from public.tasks t
     where p_kind = 'agent' and t.assignee_staff = p_id

    union all
    select 'out', 'output_of', 'job', t.job_id
      from public.tasks t
     where p_kind = 'task' and t.task_id = p_id and t.job_id is not null
    union all
    select 'in', 'output_of', 'task', t.task_id
      from public.tasks t
     where p_kind = 'job' and t.job_id = p_id

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
         coalesce(d.title, t.title, s.name, c.name, j.kind, src.name) as other_title
    from edges e
    left join public.documents   d on e.other_kind = 'document'   and d.document_id = e.other_id
    left join public.tasks       t on e.other_kind = 'task'       and t.task_id = e.other_id
    left join public.staff       s on e.other_kind = 'agent'      and s.staff_id = e.other_id
    left join public.collections c on e.other_kind = 'collection' and c.collection_id = e.other_id
    left join public.jobs        j on e.other_kind = 'job'        and j.job_id = e.other_id
    /*
      A source is two tables (0316). An authenticated attachment has a
      `display_name`; a plain reference (#35) has a `title`. Either can be the
      other end of a `derived_from`, so both are folded into one name here
      rather than making every caller know there are two kinds.
    */
    left join lateral (
      select coalesce(
               (select a.display_name from public.project_attachments a
                 where a.attachment_id = e.other_id),
               (select r.title from public.project_references r
                 where r.reference_id = e.other_id)) as name
    ) src on e.other_kind = 'source'
   order by e.direction, e.verb
$$;

comment on function app.relations_of is
  '#29. Every relation an object has, both directions. Edges a COLUMN already '
  'holds are derived rather than copied into public.relations: storing them '
  'twice makes two witnesses that can disagree, and the copy is the one that '
  'rots. Derived and stored edges use ONE verb vocabulary (0311). A source '
  'resolves against attachments AND references, because it is both (0316).';

commit;
