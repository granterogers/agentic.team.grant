begin;

-- ---------------------------------------------------------------------------
-- 0921 - one project search, over every store a project actually has
--
-- `studio_search` (0397) finds documents and the team's answers. A project also holds tasks, the conversation, saved
-- webpages, Post-its, calendar events and the team's research, and Grant's requirement is one search box that finds
-- any of them, scoped to the project he is in and never leaking another's.
--
-- ## Shape
--
-- One function per STORE (`app.psearch_*`), each returning the same typed row, and one union
-- (`app.project_search`). A provider is added by writing its function and one `union all` line below, and by adding a
-- row to `app.project_search_providers()`, which is what the page reads to know which kinds exist - so a kind the
-- database cannot serve yet (calendar, until 0897 is applied) is reported `available: false` rather than being
-- silently absent, and the page never advertises a filter that finds nothing.
--
-- Every provider:
--   - takes the office FIRST and filters its own rows by it, and joins the project through the same office, so a
--     project id from another office matches nothing;
--   - excludes fixtures and harness traffic by the canonical predicates (`projects.is_fixture`, `app.harness_task`,
--     `app.harness_job`, `app.harness_label`) - the expensive direction is hiding HIS work, so it asks only the
--     questions those predicates already answer;
--   - returns `snippet` only from text the store holds. Nothing is composed or summarised, so nothing is invented.
--
-- ## Calendar is optional, on purpose
--
-- `public.project_events` is created by 0897 on a sibling branch. This migration must apply with or without it, so the
-- provider is dynamic SQL behind `to_regclass`, builds its column list from `information_schema` and returns no rows -
-- never an error - when the table or a column it needs is missing. It reads `event_id|id`, `office_id`, `project_id`,
-- `title`, `starts_at|start_at` and, if present, `description|notes|detail` and `location`.
--
-- ## Post-its
--
-- They live inside the workspace document (`dashboard_layouts.panels`, surface 'basecamp', the entry
-- `{id:'__workspace', postits:[{id,text,...}]}` - web/studio/bc/layout.js). There is no table of them, and inventing a
-- second copy would be the "second place for a fact to rot" CLAUDE.md warns about, so the provider reads the jsonb.
-- The layout row is the OFFICE'S OWNER's (`owner = app.office_actor`), so a Post-it is found only by the office whose
-- workspace it is.
-- ---------------------------------------------------------------------------

create or replace function app.psearch_documents(p_office uuid, p_project uuid, p_q tsquery, p_limit integer)
returns table (kind text, id text, title text, snippet text, project_slug text, url_hint text, score real, at timestamptz)
language sql
stable
security definer
set search_path = ''
as $f$
  select case when d.connector = 'browser' then 'page'
              when d.origin = 'source' and d.connector <> 'mcp' then 'source'
              else 'document' end,
         d.document_id::text,
         coalesce(nullif(d.title, ''), '(untitled)'),
         ts_headline('english', coalesce(d.content, ''), p_q, 'MaxWords=24, MinWords=8, ShortWord=3, MaxFragments=1'),
         p.slug,
         '/p/' || p.slug || case when d.connector = 'browser' then '/sources' else '/documents' end
           || '?focus=' || d.document_id::text,
         ts_rank(d.search, p_q),
         d.updated_at
    from public.documents d
    join public.projects p on p.project_id = d.project_id and p.office_id = p_office and not p.is_fixture
   where p_q is not null
     and d.office_id = p_office
     and (p_project is null or d.project_id = p_project)
     and d.search @@ p_q
     and app.document_in_play(d.state, d.origin, d.project_id, d.connector, d.external_parent_ref)
     -- a document the office wrote into a connector is the same material as its original
     and not exists (select 1 from public.documents o
                      where o.document_id = d.mirrors_document_id and o.office_id = p_office
                        and coalesce(o.state, '') <> 'archived')
     -- the team's research is the research provider's, so it is not found twice
     and not (d.origin = 'made' and d.produced_by_job is not null
              and exists (select 1 from public.jobs j
                           where j.job_id = d.produced_by_job and j.kind ~ '^(browser|research|notebook[.]ask)'))
   order by 7 desc, 8 desc
   limit greatest(1, least(coalesce(p_limit, 20), 100))
$f$;

