-- 0740 - the shared pieces the governance functions stand on, each taking an office (multi-user P3, cluster d).
--
-- hq_answer_blocker, decide_suggestion, hq_autonomy_set and their neighbours (0741, 0742) write standing authorizations,
-- decisions, lessons, skills and ledger events. Each of those writers used to name no office, so the compatibility bridge
-- guessed one (the sole person office, while there is exactly one) - which is the ambient identity this phase removes.
-- These are the office-explicit versions: `p_office` FIRST, no default, every row read and written carries
-- `office_id = p_office`, and the office is written explicitly so the bridge is never consulted. The legacy overloads
-- are left where other callers outside this cluster still use them, for the lead to drop when the last one moves.
--
--   app.office_scope(office)      the offices whose DEPLOYMENT rows an office may see and change: its own, plus the
--                                 system office's (shared infrastructure credentials and duties) when the office's person is
--                                 a deployment operator (0647). An ordinary person's scope is exactly itself.
--   app.owner_office(owner_key)   the office of the person holding an owner key (the inverse of app.office_actor).
--   app.operator_refusal(office)  null when the office's person operates the deployment (0647), else the sentence the
--                                 gateway already says. The deployment-level writers ask it themselves: the gateway's
--                                 OPERATOR_ONLY list is the first line, this is the same line drawn again at the data.
--   app.append_event(office, ...) the ledger writer (public.append_event, with the office written).
--   app.undo_none(office, ...)    the "this cannot be undone" record, in the office.
--   app.record_decision_made / app.grant_standing / app.record_destination_authority /
--   app.answer_generation_approval / app.learn / app.teach_skill / app.retire_skill / app.impediments_tally /
--   app.active_refusals / app.hq_stranded_work / app.hq_staff_tools / app.hq_staff_procedures
--
-- The autonomy policy floor (`check (action_level < 3 or verdict <> 'proceed')`) and the trigger that refuses a standing
-- authorization on a level-3 tool are untouched: grant_standing still inserts through the trigger.

create function app.office_scope(p_office uuid)
returns uuid[]
language sql
stable
security definer
set search_path to ''
as $f$
  select case when public.deployment_operator(app.office_actor(p_office))
              then array[p_office, (select o.office_id from public.offices o where o.kind = 'system')]
              else array[p_office] end
$f$;
revoke all on function app.office_scope(uuid) from public, anon, authenticated, service_role;

-- The inverse of app.office_actor: the office of the person who holds an owner key. For the harness, the scratch scripts
-- and the operator's tooling, which know a person by the key the gateway would inject and need the office to say so.
-- Null when nobody holds the key; never a default.
create function app.owner_office(p_owner_key text)
returns uuid
language sql
stable
security definer
set search_path to ''
as $f$
  select o.office_id
    from public.office_members m
    join auth.users u on lower(u.email) = lower(m.email)
    join public.offices o on o.auth_user_id = u.id
   where m.owner_key = nullif(btrim(coalesce(p_owner_key, '')), '') and m.kind = 'person' and o.state = 'active'
   limit 1
$f$;
revoke all on function app.owner_office(text) from public, anon, authenticated, service_role;

create function app.operator_refusal(p_office uuid)
returns text
language sql
stable
security definer
set search_path to ''
as $f$
  select case when public.deployment_operator(app.office_actor(p_office)) then null
              else 'This changes something shared by the whole deployment, so only its operator can do it.' end
$f$;
revoke all on function app.operator_refusal(uuid) from public, anon, authenticated, service_role;

