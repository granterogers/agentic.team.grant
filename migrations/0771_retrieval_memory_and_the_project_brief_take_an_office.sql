-- 0771 - retrieval, memory and the project brief take an office (multi-user P3, cluster g-context).
--
-- These are the functions whose output is pasted into a model's prompt: the documents a question finds, the lessons
-- and skills learned, the decisions already settled, what a project's connectors hold, the sibling projects a
-- question may widen to. The rule is stricter than for the other clusters: the office predicate is IN the statement
-- that fetches the rows (never retrieve-then-filter), so a limit-10 search by an office with one match returns that
-- one, however many matches another office holds.
--
--   app.search_documents(office, query, project, limit, match)
--   app.lessons_for(office, ...) / app.learn(office, ...)   a lesson is a carrier; its supersedes edge is read only
--                                                          within the office, and learn refuses a foreign target
--   app.skills_for(office, ...)                             skill grants are read through app.staff_may_use(office,...)
--   app.decisions_about(office, ...)
--   app.project_instruction_for / project_knowledge / container_refs / sibling_projects / projects_named_in (office, ...)
--
-- "Widen to the same office's other projects" (decision 6) is bounded by p_office, never by a project id alone.
--
-- Left in place on purpose until their last callers move (the lead drops them): app.search_documents(text, uuid,
-- integer, text) (app.mcp_search, the MCP door, calls it) and app.learn(lesson_scope, ...) (app.decide_suggestion, in
-- the governance cluster, calls it). Both are in schema app, which no browser role can execute. Their public doors
-- (public.search_documents, public.hq_search_documents, public.learn, public.lessons_for, public.skills_for,
-- public.decisions_about, public.project_knowledge, public.project_instruction_for, public.container_refs) are dropped:
-- nothing in the gateway or the edge functions reaches them.

