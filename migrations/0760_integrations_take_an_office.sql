-- 0760 - the signed-in browser tier and the MCP admin surface take an office (multi-user P3, wave 2/4, cluster f).
--
-- Before: app.browser_sessions_for / browser_lately / browser_now / browser_budget / browser_session_establish /
-- browser_session_forget and app.hq_mcp / mcp_inventory / register_mcp_provider / offer_mcp_tool / revoke_mcp_provider
-- (and their public wrappers) read and wrote `browser_sessions`, `browser_actions`, `mcp_providers`,
-- `mcp_discovered_tools`, `mcp_clients` and `mcp_calls` for whoever called. A pasted session jar is a CREDENTIAL, and:
--
--   * establish took any project id that existed and ROTATED the Vault secret named after it, then overwrote the
--     session row on `(project_id, site)`: office B could replace office A's signed-in session;
--   * forget revoked and DELETED THE VAULT SECRET of any session id it was handed;
--   * the budget summed every office's browsing into one figure, and the activity ledger listed every office's;
--   * revoke_mcp_provider switched off every capability whose `delivered_by` was 'mcp:<name>', and provider names are
--     only unique per office since 0662, so revoking "acme" in one office disabled "acme" in all of them;
--   * offer_mcp_tool filed a discovered tool under any catalogue name (`on conflict do nothing`), so a provider could
--     be "offered as" a capability that already existed - including a built-in, or another office's - and the
--     inventory then reported that capability's state as its own;
--   * register_mcp_provider took any Vault reference, which the discovery job sends to the endpoint it names;
--   * hq_mcp listed every office's MCP clients, their recent calls and the capability catalogue's provider tools.
--
-- Now each takes `p_office uuid` FIRST, with no default, and every statement that touches an owned table carries
-- `office_id = p_office` (browser_sessions has no office column and is reached through its project). A row of another
-- office is indistinguishable from a row that does not exist: the same sentence.
--
-- `tool_permissions` stays one catalogue for the deployment (it is GLOBAL: what the product CAN do), so a provider's
-- tools are identified by `mcp_discovered_tools.offered_as` of that provider rather than by the provider's NAME.
-- A destructive tool is still offered at level 3 and disabled; `standing_never_covers_level_three` is untouched.
--
-- app.browser_session_open is the helper only establish calls; it takes the office too.