create or replace function app.psearch_tasks(p_office uuid, p_project uuid, p_q tsquery, p_limit integer)
returns table (kind text, id text, title text, snippet text, project_slug text, url_hint text, score real, at timestamptz)
language sql
stable
security definer
set search_path = ''
as $f$
  select 'task',
         t.task_id::text,
         t.title,
         ts_headline('english', coalesce(nullif(t.detail, ''), t.title), p_q,
                     'MaxWords=24, MinWords=6, ShortWord=3, MaxFragments=1'),
         p.slug,
         '/p/' || p.slug || '/tasks?focus=' || t.task_id::text,
         ts_rank(to_tsvector('english', t.title || ' ' || coalesce(t.detail, '')), p_q),
         t.updated_at
    from public.tasks t
    join public.projects p on p.project_id = t.project_id and p.office_id = p_office and not p.is_fixture
   where p_q is not null
     and t.office_id = p_office
     and (p_project is null or t.project_id = p_project)
     and t.state <> 'cancelled'
     and not app.harness_task(t.is_fixture, t.job_id)
     and to_tsvector('english', t.title || ' ' || coalesce(t.detail, '')) @@ p_q
   order by 7 desc, 8 desc
   limit greatest(1, least(coalesce(p_limit, 20), 100))
$f$;

-- The project conversation: what was said to the team, and what the team answered (research answers are the research
-- provider's). Nothing synthetic, nothing a harness job wrote.
create or replace function app.psearch_chat(p_office uuid, p_project uuid, p_q tsquery, p_limit integer)
returns table (kind text, id text, title text, snippet text, project_slug text, url_hint text, score real, at timestamptz)
language sql
stable
security definer
set search_path = ''
as $f$
  (select 'message',
          c.command_id::text,
          'You: ' || left(coalesce(nullif(c.instruction, ''), c.transcript), 80),
          ts_headline('english', coalesce(nullif(c.instruction, ''), c.transcript), p_q,
                      'MaxWords=24, MinWords=6, ShortWord=3, MaxFragments=1'),
          p.slug,
          '/p/' || p.slug || '/chat',
          ts_rank(to_tsvector('english', coalesce(nullif(c.instruction, ''), c.transcript)), p_q),
          c.received_at
     from public.inbound_commands c
     join public.projects p on p.project_id = c.project_id and p.office_id = p_office and not p.is_fixture
    where p_q is not null
      and c.office_id = p_office
      and (p_project is null or c.project_id = p_project)
      and not c.synthetic
      and not app.harness_label(c.dedupe_key)
      and (c.job_id is null or not app.harness_job(c.job_id))
      and to_tsvector('english', coalesce(nullif(c.instruction, ''), c.transcript, '')) @@ p_q
    order by 7 desc, 8 desc
    limit greatest(1, least(coalesce(p_limit, 20), 100)))
  union all
  (select 'answer',
          o.output_id::text,
          coalesce(nullif(s.name, ''), 'The team') || ' on ' || coalesce(nullif(j.kind, ''), 'a job'),
          ts_headline('english', coalesce(o.body, ''), p_q, 'MaxWords=24, MinWords=6, ShortWord=3, MaxFragments=1'),
          p.slug,
          '/p/' || p.slug || '/chat',
          ts_rank(to_tsvector('english', coalesce(o.body, '')), p_q),
          o.created_at
     from public.outputs o
     join public.jobs j on j.job_id = o.job_id and j.office_id = p_office
     join public.projects p on p.project_id = j.project_id and p.office_id = p_office and not p.is_fixture
     left join public.staff s on s.staff_id = o.staff_id
    where p_q is not null
      and (p_project is null or j.project_id = p_project)
      and not app.harness_job(j.job_id)
      and j.kind !~ '^(browser|research|notebook[.]ask)'
      and to_tsvector('english', coalesce(o.body, '')) @@ p_q
    order by 7 desc, 8 desc
    limit greatest(1, least(coalesce(p_limit, 20), 100)))
$f$;

-- The team's research: answers and made documents produced by research-shaped jobs.
create or replace function app.psearch_research(p_office uuid, p_project uuid, p_q tsquery, p_limit integer)
returns table (kind text, id text, title text, snippet text, project_slug text, url_hint text, score real, at timestamptz)
language sql
stable
security definer
set search_path = ''
as $f$
  (select 'research',
          o.output_id::text,
          coalesce(nullif(s.name, ''), 'The team') || ' - research',
          ts_headline('english', coalesce(o.body, ''), p_q, 'MaxWords=24, MinWords=6, ShortWord=3, MaxFragments=1'),
          p.slug,
          '/p/' || p.slug || '/chat',
          ts_rank(to_tsvector('english', coalesce(o.body, '')), p_q),
          o.created_at
     from public.outputs o
     join public.jobs j on j.job_id = o.job_id and j.office_id = p_office
     join public.projects p on p.project_id = j.project_id and p.office_id = p_office and not p.is_fixture
     left join public.staff s on s.staff_id = o.staff_id
    where p_q is not null
      and (p_project is null or j.project_id = p_project)
      and not app.harness_job(j.job_id)
      and j.kind ~ '^(browser|research|notebook[.]ask)'
      and to_tsvector('english', coalesce(o.body, '')) @@ p_q
    order by 7 desc, 8 desc
    limit greatest(1, least(coalesce(p_limit, 20), 100)))
  union all
  (select 'research',
          d.document_id::text,
          coalesce(nullif(d.title, ''), '(untitled)'),
          ts_headline('english', coalesce(d.content, ''), p_q, 'MaxWords=24, MinWords=8, ShortWord=3, MaxFragments=1'),
          p.slug,
          '/p/' || p.slug || '/documents?focus=' || d.document_id::text,
          ts_rank(d.search, p_q),
          d.updated_at
     from public.documents d
     join public.projects p on p.project_id = d.project_id and p.office_id = p_office and not p.is_fixture
     join public.jobs j on j.job_id = d.produced_by_job and j.office_id = p_office
    where p_q is not null
      and d.office_id = p_office
      and (p_project is null or d.project_id = p_project)
      and d.origin = 'made'
      and d.search @@ p_q
      and app.document_in_play(d.state, d.origin, d.project_id, d.connector, d.external_parent_ref)
      and not app.harness_job(j.job_id)
      and j.kind ~ '^(browser|research|notebook[.]ask)'
    order by 7 desc, 8 desc
    limit greatest(1, least(coalesce(p_limit, 20), 100)))
$f$;

-- Post-its: the text inside the workspace document. The owner is the office's own person, so a layout row that
-- belongs to anyone else is not read.
create or replace function app.psearch_postits(p_office uuid, p_project uuid, p_q tsquery, p_limit integer)
returns table (kind text, id text, title text, snippet text, project_slug text, url_hint text, score real, at timestamptz)
language sql
stable
security definer
set search_path = ''
as $f$
  select 'postit',
         n.note ->> 'id',
         'Post-it',
         ts_headline('english', n.note ->> 'text', p_q, 'MaxWords=24, MinWords=4, ShortWord=3, MaxFragments=1'),
         p.slug,
         '/p/' || p.slug,
         ts_rank(to_tsvector('english', n.note ->> 'text'), p_q),
         l.updated_at
    from public.dashboard_layouts l
    join public.projects p on p.project_id = l.project_id and p.office_id = p_office and not p.is_fixture
    cross join lateral jsonb_array_elements(l.panels) as m(mod)
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(m.mod -> 'postits') = 'array' then m.mod -> 'postits' else '[]'::jsonb end) as n(note)
   where p_q is not null
     and l.surface = 'basecamp'
     and l.owner = app.office_actor(p_office)
     and (p_project is null or l.project_id = p_project)
     and jsonb_typeof(l.panels) = 'array'
     and m.mod ->> 'id' = '__workspace'
     and jsonb_typeof(n.note -> 'text') = 'string'
     and to_tsvector('english', n.note ->> 'text') @@ p_q
   order by 7 desc, 8 desc
   limit greatest(1, least(coalesce(p_limit, 20), 100))