create function app.search_documents(p_office uuid, p_query text, p_project uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 10, p_match text DEFAULT 'all'::text)
 RETURNS TABLE(document_id uuid, project_id uuid, connector text, title text, rank real, snippet text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
#variable_conflict use_column
begin
  -- First, and always: a query with no lexemes must not get as far as an answer for an office that does not exist.
  perform app.require_office(p_office);
  return query
  with q as (
    select case
             when p_match = 'any' then
               nullif(
                 array_to_string(
                   tsvector_to_array(to_tsvector('english', coalesce(p_query, ''))), ' | '
                 ), ''
               )::tsquery
             else websearch_to_tsquery('english', coalesce(p_query, ''))
           end as tsq
  )
  select d.document_id,
         d.project_id,
         d.connector,
         d.title,
         ts_rank(d.search, q.tsq) as rank,
         ts_headline('english', coalesce(d.content, ''), q.tsq,
                     'MaxWords=40, MinWords=20, ShortWord=3, MaxFragments=2') as snippet
    from public.documents d, q
   -- A query with no lexemes at all - "the and of" - is null here, and the
   -- match operator against null is null, so it matches nothing. That is the
   -- correct answer and not an error: there was nothing to search for.
   where d.office_id = p_office
     and q.tsq is not null
     and d.search @@ q.tsq
     and (p_project is null or d.project_id = p_project)
     -- A route being closed does not hide what it already brought in. Section
     -- 17 turns off a connector, not the documents it fed.
     --
     -- ADR-0040: archived material keeps its row, its content and its
     -- relations, and leaves ordinary retrieval.
     and coalesce(d.state, '') <> 'archived'
     -- One document, one hit. A mirror steps aside only when the thing it
     -- mirrors is visible here too.
     and not exists (
       select 1 from public.documents o
        where o.document_id = d.mirrors_document_id
          and o.office_id = p_office
          and coalesce(o.state, '') <> 'archived'
          and (p_project is null or o.project_id = p_project)
     )
   order by rank desc, d.updated_at desc
   limit greatest(1, least(p_limit, 100));
end
$function$;

revoke all on function app.search_documents(uuid, text, uuid, integer, text) from public, anon, authenticated, service_role;

create function app.lessons_for(p_office uuid, p_project_id uuid DEFAULT NULL::uuid, p_staff_slug text DEFAULT NULL::text, p_job_kind text DEFAULT NULL::text, p_limit integer DEFAULT 8, p_include_harness boolean DEFAULT false)
 RETURNS TABLE(lesson_id uuid, scope lesson_scope, body text, observations integer, confidence numeric, learned_by text, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select l.lesson_id, l.scope, l.body, l.observations, l.confidence,
         l.learned_by, l.created_at
    from public.lessons l
   where l.office_id = app.require_office(p_office)
     and l.row_kind = 'lesson'
     -- a revision hides what it revises only inside the office: an edge from another office's row is not a revision
     and not exists (select 1 from public.lessons r where r.supersedes = l.lesson_id and r.office_id = p_office)
     and (p_include_harness
          or (not l.is_fixture
              and not coalesce(app.harness_job(l.from_job), false)))
     and ((l.scope = 'global')
      or (l.scope = 'project' and l.project_id = p_project_id)
      or (l.scope = 'staff'   and l.staff_slug = p_staff_slug)
      or (l.scope = 'kind'    and l.job_kind   = p_job_kind))
   order by
     -- Specificity first. The general lesson is usually already reflected in
     -- how the office is built; the specific one is what nobody knew.
     case l.scope when 'staff' then 0 when 'kind' then 1 when 'project' then 2 else 3 end,
     l.observations desc,
     l.confidence desc,
     l.created_at desc
   limit greatest(coalesce(p_limit, 8), 0)
$function$;

revoke all on function app.lessons_for(uuid, uuid, text, text, integer, boolean) from public, anon, authenticated, service_role;

create function app.learn(p_office uuid, p_scope lesson_scope, p_body text, p_learned_by text, p_project_id uuid DEFAULT NULL::uuid, p_staff_slug text DEFAULT NULL::text, p_job_kind text DEFAULT NULL::text, p_from_job uuid DEFAULT NULL::uuid, p_confidence numeric DEFAULT 0.50, p_supersedes uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  prior public.lessons%rowtype;
  seen  integer := 1;
  made  public.lessons%rowtype;
begin
  perform app.require_office(p_office);
  -- A project or a job of another office is refused exactly as one that does not exist is.
  if p_project_id is not null and app.office_project(p_office, p_project_id) is null then
    return jsonb_build_object('error', 'no such project');
  end if;
  if p_from_job is not null and not exists (
       select 1 from public.jobs j where j.job_id = p_from_job and j.office_id = p_office) then
    return jsonb_build_object('error', 'no such job');
  end if;
  if p_supersedes is not null then
    select * into prior from public.lessons where lesson_id = p_supersedes and office_id = p_office;
    if not found then
      return jsonb_build_object('error', 'nothing to supersede: ' || p_supersedes::text);
    end if;
    -- Superseding a row that is already superseded would lose the newer belief.
    if exists (select 1 from public.lessons where supersedes = p_supersedes and office_id = p_office) then
      return jsonb_build_object('error', 'that lesson has already been revised');
    end if;
    seen := prior.observations + 1;
  end if;

  insert into public.lessons
    (office_id, row_kind, scope, project_id, staff_slug, job_kind, body,
     learned_by, from_job, confidence, observations, supersedes)
  values
    (p_office, 'lesson', p_scope, p_project_id, p_staff_slug, p_job_kind, p_body,
     p_learned_by, p_from_job, least(greatest(p_confidence, 0), 1), seen, p_supersedes)
  returning * into made;

  /*
    Into the ledger (#53).

    `actor_kind` is decided by who says they learned it: Grant teaching the
    office in a Telegram message is a user acting, and an agent drawing its own
    conclusion is the autonomous case this issue is actually about. Conflating
    them would make "what has it decided by itself" unanswerable, which is the
    one question the ledger exists to answer here.
  */
  perform app.append_event(
    p_office,
    coalesce((select correlation_id from public.jobs where job_id = p_from_job and office_id = p_office),
             extensions.gen_random_uuid()),
    case when p_learned_by = app.office_actor(p_office) then 'user' else 'agent' end,
    p_learned_by, 'learning', 'office.learned',
    true, p_project_id, null,
    jsonb_build_object('lesson_id', made.lesson_id, 'scope', p_scope,
                       'observations', made.observations),
    left(p_body, 1000), '[]'::jsonb, null, null,
    'app.unlearn(lesson_id, by, reason)',
    p_from_job);

  return jsonb_build_object(
    'lesson_id', made.lesson_id,
    'observations', made.observations,
    'replaced', p_supersedes
  );
end;
$function$;

revoke all on function app.learn(uuid, lesson_scope, text, text, uuid, text, text, uuid, numeric, uuid) from public, anon, authenticated, service_role;

create function app.skills_for(p_office uuid, p_staff_slug text DEFAULT NULL::text, p_job_kind text DEFAULT NULL::text, p_project_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 4)
 RETURNS TABLE(skill_id uuid, name text, scope lesson_scope, when_to_use text, procedure text, tools text[], missing text[], authored_by text, version integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select s.skill_id, s.name, s.scope, s.when_to_use, s.procedure,
         coalesce(t.all_tools, '{}') as tools,
         coalesce(t.not_held, '{}') as missing,
         s.authored_by, s.version
    from public.skills s
    left join lateral (
      select array_agg(st.tool order by st.tool) as all_tools,
             array_remove(array_agg(
               -- The one column that turns a procedure into a request. Computed
               -- by asking the authorisation path; the authorisation path is
               -- never asked to look the other way (ADR-0017).
               case when app.staff_may_use(p_office, coalesce(p_staff_slug, ''), st.tool)
                    then null else st.tool end
               order by st.tool), null) as not_held
        from public.skill_tools st
       where st.skill_id = s.skill_id
    ) t on true
   where s.office_id = app.require_office(p_office)
     and s.row_kind = 'skill'
     and not exists (select 1 from public.skills n where n.supersedes = s.skill_id and n.office_id = p_office)
     and ((s.scope = 'global')
      or (s.scope = 'staff'   and s.staff_slug = p_staff_slug)
      or (s.scope = 'kind'    and s.job_kind   = p_job_kind)
      or (s.scope = 'project' and s.project_id = p_project_id))
   order by
     -- Same ranking rule as lessons: the specific one is what nobody knew, the
     -- general one is usually already reflected in how the office is built.
     case s.scope when 'staff' then 0 when 'kind' then 1 when 'project' then 2 else 3 end,
     s.created_at desc
   limit greatest(coalesce(p_limit, 4), 0)
$function$;

revoke all on function app.skills_for(uuid, text, text, uuid, integer) from public, anon, authenticated, service_role;

create function app.decisions_about(p_office uuid, p_text text, p_limit integer DEFAULT 4)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select coalesce(jsonb_agg(q.v order by q.rank desc, q.at desc), '[]'::jsonb)
    from (
      select d.decided_at as at,
             ts_rank(d.search, websearch_to_tsquery('english', p_text))
               + extensions.similarity(d.question, p_text) as rank,
             jsonb_build_object(
               'id', d.decision_id,
               'question', d.question,
               'chose', d.chose,
               'ruled_out', to_jsonb(d.ruled_out),
               'because', d.because,
               'by', d.decided_by,
               'at', d.decided_at,
               'project', p.name,
               'supersedes', d.supersedes) as v
        from public.decisions d
        left join public.projects p on p.project_id = d.project_id and p.office_id = p_office
       where d.office_id = app.require_office(p_office)
         and not exists (select 1 from public.decisions n where n.supersedes = d.decision_id and n.office_id = p_office)
         and not d.is_fixture
         and (d.search @@ websearch_to_tsquery('english', p_text)
              or extensions.similarity(d.question, p_text) > 0.25
              -- The options it beat, which the generated vector cannot hold
              -- (see the column comment). "Did we look at Drive?" has to find
              -- the decision that ruled Drive out.
              or extensions.similarity(array_to_string(d.ruled_out, ' '), p_text) > 0.25)
       order by 2 desc, 1 desc
       limit greatest(1, least(coalesce(p_limit, 4), 10))
    ) q;
$function$;

revoke all on function app.decisions_about(uuid, text, integer) from public, anon, authenticated, service_role;

create function app.project_instruction_for(p_office uuid, p_project_id uuid, p_staff_slug text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    (select ps.instruction
       from public.project_staff ps
       join public.staff s on s.staff_id = ps.staff_id
       join public.projects pr on pr.project_id = ps.project_id and pr.office_id = app.require_office(p_office)
      where ps.project_id = p_project_id and s.slug = p_staff_slug),
    '')
$function$;

revoke all on function app.project_instruction_for(uuid, uuid, text) from public, anon, authenticated, service_role;

create function app.project_knowledge(p_office uuid, p_project uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  with attached as (
    select a.connector,
           count(*)::int as attachments,
           max(a.last_synced_at) as last_synced
      from public.project_attachments a
     where a.project_id = app.office_project(app.require_office(p_office), p_project)
       and a.enabled
     group by a.connector
  ),
  indexed as (
    select d.connector,
           count(*)::int as documents,
           max(coalesce(d.fetched_at, d.updated_at)) as newest
      from public.documents d
     where d.office_id = p_office
       and d.project_id = app.office_project(p_office, p_project)
       and coalesce(btrim(d.connector), '') <> ''
     group by d.connector
  ),
  /*
    Every connector that is attached OR has fed something in.

    Named `covered` rather than `both`, which is a reserved word — `trim(both
    ...)` — and produced a syntax error pointing at the CTE name.

    A full outer join rather than a left one: a connector whose attachment was
    removed can still have documents (§17 turns off a route, not what it
    brought in), and a reader that hid those would be understating what the
    office holds -- the opposite failure to the one this exists for, and just
    as dishonest.
  */
  covered as (
    select coalesce(a.connector, i.connector) as connector,
           coalesce(a.attachments, 0) as attachments,
           a.last_synced,
           coalesce(i.documents, 0) as documents,
           i.newest
      from attached a
      full outer join indexed i on i.connector = a.connector
  ),
  /*
    Mail as a domain the office can be blind to (#172, ADR-0037).

    Narrowed to a project that has at least one CONTACT with an address, and
    deliberately not to one that merely has an alias: almost every project has
    a name of four characters or more, so the wider rule would put a caveat on
    every answer the office gives whenever Gmail is down -- and CLAUDE.md
    already records what a caveat on every turn costs. A contact is Grant
    saying this project has correspondents, which is what makes the gap worth
    reporting.

    Stale rather than empty. An inbox with nothing new in it is normal; a cache
    that has not been refreshed in a day means the reader is broken, which is
    the case today -- Google is refusing the stored refresh token and the mail
    has been 40 hours old without anything saying so.
  */
  mail as (
    select exists (
             select 1 from public.contacts c
              where c.project_id = app.office_project(p_office, p_project)
                and coalesce(btrim(c.email), '') <> ''
           )
           and coalesce(
                 (select max(m.last_seen_at) from public.mail_messages m where m.office_id = p_office),
                 'epoch'::timestamptz
               ) < app.now_utc() - interval '24 hours' as blind
  )
  select jsonb_build_object(
    'as_of', app.now_utc(),
    'documents', (select coalesce(sum(documents), 0)::int from covered),
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object(
               'connector', b.connector,
               'attached', b.attachments > 0,
               'documents', b.documents,
               'newest', b.newest,
               'last_synced', b.last_synced,
               -- Attached, and nothing of it is in the index. The case this
               -- function exists for.
               'blank', b.attachments > 0 and b.documents = 0)
             order by b.documents desc, b.connector)
        from covered b), '[]'::jsonb),
    /*
      The connectors a search CANNOT speak for.

      Named rather than counted, because the sentence the office has to be able
      to say is "nothing in what I have indexed, and Drive is not indexed" --
      and a count cannot name Drive.
    */
    'blank', coalesce((
      select jsonb_agg(x order by x) from (
        select b.connector as x from covered b where b.attachments > 0 and b.documents = 0
        union all
        select 'mail' from mail where mail.blind
      ) named), '[]'::jsonb),
    -- True only when every attached connector has fed something in. A search
    -- that finds nothing may be reported as an absence ONLY when this is true.
    'complete', not exists (
      select 1 from covered b where b.attachments > 0 and b.documents = 0)
      and not (select mail.blind from mail)
  );
$function$;

revoke all on function app.project_knowledge(uuid, uuid) from public, anon, authenticated, service_role;

create function app.container_refs(p_office uuid, p_project_id uuid, p_connector text)
 RETURNS TABLE(external_ref text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select a.external_ref
    from public.project_attachments a
    join public.projects pr on pr.project_id = a.project_id and pr.office_id = app.require_office(p_office)
   where a.project_id = p_project_id
     and a.connector = p_connector
     and a.external_ref is not null
$function$;

revoke all on function app.container_refs(uuid, uuid, text) from public, anon, authenticated, service_role;

create function app.sibling_projects(p_office uuid, p_project uuid)
 returns table(project_id uuid, slug text, name text, account_level boolean)
 language sql
 stable security definer
 set search_path to 'public', 'pg_catalog'
as $function$
  -- The other projects of THIS office (decision 6: widening is bounded by the office, never by a project id alone).
  -- The office's own catch-all, 'unnamed', is the account-level project; it is read here and never created here.
  select p.project_id, p.slug, p.name, (p.slug = 'unnamed')
    from public.projects p
   where p.office_id = app.require_office(p_office)
     and p.status = 'active'
     and not p.is_fixture
     and p.project_id is distinct from coalesce(
           p_project,
           (select u.project_id from public.projects u where u.office_id = p_office and u.slug = 'unnamed'))
     -- A test project has no office around it: a harness turn must not read a real project's documents.
     and not coalesce((select a.is_fixture from public.projects a where a.project_id = p_project and a.office_id = p_office), false)
$function$;
revoke all on function app.sibling_projects(uuid, uuid) from public, anon, authenticated, service_role;

create function app.projects_named_in(p_office uuid, p_text text, p_project uuid)
 RETURNS TABLE(project_id uuid, slug text, name text, account_level boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select s.project_id, s.slug, s.name, s.account_level
    from app.sibling_projects(p_office, p_project) s
   where exists (
     select 1
       from (select s.name as phrase
             union
             select a.alias from public.project_aliases a where a.project_id = s.project_id) n
      where length(btrim(n.phrase)) >= 4
        and lower(coalesce(p_text, '')) ~ ('\m' || regexp_replace(lower(btrim(n.phrase)), '([^a-z0-9 ])', '\\\1', 'g') || '\M')
   )
$function$;

revoke all on function app.projects_named_in(uuid, text, uuid) from public, anon, authenticated, service_role;


-- The old signatures. A second overload makes calls ambiguous and keeps an unscoped door open.
drop function app.lessons_for(uuid, text, text, integer, boolean);
drop function app.skills_for(text, text, uuid, integer);
drop function app.decisions_about(text, integer);
drop function app.project_instruction_for(uuid, text);
drop function app.project_knowledge(uuid);
drop function app.container_refs(uuid, text);
drop function app.projects_named_in(text, uuid);
drop function app.sibling_projects(uuid);
-- and their unscoped public doors
drop function public.search_documents(text, uuid, integer, text);
drop function public.hq_search_documents(text, uuid, integer, text);
drop function public.learn(lesson_scope, text, text, uuid, text, text, uuid, numeric, uuid);
drop function public.lessons_for(uuid, text, text, integer);
drop function public.skills_for(text, text, uuid, integer);
drop function public.decisions_about(text, integer);
drop function public.project_instruction_for(uuid, text);
drop function public.project_knowledge(uuid);
drop function public.container_refs(uuid, text);
