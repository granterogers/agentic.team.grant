-- 0841 - the last callers of the office-less shapes move, and the office-less shapes go (multi-user P3, merge clean-up).
--
-- Five clusters each converted their own functions and kept the old signature for callers another cluster still owned. With
-- every cluster merged those callers are all in one place, so this moves them and drops the old overloads in the same
-- migration: a second overload is a legacy door (it answers without an office), and `create or replace` with a changed
-- argument list would only have added to it.
--
--   callers moved (spliced from their LIVE definitions, each replacement counted):
--     app.authorize_effect       staff_may_use(slug, tool)             -> staff_may_use(p_office, slug, tool)
--     app.hq_attach              record_destination_authority('notion.write', ...) -> (p_office, 'notion.write', ...)
--     app.record_rehearsal       public.append_event(...)              -> app.append_event(app.system_office(), ...)
--     app.page_backup_failure    public.append_event(...)              -> app.append_event(app.system_office(), ...)
--   converted here:
--     app.request_tool           now takes the office first; its open-request key leads with the office (it was one
--                                global slot per (tool, person), so a second office asking for the same thing was handed
--                                the FIRST office's open request back).
--   new:
--     app.system_office()        the deployment's own office (kind = 'system'): where an event nobody is the author of is filed.
--
--   dropped, by exact argument list (no caller is left: the callers check is re-run after this migration):
--     app.calendar_ahead(int) app.current_project(project_scope_kind, text) app.grant_standing(text, uuid, text, text, timestamptz, text)
--     app.held_for_budget() app.impediments_tally(int, int, boolean) app.jobs_stuck_queued(int) app.jobs_waiting(int)
--     app.last_progress() app.learn(<old>) app.office_health(int) app.reach_wanted() app.record_decision_made(<old>)
--     app.record_destination_authority(<old>) app.recurring_failures(int, int) app.retire_skill(uuid, text, text)
--     app.staff_may_use(text, text, boolean) app.teach_skill(<old>) app.undo_none(text, text) app.withdraw_tool_request(uuid, text)
--     public.append_event(<old>) public.retire_skill(uuid, text, text)
--     public.teach_skill(<old>) public.request_tool(<old>) public.impediments_tally(int, int) public.reach_wanted()   (broken wrappers)

create function app.system_office()
 returns uuid
 language sql
 stable security definer
 set search_path to ''
as $f$ select o.office_id from public.offices o where o.kind = 'system' and o.state = 'active' order by o.created_at limit 1 $f$;
revoke all on function app.system_office() from public, anon, authenticated, service_role;

-- A request is an office's: one open request per office, tool and person.
drop index public.tool_requests_one_open;
create unique index tool_requests_one_open on public.tool_requests (office_id, tool, asked_by) where state = 'open';

-- ---------------------------------------------------------------------------------------------------------------------
-- request_tool: the office first
-- ---------------------------------------------------------------------------------------------------------------------
create function app.request_tool(p_office uuid, p_tool text, p_asked_by text, p_what_for text, p_because jsonb default '{}'::jsonb, p_from_job uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  refused public.tool_requests%rowtype;
  made    public.tool_requests%rowtype;
begin
  perform app.require_office(p_office);

  -- A job of another office is refused exactly as one that does not exist is.
  if p_from_job is not null
     and not exists (select 1 from public.jobs j where j.job_id = p_from_job and j.office_id = p_office) then
    return jsonb_build_object('error', 'no such job');
  end if;

  -- Nothing to ask for. Answering "you already have it" beats an open request sitting in front of the person for a
  -- decision they already made.
  if app.staff_may_use(p_office, p_asked_by, p_tool) then
    return jsonb_build_object('already_held', true, 'tool', p_tool);
  end if;

  /*
    A decline that is still in force, keyed on the exact tool and person - IN THIS OFFICE. Ninety days per decline. The
    `order by` matters: the most recent refusal is the one whose clock is running, and taking any other row would let an
    old settled decline expire the silence a new one just bought.
  */
  select * into refused
    from public.tool_requests
   where office_id = p_office and tool = p_tool and asked_by = p_asked_by and state = 'declined'
   order by settled_at desc nulls last
   limit 1;

  if found and refused.settled_at
       > app.now_utc() - (greatest(refused.declines, 1) * interval '90 days') then
    return jsonb_build_object(
      'declined', true,
      'tool', p_tool,
      'reason', refused.decline_reason,
      'may_ask_again_after',
        refused.settled_at + (greatest(refused.declines, 1) * interval '90 days'));
  end if;

  insert into public.tool_requests (office_id, tool, asked_by, what_for, because, from_job)
  values (p_office, p_tool, p_asked_by, p_what_for, coalesce(p_because, '{}'::jsonb), p_from_job)
  on conflict (office_id, tool, asked_by) where state = 'open' do nothing
  returning * into made;

  if made.request_id is null then
    -- Already asked and still waiting. Not an error: the honest answer is that the ask exists, and repeating it would
    -- only make the queue longer.
    select * into made from public.tool_requests
     where office_id = p_office and tool = p_tool and asked_by = p_asked_by and state = 'open';
    return jsonb_build_object('request_id', made.request_id, 'already_asked', true);
  end if;

  perform app.append_event(
    p_office,
    coalesce((select correlation_id from public.jobs where job_id = p_from_job and office_id = p_office),
             extensions.gen_random_uuid()),
    'agent', p_asked_by, 'capability_gap', 'tool.requested',
    true, null, null,
    jsonb_build_object('tool', p_tool, 'request_id', made.request_id),
    left(p_what_for, 1000), '[]'::jsonb, null, null,
    -- if the author cannot say how to undo it, it is not reversible.
    'app.withdraw_tool_request(office, request_id)',
    p_from_job);

  return jsonb_build_object('request_id', made.request_id, 'tool', p_tool);
end;
$function$;
revoke all on function app.request_tool(uuid, text, text, text, jsonb, uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- The callers that moved, each spliced from its live definition with the replacement counted.
-- ---------------------------------------------------------------------------------------------------------------------
do $m$
declare
  r record;
  v text;
  n integer;
begin
  for r in
    select * from (values
      ('app.authorize_effect(uuid,uuid,text,uuid,text,text,text,uuid,text,text)'::text,
       'app.staff_may_use(p_staff, p_tool)',
       'app.staff_may_use(p_office, p_staff, p_tool)'),
      ('app.hq_attach(uuid,text,text,text,text,text,text,text)',
       'app.record_destination_authority(''notion.write''',
       'app.record_destination_authority(p_office, ''notion.write'''),
      ('app.record_rehearsal(text,jsonb)',
       'public.append_event(',
       'app.append_event(app.system_office(), '),
      ('app.page_backup_failure()',
       'public.append_event(',
       'app.append_event(app.system_office(), ')
    ) as x(fn, anchor, repl)
  loop
    v := pg_get_functiondef(r.fn::regprocedure);
    n := (length(v) - length(replace(v, r.anchor, ''))) / length(r.anchor);
    if n <> 1 then raise exception '0841 splice anchor % for % matched % times, not once', r.anchor, r.fn, n; end if;
    v := replace(v, r.anchor, r.repl);
    execute v;
  end loop;
end
$m$;

-- ---------------------------------------------------------------------------------------------------------------------
-- The old shapes go.
-- ---------------------------------------------------------------------------------------------------------------------
drop function app.request_tool(text, text, text, jsonb, uuid);
drop function app.calendar_ahead(integer);
drop function app.current_project(project_scope_kind, text);
drop function app.grant_standing(text, uuid, text, text, timestamp with time zone, text);
drop function app.held_for_budget();
drop function app.impediments_tally(integer, integer, boolean);
drop function app.jobs_stuck_queued(integer);
drop function app.jobs_waiting(integer);
drop function app.last_progress();
drop function app.learn(lesson_scope, text, text, uuid, text, text, uuid, numeric, uuid);
drop function app.office_health(integer);
drop function app.reach_wanted();
drop function app.recurring_failures(integer, integer);
drop function app.record_decision_made(text, text, text[], text, text, uuid, uuid, uuid);
drop function app.record_destination_authority(text, uuid, text, text, uuid, text, boolean);
drop function app.teach_skill(text, text, text, text, lesson_scope, uuid, text, text, text[], uuid, uuid);
drop function public.append_event(uuid, text, text, text, text, boolean, uuid, jsonb, jsonb, text, jsonb, text, text, text, uuid, uuid, uuid);
drop function app.retire_skill(uuid, text, text);
drop function app.staff_may_use(text, text, boolean);
drop function app.undo_none(text, text);
drop function app.withdraw_tool_request(uuid, text);
drop function public.retire_skill(uuid, text, text);

-- Defence in depth for the whole `app` schema. PostgreSQL grants EXECUTE on a new function to PUBLIC, and the conversions
-- revoked it function by function, so the ones nobody remembered (three of the identity doors among them) were still
-- executable by anon and authenticated. Nothing can reach them today - neither role has USAGE on the schema, and PostgREST
-- exposes only `public` - but a grant that depends on a second grant staying absent is one edit from a hole. Revoke it for
-- every function that exists, and for every function created from here on.
do $m$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
      from pg_proc p
     where p.pronamespace = 'app'::regnamespace and p.prokind in ('f', 'p')
       and (has_function_privilege('public', p.oid, 'execute')
            or has_function_privilege('anon', p.oid, 'execute')
            or has_function_privilege('authenticated', p.oid, 'execute'))
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end
$m$;
alter default privileges in schema app revoke execute on functions from public, anon, authenticated;

-- Four public wrappers over the shapes dropped above. Nothing in the repository, the edge functions or the gateway reaches
-- them, and each would now fail on first use (found by scripts/p3/check-arity.ts, which reads every body for a call by an
-- argument list that no longer exists). Dropped rather than converted: an unused door has no reason to be rebuilt.
drop function public.teach_skill(text, text, text, text, lesson_scope, uuid, text, text, text[], uuid, uuid);
drop function public.request_tool(text, text, text, jsonb, uuid);
drop function public.impediments_tally(integer, integer);
drop function public.reach_wanted();
