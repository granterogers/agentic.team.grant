-- 0065 — the fixed shapes an MCP client may read
--
-- ADR-0014: named tools over reviewed projections, never "run this SQL". Same
-- rule as the HQ API and for a stronger reason — that endpoint serves a page we
-- wrote, and this one serves a general-purpose model that will try things.
--
-- Each function below is a tool. There are five, they are read-only, and the
-- projection is the review surface: if a column should not leave this database,
-- it is absent here rather than filtered somewhere downstream.
--
-- What is deliberately NOT exposed, and why, because the omissions are the
-- design:
--
--   * anything in `vault`, `slack_app_credentials`, `mcp_clients`,
--     `connection_health` — credentials and credential references. §15.
--   * `inference_usage` — reading it is harmless, but a model that can see its
--     own budget is a model that can reason about spending it.
--   * `inbound_commands` — Grant's raw instructions, including whatever he
--     typed in a DM. The team's *decisions* are public to a client; his
--     messages are not.
--
-- The `search` tool is the point of the whole exercise: it is the same
-- `app.search_documents` the office uses, with the same 'any' matching, so a
-- model asking a question of the corpus gets exactly what a director would.

begin;

-- 1. What the team is and what it is working on.
create or replace function app.mcp_projects()
returns jsonb
language sql stable security definer set search_path = public, pg_catalog
as $$
  select coalesce(jsonb_agg(x order by x->>'name'), '[]'::jsonb) from (
    select jsonb_build_object(
             'project_id', p.project_id,
             'slug', p.slug,
             'name', p.name,
             'status', p.status,
             'documents', (select count(*) from public.documents d where d.project_id = p.project_id),
             'live_jobs', (select count(*) from public.jobs j
                            where j.project_id = p.project_id
                              and j.state not in ('complete', 'cancelled', 'failed')),
             'updated_at', p.updated_at
           ) as x
      from public.projects p
     where p.status = 'active'
  ) s
$$;

-- 2. The corpus, searched. The reason a model is here at all.
create or replace function app.mcp_search(p_query text, p_project text default null, p_limit integer default 8)
returns jsonb
language sql stable security definer set search_path = public, pg_catalog
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'document_id', s.document_id,
           'title', s.title,
           'connector', s.connector,
           'project', (select p.slug from public.projects p where p.project_id = s.project_id),
           'rank', s.rank,
           'snippet', s.snippet
         ) order by s.rank desc), '[]'::jsonb)
    from app.search_documents(
           p_query,
           (select p.project_id from public.projects p where p.slug = p_project),
           greatest(1, least(coalesce(p_limit, 8), 25)),
           'any'
         ) s
$$;

-- 3. One document in full. Bounded, because a 69,000-character article returned
--    whole is a context window spent on one call.
create or replace function app.mcp_document(p_document_id uuid, p_max_chars integer default 20000)
returns jsonb
language sql stable security definer set search_path = public, pg_catalog
as $$
  select coalesce(
    (select jsonb_build_object(
              'document_id', d.document_id,
              'title', d.title,
              'connector', d.connector,
              'project', (select p.slug from public.projects p where p.project_id = d.project_id),
              'chars', d.content_chars,
              'truncated', d.content_chars > greatest(1000, least(coalesce(p_max_chars, 20000), 60000)),
              'fetched_at', d.fetched_at,
              'content', left(coalesce(d.content, ''),
                              greatest(1000, least(coalesce(p_max_chars, 20000), 60000)))
            )
       from public.documents d where d.document_id = p_document_id),
    jsonb_build_object('error', 'no such document'))
$$;

-- 4. Who the team is. §9's roster, so a client knows who it is talking about.
create or replace function app.mcp_staff()
returns jsonb
language sql stable security definer set search_path = public, pg_catalog
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'slug', s.slug, 'name', s.name, 'title', s.title,
           'responsibilities', s.responsibilities, 'expertise', s.expertise
         ) order by s.slug), '[]'::jsonb)
    from public.staff s where s.active
$$;

-- 5. What the team recently concluded. Outputs and their provenance — never
--    Grant's raw instructions, which is why this reads `outputs` and not
--    `inbound_commands`.
create or replace function app.mcp_recent_work(p_limit integer default 20)
returns jsonb
language sql stable security definer set search_path = public, pg_catalog
as $$
  select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb) from (
    select jsonb_build_object(
             'output_id', o.output_id,
             'project', (select p.slug from public.projects p where p.project_id = j.project_id),
             'kind', j.kind,
             'staff', (select st.slug from public.staff st where st.staff_id = o.staff_id),
             'confidence', o.confidence,
             'evidence', o.evidence,
             'reviewed', o.reviewer_status,
             'sources', o.sources,
             'model', o.model,
             'created_at', o.created_at,
             'body', left(o.body, 4000)
           ) as x
      from public.outputs o
      join public.jobs j on j.job_id = o.job_id
     order by o.created_at desc
     limit greatest(1, least(coalesce(p_limit, 20), 50))
  ) s
$$;

comment on function app.mcp_search is
  'The same search the office uses, with the same ''any'' matching, so a model '
  'asking a question of the corpus gets what a director would get.';
comment on function app.mcp_recent_work is
  'Outputs and their provenance. Deliberately not inbound_commands: the team''s '
  'decisions are visible to a client, Grant''s messages are not.';

do $$
declare fn text;
begin
  foreach fn in array array[
    'app.mcp_projects()', 'app.mcp_search(text, text, integer)',
    'app.mcp_document(uuid, integer)', 'app.mcp_staff()', 'app.mcp_recent_work(integer)'
  ] loop
    execute format('revoke all on function %s from public', fn);
    execute format('grant execute on function %s to ai_team_app, service_role', fn);
  end loop;
end $$;

commit;
