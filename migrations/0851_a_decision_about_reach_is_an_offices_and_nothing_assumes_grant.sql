-- 0851 - the decisions about reach take an office; the ambient-Grant readers go (multi-user P3, k-worker-internal).
--
--   app.approve_tool(p_office, p_request_id, p_by, p_limits)   \  a request is an office's. A request of another office is "no such
--   app.decline_tool(p_office, p_request_id, p_by, p_reason)    \  request" - the sentence a missing one gets - and nothing of it
--   app.revoke_tool(p_office, p_slug, p_tool, p_by)             /  moves. `p_by` has no default (a default is an identity) and must be
--   app.withdraw_tool_request(p_office, p_request_id, p_by)    /  the office's own person, `app.office_actor(p_office)`; the
--                                                                 ledger entry is written to THIS office with app.append_event.
--   app.hq_appearance(p_office)                                 the appearance an office stored, read by office (it read `owner='grant'`)
--
-- DROPPED, with no caller in the database, the repository or the gateway:
--   app.contact_labels(text)                 its office-explicit sibling app.contact_labels(uuid) is what every reader calls
--   app.hq_appearance(text)                  replaced above
--   public.task_pulled(text, text, jsonb)    a wrapper over app.task_pulled(text, text, jsonb), which no longer exists: it could only fail
--
-- NOT DROPPED, because a gateway-reachable function of the GOVERNANCE cluster still calls them (that cluster moves its callers,
-- then the lead drops these four old signatures):
--   app.approve_tool(uuid, text, jsonb)                      called by public.hq_approve_tool
--   app.decline_tool(uuid, text, text)                       called by public.hq_decline_tool
--   app.revoke_tool(text, text, text)                        called by public.hq_revoke_tool
--   app.withdraw_tool_request(uuid, text)                    called by app.request_tool and the old app.approve_tool
-- They are revoked from every browser role here (a definer caller does not need the grant).
--
-- REPORTED, not fixed here (P2 follow-ups, global keys): staff_tools is keyed (staff_slug, tool) and tool_requests_one_open is
-- unique on (tool, asked_by) across the deployment, so a second office granting a tool the first already holds writes nothing
-- (ON CONFLICT DO NOTHING) and the open-request slot is shared. The writes below carry the office explicitly and guard every read.

