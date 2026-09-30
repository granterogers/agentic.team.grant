/*
  0616 - an approval applies to exactly the action approved, and the handler checks it

  Issue #386, the two doors that were gated by a blocker alone.

  `notebook.generate` and `office.execute_plan` are started by answering a question
  (`app.answer_generation_approval` queues a child job of the kind the question
  named). The gate on the first was the PRESENCE of `approved_by` in the job's
  payload; the second had no check at all. Nothing tied the yes to what it was a
  yes to:

    - anything that can write a job's `pinned_config` could start a generation
      (`public.mcp_enqueue` takes a free payload for a client - it is closed to
      the public key since 0613, and it should not have accepted an approval
      either way);
    - an approval named the asking JOB, so a plan that changed between the
      question and the answer was still approved as asked;
    - a No was a state on a question and nothing at the door remembered it.

  What changes, and it is the same shape as Run 2's plan steps:

    1. The question carries the fingerprint of what it asks about
       (`blockers.action_fingerprint`, from `app.approval_fingerprint`): the
       tool the yes will start, the project, and the MATERIAL of the request -
       kind and instructions for a generation, the steps for a plan. Deliberately
       a whitelist: a job's config also collects retry notes and gate refusals,
       and hashing all of it would fail every retry.
    2. The child job carries the question's id (`approval`) as it always did,
       and `app.approval_verdict(job)` is what the HANDLER asks before it acts:
       is that question real, answered yes by a person the office knows, on the
       job that asked, not taken back, and does what it asked about still equal
       what this job is about to do? `none` (nothing was approved: ask),
       `forged` (something claims an approval that does not exist), `mismatch`
       (the action changed), `approved`, or `approved_legacy` (a question raised
       before this migration, which has no fingerprint: verified as far as it can
       be, and accepted for in-flight work only).
    3. A client cannot bring an approval with it: `app.mcp_enqueue` strips the
       keys that say a job was approved or where it came from.

  Version skew: the question's fingerprint is written by this migration's
  functions, so a question raised by the OLD ones has none and is `approved_legacy`.
  A worker that predates this asks nothing and behaves as before.
*/

