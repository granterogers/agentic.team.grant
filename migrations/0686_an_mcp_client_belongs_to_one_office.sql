-- 0686 - an MCP client belongs to exactly one office, and the credential itself establishes it (multi-user P3, wave 10).
--
-- Before: a token resolved to a client and the client to "the deployment": every tool read every office, and the consent page's
-- password was the machine key - a credential that names nobody - so whoever held it could connect any AI app to the whole
-- store. Now:
--   * an authorisation code is issued FOR an office (the one the consenting person's verified login resolved to; the machine
--     key's is the test office), and redeeming it binds the client row to that office;
--   * a client already bound to one office can never be re-bound to another by a second consent (it is refused as an invalid
--     grant); `mcp_clients.office_id` is immutable already (P2) and a token hash is globally unique;
--   * `mcp_client_for` returns the client's office, and an inactive office has no client;
--   * every tool takes `p_office` first, and a tool that names a client checks the client is the office's.
-- The transitional rule in check:office-edges (no second real office while an MCP client is enabled) is lifted by
-- system_config['mcp.office_bound'] = true, which is set by its OWN migration once the attack cases have passed in production.

drop function public.mcp_client_for(text);
drop function app.mcp_client_for(text);
create function app.mcp_client_for(p_token_sha256 text)
returns table (client_id text, display_name text, scopes text[], office_id uuid)
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $f$
  select c.client_id, c.display_name, c.scopes, c.office_id
    from public.mcp_clients c
    join public.offices o on o.office_id = c.office_id and o.state = 'active' and o.kind <> 'system'
   where c.token_sha256 = p_token_sha256
     and c.enabled
$f$;
revoke all on function app.mcp_client_for(text) from public, anon, authenticated, service_role;
create function public.mcp_client_for(p_token_sha256 text)
returns table (client_id text, display_name text, scopes text[], office_id uuid)
language sql stable security definer set search_path to 'public', 'pg_catalog'
as $f$ select * from app.mcp_client_for(p_token_sha256) $f$;
revoke all on function public.mcp_client_for(text) from public, anon, authenticated;
grant execute on function public.mcp_client_for(text) to service_role;

create function app.mcp_issue_code(p_office uuid, p_client_id text, p_redirect_uri text, p_code_sha256 text, p_code_challenge text, p_resource text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_uris text[];
begin
  perform app.require_office(p_office);
  select redirect_uris into v_uris
    from public.mcp_oauth_clients where client_id = p_client_id;
  if v_uris is null then
    return jsonb_build_object('error', 'invalid_client');
  end if;
  -- Exact membership. A prefix match here is how an open redirector becomes a
  -- token thief.
  if not (p_redirect_uri = any(v_uris)) then
    return jsonb_build_object('error', 'invalid_redirect_uri');
  end if;

  insert into public.mcp_auth_codes
    (office_id, code_sha256, client_id, redirect_uri, code_challenge, resource)
  values (p_office, p_code_sha256, p_client_id, p_redirect_uri, p_code_challenge, p_resource);

  update public.mcp_oauth_clients set last_used_at = app.now_utc()
   where client_id = p_client_id;

  return jsonb_build_object('ok', true);
end;
$function$;

CREATE OR REPLACE FUNCTION app.mcp_redeem_code(p_code_sha256 text, p_client_id text, p_redirect_uri text, p_token_sha256 text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  c public.mcp_auth_codes;
  v_name text;
begin
  update public.mcp_auth_codes
     set redeemed_at = app.now_utc()
   where code_sha256 = p_code_sha256
     and redeemed_at is null
     and expires_at > app.now_utc()
     and client_id = p_client_id
     and redirect_uri = p_redirect_uri
  returning * into c;

  if not found then
    return jsonb_build_object('error', 'invalid_grant');
  end if;
  -- A client belongs to ONE office. A second office's consent cannot take its token or re-bind it.
  if exists (select 1 from public.mcp_clients k where k.client_id = p_client_id and k.office_id <> c.office_id) then
    return jsonb_build_object('error', 'invalid_grant');
  end if;

  select client_name into v_name
    from public.mcp_oauth_clients where client_id = p_client_id;

  -- One row per OAuth client in `mcp_clients`, reusing the table the endpoint
  -- already authenticates against. A second authentication path would be a
  -- second thing to get wrong, and this one is already tested.
  insert into public.mcp_clients (office_id, client_id, display_name, token_sha256, scopes)
  values (c.office_id, p_client_id, coalesce(v_name, 'OAuth client'), p_token_sha256,
          string_to_array(c.scope, ' '))
  on conflict (client_id) do update
    set token_sha256 = excluded.token_sha256,
        display_name = excluded.display_name,
        scopes = excluded.scopes,
        enabled = true,
        disabled_reason = null
    where public.mcp_clients.office_id = excluded.office_id;

  return jsonb_build_object('ok', true, 'scope', c.scope);
end;
$function$;

create function app.mcp_projects(p_office uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  perform app.require_office(p_office);
  return (select coalesce(jsonb_agg(x order by x->>'name'), '[]'::jsonb) from (
    select jsonb_build_object(
             'project_id', p.project_id,
             'slug', p.slug,
             'name', p.name,
             'status', p.status,
             'documents', (select count(*) from public.documents d where d.office_id = p_office and d.project_id = p.project_id),
             'live_jobs', (select count(*) from public.jobs j
                            where j.office_id = p_office and j.project_id = p.project_id
                              and j.state not in ('complete', 'cancelled', 'failed')),
             'updated_at', p.updated_at
           ) as x
      from public.projects p
     where p.office_id = p_office and p.status = 'active'
  ) s);
end
$function$;

create function app.mcp_recent_work(p_office uuid, p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  perform app.require_office(p_office);
  return (select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb) from (
    select jsonb_build_object(
             'output_id', o.output_id,
             'project', (select p.slug from public.projects p where p.project_id = j.project_id and p.office_id = p_office),
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
      join public.jobs j on j.job_id = o.job_id and j.office_id = p_office
     order by o.created_at desc
     limit greatest(1, least(coalesce(p_limit, 20), 50))
  ) s);
end
$function$;

create function app.mcp_document(p_office uuid, p_document_id uuid, p_max_chars integer DEFAULT 20000)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  perform app.require_office(p_office);
  return coalesce(
    (select jsonb_build_object(
              'document_id', d.document_id,
              'title', d.title,
              'connector', d.connector,
              'project', (select p.slug from public.projects p where p.project_id = d.project_id and p.office_id = p_office),
              'chars', d.content_chars,
              'truncated', d.content_chars > greatest(1000, least(coalesce(p_max_chars, 20000), 60000)),
              'fetched_at', d.fetched_at,
              'content', left(coalesce(d.content, ''),
                              greatest(1000, least(coalesce(p_max_chars, 20000), 60000)))
            )
       from public.documents d where d.document_id = p_document_id and d.office_id = p_office),
    jsonb_build_object('error', 'no such document'));
end
$function$;

create function app.mcp_enqueue(p_office uuid, p_client_id text, p_project text, p_kind text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_project uuid;
  v_job uuid;
begin
  perform app.require_office(p_office);
  -- The client is the OFFICE'S: a client of another office is not one this office can enqueue as.
  if not exists (select 1 from public.mcp_clients k where k.client_id = p_client_id and k.office_id = p_office and k.enabled) then
    return jsonb_build_object('error', 'no such client');
  end if;
  -- The list is fixed for the same reason the tool list is: a client naming a
  -- job kind is a client choosing what the worker does.
  if p_kind not in ('notebook.generate', 'notebook.push_document', 'notebook.ask') then
    return jsonb_build_object('error', format('%L is not a kind a client may enqueue', p_kind));
  end if;

  select project_id into v_project
    from public.projects where office_id = p_office and slug = p_project and status = 'active';
  if v_project is null then
    return jsonb_build_object('error', format('no active project with slug %L', p_project));
  end if;

  insert into public.jobs
    (office_id, correlation_id, project_id, idempotency_key, kind, requested_by, priority, pinned_config)
  values (p_office, gen_random_uuid(), v_project,
          format('mcp-%s-%s', p_client_id, gen_random_uuid()),
          p_kind, format('mcp:%s', p_client_id), 200,
          -- 0616: what says a job was approved, or where it came from, is never a client's to send.
          coalesce(p_payload, '{}'::jsonb) - 'approved_by' - 'approval' - 'approval_next'
            - 'command_id' - 'origin_namespace' - 'plan_steps')
  returning job_id into v_job;

  return jsonb_build_object(
    'job_id', v_job, 'kind', p_kind, 'state', 'queued',
    'note', 'the worker picks this up; call check_job with the id'
  );
end;
$function$;

create function app.mcp_add_document(p_office uuid, p_client_id text, p_project text, p_title text, p_content text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_project uuid;
  v_id uuid;
  v_fingerprint text;
  v_existing uuid;
begin
  perform app.require_office(p_office);
  if not exists (select 1 from public.mcp_clients k where k.client_id = p_client_id and k.office_id = p_office and k.enabled) then
    return jsonb_build_object('error', 'no such client');
  end if;
  select project_id into v_project
    from public.projects where office_id = p_office and slug = p_project and status = 'active';
  if v_project is null then
    return jsonb_build_object('error', format('no active project with slug %L', p_project));
  end if;
  if coalesce(trim(p_content), '') = '' then
    return jsonb_build_object('error', 'content is empty; refusing to store an empty document');
  end if;
  if coalesce(trim(p_title), '') = '' then
    return jsonb_build_object('error', 'title is required');
  end if;

  v_fingerprint := encode(sha256(convert_to(p_content, 'UTF8')), 'hex');

  select document_id into v_existing
    from public.documents
   where office_id = p_office and project_id = v_project and content_fingerprint = v_fingerprint;
  if v_existing is not null then
    return jsonb_build_object(
      'document_id', v_existing, 'title', p_title, 'duplicate', true,
      'note', 'identical content already in this project; nothing was added'
    );
  end if;

  insert into public.documents
    (office_id, project_id, connector, external_parent_ref, external_ref, title, doc_type,
     content, content_fingerprint, content_chars, fetched_at, added_by)
  values (p_office, v_project, 'mcp', null, null, p_title, 'note',
          p_content, v_fingerprint, length(p_content), app.now_utc(), p_client_id)
  returning document_id into v_id;

  return jsonb_build_object(
    'document_id', v_id, 'title', p_title, 'chars', length(p_content), 'duplicate', false
  );
end;
$function$;

create function app.mcp_job_status(p_office uuid, p_job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  perform app.require_office(p_office);
  return coalesce(
    (select jsonb_build_object(
              'job_id', j.job_id, 'kind', j.kind, 'state', j.state,
              'situation', (app.job_situation(j.job_id) ->> 'situation'),
              'reason', j.state_reason, 'created_at', j.created_at,
              'finished_at', j.finished_at,
              'output', (select left(o.body, 4000) from public.outputs o
                          where o.job_id = j.job_id order by o.created_at desc limit 1)
            )
       from public.jobs j where j.job_id = p_job_id and j.office_id = p_office),
    jsonb_build_object('error', 'no such job'));
end
$function$;

create function app.mcp_record_call(p_office uuid, p_client_id text, p_tool text, p_arguments jsonb, p_outcome text, p_rows integer DEFAULT 0, p_duration_ms integer DEFAULT NULL::integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  perform app.require_office(p_office);
  -- A call is recorded against the office's own client or not at all.
  if not exists (select 1 from public.mcp_clients k where k.client_id = p_client_id and k.office_id = p_office) then
    return;
  end if;
  insert into public.mcp_calls (client_id, tool, arguments, outcome, rows_returned, duration_ms)
  values (p_client_id, p_tool, coalesce(p_arguments, '{}'::jsonb), p_outcome,
          coalesce(p_rows, 0), p_duration_ms);

  update public.mcp_clients
     set last_seen_at = app.now_utc(), calls = calls + 1
   where client_id = p_client_id and office_id = p_office;
end;
$function$;

-- Search: the office's documents only. Written as plpgsql so that it binds to app.search_documents(p_office, ...) when called.
create function app.mcp_search(p_office uuid, p_query text, p_project text default null, p_limit integer default 8)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $f$
declare
  v_project uuid;
begin
  perform app.require_office(p_office);
  if p_project is not null then
    select p.project_id into v_project from public.projects p where p.office_id = p_office and p.slug = p_project;
    -- A project that is not this office's reads as no results, the same as a project that does not exist.
    if v_project is null then return '[]'::jsonb; end if;
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'document_id', s.document_id,
             'title', s.title,
             'connector', s.connector,
             'project', (select p.slug from public.projects p where p.project_id = s.project_id and p.office_id = p_office),
             'rank', s.rank,
             'snippet', s.snippet
           ) order by s.rank desc), '[]'::jsonb)
      from app.search_documents(p_office, p_query, v_project, greatest(1, least(coalesce(p_limit, 8), 25)), 'any') s);
end
$f$;
revoke all on function app.mcp_search(uuid, text, text, integer) from public, anon, authenticated, service_role;

-- the public doors (service role only)
create function public.mcp_projects(p_office uuid) returns jsonb language sql stable security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.mcp_projects(p_office) $f$;
create function public.mcp_recent_work(p_office uuid, p_limit integer default 20) returns jsonb language sql stable security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.mcp_recent_work(p_office, p_limit) $f$;
create function public.mcp_document(p_office uuid, p_document_id uuid, p_max_chars integer default 20000) returns jsonb language sql stable security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.mcp_document(p_office, p_document_id, p_max_chars) $f$;
create function public.mcp_search(p_office uuid, p_query text, p_project text default null, p_limit integer default 8) returns jsonb language sql stable security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.mcp_search(p_office, p_query, p_project, p_limit) $f$;
create function public.mcp_enqueue(p_office uuid, p_client_id text, p_project text, p_kind text, p_payload jsonb default '{}'::jsonb) returns jsonb language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.mcp_enqueue(p_office, p_client_id, p_project, p_kind, p_payload) $f$;
create function public.mcp_add_document(p_office uuid, p_client_id text, p_project text, p_title text, p_content text) returns jsonb language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.mcp_add_document(p_office, p_client_id, p_project, p_title, p_content) $f$;
create function public.mcp_job_status(p_office uuid, p_job_id uuid) returns jsonb language sql stable security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.mcp_job_status(p_office, p_job_id) $f$;
create function public.mcp_record_call(p_office uuid, p_client_id text, p_tool text, p_arguments jsonb, p_outcome text, p_rows integer default 0, p_duration_ms integer default null) returns void language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.mcp_record_call(p_office, p_client_id, p_tool, p_arguments, p_outcome, p_rows, p_duration_ms) $f$;
create function public.mcp_issue_code(p_office uuid, p_client_id text, p_redirect_uri text, p_code_sha256 text, p_code_challenge text, p_resource text default null) returns jsonb language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.mcp_issue_code(p_office, p_client_id, p_redirect_uri, p_code_sha256, p_code_challenge, p_resource) $f$;

do $g$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.proname in
              ('mcp_projects','mcp_recent_work','mcp_document','mcp_search','mcp_enqueue','mcp_add_document','mcp_job_status','mcp_record_call','mcp_issue_code')
              and pg_get_function_arguments(p.oid) like 'p_office uuid%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $g$;

-- the old, officeless shapes
drop function public.mcp_projects();
drop function public.mcp_recent_work(integer);
drop function public.mcp_document(uuid, integer);
drop function public.mcp_search(text, text, integer);
drop function public.mcp_enqueue(text, text, text, jsonb);
drop function public.mcp_add_document(text, text, text, text);
drop function public.mcp_job_status(uuid);
drop function public.mcp_record_call(text, text, jsonb, text, integer, integer);
drop function public.mcp_issue_code(text, text, text, text, text);
drop function app.mcp_projects();
drop function app.mcp_recent_work(integer);
drop function app.mcp_document(uuid, integer);
drop function app.mcp_search(text, text, integer);
drop function app.mcp_enqueue(text, text, text, jsonb);
drop function app.mcp_add_document(text, text, text, text);
drop function app.mcp_job_status(uuid);
drop function app.mcp_record_call(text, text, jsonb, text, integer, integer);
drop function app.mcp_issue_code(text, text, text, text, text);

-- The roster is global (staff is a shared table) but the tool is an office's: it takes the office like the rest, so the
-- gateway shape is uniform and a client with no office cannot call any tool.
create function app.mcp_staff(p_office uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $f$
begin
  perform app.require_office(p_office);
  return (select coalesce(jsonb_agg(jsonb_build_object(
           'slug', s.slug, 'name', s.name, 'title', s.title,
           'responsibilities', s.responsibilities, 'expertise', s.expertise
         ) order by s.slug), '[]'::jsonb)
    from public.staff s where s.active);
end
$f$;
revoke all on function app.mcp_staff(uuid) from public, anon, authenticated, service_role;
create function public.mcp_staff(p_office uuid) returns jsonb language sql stable security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.mcp_staff(p_office) $f$;
revoke all on function public.mcp_staff(uuid) from public, anon, authenticated;
grant execute on function public.mcp_staff(uuid) to service_role;
drop function public.mcp_staff();
drop function app.mcp_staff();