-- p_limits has NO default: with one, a three-argument call would match this signature and the old
-- app.approve_tool(uuid, text, jsonb) alike and fail as ambiguous for as long as both exist.
create function app.approve_tool(p_office uuid, p_request_id uuid, p_by text, p_limits jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  req    public.tool_requests%rowtype;
  known  public.tool_permissions%rowtype;
begin
  perform app.require_office(p_office);
  if p_by is distinct from app.office_actor(p_office) then
    return jsonb_build_object('error',
      'only the person this office belongs to approves reach. An agent may ask and may never answer (ADR-0018).');
  end if;

  -- A request of another office is a request that does not exist.
  select * into req from public.tool_requests where request_id = p_request_id and office_id = p_office for update;
  if not found then
    return jsonb_build_object('error', 'no such request: ' || p_request_id::text);
  end if;
  if req.state <> 'open' then
    return jsonb_build_object('error', 'that request was already ' || req.state);
  end if;

  update public.tool_requests
     set state = 'approved', settled_at = app.now_utc(),
         decided_by = p_by, limits = p_limits
   where request_id = p_request_id and office_id = p_office;

  select * into known from public.tool_permissions where tool = req.tool;

  /*
    No implementation behind the name, so there is nothing to grant.

    Inserting the row anyway would make the approval appear to work and leave a
    permission that may or may not do anything. What the person has actually decided
    here is that they want it built, and saying that is more useful than a grant
    that silently does nothing.
  */
  if not found then
    perform app.append_event(
      p_office, extensions.gen_random_uuid(), 'user', p_by, 'approval', 'tool.wanted',
      true, null, null,
      jsonb_build_object('tool', req.tool, 'request_id', req.request_id),
      'Approved, but no such tool exists yet — this is a decision to build it.',
      '[]'::jsonb, null, null, 'app.withdraw_tool_request(request_id)', null);
    return jsonb_build_object(
      'approved', true, 'granted', false, 'needs_building', true, 'tool', req.tool,
      'say', format('Approved — but %s does not exist yet, so there is nothing '
                    || 'to switch on. It needs building before anyone can hold it.',
                    req.tool));
  end if;

  insert into public.staff_tools (office_id, staff_slug, tool, granted_by, note)
  values (p_office, req.asked_by, req.tool, p_by,
          format('Approved from request %s.', req.request_id))
  on conflict (staff_slug, tool) do nothing;

  perform app.append_event(
    p_office, extensions.gen_random_uuid(), 'user', p_by, 'approval', 'tool.granted',
    true, null,
    jsonb_build_object('held', false),
    jsonb_build_object('tool', req.tool, 'to', req.asked_by,
                       'request_id', req.request_id, 'limits', p_limits),
    left(req.what_for, 1000), '[]'::jsonb, null, req.tool,
    'app.revoke_tool(office, staff_slug, tool)', null);

  /*
    The global switch stays the ceiling (0119).

    A grant against a policy-disabled tool is recorded and does nothing, and
    saying so is the difference between a permission screen that explains itself
    and one that lies. Flipping the global switch is a separate, deliberate act.
  */
  return jsonb_build_object(
    'approved', true, 'granted', true, 'tool', req.tool, 'to', req.asked_by,
    'in_force', known.enabled,
    'say', case when known.enabled
      then format('%s can now use %s.', req.asked_by, req.tool)
      else format('Granted to %s, but %s is switched off for everyone — %s. '
                  || 'It stays off until that changes.',
                  req.asked_by, req.tool, coalesce(known.disabled_reason, 'by policy'))
    end);
end;
$function$;
revoke all on function app.approve_tool(uuid, uuid, text, jsonb) from public, anon, authenticated, service_role;

create function app.decline_tool(p_office uuid, p_request_id uuid, p_by text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  req    public.tool_requests%rowtype;
  before integer;
begin
  perform app.require_office(p_office);
  if p_by is distinct from app.office_actor(p_office) then
    return jsonb_build_object('error',
      'only the person this office belongs to answers a request for reach (ADR-0018).');
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 8 then
    return jsonb_build_object('error',
      'a decline needs a reason — it is what makes it worth revisiting in three months');
  end if;

  select * into req from public.tool_requests where request_id = p_request_id and office_id = p_office for update;
  if not found then
    return jsonb_build_object('error', 'no such request: ' || p_request_id::text);
  end if;
  if req.state <> 'open' then
    return jsonb_build_object('error', 'that request was already ' || req.state);
  end if;

  -- Carried forward from every previous refusal of this exact ask, so the
  -- silence lengthens rather than resetting to ninety days each time.
  select coalesce(max(declines), 0) into before
    from public.tool_requests
   where tool = req.tool and asked_by = req.asked_by and state = 'declined' and office_id = p_office;

  update public.tool_requests
     set state = 'declined', settled_at = app.now_utc(),
         decided_by = p_by, decline_reason = btrim(p_reason),
         declines = before + 1
   where request_id = p_request_id and office_id = p_office;

  perform app.append_event(
    p_office, extensions.gen_random_uuid(), 'user', p_by, 'approval', 'tool.declined',
    true, null, null,
    jsonb_build_object('tool', req.tool, 'asked_by', req.asked_by,
                       'declines', before + 1),
    left(btrim(p_reason), 1000), '[]'::jsonb, null, req.tool,
    'app.request_tool(...) again once the silence expires', null);

  return jsonb_build_object(
    'declined', true, 'tool', req.tool, 'declines', before + 1,
    'silent_until', app.now_utc() + ((before + 1) * interval '90 days'));
end;
$function$;
revoke all on function app.decline_tool(uuid, uuid, text, text) from public, anon, authenticated, service_role;

create function app.withdraw_tool_request(p_office uuid, p_request_id uuid, p_by text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
begin
  perform app.require_office(p_office);
  update public.tool_requests
     set state = 'withdrawn', settled_at = app.now_utc(), decided_by = p_by
   where request_id = p_request_id and office_id = p_office and state = 'open';
  if not found then
    return jsonb_build_object('error', 'nothing open to withdraw');
  end if;
  return jsonb_build_object('withdrawn', p_request_id);
end;
$function$;
revoke all on function app.withdraw_tool_request(uuid, uuid, text) from public, anon, authenticated, service_role;

create function app.revoke_tool(p_office uuid, p_slug text, p_tool text, p_by text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_changed boolean;
begin
  perform app.require_office(p_office);
  if not exists (select 1 from public.staff where slug = p_slug) then
    return jsonb_build_object('error', format('no one called %L', p_slug));
  end if;
  if not exists (select 1 from public.tool_permissions where tool = p_tool) then
    return jsonb_build_object('error', format('there is no tool called %L', p_tool));
  end if;

  -- Only THIS office's grant is taken back; another office holding the same tool is untouched.
  delete from public.staff_tools where staff_slug = p_slug and tool = p_tool and office_id = p_office;
  v_changed := found;
  if not v_changed then
    return jsonb_build_object('error', format('%s does not hold %s', p_slug, p_tool));
  end if;

  -- The ledger, in the words the request path and the team page use ('tool.revoked').
  perform app.append_event(
    p_office, extensions.gen_random_uuid(), 'user', p_by, 'approval', 'tool.revoked',
    true, null,
    jsonb_build_object('held', true),
    jsonb_build_object('held', false),
    format('%s no longer holds %s.', p_slug, p_tool),
    '[]'::jsonb, null, p_tool, 'app.hq_staff_tool_set on again', null);

  return jsonb_build_object('revoked', p_tool, 'from', p_slug);
end;
$function$;
revoke all on function app.revoke_tool(uuid, text, text, text) from public, anon, authenticated, service_role;

-- The old signatures stay for the governance cluster's gateway wrappers; no browser role may call them.
revoke all on function app.approve_tool(uuid, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function app.decline_tool(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function app.revoke_tool(text, text, text) from public, anon, authenticated, service_role;
revoke all on function app.withdraw_tool_request(uuid, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- hq_appearance: read by office, not by the literal owner 'grant'
-- ---------------------------------------------------------------------------------------------------------------------
create function app.hq_appearance(p_office uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select coalesce((select a.settings from public.appearance_settings a
                    where a.office_id = app.require_office(p_office)
                    order by a.updated_at desc limit 1),
                  '{}'::jsonb)
$function$;
revoke all on function app.hq_appearance(uuid) from public, anon, authenticated, service_role;

drop function app.hq_appearance(text);
drop function app.contact_labels(text);
drop function public.task_pulled(text, text, jsonb);
