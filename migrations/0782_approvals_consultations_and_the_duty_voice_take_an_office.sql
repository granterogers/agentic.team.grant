-- 0782 - approvals, standing authorizations, consultations, the duty's voice and the failure tally take an office
-- (multi-user P3, cluster h-jobs).
--
-- What an approval is: a question (a `blockers` row) minted for one job, answered by a person, and later CONSUMED by
-- `approval_verdict` / `authorize_effect` when the job (or its child) is about to act. The question, the job, the project
-- it names and any standing authorization that could stand in for it must all be one office's. Before this they were
-- looked up by id alone, and the standing authorization by `project_id is null` - which meant every office's.
--
--   request_approval(p_office, job, ...)                  mints a question inside the job's office
--   request_generation_approval(p_office, job, ...)       same, for a notebook generation
--   approval_verdict(p_office, job)                       the question a job NAMES (pinned_config.approval is data, and
--                                                         data can name another office's question) must be this office's
--   authorize_effect(p_office, project, tool, ...)        the one boundary every effect goes through: reads this office's
--                                                         dial and standing yes (app.may_act_in) and this office's recorded
--                                                         answers; a foreign job, project or question changes nothing
--   record_consultation(p_office, job, ...)               no ambient requester: `p_requested_by` is REQUIRED (it defaulted
--                                                         to 'chief-of-staff', an identity nobody had given)
--   say_once(p_office, job, body, topic)                  the duty's "I already said this" memory, keyed by the OFFICE
--                                                         (duty_said is keyed by kind and project; a job with no project now
--                                                         falls to its OWN office's Unnamed project, not a deployment-wide one)
--   failure_seen(p_office, kind, message, subject, job)   the tally row is the office's; a job of another office is a job
--                                                         that does not exist
--
-- A foreign job and a nonexistent one are indistinguishable to all of them. The public wrapper of record_consultation
-- (and the other public wrappers of this cluster) is retired in 0784: nothing called them but the worker and two suites.
--
-- NOT done here, reported: `failure_signatures` is UNIQUE (job_kind, error_class, subject) across the deployment, so two
-- offices that fail the same way share one key. `failure_seen` guards its ON CONFLICT UPDATE with the office: the second
-- office's failure is then not counted (it reads "tracked under another record"), and never changes the first's row.

create function app.request_approval(p_office uuid, p_job uuid, p_action text, p_why text, p_next text)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $f$
declare
  v_project uuid;
  v_agent text;
  v_id uuid;
begin
  perform app.require_office(p_office);

  if p_next not in ('notebook.generate', 'office.execute_plan') then
    -- The list is fixed for the same reason the MCP kinds are: an approval that can start any job kind is a button that
    -- can start any job kind.
    raise exception '% is not a kind an approval may start', p_next
      using errcode = '22023';
  end if;

  select j.project_id into v_project from public.jobs j where j.job_id = p_job and j.office_id = p_office;
  if not found then
    -- A job of another office is a job that does not exist.
    raise exception 'no such job' using errcode = 'P0002';
  end if;

  -- Up the parent chain: a follow-up job is the same person continuing the same work, and the routing decision lives on
  -- the job that took the message.
  with recursive lineage as (
    select job_id, parent_job_id, 0 as depth
      from public.jobs where job_id = p_job and office_id = p_office
    union all
    select j.job_id, j.parent_job_id, l.depth + 1
      from public.jobs j join lineage l on j.job_id = l.parent_job_id
     where l.depth < 8 and j.office_id = p_office
  )
  select s.name into v_agent
    from lineage l
    join public.routing_decisions r on r.job_id = l.job_id
    join public.staff s on s.slug = r.roster[1]
   order by l.depth asc, r.decided_at desc
   limit 1;

  select blocker_id into v_id
    from public.blockers where job_id = p_job and office_id = p_office and state = 'open' limit 1;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.blockers
    (office_id, project_id, job_id, requested_action, why_needed, consequences_of_delay,
     approval_options, originating_agent, work_can_continue)
  values (
    p_office, v_project, p_job, p_action,
    -- The plan, appended (#131). Empty when the job has none, so a job that only reads gains nothing and no blank heading.
    p_why || app.job_plan_text(p_job),
    'Nothing happens until you answer. The request stays here.',
    array['Go ahead', 'Not now'],
    coalesce(v_agent, (select name from public.staff where slug = 'chief-of-staff')),
    true
  )
  returning blocker_id into v_id;

  -- What the yes should start. On the job, because `pinned_config` is already the record of the configuration a job ran
  -- under, and a plan is exactly that.
  update public.jobs
     set pinned_config = pinned_config || jsonb_build_object('approval_next', p_next)
   where job_id = p_job and office_id = p_office;

  -- 0616: the question is about EXACTLY this plan (approval_next is on the job by now).
  update public.blockers
     set action_fingerprint = (select app.approval_fingerprint(j.project_id, p_next, j.pinned_config)
                                 from public.jobs j where j.job_id = p_job and j.office_id = p_office),
         decline_option = 'Not now'
   where blocker_id = v_id and office_id = p_office and action_fingerprint is null;

  return v_id;
end;
$f$;
revoke all on function app.request_approval(uuid, uuid, text, text, text) from public, anon, authenticated, service_role;
drop function app.request_approval(uuid, text, text, text);

create function app.request_generation_approval(p_office uuid, p_job uuid, p_kind text, p_what text, p_cost text)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $f$
declare
  v_project uuid;
  v_agent text;
  v_id uuid;
begin
  perform app.require_office(p_office);

  select j.project_id into v_project from public.jobs j where j.job_id = p_job and j.office_id = p_office;
  if not found then
    raise exception 'no such job' using errcode = 'P0002';
  end if;

  -- Up the parent chain. A generation job is the child of the instruction that asked for it, and the routing decision -
  -- who is speaking - lives on the parent. Bounded at eight because a chain deeper than that is a bug.
  with recursive lineage as (
    select job_id, parent_job_id, 0 as depth
      from public.jobs where job_id = p_job and office_id = p_office
    union all
    select j.job_id, j.parent_job_id, l.depth + 1
      from public.jobs j join lineage l on j.job_id = l.parent_job_id
     where l.depth < 8 and j.office_id = p_office
  )
  select s.name into v_agent
    from lineage l
    join public.routing_decisions r on r.job_id = l.job_id
    join public.staff s on s.slug = r.roster[1]
   order by l.depth asc, r.decided_at desc
   limit 1;

  select blocker_id into v_id
    from public.blockers
   where job_id = p_job and office_id = p_office and state = 'open'
   limit 1;
  if v_id is not null then
    return v_id;
  end if;

  -- What answering this PERFORMS. Without it app.hq_answer_blocker resolves the question and queues nothing (0591).
  update public.jobs
     set pinned_config = coalesce(pinned_config, '{}'::jsonb)
           || jsonb_build_object('approval_next', 'notebook.generate')
   where job_id = p_job and office_id = p_office
     and coalesce(pinned_config ->> 'approval_next', '') = '';

  insert into public.blockers
    (office_id, project_id, job_id, requested_action, why_needed, consequences_of_delay,
     approval_options, originating_agent, work_can_continue)
  values (
    p_office, v_project, p_job,
    format('Generate %s in the notebook', p_what),
    p_cost,
    'Nothing is generated until you say so. The request stays here until you answer it.',
    array['Go ahead', 'Not now'],
    -- The Chief of Staff, not "the team", when the chain says nothing.
    coalesce(v_agent, (select name from public.staff where slug = 'chief-of-staff')),
    true
  )
  returning blocker_id into v_id;

  -- 0616: the question is about EXACTLY this request.
  update public.blockers
     set action_fingerprint = (select app.approval_fingerprint(j.project_id, 'notebook.generate', j.pinned_config)
                                 from public.jobs j where j.job_id = p_job and j.office_id = p_office),
         decline_option = 'Not now'
   where blocker_id = v_id and office_id = p_office and action_fingerprint is null;

  return v_id;
end;
$f$;
revoke all on function app.request_generation_approval(uuid, uuid, text, text, text) from public, anon, authenticated, service_role;
drop function app.request_generation_approval(uuid, text, text, text);

-- The verdict on a job that says it was approved. The question it names lives in `pinned_config` - data a job carries,
-- not a thing this function may trust to be this office's - so the question is looked up INSIDE the office: another
-- office's question and one that does not exist read the same ("the question it names does not exist").
create function app.approval_verdict(p_office uuid, p_job uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $f$
declare
  j record;
  b public.blockers;
  v_id uuid;
  v_fp text;
  v_from timestamptz;
begin
  perform app.require_office(p_office);

  select job_id, kind, project_id, parent_job_id, pinned_config into j
    from public.jobs where job_id = p_job and office_id = p_office;
  if not found then
    return jsonb_build_object('state', 'forged', 'why', 'there is no such job');
  end if;

  if coalesce(j.pinned_config ->> 'approval', '') = '' then
    -- Nothing names a question. A job that claims to be approved with no question behind it is not.
    return case
      when coalesce(j.pinned_config ->> 'approved_by', '') = ''
        then jsonb_build_object('state', 'none', 'why', 'nothing has been approved')
      else jsonb_build_object('state', 'forged',
             'why', 'this says it was approved, and no question it was approved on exists')
    end;
  end if;

  begin
    v_id := (j.pinned_config ->> 'approval')::uuid;
  exception when invalid_text_representation then
    return jsonb_build_object('state', 'forged', 'why', 'the approval it names is not a question');
  end;
  select * into b from public.blockers where blocker_id = v_id and office_id = p_office;
  if not found then
    return jsonb_build_object('state', 'forged', 'why', 'the question it names does not exist');
  end if;
  if b.state <> 'resolved' or b.answered_option is null
     or b.answered_option is distinct from b.approval_options[1] then
    return jsonb_build_object('state', 'forged', 'why', 'that question was not answered yes');
  end if;
  if b.refusal_withdrawn_at is not null then
    return jsonb_build_object('state', 'forged', 'why', 'that answer was taken back');
  end if;
  if b.job_id is distinct from j.parent_job_id then
    return jsonb_build_object('state', 'forged', 'why', 'that question was asked by a different job');
  end if;
  if app.principal_kind(b.answered_by) <> 'person'
     and not app.harness_job(j.job_id) then
    return jsonb_build_object('state', 'forged', 'why', 'that answer did not come from a person');
  end if;

  v_fp := app.approval_fingerprint(j.project_id, j.kind, j.pinned_config);
  if b.action_fingerprint is null then
    select (value #>> '{}')::timestamptz into v_from
      from public.system_config where key = 'approval.fingerprints_from';
    -- Accepted only for a question raised before approvals carried a fingerprint: a finite set that only shrinks.
    if v_from is null or b.created_at >= v_from then
      return jsonb_build_object('state', 'forged', 'blocker', b.blocker_id,
        'why', 'that question carries no fingerprint, so nothing ties it to what this job is about to do');
    end if;
    return jsonb_build_object('state', 'approved_legacy', 'fingerprint', v_fp,
      'blocker', b.blocker_id, 'by', b.answered_by, 'asking_job', b.job_id,
      'why', 'raised before approvals carried a fingerprint: the question is real and was answered yes, and that is as far as it can be checked');
  end if;
  if b.action_fingerprint <> v_fp then
    return jsonb_build_object('state', 'mismatch', 'fingerprint', v_fp, 'approved', b.action_fingerprint,
      'blocker', b.blocker_id, 'why', 'what was approved is not what this job is about to do');
  end if;
  return jsonb_build_object('state', 'approved', 'fingerprint', v_fp, 'blocker', b.blocker_id,
    'by', b.answered_by, 'asking_job', b.job_id, 'why', 'you said yes to exactly this');
end
$f$;
revoke all on function app.approval_verdict(uuid, uuid) from public, anon, authenticated, service_role;
drop function app.approval_verdict(uuid);

-- The one boundary every effect goes through. Everything it consults is THIS office's: the dial and the standing yes
-- (app.may_act_in), the answers already recorded (blockers), a destination-scoped standing yes. A project, a job or an
-- asking job of another office reads exactly as one that does not exist: nothing is found, so nothing is approved.
create function app.authorize_effect(
  p_office uuid, p_project uuid, p_tool text, p_asked_job uuid default null, p_staff text default null,
  p_audience text default null, p_fingerprint text default null, p_job uuid default null,
  p_legacy_fingerprint text default null, p_scope text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $f$
declare
  v         jsonb;
  v_verdict text;
  v_days    integer;
  v_answer  text;
  v_last    record;
  v_real    boolean;
  v_scoped  record;
  v_proj    uuid;
  v_job     uuid;
  v_asked   uuid;
begin
  perform app.require_office(p_office);

  -- Every id the caller named is checked against the office, once, here. One that is not this office's becomes null:
  -- the rest of the function then reads it exactly as it reads an id that does not exist.
  select p.project_id into v_proj from public.projects p where p.project_id = p_project and p.office_id = p_office;
  select j.job_id into v_job from public.jobs j where j.job_id = p_job and j.office_id = p_office;
  select j.job_id into v_asked from public.jobs j where j.job_id = p_asked_job and j.office_id = p_office;

  v := app.may_act_in(p_office, v_proj, p_tool, v_asked);
  v_verdict := v ->> 'verdict';
  if v_verdict = 'refuse' then
    return v;
  end if;

  if p_staff is not null and btrim(p_staff) <> '' and not app.staff_may_use(p_staff, p_tool) then
    return v || jsonb_build_object(
      'verdict', 'refuse', 'standing', null, 'reason', 'specialist_not_granted',
      'because', format('%s has not been given %s, so this is not theirs to do.', p_staff, p_tool));
  end if;

  -- WHAT HE ALREADY SAID ABOUT EXACTLY THIS ACTION, in this job, comes before the dial. A No recorded for this very step
  -- is not undone by a later change of dial, a standing row, or a matrix cell that now says proceed.
  if v_job is not null and p_fingerprint is not null then
    v_answer := app.action_answer(v_job, p_fingerprint, p_legacy_fingerprint);
    if v_answer in ('no', 'unclear') then
      return v || jsonb_build_object(
        'verdict', 'refuse', 'declined', true, 'reason', 'declined',
        'because', 'You said no to this.');
    end if;
  end if;

  -- Reading is not reaching: the floor starts at level 1, where something is written.
  if p_audience = 'outside' and v_verdict = 'proceed'
     and coalesce((v ->> 'action_level')::integer, 0) >= 1 then
    v_verdict := 'ask';
    v := v || jsonb_build_object(
      'verdict', 'ask', 'standing', null, 'reason', 'outside_audience',
      'because', 'This is meant for somebody outside the office, so it waits for your say-so.');
  end if;

  if v_verdict = 'proceed'
     and coalesce((v ->> 'asked_for')::boolean, false) is not true
     and exists (select 1 from public.tool_permissions tp where tp.tool = p_tool and tp.scoped) then
    v_verdict := 'ask';
    v := v || jsonb_build_object(
      'verdict', 'ask', 'standing', null, 'reason', 'destination_scoped',
      'because', format('%s is authorised one destination at a time, so the setting alone does not cover it.', p_tool));
  end if;

  if v_verdict = 'ask' and v_answer = 'yes' then
    return v || jsonb_build_object(
      'verdict', 'proceed', 'approved', true, 'reason', 'approved',
      'because', 'You said yes to exactly this.');
  end if;

  -- A standing yes that is about ONE destination (0640). Honoured only when the caller says which destination it is
  -- writing to and the row names that same one, never for an outside audience - and only THIS office's row.
  if v_verdict = 'ask' and p_scope is not null and p_audience is distinct from 'outside' then
    select authorization_id, project_id, reason, granted_at, expires_at into v_scoped
      from public.standing_authorizations
     where office_id = p_office
       and tool = p_tool and scope_ref = p_scope and revoked_at is null
       and (expires_at is null or expires_at > app.now_utc())
       and (project_id is null or project_id = v_proj)
     order by (project_id is not null) desc
     limit 1;
    if found then
      return v || jsonb_build_object(
        'verdict', 'proceed',
        'standing', jsonb_build_object(
          'id', v_scoped.authorization_id, 'scope', 'this destination', 'destination', p_scope,
          'reason', v_scoped.reason, 'since', v_scoped.granted_at, 'until', v_scoped.expires_at),
        'because', format('You connected %s, so writing to it does not stop to ask: %s', p_scope, v_scoped.reason));
    end if;
  end if;

  if (v -> 'standing') is not null and v -> 'standing' <> 'null'::jsonb then
    return v;
  end if;
  if coalesce((v ->> 'asked_for')::boolean, false) then
    return v;
  end if;

  v_real := not coalesce(app.harness_job(v_job), false);
  v_days := app.refusal_days();
  -- A No he gave BEFORE, to this action or its standing offer, inside the window - from THIS office's questions only,
  -- and only from the same kind of traffic (a harness No must not silence a real duty, and the reverse).
  select b.resolved_at,
         (b.answered_option = b.decline_option and b.refusal_withdrawn_at is null) as declined
    into v_last
    from public.blockers b
   where b.office_id = p_office
     and b.state = 'resolved'
     and b.answered_option is not null
     and (b.job_id is null or (not coalesce(app.harness_job(b.job_id), false)) = v_real)
     and (   (p_fingerprint is not null and b.action_fingerprint = p_fingerprint)
          or (p_fingerprint is null and b.action_fingerprint is null
              and b.standing_tool = p_tool and b.project_id is not distinct from v_proj))
   order by b.resolved_at desc
   limit 1;
  if found and v_last.declined
     and v_last.resolved_at > app.now_utc() - make_interval(days => v_days) then
    return v || jsonb_build_object(
      'verdict', 'refuse', 'declined', true, 'remembered', true, 'reason', 'declined_before',
      'declined_at', v_last.resolved_at,
      'because', format('You said no to this on %s, so it stays no until %s unless you say otherwise.',
                        to_char(v_last.resolved_at, 'FMDD Mon'),
                        to_char(v_last.resolved_at + make_interval(days => v_days), 'FMDD Mon')));
  end if;

  return v;
end;
$f$;
revoke all on function app.authorize_effect(uuid, uuid, text, uuid, text, text, text, uuid, text, text) from public, anon, authenticated, service_role;
drop function app.authorize_effect(uuid, text, uuid, text, text, text, uuid, text, text);

-- A consultation: one specialist asked another about a job. No ambient requester - the caller says who is asking.
create function app.record_consultation(p_office uuid, p_job_id uuid, p_consulted text, p_requested_by text, p_reason text default ''::text, p_requests integer default 0)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $f$
declare
  v_consulted uuid;
  v_by        uuid;
  v_id        uuid;
begin
  perform app.require_office(p_office);
  if not exists (select 1 from public.jobs where job_id = p_job_id and office_id = p_office) then
    return jsonb_build_object('error', 'no such job');
  end if;

  select staff_id into v_consulted from public.staff where slug = btrim(coalesce(p_consulted, ''));
  if v_consulted is null then
    return jsonb_build_object('error', format('nobody here is called %L', p_consulted));
  end if;

  select staff_id into v_by from public.staff where slug = btrim(coalesce(p_requested_by, ''));

  -- Consulting yourself is not a consultation. Refused rather than silently written: counting it would make the
  -- delegation rate look healthy while nothing was being delegated at all.
  if v_consulted = v_by then
    return jsonb_build_object('error', 'that is the same person — not a consultation');
  end if;

  insert into public.consultations
    (job_id, consulted_staff, requested_by, reason, provider_requests)
  values (p_job_id, v_consulted, v_by,
          coalesce(nullif(btrim(p_reason), ''), 'no reason recorded'),
          greatest(coalesce(p_requests, 0), 0))
  returning consultation_id into v_id;

  return jsonb_build_object('ok', true, 'consultation', v_id, 'consulted', p_consulted);
end;
$f$;
revoke all on function app.record_consultation(uuid, uuid, text, text, text, integer) from public, anon, authenticated, service_role;
drop function app.record_consultation(uuid, text, text, text, integer);

-- The duty's memory of what it last said. duty_said is keyed by (job_kind, project) and a project is one office's, so
-- the key carries the office - provided the project is: a job with NO project used to fall to `app.unnamed_project()`, the
-- deployment's one Unnamed project, so two offices' project-less duties of one kind shared a memory and silenced each
-- other. It falls to its own office's Unnamed project now.
create function app.say_once(p_office uuid, p_job_id uuid, p_body text, p_topic text default null)
returns boolean
language plpgsql
security definer
set search_path to ''
as $f$
declare
  v_kind text;
  v_project uuid;
  v_is_duty boolean;
  v_print text;
  v_prev text;
  v_said timestamptz;
begin
  perform app.require_office(p_office);

  select j.kind, j.project_id into v_kind, v_project
    from public.jobs j where j.job_id = p_job_id and j.office_id = p_office;
  if v_kind is null then
    return true;   -- a job that is not this office's is a job that does not exist: nothing to be quiet about
  end if;
  v_project := coalesce(v_project, app.unnamed_project(p_office));

  -- Only the clock repeats itself. A person asking twice deserves two answers. THIS office's duties only.
  select exists (select 1 from public.responsibilities r where r.job_kind = v_kind and r.office_id = p_office)
    into v_is_duty;
  if not v_is_duty then
    return true;
  end if;

  -- The topic when the handler named one, the body when it did not. Prefixed so a topic can never collide with the md5
  -- of some body.
  v_print := case
               when coalesce(trim(p_topic), '') <> ''
                 then 'topic:' || trim(p_topic)
               else 'body:' || md5(coalesce(p_body, ''))
             end;

  select fingerprint, said_at into v_prev, v_said
    from public.duty_said
   where job_kind = v_kind and project_id = v_project;

  if v_prev is distinct from v_print
     or v_said < app.now_utc() - interval '20 hours' then
    insert into public.duty_said
      (job_kind, project_id, fingerprint, said_at, repeats, last_seen_at)
    values (v_kind, v_project, v_print, app.now_utc(), 0, app.now_utc())
    on conflict (job_kind, project_id) do update
      set fingerprint = excluded.fingerprint,
          said_at = excluded.said_at,
          repeats = 0,
          last_seen_at = excluded.last_seen_at;
    return true;
  end if;

  update public.duty_said
     set repeats = repeats + 1,
         last_seen_at = app.now_utc()
   where job_kind = v_kind and project_id = v_project;
  return false;
end
$f$;
revoke all on function app.say_once(uuid, uuid, text, text) from public, anon, authenticated, service_role;
drop function app.say_once(uuid, text);
drop function app.say_once(uuid, text, text);

-- 0684 attached `app.default_to_offices_unnamed_project()` to duty_said as well as to inbound_commands. That function reads
-- `new.office_id`, and duty_said (a DERIVED table: its office is its project's) has no such column, so EVERY insert into
-- duty_said raised 42703 "record new has no field office_id" - which is every first announcement of every duty, through
-- say_once, and say_once's caller treats a throw as "speak". Found by driving say_once. duty_said.project_id is NOT NULL and
-- say_once always supplies it (its own office's Unnamed project when the job has none), so the default has nothing to do here.
drop trigger a0_project_default on public.duty_said;

-- The tally of failures the morning briefing reads. The row is the office's; a job of another office is a job that does
-- not exist (so it is neither the harness check's subject nor `last_job_id`).
create function app.failure_seen(p_office uuid, p_job_kind text, p_message text, p_subject text default null, p_job_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $f$
declare
  v_class text := app.classify_failure(p_message);
  v_subject text := coalesce(btrim(p_subject), '');
  v_seen int;
  v_first timestamptz;
  v_job uuid;
begin
  perform app.require_office(p_office);

  if v_subject <> ''
     and not (
       (v_subject ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or v_subject ~ '^[a-z0-9][a-z0-9_.:-]{0,39}$')
       and v_subject !~
         '(xox[abeprs]-|sbp_[A-Za-z0-9]{16}|ntn_[A-Za-z0-9]{16}|secret_[A-Za-z0-9]{16}|sk-[A-Za-z0-9_-]{12}|AIza[A-Za-z0-9_-]{20}|gh[posur]_[A-Za-z0-9]{20}|github_pat_|eyJ[A-Za-z0-9_-]{10}\.[A-Za-z0-9_-]{10})'
     )
  then
    v_subject := '';
  end if;

  select j.job_id into v_job from public.jobs j where j.job_id = p_job_id and j.office_id = p_office;

  -- Harness traffic is not counted (0491). The answer is still a jsonb the caller can log.
  if v_job is not null and app.harness_job(v_job) then
    return jsonb_build_object(
      'class', v_class, 'subject', v_subject, 'seen', 0,
      'first_seen', app.now_utc(), 'harness', true,
      'note', format('%s failure on harness traffic, not counted', v_class));
  end if;

  insert into public.failure_signatures
    (office_id, job_kind, error_class, subject, seen, first_seen, last_seen, last_job_id)
  values (p_office, p_job_kind, v_class, v_subject, 1, app.now_utc(), app.now_utc(), v_job)
  on conflict (job_kind, error_class, subject) do update
    set seen = public.failure_signatures.seen + 1,
        last_seen = app.now_utc(),
        last_job_id = coalesce(excluded.last_job_id, public.failure_signatures.last_job_id)
    where public.failure_signatures.office_id = p_office
  returning seen, first_seen into v_seen, v_first;

  if v_seen is null then
    -- The key is another office's (it is global until the P2 follow-up). It is not counted here and not touched there.
    return jsonb_build_object('class', v_class, 'subject', v_subject, 'seen', 0,
      'first_seen', app.now_utc(), 'note', format('%s failure for %s is tracked under another record', v_class, p_job_kind));
  end if;

  return jsonb_build_object(
    'class', v_class, 'subject', v_subject, 'seen', v_seen,
    'first_seen', v_first,
    'note', case when v_seen = 1 then format('first %s failure for %s', v_class, p_job_kind)
                 else format('%s has failed with %s %s times since %s',
                             p_job_kind, v_class, v_seen, to_char(v_first, 'FMDD Mon')) end);
end;
$f$;
revoke all on function app.failure_seen(uuid, text, text, text, uuid) from public, anon, authenticated, service_role;
drop function app.failure_seen(text, text, text, uuid);
