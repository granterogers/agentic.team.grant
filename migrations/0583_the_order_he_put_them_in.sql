-- The order Grant put his documents in, and two dates that do not lie.
--
-- §§25-38 of the 24 September mission. Four ordering modes -- Name, Date
-- uploaded, Date created, Custom -- in BOTH the miniature and the expanded
-- view, sharing ONE custom order, persisted where the person is rather than
-- where the browser is.
--
-- WHY A TABLE AND NOT `localStorage`. The same reason as ADR-0021 and #341,
-- which §22 says explicitly applies here: "This same architectural principle
-- should inform custom document ordering where appropriate." He uses more
-- than one device and the whole point of arranging something is that it stays
-- arranged.
--
-- WHY A LIST OF IDS AND NOT A COLUMN ON `documents`. A position column would
-- have to be maintained on every insert, would be meaningless for a document
-- in no project, and would make "the order Grant chose" and "the order things
-- arrived in" the same field. A list says only what it means: these documents,
-- in this order, for this person, on this project. Anything not in the list is
-- new since he arranged it and sorts after, which is also what he would
-- expect.
--
-- WHY THE TWO DATES ARE MOSTLY NULL AND THAT IS CORRECT. §27 and §28 forbid
-- substituting one timestamp for another. Of 104 documents the office holds,
-- all have a row date, 94 have a fetch date and none of the source documents
-- knows when its ORIGINAL was created -- `remote_updated_at` is a modified
-- date and is not it. So `created` is populated only for what the office
-- itself made, `uploaded` only for what was actually taken in, and the surface
-- says "not known" rather than showing a date that means something else.

create table if not exists public.document_orders (
  owner       text not null default 'grant',
  project_id  uuid not null references public.projects(project_id) on delete cascade,
  doc_ids     jsonb not null,
  updated_at  timestamptz not null default app.now_utc(),
  primary key (owner, project_id),
  constraint document_orders_is_a_list
    check (jsonb_typeof(doc_ids) = 'array' and jsonb_array_length(doc_ids) > 0)
);

comment on table public.document_orders is
  'The order one person put one project''s documents in. A list of ids: '
  'anything absent is newer than the arrangement and sorts after it.';

revoke all on table public.document_orders from anon, authenticated;

