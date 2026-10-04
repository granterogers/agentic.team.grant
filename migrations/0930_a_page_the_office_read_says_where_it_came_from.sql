-- 0930: a page the office read for a project says where it came from, and the web is something the office can search.
--
-- WHAT THIS ADDS, AND WHAT IT DELIBERATELY DOES NOT (0310: do not store a fact you can already read).
--
-- A saved web page is already a `public.documents` row (origin 'source', connector 'browser'). Of the provenance asked for,
-- almost everything is readable where it already lives:
--   url               documents.external_ref
--   title             documents.title
--   retrieval date    documents.fetched_at (a downloaded file has no text, so its updated_at)
--   project           documents.project_id
--   originating job   documents.produced_by_job
--   agent             that job's recipient_agent, else the 'by' the door recorded in its pinned_config
--   research task     the web.research job itself (or its parent), and the question in its pinned_config
--   indexed           documents.content is not null (documents.search is GENERATED from it)
--   screenshot        the latest ok 'shot' row in browser_actions for that url and project (shot_path)
--   evidence          outputs.sources, which sourceRefs()/artifact write as 'browser:<document_id> <title>'
-- None of that is copied into a second place. The ONE fact nothing held is HOW the page was found: which search, which
-- rank, or which page's link it was reached from. That goes on the append-only ledger row that recorded the read
-- (browser_actions.found_via), because that row is the event and the question is a property of the event.
--
-- Also here:
--   * app.browser_note_via: browser_note with the new column. browser_note now DELEGATES to it (two writers of one field
--     must share one body - 0472), and keeps its nine-argument signature, so no overload is created.
--   * app.web_file_refusal / app.record_web_file: a downloaded file is stored only if its type is on an allow-list and it
--     is under a size cap. TS (src/browser/download.ts) refuses first; this is the second place, because a writer that
--     trusts its caller is how a rule gets bypassed by the next caller.
--   * app.hq_project_sources_web + public wrapper: the reader the Sources page calls (gateway section web_sources).
--   * web.search is ENABLED, in the same change that implements it (0298's own instruction), and web.read now names both
--     job kinds that deliver it.

-- ---------------------------------------------------------------------------------------------------------------------
-- how a read was reached
-- ---------------------------------------------------------------------------------------------------------------------
alter table public.browser_actions add column if not exists found_via jsonb;

alter table public.browser_actions drop constraint if exists browser_actions_found_via_shape;
alter table public.browser_actions add constraint browser_actions_found_via_shape
  check (found_via is null or jsonb_typeof(found_via) = 'object');

comment on column public.browser_actions.found_via is
  'How this page was reached, when the office went looking rather than being told: {"how":"search","query":"...","rank":2} '
  'or {"how":"link","from":"https://...","depth":1}. Null for an address a person named. A property of the read, so it lives '
  'on the ledger row that recorded it and nowhere else.';

create or replace function app.browser_note_via(
  p_office uuid, p_session uuid, p_job uuid, p_verb text, p_url text, p_ok boolean, p_detail text, p_shot text,
  p_ms integer, p_via jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_project uuid;
  v_session uuid;
  v_job uuid;
  v_id uuid;
begin
  perform app.require_office(p_office);
  -- A session or job that is another office's, or nobody's, is not written against: the same for both.
  select s.session_id, s.project_id into v_session, v_project
    from public.browser_sessions s
    join public.projects sp on sp.project_id = s.project_id and sp.office_id = p_office
   where s.session_id = p_session;
  select j.job_id into v_job from public.jobs j where j.job_id = p_job and j.office_id = p_office;
  if v_project is null then
    select j.project_id into v_project from public.jobs j where j.job_id = v_job;
  end if;
  insert into public.browser_actions
    (office_id, session_id, job_id, project_id, verb, url, ok, detail, shot_path, ms, found_via)
  values (p_office, v_session, v_job, v_project, p_verb, left(coalesce(p_url, ''), 2000), coalesce(p_ok, false),
          left(coalesce(p_detail, ''), 600), p_shot, greatest(coalesce(p_ms, 0), 0),
          case when jsonb_typeof(p_via) = 'object' then p_via else null end)
  returning action_id into v_id;
  if v_session is not null and coalesce(p_ok, false) then
    update public.browser_sessions
       set last_alive_at = app.now_utc(), updated_at = app.now_utc()
     where session_id = v_session;
  end if;
  return jsonb_build_object('ok', true, 'action_id', v_id);
end;
$function$;

create or replace function app.browser_note(p_office uuid, p_session uuid, p_job uuid, p_verb text, p_url text,
                                            p_ok boolean, p_detail text, p_shot text, p_ms integer)
returns jsonb
language sql
security definer
set search_path to ''
as $function$
  select app.browser_note_via(p_office, p_session, p_job, p_verb, p_url, p_ok, p_detail, p_shot, p_ms, null)
$function$;

revoke all on function app.browser_note_via(uuid, uuid, uuid, text, text, boolean, text, text, integer, jsonb)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- a downloaded file: an allow-list and a cap, enforced where it is written
-- ---------------------------------------------------------------------------------------------------------------------
-- The list is a property (documents a person reads and cannot run), not an enumeration of what is dangerous: anything not
-- named is refused, so a type nobody thought of fails closed. No HTML (a page is READ, not stored as a file), no SVG (it
-- carries script), no archive, no executable, no office macro format.
create or replace function app.web_file_refusal(p_mime text, p_bytes bigint)
returns text
language sql
immutable
set search_path to ''
as $function$
  select case
    when p_bytes is null or p_bytes <= 0 then 'the file was empty'
    when p_bytes > 10485760 then 'the file is larger than the 10 MB cap'
    when lower(split_part(coalesce(p_mime, ''), ';', 1)) not in (
      'application/pdf', 'text/plain', 'text/csv', 'text/markdown', 'application/json',
      'image/png', 'image/jpeg', 'image/gif', 'image/webp',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation')
      then format('%s is not a type the office keeps from the web', coalesce(nullif(split_part(coalesce(p_mime, ''), ';', 1), ''), 'an unknown type'))
    else null
  end
$function$;

create or replace function app.record_web_file(p_office uuid, p_project uuid, p_url text, p_title text,
                                               p_storage_path text, p_mime text, p_bytes bigint, p_job uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_id uuid;
  v_job uuid;
  v_why text;
  v_title text := nullif(trim(coalesce(p_title, '')), '');
  v_mime text := lower(split_part(coalesce(p_mime, ''), ';', 1));
begin
  perform app.require_office(p_office);
  if not exists (select 1 from public.projects where project_id = p_project and office_id = p_office) then
    return jsonb_build_object('error', 'there is no dashboard project by that id');
  end if;
  v_why := app.web_file_refusal(v_mime, p_bytes);
  if v_why is not null then
    return jsonb_build_object('error', v_why);
  end if;
  if coalesce(trim(p_storage_path), '') = '' then
    return jsonb_build_object('error', 'a kept file needs a storage path');
  end if;
  if v_title is null then
    return jsonb_build_object('error', 'a kept file needs a title');
  end if;
  select j.job_id into v_job from public.jobs j where j.job_id = p_job and j.office_id = p_office;
  insert into public.documents
    (office_id, project_id, title, doc_type, origin, connector, external_ref, state,
     storage_path, mime_type, byte_size, produced_by_job, tags)
  values
    (p_office, p_project, left(v_title, 300), 'file', 'source', 'browser', left(p_url, 2000), 'approved',
     p_storage_path, v_mime, p_bytes, v_job, array['download'])
  on conflict (project_id, external_ref) where connector = 'browser' and external_ref is not null
  do update set
     title = excluded.title, storage_path = excluded.storage_path, mime_type = excluded.mime_type,
     byte_size = excluded.byte_size, produced_by_job = excluded.produced_by_job, updated_at = app.now_utc()
  returning document_id into v_id;
  return jsonb_build_object('ok', true, 'document_id', v_id);
end;
$function$;

revoke all on function app.record_web_file(uuid, uuid, text, text, text, text, bigint, uuid)
  from public, anon, authenticated, service_role;
revoke all on function app.web_file_refusal(text, bigint) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- the reader: what the web gave a project, and where each piece came from
-- ---------------------------------------------------------------------------------------------------------------------
-- Harness exclusion asks app.harness_browsing - the same two-sided predicate the browsing ledger reader uses - for the
-- page AND for the output that cites it, so a suite's traffic is in neither the list nor the citation count.
create or replace function app.hq_project_sources_web(p_office uuid, p_slug text, p_limit text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $f$
declare
  v_project uuid;
  v_name    text;
  v_limit   int;
  v_pages   jsonb;
begin
  perform app.require_office(p_office);
  begin
    v_limit := least(greatest(coalesce(nullif(btrim(p_limit), '')::int, 100), 1), 500);
  exception when others then
    return jsonb_build_object('error', 'limit must be a whole number');
  end;
  select p.project_id, p.name into v_project, v_name
    from public.projects p where p.office_id = p_office and p.slug = p_slug;
  if v_project is null then
    return jsonb_build_object('error', format('no project called %L', p_slug));
  end if;

  select coalesce(jsonb_agg(x.j order by x.at desc), '[]'::jsonb) into v_pages
    from (
      select coalesce(d.fetched_at, d.updated_at) as at,
             jsonb_build_object(
               'document_id', d.document_id,
               'ref', 'browser:' || d.document_id::text,
               'url', d.external_ref,
               'title', d.title,
               'kind', case when d.storage_path is not null then 'file' else 'page' end,
               'retrieved_at', coalesce(d.fetched_at, d.updated_at),
               'project', jsonb_build_object('slug', p_slug, 'name', v_name),
               'agent', case when st.slug is null then null
                             else jsonb_build_object('slug', st.slug, 'name', st.name) end,
               'job_id', d.produced_by_job,
               'research_task', case when rt.job_id is null then null
                                     else jsonb_build_object('job_id', rt.job_id,
                                                             'label', nullif(left(rt.pinned_config ->> 'question', 200), '')) end,
               'found_via', rd.found_via,
               'indexed', d.content is not null,
               'has_excerpt', d.content is not null and length(btrim(d.content)) > 0,
               'excerpt', case when d.content is null then null
                               else left(regexp_replace(d.content, '\s+', ' ', 'g'), 280) end,
               'content_chars', d.content_chars,
               'file', case when d.storage_path is null then null
                            else jsonb_build_object('mime_type', d.mime_type, 'bytes', d.byte_size,
                                                    'storage_path', d.storage_path) end,
               'screenshot', jsonb_build_object('available', sh.shot_path is not null,
                                                'path', sh.shot_path, 'taken_at', sh.at),
               'citations', jsonb_build_object('count', coalesce(ci.n, 0), 'evidence', coalesce(ci.ev, '[]'::jsonb))
             ) as j
        from public.documents d
        left join public.jobs pj on pj.job_id = d.produced_by_job and pj.office_id = p_office
        left join public.staff st on st.slug = coalesce(pj.recipient_agent, pj.pinned_config ->> 'by')
        -- the research task is the web.research job that fetched the page, or the one that spawned the job that did
        left join lateral (
          select r.job_id, r.pinned_config
            from public.jobs r
           where r.office_id = p_office and r.kind = 'web.research'
             and r.job_id in (pj.job_id, pj.parent_job_id)
           order by (r.job_id = pj.job_id) desc
           limit 1
        ) rt on true
        left join lateral (
          select a.found_via
            from public.browser_actions a
           where a.office_id = p_office and a.project_id = d.project_id and a.url = d.external_ref
             and a.verb in ('read', 'download') and a.ok
           order by a.at desc limit 1
        ) rd on true
        left join lateral (
          select a.shot_path, a.at
            from public.browser_actions a
           where a.office_id = p_office and a.project_id = d.project_id and a.url = d.external_ref
             and a.verb = 'shot' and a.ok and a.shot_path is not null
           order by a.at desc limit 1
        ) sh on true
        left join lateral (
          select count(*)::int as n,
                 (jsonb_agg(jsonb_build_object('output_id', c.output_id, 'job_id', c.job_id, 'kind', c.kind,
                                               'at', c.created_at) order by c.created_at desc)
                    filter (where c.rn <= 5)) as ev
            from (
              select o.output_id, o.job_id, oj.kind, o.created_at,
                     row_number() over (order by o.created_at desc) as rn
                from public.outputs o
                join public.jobs oj on oj.job_id = o.job_id and oj.office_id = p_office
               where oj.project_id = d.project_id
                 and jsonb_typeof(o.sources) = 'array'
                 and not app.harness_job(oj.job_id)
                 and exists (select 1 from jsonb_array_elements_text(o.sources) e
                              where e like 'browser:' || d.document_id::text || '%')
            ) c
        ) ci on true
       where d.office_id = p_office and d.project_id = v_project
         and d.origin = 'source' and d.connector = 'browser'
         and d.external_ref is not null
         and not app.harness_browsing(d.produced_by_job, d.project_id)
       order by coalesce(d.fetched_at, d.updated_at) desc
       limit v_limit
    ) x;

  return jsonb_build_object(
    'project', jsonb_build_object('slug', p_slug, 'name', v_name),
    'count', jsonb_array_length(v_pages),
    'pages', v_pages);
end;
$f$;

revoke all on function app.hq_project_sources_web(uuid, text, text) from public, anon, authenticated, service_role;

create or replace function public.hq_project_sources_web(p_office uuid, p_slug text, p_limit text default null)
returns jsonb language sql stable security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_project_sources_web(p_office, p_slug, p_limit) $f$;

revoke all on function public.hq_project_sources_web(uuid, text, text) from public, anon, authenticated;
grant execute on function public.hq_project_sources_web(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- the registry says what is now true (0298: a row claims only what a named thing performs)
-- ---------------------------------------------------------------------------------------------------------------------
update public.tool_permissions
   set enabled = true,
       disabled_reason = null,
       delivered_by = 'job kind web.research',
       description = 'Search the public web for a question, read the best pages and the links one hop from them, and keep '
                     'the useful ones as project sources with where they came from. Takes a question; reads only, never '
                     'clicks, types or submits.',
       verbs = array['search the web for a question and keep the useful pages as project sources']
 where tool = 'web.search';

update public.tool_permissions
   set delivered_by = 'job kinds browser.gather and web.research',
       verbs = array['open a web address Grant names and file what the page says on the project']
 where tool = 'web.read';