create function app.append_event(
  p_office uuid, p_correlation_id uuid, p_actor_kind text, p_actor text, p_trigger text, p_action_type text,
  p_reversible boolean, p_project_id uuid default null, p_before_state jsonb default null,
  p_after_state jsonb default null, p_rationale_summary text default null, p_source_refs jsonb default '[]'::jsonb,
  p_provider_used text default null, p_tool_used text default null, p_reversal_method text default null,
  p_related_job_id uuid default null, p_related_task_id uuid default null, p_compensates_event_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path to ''
as $f$
declare v_id uuid;
begin
  perform app.require_office(p_office);
  insert into public.events (
    office_id, correlation_id, actor_kind, actor, trigger, action_type, reversible,
    project_id, before_state, after_state, rationale_summary, source_refs,
    provider_used, tool_used, reversal_method, related_job_id, related_task_id,
    compensates_event_id
  ) values (
    p_office, p_correlation_id, p_actor_kind, p_actor, p_trigger, p_action_type, p_reversible,
    p_project_id, p_before_state, p_after_state, p_rationale_summary, p_source_refs,
    p_provider_used, p_tool_used, p_reversal_method, p_related_job_id, p_related_task_id,
    p_compensates_event_id
  )
  returning event_id into v_id;
  return v_id;
end
$f$;
revoke all on function app.append_event(uuid, uuid, text, text, text, text, boolean, uuid, jsonb, jsonb, text, jsonb, text, text, text, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function app.undo_none(p_office uuid, p_kind text, p_description text)
returns uuid
language plpgsql
security definer
set search_path to ''
as $f$
declare v_id uuid;
begin
  perform app.require_office(p_office);
  if coalesce(current_setting('app.undoing', true), '') = '1' then
    return null;
  end if;
  insert into public.undoable_actions
    (office_id, correlation_id, kind, description, reversal, status, undo_deadline)
  values (p_office, gen_random_uuid(), p_kind, p_description, '{}'::jsonb, 'not_undoable', null)
  returning action_id into v_id;
  return v_id;
end
$f$;
revoke all on function app.undo_none(uuid, text, text) from public, anon, authenticated, service_role;

create function app.record_decision_made(p_office uuid, p_question text, p_chose text, p_ruled_out text[], p_because text, p_decided_by text, p_project uuid DEFAULT NULL::uuid, p_job uuid DEFAULT NULL::uuid, p_supersedes uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare v_id uuid;
begin
  perform app.require_office(p_office);
  if coalesce(btrim(p_question), '') = '' or coalesce(btrim(p_chose), '') = ''
     or coalesce(btrim(p_because), '') = '' then
    return jsonb_build_object('ok', false,
      'error', 'a decision needs the question, what was chosen, and why');
  end if;

  insert into public.decisions
    (office_id, question, chose, ruled_out, because, decided_by, project_id, from_job, supersedes)
  values (p_office, btrim(p_question), btrim(p_chose),
          coalesce(p_ruled_out, array[]::text[]), btrim(p_because),
          p_decided_by, p_project, p_job, p_supersedes)
  returning decision_id into v_id;

  return jsonb_build_object('ok', true, 'decision', v_id);
end;
$function$;
revoke all on function app.record_decision_made(uuid, text, text, text[], text, text, uuid, uuid, uuid) from public, anon, authenticated, service_role;
create function app.grant_standing(p_office uuid, p_tool text, p_project uuid, p_reason text, p_by text, p_until timestamp with time zone DEFAULT NULL::timestamp with time zone, p_scope text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare v_id uuid; v_refusal text; v_scope text := nullif(btrim(coalesce(p_scope, '')), '');
begin
  perform app.require_office(p_office);
  -- 0618: a test principal grants a standing authorization only in a fixture project, and nobody unknown at all.
  v_refusal := app.authority_refusal(p_by, null, p_project);
  if v_refusal is not null then
    return jsonb_build_object('ok', false, 'error', v_refusal);
  end if;
  -- A project of another office and a project that does not exist answer alike.
  if p_project is not null and app.project_in_office(p_office, p_project::text) is null then
    return jsonb_build_object('ok', false, 'error', 'there is no such project');
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    return jsonb_build_object('ok', false,
      'error', 'a standing authorization needs a reason — it is what makes it reviewable later');
  end if;

  -- Replace rather than collide. Saying it again with a better reason is the common case, and the unique index
  -- would otherwise refuse it. The scope is part of what is replaced: a different destination is a different row.
  update public.standing_authorizations
     set revoked_at = app.now_utc(), revoked_reason = 'replaced by a newer standing authorization'
   where office_id = p_office and tool = p_tool and revoked_at is null
     and project_id is not distinct from p_project
     and scope_ref is not distinct from v_scope;

  begin
    insert into public.standing_authorizations (office_id, project_id, tool, reason, granted_by, expires_at, scope_ref)
    values (p_office, p_project, p_tool, btrim(p_reason), p_by, p_until, v_scope)
    returning authorization_id into v_id;
  exception when raise_exception then
    -- The trigger's refusal (a level-3 tool, a scoped tool with no destination) is an ANSWER: the question that
    -- offered it is still answered, and the outcome says why nothing was granted.
    return jsonb_build_object('ok', false, 'error', sqlerrm);
  end;

  return jsonb_build_object('ok', true, 'authorization', v_id, 'tool', p_tool, 'destination', v_scope,
    'scope', case when p_project is null then 'everywhere' else 'this project' end);
end;
$function$;
revoke all on function app.grant_standing(uuid, text, uuid, text, text, timestamp with time zone, text) from public, anon, authenticated, service_role;
create function app.record_destination_authority(p_office uuid, p_tool text, p_project uuid, p_scope text, p_by text, p_job uuid, p_why text, p_exclusive boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_who text;
  v_scoped boolean;
begin
  perform app.require_office(p_office);
  select scoped into v_scoped from public.tool_permissions where tool = p_tool and enabled;
  if v_scoped is not true then
    return jsonb_build_object('ok', false, 'error', format('%s is not authorised per destination', p_tool));
  end if;
  if coalesce(btrim(p_scope), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'a destination is needed');
  end if;

  -- A job that is not this office's lends it no provenance.
  if p_job is not null and not exists (select 1 from public.jobs j where j.job_id = p_job and j.office_id = p_office) then
    p_job := null;
  end if;
  v_who := app.person_provenance(p_by, p_job);
  if v_who is null then
    return jsonb_build_object('ok', false, 'error', 'only a person connecting something authorises it');
  end if;

  if p_exclusive then
    update public.standing_authorizations
       set revoked_at = app.now_utc(), revoked_reason = 'the destination changed'
     where office_id = p_office and tool = p_tool and revoked_at is null and scope_ref is distinct from p_scope
       and project_id is not distinct from p_project;
  end if;

  return app.grant_standing(
    p_office, p_tool, p_project,
    format('%s - connected by %s', coalesce(nullif(btrim(p_why), ''), p_scope), v_who),
    v_who, null, p_scope);
end;
$function$;
revoke all on function app.record_destination_authority(uuid, text, uuid, text, text, uuid, text, boolean) from public, anon, authenticated, service_role;
create function app.answer_generation_approval(p_office uuid, p_blocker uuid, p_approved boolean, p_by text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  b public.blockers;
  v_config jsonb;
  v_next text;
  v_new uuid;
  v_refusal text;
begin
  perform app.require_office(p_office);
  -- 0608: called directly by the button path as well as by hq_answer_blocker,
  -- so it refuses an unidentified approver for itself.
  v_refusal := app.principal_refusal(p_by);
  if v_refusal is not null then
    return jsonb_build_object('error', v_refusal);
  end if;

  -- 0611: locked, like hq_answer_blocker (0596). This is the door the button path
  -- calls directly, and it now writes the durable answer, so two presses at the
  -- same moment must not both read 'open' and leave an answer that contradicts
  -- the job that ran.
  select * into b from public.blockers where blocker_id = p_blocker and office_id = p_office for update;
  if not found then
    return jsonb_build_object('error', 'no such request');
  end if;
  v_refusal := app.authority_refusal(btrim(coalesce(p_by, '')), b.job_id, b.project_id);
  if v_refusal is not null then
    return jsonb_build_object('error', v_refusal);
  end if;
  if b.state <> 'open' then
    return jsonb_build_object('already', true, 'state', b.state, 'resolution', b.resolution);
  end if;

  -- Called off (review of the final audit): the answer is recorded and nothing is started.
  if p_approved and exists (select 1 from public.jobs j where j.job_id = b.job_id and j.office_id = p_office and j.state = 'cancelled') then
    update public.blockers
       set state = 'resolved', resolved_at = app.now_utc(),
           resolution = format('approved by %s, but the work it asked about was called off, so nothing was started', p_by),
           answered_option = b.approval_options[1], answered_by = p_by
     where blocker_id = p_blocker and office_id = p_office;
    return jsonb_build_object('approved', true, 'called_off', true, 'started', 0);
  end if;

  update public.blockers
     set state = 'resolved',
         resolved_at = app.now_utc(),
         resolution = case when p_approved
                        then format('approved by %s', p_by)
                        else format('declined by %s', p_by) end,
         -- 0611: the option chosen is a column whichever door answered, so an
         -- answer from a button is as visible to the boundary as one typed.
         answered_option = case when p_approved then b.approval_options[1]
                                else coalesce(b.decline_option, b.approval_options[2]) end,
         answered_by = p_by
   where blocker_id = p_blocker and office_id = p_office;

  if not p_approved then
    return jsonb_build_object('approved', false);
  end if;

  select pinned_config into v_config from public.jobs where job_id = b.job_id and office_id = p_office;
  -- `notebook.generate` when the job did not say, which is every approval
  -- created before this migration. An in-flight request must not become
  -- unanswerable because the schema moved under it.
  v_next := coalesce(v_config ->> 'approval_next', 'notebook.generate');

  insert into public.jobs
    (office_id, parent_job_id, correlation_id, project_id, idempotency_key, kind,
     requested_by, priority, pinned_config)
  select p_office, b.job_id, j.correlation_id, j.project_id,
         format('approved-%s', p_blocker),
         v_next,
         j.requested_by,
         -- Ahead of the queue: he has just pressed a button and is watching.
         50,
         (coalesce(v_config, '{}'::jsonb) - 'approval_next')
           || jsonb_build_object('approved_by', p_by, 'approval', p_blocker)
    from public.jobs j where j.job_id = b.job_id and j.office_id = p_office
  returning job_id into v_new;

  return jsonb_build_object('approved', true, 'job_id', v_new, 'kind', v_next);
end;
$function$;
revoke all on function app.answer_generation_approval(uuid, uuid, boolean, text) from public, anon, authenticated, service_role;
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
  if p_project_id is not null and app.project_in_office(p_office, p_project_id::text) is null then
    return jsonb_build_object('error', 'there is no such project');
  end if;
  if p_from_job is not null and not exists (select 1 from public.jobs j where j.job_id = p_from_job and j.office_id = p_office) then
    return jsonb_build_object('error', 'there is no such job');
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
    case when p_learned_by = 'grant' then 'user' else 'agent' end,
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
create function app.teach_skill(p_office uuid, p_name text, p_when_to_use text, p_procedure text, p_authored_by text, p_scope lesson_scope DEFAULT 'global'::lesson_scope, p_project_id uuid DEFAULT NULL::uuid, p_staff_slug text DEFAULT NULL::text, p_job_kind text DEFAULT NULL::text, p_tools text[] DEFAULT '{}'::text[], p_from_job uuid DEFAULT NULL::uuid, p_supersedes uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  prior   public.skills%rowtype;
  made    public.skills%rowtype;
  next_v  integer := 1;
  unknown text;
begin
  perform app.require_office(p_office);
  if p_project_id is not null and app.project_in_office(p_office, p_project_id::text) is null then
    return jsonb_build_object('error', 'there is no such project');
  end if;
  if p_from_job is not null and not exists (select 1 from public.jobs j where j.job_id = p_from_job and j.office_id = p_office) then
    return jsonb_build_object('error', 'there is no such job');
  end if;
  if p_supersedes is not null then
    select * into prior from public.skills where skill_id = p_supersedes and office_id = p_office;
    if not found then
      return jsonb_build_object('error', 'nothing to supersede: ' || p_supersedes::text);
    end if;
    if exists (select 1 from public.skills where supersedes = p_supersedes and office_id = p_office) then
      return jsonb_build_object('error', 'that skill has already been revised');
    end if;
    next_v := prior.version + 1;
  end if;

  -- Named before anything is written, so the error is about the tool rather
  -- than about a foreign key on a table the author has never heard of.
  select t into unknown
    from unnest(coalesce(p_tools, '{}'::text[])) as t
   where not exists (select 1 from public.tool_permissions tp where tp.tool = t)
   limit 1;
  if unknown is not null then
    return jsonb_build_object(
      'error', 'no such tool: ' || unknown ||
               '. A skill may only name tools that already exist; ask for a new '
               'one rather than inventing it (ADR-0017).');
  end if;

  insert into public.skills
    (office_id, row_kind, scope, project_id, staff_slug, job_kind, name, when_to_use,
     procedure, authored_by, from_job, version, supersedes)
  values
    (p_office, 'skill', p_scope, p_project_id, p_staff_slug, p_job_kind, p_name,
     p_when_to_use, p_procedure, p_authored_by, p_from_job, next_v, p_supersedes)
  returning * into made;

  insert into public.skill_tools (skill_id, tool)
  select made.skill_id, t from unnest(coalesce(p_tools, '{}'::text[])) as t
  on conflict do nothing;

  perform app.append_event(
    p_office,
    coalesce((select correlation_id from public.jobs where job_id = p_from_job and office_id = p_office),
             extensions.gen_random_uuid()),
    case when p_authored_by = 'grant' then 'user' else 'agent' end,
    p_authored_by, 'learning', 'office.skill_written',
    true, p_project_id, null,
    jsonb_build_object('skill_id', made.skill_id, 'name', p_name,
                       'scope', p_scope, 'version', made.version,
                       'tools', coalesce(p_tools, '{}'::text[])),
    -- The procedure is up to 4,000 characters and the ledger caps a rationale
    -- at 1,000, which is §6 refusing to become a place text is dumped. What it
    -- needs is enough to identify the change; the row itself holds the rest.
    left(format('%s — %s', p_name, p_when_to_use), 1000),
    '[]'::jsonb, null, null,
    'app.retire_skill(skill_id, by, reason)',
    p_from_job);

  return jsonb_build_object(
    'skill_id', made.skill_id,
    'version', made.version,
    'replaced', p_supersedes,
    'tools', coalesce(p_tools, '{}'::text[])
  );
end;
$function$;
revoke all on function app.teach_skill(uuid, text, text, text, text, lesson_scope, uuid, text, text, text[], uuid, uuid) from public, anon, authenticated, service_role;
create function app.retire_skill(p_office uuid, p_skill_id uuid, p_by text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  prior public.skills%rowtype;
begin
  perform app.require_office(p_office);
  select * into prior from public.skills where skill_id = p_skill_id and office_id = p_office;
  if not found then
    return jsonb_build_object('error', 'no such skill: ' || p_skill_id::text);
  end if;
  if exists (select 1 from public.skills where supersedes = p_skill_id and office_id = p_office) then
    return jsonb_build_object('error', 'that skill has already been revised or retired');
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 8 then
    return jsonb_build_object('error', 'a retirement needs a reason');
  end if;

  insert into public.skills
    (office_id, row_kind, scope, project_id, staff_slug, job_kind, name, when_to_use,
     procedure, authored_by, version, supersedes)
  values
    (p_office, 'retirement', prior.scope, prior.project_id, prior.staff_slug, prior.job_kind,
     prior.name,
     'Retired. ' || btrim(p_reason),
     'This skill was withdrawn and is no longer used. Reason given: '
       || btrim(p_reason),
     p_by, prior.version + 1, p_skill_id);

  return jsonb_build_object('retired', p_skill_id, 'by', p_by);
end;
$function$;
revoke all on function app.retire_skill(uuid, uuid, text, text) from public, anon, authenticated, service_role;
create function app.impediments_tally(p_office uuid, p_days integer DEFAULT 30, p_min integer DEFAULT 2, p_include_fixtures boolean DEFAULT false)
 RETURNS TABLE(kind impediment_kind, needed text, staff_slug text, times integer, first_seen timestamp with time zone, last_seen timestamp with time zone, projects integer, for_instance text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select i.kind,
         i.needed,
         i.staff_slug,
         count(*)::int                        as times,
         min(i.created_at)                    as first_seen,
         max(i.created_at)                    as last_seen,
         count(distinct i.project_id)::int    as projects,
         (array_agg(i.detail order by i.created_at desc)
            filter (where btrim(i.detail) <> ''))[1] as for_instance
    from public.job_impediments i
    join public.jobs j on j.job_id = i.job_id and j.office_id = p_office
   where app.require_office(p_office) is not null and (
           coalesce(p_include_fixtures, false)
           -- Either witness may exclude; neither may include. See the header.
           or not (coalesce(j.is_fixture, false) or i.is_fixture)
         )
     and i.created_at >= app.now_utc() - make_interval(days => greatest(coalesce(p_days, 30), 1))
   group by i.kind, i.needed, i.staff_slug
  having count(*) >= greatest(coalesce(p_min, 2), 1)
   order by count(*) desc, max(i.created_at) desc
$function$;
revoke all on function app.impediments_tally(uuid, integer, integer, boolean) from public, anon, authenticated, service_role;
create function app.active_refusals(p_office uuid, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  perform app.require_office(p_office);
  return (
with days as (select app.refusal_days() as d),
  latest as (
    select distinct on (coalesce(b.action_fingerprint, 'tool:' || b.standing_tool || ':' || coalesce(b.project_id::text, '')))
           b.*
      from public.blockers b
     where b.office_id = p_office and b.state = 'resolved' and b.answered_option is not null
       and (b.action_fingerprint is not null or b.standing_tool is not null)
     order by coalesce(b.action_fingerprint, 'tool:' || b.standing_tool || ':' || coalesce(b.project_id::text, '')),
              b.resolved_at desc)
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', l.blocker_id,
           'what', l.requested_action,
           'project', (select p.name from public.projects p where p.project_id = l.project_id and p.office_id = p_office),
           'declined_at', l.resolved_at,
           'until', l.resolved_at + make_interval(days => (select d from days)),
           'by', l.answered_by)
         order by l.resolved_at desc), '[]'::jsonb)
    from (select * from latest l0
           where l0.answered_option = l0.decline_option
             and l0.refusal_withdrawn_at is null
             and l0.resolved_at > app.now_utc() - make_interval(days => (select d from days))
             and not (l0.job_id is not null and app.harness_job(l0.job_id))
           order by l0.resolved_at desc
           limit p_limit) l
  );
end;
$function$;
revoke all on function app.active_refusals(uuid, integer) from public, anon, authenticated, service_role;
create function app.hq_stranded_work(p_office uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.require_office(p_office);
  return (
with stuck as (
    select j.kind, count(*)::int as waiting, min(j.created_at) as oldest
      from public.jobs j
      join public.job_kind_needs n on n.kind = j.kind and n.needs_subprocess
     where j.office_id = p_office and j.state = 'queued'
     group by j.kind
  )
  select jsonb_build_object(
    'total', coalesce((select sum(waiting) from stuck), 0),
    'oldest', (select min(oldest) from stuck),
    'kinds', coalesce(
      (select jsonb_agg(jsonb_build_object('kind', kind, 'waiting', waiting)
                        order by waiting desc) from stuck),
      '[]'::jsonb),
    'why', 'These need a runtime that can run a local process. The only worker '
           'is a Supabase Edge Function, and Deno has none. They wait rather '
           'than fail, so they run the moment one exists.'
  )
  );
end;
$function$;
revoke all on function app.hq_stranded_work(uuid) from public, anon, authenticated, service_role;
create function app.hq_staff_tools(p_office uuid, p_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.require_office(p_office);
  return (
select coalesce(jsonb_agg(jsonb_build_object(
           'tool', t.tool,
           'description', t.description,
           'level', t.level,
           'granted', st.staff_slug is not null,
           'available', t.enabled,
           'unavailable_because', t.disabled_reason
         ) order by t.level, t.tool), '[]'::jsonb)
    from public.tool_permissions t
    left join public.staff_tools st
      on st.tool = t.tool and st.staff_slug = p_slug and st.office_id = p_office
  );
end;
$function$;
revoke all on function app.hq_staff_tools(uuid, text) from public, anon, authenticated, service_role;
create function app.hq_staff_procedures(p_office uuid, p_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  perform app.require_office(p_office);
  return (
select coalesce(jsonb_agg(jsonb_build_object(
           'skill_id', s.skill_id,
           'name', s.name,
           'scope', s.scope::text,
           'when_to_use', s.when_to_use,
           'procedure', s.procedure,
           'version', s.version,
           'authored_by', s.authored_by,
           'tools', coalesce((
             select array_agg(st.tool order by st.tool)
               from public.skill_tools st where st.skill_id = s.skill_id
           ), array[]::text[]),
           -- How many jobs have been shown it. A procedure with a lot of use
           -- and a poor record is the one worth arguing with; one with none is
           -- just noise in the prompt.
           'uses', (select count(*)::int from public.skill_uses u where u.skill_id = s.skill_id)
         ) order by case s.scope when 'staff' then 0 else 1 end, s.created_at desc),
         '[]'::jsonb)
    from public.skills s
   where s.office_id = p_office and s.row_kind = 'skill'
     and not exists (select 1 from public.skills n where n.supersedes = s.skill_id and n.office_id = p_office)
     and (s.scope = 'global'
          or (s.scope = 'staff' and s.staff_slug = p_slug))
  );
end;
$function$;
revoke all on function app.hq_staff_procedures(uuid, text) from public, anon, authenticated, service_role;