-- Set it. An empty list is a RESET, for ADR-0021's reason: `[]` cannot be told
-- apart from a list that failed to load, so it deletes the row and the default
-- order comes back.
create or replace function app.hq_document_order_set(p_slug text, p_ids jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_project uuid;
  v_clean jsonb;
begin
  select project_id into v_project from public.projects where slug = p_slug;
  if v_project is null then
    return jsonb_build_object('error', format('no project called %L', p_slug));
  end if;
  if p_ids is null or jsonb_typeof(p_ids) <> 'array' or jsonb_array_length(p_ids) = 0 then
    delete from public.document_orders where project_id = v_project and owner = 'grant';
    return jsonb_build_object('ok', true, 'reset', true);
  end if;
  -- Only documents that are really on this project, in the order given, each
  -- once. A list carrying an id from somewhere else would quietly reorder
  -- nothing and look like a save that worked.
  select coalesce(jsonb_agg(to_jsonb(x.id) order by x.ord), '[]'::jsonb) into v_clean
    from (
      select distinct on (e.value #>> '{}') (e.value #>> '{}')::uuid as id, e.ordinality as ord
        from jsonb_array_elements(p_ids) with ordinality as e(value, ordinality)
       where exists (
         select 1 from public.documents d
          where d.document_id = (e.value #>> '{}')::uuid and d.project_id = v_project
       )
       order by e.value #>> '{}', e.ordinality
    ) x;
  if jsonb_array_length(v_clean) = 0 then
    return jsonb_build_object('error', 'none of those documents are on this project');
  end if;
  insert into public.document_orders (owner, project_id, doc_ids, updated_at)
  values ('grant', v_project, v_clean, app.now_utc())
  on conflict (owner, project_id)
    do update set doc_ids = excluded.doc_ids, updated_at = excluded.updated_at;
  return jsonb_build_object('ok', true, 'kept', jsonb_array_length(v_clean));
end;
$fn$;

create or replace function app.hq_document_order_reset(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare v_project uuid;
begin
  select project_id into v_project from public.projects where slug = p_slug;
  if v_project is null then
    return jsonb_build_object('error', format('no project called %L', p_slug));
  end if;
  delete from public.document_orders where project_id = v_project and owner = 'grant';
  return jsonb_build_object('ok', true, 'reset', true);
end;
$fn$;

create or replace function public.hq_document_order_set(p_slug text, p_ids jsonb)
returns jsonb language sql security definer set search_path = ''
as $$ select app.hq_document_order_set(p_slug, p_ids) $$;

create or replace function public.hq_document_order_reset(p_slug text)
returns jsonb language sql security definer set search_path = ''
as $$ select app.hq_document_order_reset(p_slug) $$;

grant execute on function public.hq_document_order_set(text, jsonb) to anon, authenticated, service_role;
grant execute on function public.hq_document_order_reset(text) to anon, authenticated, service_role;

-- And the payload carries the two dates, spliced from the live definition.
CREATE OR REPLACE FUNCTION app.studio_documents(p_project_id uuid, p_limit integer DEFAULT 24)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.document_id,
           'title', d.title,
           'kind', case
             when coalesce(d.mime_type, '') like 'audio/%' then 'audio'
             when d.origin = 'made' then 'made'
             when coalesce(d.mime_type, '') = 'application/pdf'
               or d.title ilike '%.pdf' then 'pdf'
             else 'doc' end,
           'origin', case d.origin
             when 'yours' then 'Yours'
             when 'made' then coalesce(d.produced_by, 'The team')
             else app.connector_label(d.connector) end,
           -- A size only when it says something. Below a hundred words "4 words"
           -- reads as broken metadata even when it is exactly right, and several
           -- of these are Notion database containers (#19).
           'size', case
             when d.duration_s is not null
               then format('%s min', greatest(round(d.duration_s / 60.0), 1))
             when coalesce(d.content_chars, 0) >= 550
               then format('%s words', to_char(round(d.content_chars / 5.5), 'FM999G999'))
             when d.byte_size is not null and d.byte_size >= 1024
               then format('%s KB', round(d.byte_size / 1024.0))
             else '' end,
           'state', d.state,

           -- THE TWO DATES, AND THE HONEST GAPS IN THEM (§§27-28).
           --
           -- `uploaded` is when this copy entered the office, which for
           -- anything pulled from a connector or dropped on a project is
           -- exactly `fetched_at`. A document the office WROTE was never
           -- uploaded, so it has none, and saying so is the point: "do NOT
           -- silently substitute another timestamp merely because an upload
           -- timestamp is missing."
           --
           -- `created` is when the thing itself was made, and the office only
           -- knows that for its own work. For a source document `created_at`
           -- is when the office first recorded it -- which is the UPLOAD date
           -- wearing another name, and confusing the two is what §28 forbids.
           -- `remote_updated_at` is a MODIFIED date and is not it either.
           --
           -- `added` is neither: it is the office's own row date, always
           -- present, and it is here as the deterministic tiebreak so two
           -- documents with equal or absent dates never swap places between
           -- renders.
           'uploaded', d.fetched_at,
           'created', case when d.origin = 'made' then d.created_at else null end,
           'added', d.created_at,
           -- What the two new controls toggle. Sorted, so a press that adds a
           -- tag does not reorder the ones already there.
           'tags', to_jsonb(coalesce((select array(select distinct unnest(d.tags) order by 1)), '{}'::text[])),
           'collections', coalesce((
             select jsonb_agg(c.name order by c.name)
               from public.document_collections dc
               join public.collections c on c.collection_id = dc.collection_id
              where dc.document_id = d.document_id), '[]'::jsonb)
         ) order by d.created_at desc), '[]'::jsonb)
    from (select * from public.documents dd
           where dd.project_id = p_project_id
             /*
               #28: an output that has not been approved is not in the project.

               This function emitted `state` and never filtered on it, so a
               draft sat in the gallery beside eighty-six approved documents and
               looked exactly like them. The import gate is only a gate if the
               thing behind it is actually behind it.

               Here rather than in the page: an agent asking what this project
               holds must get the same answer as the gallery, and a rule
               enforced in one renderer is a rule the API does not have.
             */
             and dd.state = 'approved'
           order by dd.created_at desc
           limit greatest(coalesce(p_limit, 24), 1)) d
$function$;

-- The order itself, on each project, so the page needs no extra call.
CREATE OR REPLACE FUNCTION app.hq_studio_core()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  with people as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'slug', s.slug,
             'name', s.name,
             'role', s.title,
             'avatar_ref', s.avatar_ref,
             'expertise', coalesce(s.expertise, array[]::text[]),
             'state', case when j.running > 0 then 'busy' else 'idle' end,
             'doing', j.doing
           ) order by case s.slug when 'chief-of-staff' then 0 else 1 end, s.name),
           '[]'::jsonb) as v
      from public.staff s
      left join lateral (
        select count(*) as running,
               (array_agg(jj.kind order by jj.updated_at desc))[1] as doing
          from public.jobs jj
         where jj.recipient_agent = s.slug
           and jj.state in ('running', 'queued')
           and not jj.is_fixture
      ) j on true
     where s.active and s.slug not like 'fixture-%'
  ),

  projects as (
    select coalesce(jsonb_agg(t order by t.name), '[]'::jsonb) as v
      from (
        select
          p.project_id as id,
          p.slug, p.name,
          coalesce(nullif(btrim(p.purpose), ''), '') as purpose,

          coalesce((
            select array_agg(distinct app.connector_label(a.connector)
                             order by app.connector_label(a.connector))
              from public.project_attachments a
             where a.project_id = p.project_id and a.enabled
          ), array[]::text[]) as connectors,

          (select count(*)::int from public.documents d
            where d.project_id = p.project_id) as docs,
          (select count(*)::int from public.tasks tk
            where tk.project_id = p.project_id and not tk.is_fixture
              and tk.state = 'done') as done,
          (select count(*)::int from public.tasks tk
            where tk.project_id = p.project_id and not tk.is_fixture) as total,

          (select format('%s by %s', left(tk.title, 40), to_char(tk.due_on, 'FMDD Mon'))
             from public.tasks tk
            where tk.project_id = p.project_id and not tk.is_fixture
              and tk.due_on is not null and tk.state in ('todo', 'doing')
            order by tk.due_on limit 1) as next,

          app.studio_documents(p.project_id) as documents,

          -- The order he put them in (§§29-31), or nothing if he has not.
          (select o.doc_ids from public.document_orders o
            where o.project_id = p.project_id and o.owner = 'grant') as doc_order,
          app.studio_tasks(p.project_id)     as tasks,
          app.studio_sources(p.project_id)   as sources,
          app.studio_activity(p.project_id)  as activity,
          /*
            What is waiting on Grant, in the project (#151, migration 0289).

            The landing page has shown this since 0240 and a project never did,
            so the one genuinely urgent category was visible exactly where he
            could not act on it. Same view, same order — a list that disagreed
            with the banner would make "the urgent one" depend on which room he
            was standing in.
          */
          app.studio_waiting(p.project_id) as waiting,
          /*
            Real, since #71 and migration 0286. This was an honest empty literal
            because there was nowhere for a module to be written — and honest
            or not it was permanent, which is what the Issue objected to.

            It is not a new table. A module is a MILESTONE that gathers
            documents; 0286's header has the mapping and the reasoning.
          */
          app.studio_modules(p.project_id) as modules,
          -- Contacts are real now (#24, migration 0245). This was an honest
          -- empty literal because there was no table; there is one, and the
          -- function returns it in the shape the contact card already draws.
          app.studio_contacts(p.project_id) as contacts,
          -- Real work, not an empty array (0228). AI Team went honestly empty
          -- when data.js was replaced, and an empty tab because nothing was
          -- asked looks identical to one because nobody wired it.
          app.studio_requests(p.project_id) as requests,

          -- The arrangement he made, so it is his on every device (#81).
          (select l.panels from public.dashboard_layouts l
            where l.project_id = p.project_id and l.owner = 'grant'
              and l.surface = 'studio') as layout,

          -- And the experiment's, which is a DIFFERENT arrangement of a
          -- different board: twelve columns and heights in rows, where the
          -- studio's is three columns and heights in pixels. One row per
          -- surface is what #299 was waiting for; before it, saving one would
          -- have taken panels off the other.
          (select l.panels from public.dashboard_layouts l
            where l.project_id = p.project_id and l.owner = 'grant'
              and l.surface = 'basecamp') as layout_board,

          -- What the project LOOKS like, when he has said (#83).
          p.icon, p.icon_hue as "iconHue", p.image

        from public.projects p
        where p.status = 'active' and not p.is_fixture
      ) t
  ),

  waiting as (
    select case when n.blocker_id is null then null else jsonb_build_object(
             'what', n.requested_action,
             'who', coalesce(n.originating_agent, 'The team'),
             'when', to_char(n.created_at, 'FMDD Mon'),
             'slug', (select p.slug from public.projects p where p.project_id = n.project_id),
             'blocker', n.blocker_id,
             'note', case when n.work_can_continue
                          then 'Everything else on that project is carrying on.'
                          else 'Nothing else on that project moves until you answer.' end
           ) end as v
      from (select * from public.needs_me
             order by overdue desc, real_deadline nulls last limit 1) n
     union all select null limit 1
  )

  select jsonb_build_object(
    'crew', (select v from people),
    'projects', (select v from projects),
    'waiting', (select v from waiting),
    'avatar_base', (select value #>> '{}' from public.system_config
                     where key = 'staff.avatar_base_url'),
    'connectors', (select coalesce(jsonb_agg(jsonb_build_object(
                            'connector', k.connector,
                            'name', app.connector_label(k.connector),
                            'enabled', k.enabled
                          ) order by k.name), '[]'::jsonb)
                     from public.knowledge_connectors k),
    'health', (
      select jsonb_build_object(
        'stalled', coalesce(sum(s.n), 0),
        'kinds', coalesce(jsonb_agg(jsonb_build_object(
                   'kind', s.kind, 'n', s.n,
                   'oldest_minutes', s.oldest_minutes) order by s.n desc)
                 filter (where s.kind is not null), '[]'::jsonb))
        from app.jobs_stuck_queued() s
    ),
    'generated_at', app.now_utc()
  )
$function$;