$f$;

-- Calendar events, only if 0897's table is here and shaped as expected. Never raises.
create or replace function app.psearch_events(p_office uuid, p_project uuid, p_q tsquery, p_limit integer)
returns table (kind text, id text, title text, snippet text, project_slug text, url_hint text, score real, at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $f$
declare
  cols text[];
  v_id text; v_start text; v_desc text; v_loc text; v_text text;
begin
  if p_q is null or to_regclass('public.project_events') is null then return; end if;
  select array_agg(column_name::text) into cols
    from information_schema.columns where table_schema = 'public' and table_name = 'project_events';
  v_id    := case when 'event_id' = any(cols) then 'event_id' when 'id' = any(cols) then 'id' end;
  v_start := case when 'starts_at' = any(cols) then 'starts_at' when 'start_at' = any(cols) then 'start_at' end;
  v_desc  := case when 'description' = any(cols) then 'description' when 'notes' = any(cols) then 'notes'
                  when 'detail' = any(cols) then 'detail' end;
  v_loc   := case when 'location' = any(cols) then 'location' end;
  if v_id is null or v_start is null
     or not ('office_id' = any(cols) and 'project_id' = any(cols) and 'title' = any(cols)) then
    return;
  end if;
  v_text := format('coalesce(e.title, '''') || '' '' || coalesce(%s, '''') || '' '' || coalesce(%s, '''')',
                   case when v_desc is null then 'null' else 'e.' || quote_ident(v_desc) end,
                   case when v_loc is null then 'null' else 'e.' || quote_ident(v_loc) end);
  return query execute format($q$
    select 'event'::text,
           e.%1$I::text,
           coalesce(nullif(e.title, ''), '(untitled event)'),
           ts_headline('english', %2$s, $2, 'MaxWords=24, MinWords=4, ShortWord=3, MaxFragments=1'),
           p.slug,
           '/p/' || p.slug || '/schedule?focus=' || e.%1$I::text,
           ts_rank(to_tsvector('english', %2$s), $2),
           e.%3$I::timestamptz
      from public.project_events e
      join public.projects p on p.project_id = e.project_id and p.office_id = $1 and not p.is_fixture
     where e.office_id = $1
       and ($3 is null or e.project_id = $3)
       and to_tsvector('english', %2$s) @@ $2
     order by 7 desc, 8 desc
     limit greatest(1, least(coalesce($4, 20), 100))
  $q$, v_id, v_text, v_start) using p_office, p_q, p_project, p_limit;
end
$f$;

-- What the page may offer. `available` is a fact about this database, not a hope.
create or replace function app.project_search_providers(p_office uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $f$
begin
  perform app.require_office(p_office);
  return jsonb_build_array(
    jsonb_build_object('provider', 'documents', 'kinds', jsonb_build_array('document', 'source', 'page'), 'available', true),
    jsonb_build_object('provider', 'tasks',     'kinds', jsonb_build_array('task'),                        'available', true),
    jsonb_build_object('provider', 'chat',      'kinds', jsonb_build_array('message', 'answer'),           'available', true),
    jsonb_build_object('provider', 'research',  'kinds', jsonb_build_array('research'),                    'available', true),
    jsonb_build_object('provider', 'postits',   'kinds', jsonb_build_array('postit'),                      'available', true),
    jsonb_build_object('provider', 'events',    'kinds', jsonb_build_array('event'),
                       'available', to_regclass('public.project_events') is not null)
  );
end
$f$;

drop function if exists public.project_search(uuid, text, uuid, integer, text);
drop function if exists app.project_search(uuid, text, uuid, integer, text);

create function app.project_search(
  p_office  uuid,
  p_query   text,
  p_project uuid default null,
  p_limit   integer default 20,
  p_kinds   text default null
)
returns table (kind text, id text, title text, snippet text, project_slug text, url_hint text, score real, at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $f$
declare
  v_q tsquery;
  v_kinds text[];
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 50));
begin
  perform app.require_office(p_office);
  v_q := websearch_to_tsquery('english', btrim(coalesce(p_query, '')));
  -- a query with no lexemes ("the and of") is NULL here and matches nothing: the answer is "nothing", not an error
  if v_q is null or v_q::text = '' then return; end if;
  -- a project of another office is a project that does not exist
  if p_project is not null
     and not exists (select 1 from public.projects where project_id = p_project and office_id = p_office) then
    return;
  end if;
  v_kinds := case when nullif(btrim(coalesce(p_kinds, '')), '') is null then null
                  else string_to_array(lower(regexp_replace(p_kinds, '\s+', '', 'g')), ',') end;

  return query
  select h.kind, h.id, h.title, h.snippet, h.project_slug, h.url_hint, h.score, h.at
    from (
      select * from app.psearch_documents(p_office, p_project, v_q, v_limit)
      union all select * from app.psearch_tasks(p_office, p_project, v_q, v_limit)
      union all select * from app.psearch_chat(p_office, p_project, v_q, v_limit)
      union all select * from app.psearch_research(p_office, p_project, v_q, v_limit)
      union all select * from app.psearch_postits(p_office, p_project, v_q, v_limit)
      union all select * from app.psearch_events(p_office, p_project, v_q, v_limit)
    ) h
   where v_kinds is null or h.kind = any(v_kinds)
   order by h.score desc, h.at desc
   limit v_limit;
end
$f$;

create function public.project_search(
  p_office  uuid,
  p_query   text,
  p_project uuid default null,
  p_limit   integer default 20,
  p_kinds   text default null
)
returns table (kind text, id text, title text, snippet text, project_slug text, url_hint text, score real, at timestamptz)
language sql
stable
security definer
set search_path = ''
as $f$ select * from app.project_search(p_office, p_query, p_project, p_limit, p_kinds) $f$;

create or replace function public.project_search_providers(p_office uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $f$ select app.project_search_providers(p_office) $f$;

commit;