CREATE FUNCTION app.browser_budget(p_office uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.require_office(p_office);
  return (
with cap as (
    select coalesce(
      (select nullif(value #>> '{}', '')::numeric from public.system_config
        where key = 'browser.daily_minutes'), 10)::numeric as minutes
  ), spent as (
    select coalesce(sum(a.ms), 0)::numeric / 60000 as minutes,
           count(*)::int as actions,
           count(*) filter (
             where app.harness_browsing(a.job_id, a.project_id))::int as harness_actions
      from public.browser_actions a
     where a.at >= date_trunc('day', app.now_utc())
       and a.office_id = p_office
  )
  select jsonb_build_object(
    'cap_minutes', round(cap.minutes, 2),
    'used_minutes', round(spent.minutes, 2),
    'left_minutes', round(greatest(cap.minutes - spent.minutes, 0), 2),
    'actions_today', spent.actions,
    'harness_actions_today', spent.harness_actions,
    'exhausted', spent.minutes >= cap.minutes
  ) from cap, spent
  );
end
$function$;

CREATE FUNCTION app.browser_lately(p_office uuid, p_project uuid, p_limit integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.require_office(p_office);
  return (
select coalesce(jsonb_agg(x.v order by x.ord), '[]'::jsonb) from (
    select row_number() over (order by a.at desc) as ord,
           jsonb_build_object(
             'at', a.at, 'verb', a.verb, 'url', a.url, 'ok', a.ok,
             'detail', a.detail, 'shot_path', a.shot_path, 'ms', a.ms,
             'site', b.site
           ) as v
      from public.browser_actions a
      left join (select s.session_id, s.site
                   from public.browser_sessions s
                   join public.projects sp on sp.project_id = s.project_id and sp.office_id = p_office) b
             on b.session_id = a.session_id
     where a.office_id = p_office
       and (p_project is null or a.project_id = p_project)
       and not app.harness_browsing(a.job_id, a.project_id)
     order by a.at desc
     limit greatest(coalesce(p_limit, 30), 1)
  ) x
  );
end
$function$;

CREATE FUNCTION app.browser_now(p_office uuid, p_project uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.require_office(p_office);
  return (
select coalesce(jsonb_agg(x.v order by x.ord), '[]'::jsonb) from (
    select row_number() over (order by j.created_at) as ord,
           jsonb_build_object(
             'job_id', j.job_id,
             'url', j.pinned_config ->> 'url',
             'state', j.state::text,
             /*
               Parked waiting for a person is a different thing from running,
               and #16 asks for it as its own clear action. Said as a boolean
               rather than left for the page to work out from the state name,
               because two surfaces deciding that separately is how they come
               to disagree.
             */
             'waiting_for_you', (j.state in ('waiting_user', 'paused')),
             'stop_asked', (j.stop_requested_at is not null),
             'since', j.created_at,
             'site', s.site
           ) as v
      from public.jobs j
      left join public.browser_sessions s
        on s.project_id = j.project_id
       and s.site = lower(split_part(split_part(
             regexp_replace(coalesce(j.pinned_config ->> 'url', ''), '^https?://', ''),
             '/', 1), ':', 1))
     where j.kind = 'browser.gather'
       and j.office_id = p_office
       and j.project_id = p_project
       and exists (select 1 from public.projects pj
                    where pj.project_id = j.project_id and pj.office_id = p_office)
       and j.state in ('queued', 'running', 'retrying', 'waiting_user', 'paused')
       and not app.harness_browsing(j.job_id, j.project_id)
     order by j.created_at
     limit 20
  ) x
  );
end
$function$;

CREATE FUNCTION app.browser_sessions_for(p_office uuid, p_project uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.require_office(p_office);
  return (
select coalesce(jsonb_agg(s.v order by s.ord), '[]'::jsonb) from (
    select row_number() over (order by b.established_at desc) as ord,
           jsonb_build_object(
             'session_id', b.session_id,
             'site', b.site,
             'purpose', b.purpose,
             'has_credential', b.credential_ref is not null,
             'established_at', b.established_at,
             'last_alive_at', b.last_alive_at,
             'state', case
               when b.revoked_at is not null then 'revoked'
               when b.expired_at is not null then 'signed_out'
               when b.credential_ref is null then 'needs_sign_in'
               else 'live' end,
             'actions', (select count(*)::int from public.browser_actions a
                          where a.session_id = b.session_id
                            and a.office_id = p_office
                            and not app.harness_browsing(a.job_id, a.project_id))
           ) as v
      from public.browser_sessions b
     where b.project_id = p_project
       and exists (select 1 from public.projects pr
                    where pr.project_id = b.project_id and pr.office_id = p_office)
  ) s
  );
end
$function$;

CREATE FUNCTION app.browser_session_open(p_office uuid, p_project uuid, p_site text, p_purpose text, p_ref app.vault_secret_ref, p_by text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_site text := lower(trim(coalesce(p_site, '')));
  v_id uuid;
begin
  perform app.require_office(p_office);
  if not exists (select 1 from public.projects where project_id = p_project and office_id = p_office) then
    return jsonb_build_object('error', 'there is no dashboard project by that id');
  end if;
  if v_site !~ '^[a-z0-9.-]+\.[a-z]{2,}$' then
    return jsonb_build_object('error',
      format('%L does not look like a site. Give me a host, like example.com.', p_site));
  end if;
  if length(trim(coalesce(p_purpose, ''))) < 12 then
    return jsonb_build_object('error',
      'say what the session is for, in a sentence. A session with no stated '
      'purpose is a session nobody can audit.');
  end if;

  insert into public.browser_sessions
    (project_id, site, purpose, credential_ref, established_by)
  values (p_project, v_site, trim(p_purpose), p_ref, coalesce(nullif(trim(coalesce(p_by, '')), ''), app.office_actor(p_office)))
  on conflict (project_id, site) do update
     set purpose = excluded.purpose,
         credential_ref = coalesce(excluded.credential_ref, public.browser_sessions.credential_ref),
         established_at = app.now_utc(),
         expired_at = null,
         revoked_at = null,
         updated_at = app.now_utc()
  returning session_id into v_id;

  return jsonb_build_object('ok', true, 'session_id', v_id, 'site', v_site);
end;
$function$;

CREATE FUNCTION app.browser_session_establish(p_office uuid, p_project uuid, p_site text, p_purpose text, p_jar text, p_by text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_site text := lower(trim(coalesce(p_site, '')));
  v_ref app.vault_secret_ref;
  v_opened jsonb;
begin
  perform app.require_office(p_office);
  if coalesce(length(trim(coalesce(p_jar, ''))), 0) < 2 then
    return jsonb_build_object('error',
      'a session needs the signed-in browser state. Export it from the browser '
      'you signed in with and paste the whole thing.');
  end if;
  /*
    The jar is checked for SHAPE before it is stored, so a paste into the wrong
    box is refused with a sentence rather than kept for ever as a session that
    silently never works. 0359 is the same argument about a Client ID and a
    Client secret sitting next to each other.
  */
  begin
    if jsonb_typeof(p_jar::jsonb) not in ('array', 'object') then
      return jsonb_build_object('error',
        'that does not look like browser session state -- it should be the JSON '
        'a browser export gives you.');
    end if;
  exception when others then
    return jsonb_build_object('error',
      'that does not look like browser session state -- it should be the JSON '
      'a browser export gives you.');
  end;

  -- Opened FIRST, with no credential, so a refusal costs nothing: a Vault row
  -- written for a session the validation then rejects is orphaned for ever.
  v_opened := app.browser_session_open(p_office, p_project, v_site, p_purpose, null, p_by);
  if v_opened ? 'error' then return v_opened; end if;

  v_ref := app.store_secret(
    format('browser.session.%s.%s', p_project, v_site), p_jar,
    format('Signed-in browser state for %s. Established by %s.', v_site, coalesce(nullif(btrim(p_by), ''), app.office_actor(p_office))));

  update public.browser_sessions
     set credential_ref = v_ref, expired_at = null, revoked_at = null,
         updated_at = app.now_utc()
   where session_id = (v_opened ->> 'session_id')::uuid;

  return jsonb_build_object('ok', true, 'session_id', v_opened -> 'session_id',
                            'site', v_site);
end;
$function$;

CREATE FUNCTION app.browser_session_forget(p_office uuid, p_session uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_ref app.vault_secret_ref;
  v_site text;
begin
  perform app.require_office(p_office);
  select s.credential_ref, s.site into v_ref, v_site
    from public.browser_sessions s
   where s.session_id = p_session
     and exists (select 1 from public.projects pr
                  where pr.project_id = s.project_id and pr.office_id = p_office);
  if not found then
    return jsonb_build_object('error', 'there is no session by that id');
  end if;

  -- The reference first, the secret second. A row pointing at a secret that is
  -- already gone raises on every read (0350); a null reference degrades alone.
  update public.browser_sessions
     set credential_ref = null, revoked_at = coalesce(revoked_at, app.now_utc()),
         updated_at = app.now_utc()
   where session_id = p_session
     and project_id in (select pr.project_id from public.projects pr where pr.office_id = p_office);

  if v_ref is not null then
    delete from vault.secrets where id = v_ref::uuid;
  end if;

  return jsonb_build_object('ok', true, 'site', v_site,
    'note', format('The office can no longer sign in to %s. Nothing it already '
                   'read has been removed.', v_site));
end;
$function$;

CREATE FUNCTION app.hq_mcp(p_office uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.require_office(p_office);
  return (
select jsonb_build_object(
    'url', 'https://' ||
           coalesce((select value #>> '{}' from public.system_config where key = 'db.project_ref'),
                    'baujwlzcziasnfhhkchg') ||
           '.supabase.co/functions/v1/mcp',
    -- What a client would actually see. Level and description come straight
    -- from the permissions table, so a tool turned off says so here rather
    -- than being quietly missing.
    'tools', (select coalesce(jsonb_agg(jsonb_build_object(
                       'tool', t.tool,
                       'level', t.level,
                       'what', t.description,
                       'on', t.enabled,
                       'why_off', nullif(coalesce(t.disabled_reason, ''), '')
                     ) order by t.enabled desc, t.tool), '[]'::jsonb)
                from public.tool_permissions t
               where coalesce(t.delivered_by, '') !~ '^mcp:'
                  or exists (select 1 from public.mcp_discovered_tools d
                               join public.mcp_providers pp on pp.provider_id = d.provider_id and pp.office_id = p_office
                              where d.offered_as = t.tool)),
    'clients', (select coalesce(jsonb_agg(jsonb_build_object(
                         'name', c.display_name,
                         'on', c.enabled,
                         'why_off', nullif(coalesce(c.disabled_reason, ''), ''),
                         'calls', c.calls,
                         'last', case when c.last_seen_at is null then null
                                      else app.ago(c.last_seen_at) end
                       ) order by c.last_seen_at desc nulls last), '[]'::jsonb)
                  from public.mcp_clients c
                 where c.office_id = p_office),
    'recent', (select coalesce(jsonb_agg(jsonb_build_object(
                        'tool', k.tool,
                        'outcome', k.outcome,
                        'rows', k.rows_returned,
                        'when', app.ago(k.called_at)
                      ) order by k.called_at desc), '[]'::jsonb)
                 from (select k0.* from public.mcp_calls k0
                         join public.mcp_clients kc on kc.client_id = k0.client_id and kc.office_id = p_office
                        order by k0.called_at desc limit 8) k),
    -- Explicit, every time, with the real steps. His standing instruction.
    'steps', jsonb_build_array(
      'Copy the server URL above.',
      'In the client you want to connect — Claude Desktop, an editor, anything that speaks MCP — add it as a remote MCP server at that URL.',
      'It will ask for a bearer token. Run npm run hq:token, which sends the token to you on Telegram. The token is never shown on this page.',
      'The client then sees the tools listed above, minus any that are switched off.')
  )
  );
end
$function$;

CREATE FUNCTION app.mcp_inventory(p_office uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  perform app.require_office(p_office);
  return (
select coalesce(jsonb_agg(v order by name), '[]'::jsonb)
    from (
      select p.name,
             jsonb_build_object(
               'id', p.provider_id, 'name', p.name, 'display_name', p.display_name, 'endpoint', p.endpoint,
               'auth', p.auth_kind, 'enabled', p.enabled, 'revoked_at', p.revoked_at,
               'server', p.server_name, 'protocol', p.protocol_version,
               'last_probe_at', p.last_probe_at, 'last_probe_ok', p.last_probe_ok,
               'last_probe_detail', p.last_probe_detail,
               'discovered', (select count(*) from public.mcp_discovered_tools d
                               where d.provider_id = p.provider_id and d.vanished_at is null),
               'vanished', (select count(*) from public.mcp_discovered_tools d
                             where d.provider_id = p.provider_id and d.vanished_at is not null),
               'offered', (select count(*) from public.mcp_discovered_tools d
                            where d.provider_id = p.provider_id and d.offered_as is not null),
               /*
                 The number that matters, and the reason it is separate from
                 `offered`: a provider can advertise forty tools, the office
                 can offer six, and NONE of them be usable until Grant
                 approves. Showing only "offered" would read as reach.
               */
               'usable', (select count(*) from public.tool_permissions t
                           where t.enabled
                             and t.tool in (select d.offered_as from public.mcp_discovered_tools d
                                             where d.provider_id = p.provider_id and d.offered_as is not null)),
               'tools', (select coalesce(jsonb_agg(jsonb_build_object(
                                  'id', d.discovered_id, 'name', d.external_name, 'reach', d.reach,
                                  'certainty', d.reach_certainty, 'why', d.why_that_reach,
                                  'offered_as', d.offered_as,
                                  'usable', exists (select 1 from public.tool_permissions t
                                                     where t.tool = d.offered_as and t.enabled),
                                  'gone', d.vanished_at is not null)
                                order by d.external_name), '[]'::jsonb)
                           from public.mcp_discovered_tools d
                          where d.provider_id = p.provider_id)) as v
        from public.mcp_providers p
       where p.office_id = p_office
    ) q
  );
end
$function$;

CREATE FUNCTION app.offer_mcp_tool(p_office uuid, p_discovered uuid, p_as text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare d public.mcp_discovered_tools%rowtype; v_provider public.mcp_providers%rowtype;
        v_tool text; v_level integer;
begin
  perform app.require_office(p_office);
  select d0.* into d
    from public.mcp_discovered_tools d0
    join public.mcp_providers p0 on p0.provider_id = d0.provider_id and p0.office_id = p_office
   where d0.discovered_id = p_discovered;
  if not found then
    return jsonb_build_object('error', 'no such discovered tool');
  end if;
  if d.vanished_at is not null then
    return jsonb_build_object('error',
      'that tool is no longer offered by the provider; rediscover before offering it');
  end if;
  if d.offered_as is not null then
    return jsonb_build_object('ok', true, 'already', true, 'tool', d.offered_as);
  end if;
  select * into v_provider from public.mcp_providers where provider_id = d.provider_id and office_id = p_office;
  if not v_provider.enabled or v_provider.revoked_at is not null then
    return jsonb_build_object('error', 'that provider is disconnected');
  end if;

  v_tool := coalesce(nullif(btrim(coalesce(p_as, '')), ''),
                     format('%s.%s', v_provider.name,
                            lower(regexp_replace(d.external_name, '[^a-zA-Z0-9]+', '_', 'g'))));
  /*
    The capability catalogue (tool_permissions) is one table for the whole deployment, and a provider's name is
    only unique inside its own office. A name that is already a row belongs to somebody else unless THIS provider
    put it there: it is never silently shared (the insert below does nothing on a clash, so the discovered tool
    would otherwise be filed under, and report the state of, another office's capability).
  */
  if exists (select 1 from public.tool_permissions tp where tp.tool = v_tool)
     and not exists (select 1 from public.mcp_discovered_tools x
                      where x.provider_id = v_provider.provider_id and x.offered_as = v_tool) then
    if nullif(btrim(coalesce(p_as, '')), '') is not null then
      return jsonb_build_object('error', 'that name is already taken by another capability');
    end if;
    v_tool := format('%s-%s.%s', v_provider.name, left(p_office::text, 8),
                     lower(regexp_replace(d.external_name, '[^a-zA-Z0-9]+', '_', 'g')));
    if exists (select 1 from public.tool_permissions tp where tp.tool = v_tool)
       and not exists (select 1 from public.mcp_discovered_tools x
                        where x.provider_id = v_provider.provider_id and x.offered_as = v_tool) then
      return jsonb_build_object('error', 'that name is already taken by another capability');
    end if;
  end if;

  /*
    The level follows the REACH, and `unknown` is treated as a write.

    Not as a read: a tool nobody can classify is a tool nobody has read the
    documentation for, and the cheap direction is an approval nobody needed.
  */
  v_level := case d.reach
               when 'read' then 0
               when 'write' then 2
               when 'destructive' then 3
               else 2
             end;

  insert into public.tool_permissions
    (tool, level, description, enabled, disabled_reason, delivered_by)
  values (v_tool, v_level,
          left(format('%s, offered by %s. %s', d.external_name, v_provider.name,
                      coalesce(nullif(d.description, ''), 'no description given')), 900),
          false,
          format('discovered from %s and not yet approved. Reach %L (%s).',
                 v_provider.name, d.reach, d.reach_certainty),
          format('mcp:%s', v_provider.name))
  on conflict (tool) do nothing;

  update public.mcp_discovered_tools set offered_as = v_tool where discovered_id = p_discovered;

  return jsonb_build_object('ok', true, 'tool', v_tool, 'level', v_level,
    'enabled', false,
    'note', 'offered and DISABLED. Approving it is the ordinary approval path.');
end;
$function$;

CREATE FUNCTION app.register_mcp_provider(p_office uuid, p_name text, p_endpoint text, p_display_name text DEFAULT ''::text, p_auth_kind text DEFAULT 'none'::text, p_credential_ref uuid DEFAULT NULL::uuid, p_notes text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare v_id uuid;
begin
  perform app.require_office(p_office);
  if p_name !~ '^[a-z][a-z0-9_-]{1,30}$' then
    return jsonb_build_object('error',
      'a provider name is lower case letters, digits, dashes and underscores');
  end if;
  if p_endpoint !~ '^https://' then
    -- Plain HTTP would put a bearer token on the wire. Refused rather than
    -- warned about.
    return jsonb_build_object('error', 'an endpoint must be https');
  end if;
  if exists (select 1 from public.mcp_providers where name = p_name and office_id = p_office) then
    return jsonb_build_object('error', format('%L is already registered', p_name));
  end if;

  /*
    A credential reference is a Vault row, and Vault rows have no owner column. The discovery job sends it to the
    endpoint this call names, so an office may only point a provider at a credential one of ITS OWN providers
    already holds; an id taken from anywhere else is refused in the words for a missing one.
  */
  if p_credential_ref is not null
     and not exists (select 1 from public.mcp_providers e
                      where e.office_id = p_office and e.credential_ref = p_credential_ref) then
    return jsonb_build_object('error', 'no such credential');
  end if;

  insert into public.mcp_providers
    (office_id, name, endpoint, display_name, auth_kind, credential_ref, notes)
  values (p_office, p_name, p_endpoint, coalesce(nullif(btrim(p_display_name), ''), p_name),
          p_auth_kind, p_credential_ref, coalesce(p_notes, ''))
  returning provider_id into v_id;

  -- Ask it what it offers. The note below has promised this
  -- since the function was written and nothing performed it.
  insert into public.jobs
    (correlation_id, project_id, idempotency_key, kind, requested_by,
     priority, pinned_config, announce, office_id)
  values (gen_random_uuid(), null,
          format('mcp-discover-%s-%s', p_name, gen_random_uuid()),
          'mcp.discover', 'connector:register', 150,
          jsonb_build_object('provider', p_name, 'provider_id', v_id), true, p_office);

  return jsonb_build_object('ok', true, 'provider', v_id,
    'note', 'registered, and I am asking it what it offers. Nothing is granted by that survey.');
end;
$function$;

CREATE FUNCTION app.revoke_mcp_provider(p_office uuid, p_provider uuid, p_why text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare v_name text; v_off integer;
begin
  perform app.require_office(p_office);
  select name into v_name from public.mcp_providers where provider_id = p_provider and office_id = p_office;
  if v_name is null then
    return jsonb_build_object('error', 'no such provider');
  end if;

  update public.tool_permissions
     set enabled = false,
         disabled_reason = left(format('%s was disconnected. %s', v_name, coalesce(p_why, '')), 900)
   where enabled
     and tool in (select d.offered_as from public.mcp_discovered_tools d
                   where d.provider_id = p_provider and d.offered_as is not null);
  get diagnostics v_off = row_count;

  update public.mcp_providers
     set enabled = false, revoked_at = app.now_utc(), updated_at = app.now_utc(),
         notes = left(coalesce(notes, '') || format(E'\ndisconnected: %s', coalesce(p_why, '')), 2000)
   where provider_id = p_provider and office_id = p_office;

  return jsonb_build_object('ok', true, 'provider', v_name, 'tools_disabled', v_off);
end;
$function$;


----------------------------------------------------------------------------------------------------------------------
-- the public doors: p_office first, no default, shut to the browser's own roles
----------------------------------------------------------------------------------------------------------------------
create function public.browser_budget(p_office uuid) returns jsonb language sql stable security definer set search_path to 'public', 'pg_catalog' as $f$ select app.browser_budget(p_office) $f$;
revoke all on function public.browser_budget(uuid) from public, anon, authenticated;
grant execute on function public.browser_budget(uuid) to service_role;
revoke all on function app.browser_budget(uuid) from public, anon, authenticated, service_role;
create function public.browser_lately(p_office uuid, p_project uuid, p_limit integer DEFAULT 30) returns jsonb language sql stable security definer set search_path to 'public', 'pg_catalog' as $f$ select app.browser_lately(p_office, p_project, p_limit) $f$;
revoke all on function public.browser_lately(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.browser_lately(uuid, uuid, integer) to service_role;
revoke all on function app.browser_lately(uuid, uuid, integer) from public, anon, authenticated, service_role;
create function public.browser_now(p_office uuid, p_project uuid) returns jsonb language sql stable security definer set search_path to 'public', 'pg_catalog' as $f$ select app.browser_now(p_office, p_project) $f$;
revoke all on function public.browser_now(uuid, uuid) from public, anon, authenticated;
grant execute on function public.browser_now(uuid, uuid) to service_role;
revoke all on function app.browser_now(uuid, uuid) from public, anon, authenticated, service_role;
create function public.browser_session_establish(p_office uuid, p_project uuid, p_site text, p_purpose text, p_jar text, p_by text DEFAULT NULL::text) returns jsonb language sql  security definer set search_path to 'public', 'pg_catalog' as $f$ select app.browser_session_establish(p_office, p_project, p_site, p_purpose, p_jar, p_by) $f$;
revoke all on function public.browser_session_establish(uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.browser_session_establish(uuid, uuid, text, text, text, text) to service_role;
revoke all on function app.browser_session_establish(uuid, uuid, text, text, text, text) from public, anon, authenticated, service_role;
create function public.browser_session_forget(p_office uuid, p_session uuid) returns jsonb language sql  security definer set search_path to 'public', 'pg_catalog' as $f$ select app.browser_session_forget(p_office, p_session) $f$;
revoke all on function public.browser_session_forget(uuid, uuid) from public, anon, authenticated;
grant execute on function public.browser_session_forget(uuid, uuid) to service_role;
revoke all on function app.browser_session_forget(uuid, uuid) from public, anon, authenticated, service_role;
create function public.browser_sessions_for(p_office uuid, p_project uuid) returns jsonb language sql stable security definer set search_path to 'public', 'pg_catalog' as $f$ select app.browser_sessions_for(p_office, p_project) $f$;
revoke all on function public.browser_sessions_for(uuid, uuid) from public, anon, authenticated;
grant execute on function public.browser_sessions_for(uuid, uuid) to service_role;
revoke all on function app.browser_sessions_for(uuid, uuid) from public, anon, authenticated, service_role;
create function public.hq_mcp(p_office uuid) returns jsonb language sql stable security definer set search_path to 'public', 'pg_catalog' as $f$ select app.hq_mcp(p_office) $f$;
revoke all on function public.hq_mcp(uuid) from public, anon, authenticated;
grant execute on function public.hq_mcp(uuid) to service_role;
revoke all on function app.hq_mcp(uuid) from public, anon, authenticated, service_role;
create function public.mcp_inventory(p_office uuid) returns jsonb language sql stable security definer set search_path to 'public', 'pg_catalog' as $f$ select app.mcp_inventory(p_office) $f$;
revoke all on function public.mcp_inventory(uuid) from public, anon, authenticated;
grant execute on function public.mcp_inventory(uuid) to service_role;
revoke all on function app.mcp_inventory(uuid) from public, anon, authenticated, service_role;
create function public.offer_mcp_tool(p_office uuid, p_discovered uuid, p_as text DEFAULT NULL::text) returns jsonb language sql  security definer set search_path to 'public', 'pg_catalog' as $f$ select app.offer_mcp_tool(p_office, p_discovered, p_as) $f$;
revoke all on function public.offer_mcp_tool(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.offer_mcp_tool(uuid, uuid, text) to service_role;
revoke all on function app.offer_mcp_tool(uuid, uuid, text) from public, anon, authenticated, service_role;
create function public.register_mcp_provider(p_office uuid, p_name text, p_endpoint text, p_display_name text DEFAULT ''::text, p_auth_kind text DEFAULT 'none'::text, p_credential_ref uuid DEFAULT NULL::uuid, p_notes text DEFAULT ''::text) returns jsonb language sql  security definer set search_path to 'public', 'pg_catalog' as $f$ select app.register_mcp_provider(p_office, p_name, p_endpoint, p_display_name, p_auth_kind, p_credential_ref, p_notes) $f$;
revoke all on function public.register_mcp_provider(uuid, text, text, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.register_mcp_provider(uuid, text, text, text, text, uuid, text) to service_role;
revoke all on function app.register_mcp_provider(uuid, text, text, text, text, uuid, text) from public, anon, authenticated, service_role;
create function public.revoke_mcp_provider(p_office uuid, p_provider uuid, p_why text DEFAULT ''::text) returns jsonb language sql  security definer set search_path to 'public', 'pg_catalog' as $f$ select app.revoke_mcp_provider(p_office, p_provider, p_why) $f$;
revoke all on function public.revoke_mcp_provider(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.revoke_mcp_provider(uuid, uuid, text) to service_role;
revoke all on function app.revoke_mcp_provider(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function app.browser_session_open(uuid, uuid, text, text, app.vault_secret_ref, text) from public, anon, authenticated, service_role;

----------------------------------------------------------------------------------------------------------------------
-- the old signatures go: no door onto a browser session or an MCP provider that does not say whose
----------------------------------------------------------------------------------------------------------------------
drop function public.browser_budget();
drop function public.browser_lately(uuid, integer);
drop function public.browser_now(uuid);
drop function public.browser_session_establish(uuid, text, text, text, text);
drop function public.browser_session_forget(uuid);
drop function public.browser_sessions_for(uuid);
drop function public.hq_mcp();
drop function public.mcp_inventory();
drop function public.offer_mcp_tool(uuid, text);
drop function public.register_mcp_provider(text, text, text, text, uuid, text);
drop function public.revoke_mcp_provider(uuid, text);
drop function app.browser_budget();
drop function app.browser_lately(uuid, integer);
drop function app.browser_now(uuid);
drop function app.browser_session_establish(uuid, text, text, text, text);
drop function app.browser_session_forget(uuid);
drop function app.browser_sessions_for(uuid);
drop function app.browser_session_open(uuid, text, text, app.vault_secret_ref, text);
drop function app.hq_mcp();
drop function app.mcp_inventory();
drop function app.offer_mcp_tool(uuid, text);
drop function app.register_mcp_provider(text, text, text, text, uuid, text);
drop function app.revoke_mcp_provider(uuid, text);
