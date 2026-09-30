-- Rollback of 0631.
begin;
CREATE OR REPLACE FUNCTION app.obligation_state(p_root uuid)
 RETURNS obligation_state
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with t as (select * from app.obligation_tree(p_root)),
  counted as (
    select
      (select state from t where is_root) as root_state,
      count(*) filter (where state not in ('complete', 'cancelled', 'failed')) as live,
      count(*) filter (where state = 'complete') as done,
      count(*) filter (where state = 'failed') as failed,
      count(*) filter (where state = 'cancelled') as cancelled,
      (select count(*) from t
        join public.blockers b on b.job_id = t.job_id
       where b.state = 'open'
         and t.state not in ('complete', 'cancelled', 'failed')) as blocked
      from t
  )
  select case
    /*
      The root being cancelled settles it, whatever finished afterwards. A
      child that completes after a cancellation is work Grant called off, and
      reporting the obligation as fulfilled because it landed anyway is the
      stale-result defect #315 was written for.
    */
    when root_state = 'cancelled' then 'cancelled'::public.obligation_state
    when blocked > 0 then 'waiting_on_user'::public.obligation_state
    when live > 0 then 'working'::public.obligation_state
    when done = 0 then 'failed'::public.obligation_state
    when failed > 0 or cancelled > 0 then 'partially_complete'::public.obligation_state
    else 'fulfilled'::public.obligation_state
  end
  from counted
$function$;
CREATE OR REPLACE FUNCTION app.approve_tool(p_request_id uuid, p_by text DEFAULT 'grant'::text, p_limits jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  req    public.tool_requests%rowtype;
  known  public.tool_permissions%rowtype;
begin
  if p_by is distinct from 'grant' then
    return jsonb_build_object('error',
      'only Grant approves reach. An agent may ask and may never answer (ADR-0018).');
  end if;

  select * into req from public.tool_requests where request_id = p_request_id;
  if not found then
    return jsonb_build_object('error', 'no such request: ' || p_request_id::text);
  end if;
  if req.state <> 'open' then
    return jsonb_build_object('error', 'that request was already ' || req.state);
  end if;

  update public.tool_requests
     set state = 'approved', settled_at = app.now_utc(),
         decided_by = p_by, limits = p_limits
   where request_id = p_request_id;

  select * into known from public.tool_permissions where tool = req.tool;

  /*
    No implementation behind the name, so there is nothing to grant.

    Inserting the row anyway would make the approval appear to work and leave a
    permission that may or may not do anything. What Grant has actually decided
    here is that he wants it built, and saying that is more useful than a grant
    that silently does nothing.
  */
  if not found then
    perform public.append_event(
      extensions.gen_random_uuid(), 'user', p_by, 'approval', 'tool.wanted',
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

  insert into public.staff_tools (staff_slug, tool, granted_by, note)
  values (req.asked_by, req.tool, p_by,
          format('Approved from request %s.', req.request_id))
  on conflict (staff_slug, tool) do nothing;

  perform public.append_event(
    extensions.gen_random_uuid(), 'user', p_by, 'approval', 'tool.granted',
    true, null,
    jsonb_build_object('held', false),
    jsonb_build_object('tool', req.tool, 'to', req.asked_by,
                       'request_id', req.request_id, 'limits', p_limits),
    left(req.what_for, 1000), '[]'::jsonb, null, req.tool,
    'app.revoke_tool(staff_slug, tool)', null);

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
CREATE OR REPLACE FUNCTION app.decline_tool(p_request_id uuid, p_by text DEFAULT 'grant'::text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  req    public.tool_requests%rowtype;
  before integer;
begin
  if p_by is distinct from 'grant' then
    return jsonb_build_object('error',
      'only Grant answers a request for reach (ADR-0018).');
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 8 then
    return jsonb_build_object('error',
      'a decline needs a reason — it is what makes it worth revisiting in three months');
  end if;

  select * into req from public.tool_requests where request_id = p_request_id;
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
   where tool = req.tool and asked_by = req.asked_by and state = 'declined';

  update public.tool_requests
     set state = 'declined', settled_at = app.now_utc(),
         decided_by = p_by, decline_reason = btrim(p_reason),
         declines = before + 1
   where request_id = p_request_id;

  perform public.append_event(
    extensions.gen_random_uuid(), 'user', p_by, 'approval', 'tool.declined',
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
delete from app.schema_migrations where name like '0631_%';
commit;
