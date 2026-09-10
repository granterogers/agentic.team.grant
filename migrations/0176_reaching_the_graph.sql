-- Reaching the graph.
--
-- 0175 built the asset fields, collections and the edge table. This makes them
-- usable, with public wrappers because PostgREST exposes only `public`, and
-- with each function dropped by exact signature first because
-- `create or replace` does not replace a changed argument list.
--
-- ## `app.link` checks, because the edge table cannot
--
-- A polymorphic edge has no foreign key to its target — that is the price of
-- being able to relate anything to anything. So the check moves into the
-- function: linking to something that does not exist raises rather than writing
-- a row that will read as a missing title forever afterwards.
--
-- ## `app.relations` resolves titles per kind
--
-- Because a caller asking "what is related to this document" wants names, and
-- doing the resolution in six places in the frontend is six chances to
-- disagree. §11: UI action = API operation = agent-accessible operation.

begin;

-- --- link --------------------------------------------------------------------

drop function if exists app.link(uuid, text, uuid, text, text, uuid, text);
create function app.link(
  p_project uuid,
  p_from_kind text, p_from_id uuid,
  p_verb text,
  p_to_kind text, p_to_id uuid,
  p_made_by text default 'grant'
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_ok boolean;
begin
  -- Both ends must exist. The edge table cannot enforce this, so it is enforced
  -- here — a dangling edge is invisible until someone reads the graph and finds
  -- a relationship to nothing.
  foreach v_ok in array array[true] loop end loop;  -- no-op, keeps plpgsql happy

  execute format(
    'select exists (select 1 from public.%I where %I = $1)',
    case p_from_kind
      when 'document' then 'documents' when 'task' then 'tasks'
      when 'agent' then 'staff' when 'job' then 'jobs'
      when 'collection' then 'collections' else 'projects' end,
    case p_from_kind
      when 'document' then 'document_id' when 'task' then 'task_id'
      when 'agent' then 'staff_id' when 'job' then 'job_id'
      when 'collection' then 'collection_id' else 'project_id' end)
  into v_ok using p_from_id;
  if not v_ok then
    raise exception 'no % with id %', p_from_kind, p_from_id;
  end if;

  execute format(
    'select exists (select 1 from public.%I where %I = $1)',
    case p_to_kind
      when 'document' then 'documents' when 'task' then 'tasks'
      when 'agent' then 'staff' when 'job' then 'jobs'
      when 'collection' then 'collections' else 'projects' end,
    case p_to_kind
      when 'document' then 'document_id' when 'task' then 'task_id'
      when 'agent' then 'staff_id' when 'job' then 'job_id'
      when 'collection' then 'collection_id' else 'project_id' end)
  into v_ok using p_to_id;
  if not v_ok then
    raise exception 'no % with id %', p_to_kind, p_to_id;
  end if;

  insert into public.relations
    (project_id, from_kind, from_id, verb, to_kind, to_id, made_by)
  values (p_project, p_from_kind, p_from_id, p_verb, p_to_kind, p_to_id, p_made_by)
  on conflict (from_kind, from_id, verb, to_kind, to_id) do update
    set made_by = excluded.made_by
  returning relation_id into v_id;

  return v_id;
end $$;

drop function if exists public.link(uuid, text, uuid, text, text, uuid, text);
create function public.link(
  p_project uuid, p_from_kind text, p_from_id uuid, p_verb text,
  p_to_kind text, p_to_id uuid, p_made_by text default 'grant'
) returns uuid
language sql security definer set search_path = '' as $$
  select app.link(p_project, p_from_kind, p_from_id, p_verb, p_to_kind, p_to_id, p_made_by)
$$;

-- --- read the graph, both directions ----------------------------------------

drop function if exists app.relations_of(text, uuid);
create function app.relations_of(p_kind text, p_id uuid)
returns table (
  direction text, verb text, other_kind text, other_id uuid, other_title text
)
language sql stable security definer set search_path = '' as $$
  with edges as (
    select 'out'::text as direction, r.verb, r.to_kind as other_kind, r.to_id as other_id
      from public.relations r
     where r.from_kind = p_kind and r.from_id = p_id
    union all
    select 'in'::text, r.verb, r.from_kind, r.from_id
      from public.relations r
     where r.to_kind = p_kind and r.to_id = p_id
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

drop function if exists public.relations_of(text, uuid);
create function public.relations_of(p_kind text, p_id uuid)
returns table (direction text, verb text, other_kind text, other_id uuid, other_title text)
language sql stable security definer set search_path = '' as $$
  select * from app.relations_of(p_kind, p_id)
$$;

-- --- collections -------------------------------------------------------------

drop function if exists app.put_in_collection(uuid, text);
create function app.put_in_collection(p_document uuid, p_collection_name text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_project uuid;
  v_col uuid;
begin
  select project_id into v_project from public.documents where document_id = p_document;
  if v_project is null then
    raise exception 'no document with id %', p_document;
  end if;

  -- Created on first use. Grant should never have to make a collection before
  -- he can put something in one — that is the manual step §31A calls a design
  -- failure, in miniature.
  insert into public.collections (project_id, name)
  values (v_project, btrim(p_collection_name))
  on conflict (project_id, name) do update set name = excluded.name
  returning collection_id into v_col;

  insert into public.document_collections (document_id, collection_id)
  values (p_document, v_col)
  on conflict do nothing;

  return v_col;
end $$;

drop function if exists public.put_in_collection(uuid, text);
create function public.put_in_collection(p_document uuid, p_collection_name text)
returns uuid
language sql security definer set search_path = '' as $$
  select app.put_in_collection(p_document, p_collection_name)
$$;

-- --- the Made workspace's two questions -------------------------------------

drop function if exists app.awaiting_review(uuid);
create function app.awaiting_review(p_project uuid)
returns table (
  document_id uuid, title text, produced_by text, produced_by_job uuid,
  created_at timestamptz, derived_from text[]
)
language sql stable security definer set search_path = '' as $$
  select d.document_id, d.title, d.produced_by, d.produced_by_job, d.created_at,
         coalesce(array_agg(src.title order by src.title)
                    filter (where src.title is not null), '{}') as derived_from
    from public.documents d
    left join public.relations r
           on r.from_kind = 'document' and r.from_id = d.document_id
          and r.verb = 'derived_from' and r.to_kind = 'document'
    left join public.documents src on src.document_id = r.to_id
   where d.project_id = p_project
     and d.origin = 'made'
     and d.state = 'review'
   group by d.document_id, d.title, d.produced_by, d.produced_by_job, d.created_at
   order by d.created_at desc
$$;

drop function if exists public.awaiting_review(uuid);
create function public.awaiting_review(p_project uuid)
returns table (document_id uuid, title text, produced_by text, produced_by_job uuid,
               created_at timestamptz, derived_from text[])
language sql stable security definer set search_path = '' as $$
  select * from app.awaiting_review(p_project)
$$;

/*
  Approving is the ONE way a made artifact joins a project.

  Grant's IA draws it as a step with metadata — choose collection, add tags,
  relate to task, relate to source, preserve provenance — so this takes them all
  and does them in one transaction. Provenance is not a parameter: it is already
  on the row and cannot be removed here.
*/
drop function if exists app.approve_document(uuid, text, text[], uuid);
create function app.approve_document(
  p_document uuid,
  p_collection text default null,
  p_tags text[] default null,
  p_related_task uuid default null
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_project uuid;
begin
  select project_id into v_project from public.documents where document_id = p_document;
  if v_project is null then
    raise exception 'no document with id %', p_document;
  end if;

  update public.documents
     set state = 'approved',
         tags = case when p_tags is null then tags else p_tags end
   where document_id = p_document;

  if p_collection is not null and length(btrim(p_collection)) > 0 then
    perform app.put_in_collection(p_document, p_collection);
  end if;

  if p_related_task is not null then
    perform app.link(v_project, 'document', p_document, 'attached_to', 'task', p_related_task, 'grant');
  end if;

  return true;
end $$;

drop function if exists public.approve_document(uuid, text, text[], uuid);
create function public.approve_document(
  p_document uuid, p_collection text default null,
  p_tags text[] default null, p_related_task uuid default null
) returns boolean
language sql security definer set search_path = '' as $$
  select app.approve_document(p_document, p_collection, p_tags, p_related_task)
$$;

commit;