create or replace function app.approval_material(p_next text, p_config jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case p_next
    when 'notebook.generate' then
      jsonb_build_object('kind', p_config -> 'kind', 'instructions', p_config -> 'instructions')
    when 'office.execute_plan' then
      jsonb_build_object('plan_steps', p_config -> 'plan_steps')
    else '{}'::jsonb
  end
$$;

create or replace function app.approval_fingerprint(p_project uuid, p_next text, p_config jsonb)
returns text
language sql
immutable
set search_path = 'public', 'pg_catalog'
as $$
  select encode(sha256(convert_to(
           jsonb_build_object('next', p_next, 'project', p_project,
                              'material', app.approval_material(p_next, coalesce(p_config, '{}'::jsonb)))::text,
           'UTF8')), 'hex')
$$;
comment on function app.approval_fingerprint(uuid, text, jsonb) is
  'What an approval to start a job of this kind is an approval OF: the kind, the project and the material of the request. A whitelist on purpose (retry notes and gate refusals live in the same config).';

-- ---- the questions carry what they are about -------------------------------------
CREATE OR REPLACE FUNCTION app.request_generation_approval(p_job uuid, p_kind text, p_what text, p_cost text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_project uuid;
  v_agent text;
  v_id uuid;
begin
  select project_id into v_project from public.jobs where job_id = p_job;

  -- Up the parent chain. A generation job is the child of the instruction that
  -- asked for it, and the routing decision — who is speaking — lives on the
  -- parent. Bounded at eight because a chain deeper than that is a bug, and an
  -- unbounded recursive CTE over a table with a self-reference is how a bug
  -- becomes an outage.
  with recursive lineage as (
    select job_id, parent_job_id, 0 as depth
      from public.jobs where job_id = p_job
    union all
    select j.job_id, j.parent_job_id, l.depth + 1
      from public.jobs j join lineage l on j.job_id = l.parent_job_id
     where l.depth < 8
  )
  select s.name into v_agent
    from lineage l
    join public.routing_decisions r on r.job_id = l.job_id
    join public.staff s on s.slug = r.roster[1]
   order by l.depth asc, r.decided_at desc
   limit 1;

  select blocker_id into v_id
    from public.blockers
   where job_id = p_job and state = 'open'
   limit 1;
  if v_id is not null then
    return v_id;
  end if;

  -- What answering this PERFORMS. Without it app.hq_answer_blocker
  -- resolves the question and queues nothing, which is what Grant
  -- got for three approvals between 9 and 11 September (0591).
  update public.jobs
     set pinned_config = coalesce(pinned_config, '{}'::jsonb)
           || jsonb_build_object('approval_next', 'notebook.generate')
   where job_id = p_job
     and coalesce(pinned_config ->> 'approval_next', '') = '';

  insert into public.blockers
    (project_id, job_id, requested_action, why_needed, consequences_of_delay,
     approval_options, originating_agent, work_can_continue)
  values (
    v_project, p_job,
    format('Generate %s in the notebook', p_what),
    p_cost,
    'Nothing is generated until you say so. The request stays here until you answer it.',
    array['Go ahead', 'Not now'],
    -- The Chief of Staff, not "the team", when the chain says nothing. She is
    -- who asks when nobody else was convened, and a request signed by a
    -- collective noun is a request from the software.
    coalesce(v_agent, (select name from public.staff where slug = 'chief-of-staff')),
    true
  )
  returning blocker_id into v_id;

  -- 0616: the question is about EXACTLY this request.
  update public.blockers
     set action_fingerprint = (select app.approval_fingerprint(j.project_id, 'notebook.generate', j.pinned_config)
                                 from public.jobs j where j.job_id = p_job),
         decline_option = 'Not now'
   where blocker_id = v_id and action_fingerprint is null;

  return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION app.request_approval(p_job uuid, p_action text, p_why text, p_next text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_project uuid;
  v_agent text;
  v_id uuid;
begin
  if p_next not in ('notebook.generate', 'office.execute_plan') then
    -- The list is fixed for the same reason the MCP kinds are: an approval
    -- that can start any job kind is a button that can start any job kind.
    raise exception '% is not a kind an approval may start', p_next
      using errcode = '22023';
  end if;

  select project_id into v_project from public.jobs where job_id = p_job;

  -- Up the parent chain: a follow-up job is the same person continuing the
  -- same work, and the routing decision lives on the job that took the
  -- message. Third place this has been needed, hence the note in
  -- new-environment.md rather than a fourth fix in a fourth file.
  with recursive lineage as (
    select job_id, parent_job_id, 0 as depth
      from public.jobs where job_id = p_job
    union all
    select j.job_id, j.parent_job_id, l.depth + 1
      from public.jobs j join lineage l on j.job_id = l.parent_job_id
     where l.depth < 8
  )
  select s.name into v_agent
    from lineage l
    join public.routing_decisions r on r.job_id = l.job_id
    join public.staff s on s.slug = r.roster[1]
   order by l.depth asc, r.decided_at desc
   limit 1;

  select blocker_id into v_id
    from public.blockers where job_id = p_job and state = 'open' limit 1;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.blockers
    (project_id, job_id, requested_action, why_needed, consequences_of_delay,
     approval_options, originating_agent, work_can_continue)
  values (
    v_project, p_job, p_action,
    -- The plan, appended (#131). Empty when the job has none, so a job that
    -- only reads gains nothing and no blank heading.
    p_why || app.job_plan_text(p_job),
    'Nothing happens until you answer. The request stays here.',
    array['Go ahead', 'Not now'],
    coalesce(v_agent, (select name from public.staff where slug = 'chief-of-staff')),
    true
  )
  returning blocker_id into v_id;

  -- What the yes should start. On the job, because `pinned_config` is already
  -- §6's record of the configuration a job ran under, and a plan is exactly
  -- that.
  update public.jobs
     set pinned_config = pinned_config || jsonb_build_object('approval_next', p_next)
   where job_id = p_job;

  -- 0616: the question is about EXACTLY this plan (approval_next is on the job by now).
  update public.blockers
     set action_fingerprint = (select app.approval_fingerprint(j.project_id, p_next, j.pinned_config)
                                 from public.jobs j where j.job_id = p_job),
         decline_option = 'Not now'
   where blocker_id = v_id and action_fingerprint is null;

  return v_id;
end;
$function$
;

-- ---- what the handler asks before it acts ----------------------------------------
create or replace function app.approval_verdict(p_job uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public', 'pg_catalog'
as $$
declare
  j record;
  b public.blockers;
  v_id uuid;
  v_fp text;
begin
  select job_id, kind, project_id, parent_job_id, pinned_config into j
    from public.jobs where job_id = p_job;
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
  select * into b from public.blockers where blocker_id = v_id;
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
$$;
comment on function app.approval_verdict(uuid) is
  'The handler''s question before it acts: none | forged | mismatch | approved | approved_legacy. The answer is read from the question, never from a claim the job carries.';
revoke all on function app.approval_verdict(uuid) from public;
grant execute on function app.approval_verdict(uuid) to ai_team_app, service_role;
revoke all on function app.approval_fingerprint(uuid, text, jsonb) from public;
grant execute on function app.approval_fingerprint(uuid, text, jsonb) to ai_team_app, service_role;
revoke all on function app.approval_material(text, jsonb) from public;
grant execute on function app.approval_material(text, jsonb) to ai_team_app, service_role;

-- ---- a client cannot bring an approval with it ------------------------------------
CREATE OR REPLACE FUNCTION app.mcp_enqueue(p_client_id text, p_project text, p_kind text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_project uuid;
  v_job uuid;
begin
  -- The list is fixed for the same reason the tool list is: a client naming a
  -- job kind is a client choosing what the worker does.
  if p_kind not in ('notebook.generate', 'notebook.push_document', 'notebook.ask') then
    return jsonb_build_object('error', format('%L is not a kind a client may enqueue', p_kind));
  end if;

  select project_id into v_project
    from public.projects where slug = p_project and status = 'active';
  if v_project is null then
    return jsonb_build_object('error', format('no active project with slug %L', p_project));
  end if;

  insert into public.jobs
    (correlation_id, project_id, idempotency_key, kind, requested_by, priority, pinned_config)
  values (gen_random_uuid(), v_project,
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
$function$
;
