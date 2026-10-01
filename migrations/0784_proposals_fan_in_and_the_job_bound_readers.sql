-- 0784 - proposals, fan-in, the job-bound readers and the deployment scans of the job lifecycle (multi-user P3, h-jobs).
--
-- Three groups.
--
-- TAKE AN OFFICE (the worker holds a claimed job and passes `app.job_office`; the id each is handed is checked against it)
--   proposals_to_send, proposals_sent, raise_proposals     proposals are an office's: the tally, the harness test, the
--                                                         decline memory, the upsert and the delivered mark are all its own
--   fan_in_over, fan_in_ready, branch_outputs              a branch group is its parent job's office; a branch that is not a
--                                                         child of THAT parent in THAT office is refused as it always was
--   unrouted_live_jobs                                     the count is the office's, not the deployment's
--
-- JOB-BOUND, SAME SIGNATURE (the worker holds the job and nothing else; the office IS the job's - `app.job_office`)
--   cannot, understood, job_depth, job_forwarded, job_origin, job_plan, job_plan_set, job_trace_add, staff_behind_job,
--   open_approval_for_job, owed_a_word, approval_binds, approval_for_delivery, command_account, command_principal,
--   pause_job, resume_job, renew_lease, job_held, step_begin, step_done, stop_requested
--   They name no id but the held row, so there is nothing to validate against a caller's office - and they must not grow
--   a p_office the fence would have to trust. What was missing was the row's OWN office on the READS they make through
--   a second id, and these have it now: owed_a_word (the command a job points at), job_forwarded and job_origin (the
--   command a job points at), staff_behind_job (a duty is found by slug, and slugs repeat across offices since 0680),
--   open_approval_for_job (a question is the job's office's), and internal_root_ok which job_origin asks (the same slug
--   rule for duties and triggers). The claim fence (worker, attempt, claim_gen) is not touched anywhere.
--
-- DEPLOYMENT SCANS (handed no id; each touches rows one at a time and keeps each row's own office)
--   requeue_retrying, recover_stalled_jobs, settle_exhausted_jobs, recover_stalled_syncs, resumable_now, resume_paused,
--   expire_undo_offers, enqueue_orphans, job_trace_prune, defer_over_budget, proposals_undeliver, claim_pending_notification
--   None moves a job's office, none shows one office's content to another, and none writes a row without that row's
--   own office. Two are tightened: proposals_undeliver only restores a proposal whose DELIVERING job is its own office's
--   (a mark that points across offices proves nothing), and claim_pending_notification skips a disabled office's jobs, as
--   dequeue_job has since 0681. defer_over_budget is a deployment budget by design (the free-tier quota is shared); it
--   delays queued jobs and never moves them.
--
-- The public wrappers of this cluster are retired. Nothing in the repository called them but the worker (record_consultation)
-- and two suites, and each was a door onto a job-bound function with no office in it.
--
-- NOT done here, reported: `proposals` is UNIQUE (staff_slug, kind, needed) across the deployment (P2 follow-up: make it
-- (office_id, staff_slug, kind, needed)). raise_proposals guards its ON CONFLICT UPDATE with the office, so a second office
-- that hits the same need is not raised until that key is fixed, and never rewrites the first office's row.

create function app.proposals_sent(p_office uuid, p_ids uuid[], p_job uuid default null)
returns integer
language plpgsql
security definer
set search_path to ''
as $f$
declare
  v_n int;
  v_job uuid;
begin
  perform app.require_office(p_office);
  -- A delivering job of another office is a job that does not exist: the mark then names no job.
  select j.job_id into v_job from public.jobs j where j.job_id = p_job and j.office_id = p_office;
  update public.proposals
     set delivered_at = app.now_utc(),
         delivered_by_job = v_job
   where proposal_id = any(p_ids)
     and office_id = p_office
     and delivered_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end
$f$;
revoke all on function app.proposals_sent(uuid, uuid[], uuid) from public, anon, authenticated, service_role;
drop function app.proposals_sent(uuid[], uuid);
drop function public.proposals_sent(uuid[], uuid);

create function app.proposals_to_send(p_office uuid, p_limit integer default 5)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $f$
begin
  perform app.require_office(p_office);
  return (
  select coalesce(jsonb_agg(p order by p.times_seen desc, p.last_seen desc), '[]'::jsonb)
    from (
      select proposal_id as id, staff_slug as who, kind::text, needed, title, remedy,
             argument, cost_note, times_seen, last_seen
        from public.proposals
       where office_id = p_office
         and state = 'open' and delivered_at is null
         -- No escape hatch here, unlike the raise path: this is the batch the chief of staff actually sends, and a
         -- suite must never be able to make the office tell its person about a gap it invented.
         and not app.harness_proposal_in(p_office, staff_slug, needed)
       order by times_seen desc, last_seen desc
       limit greatest(coalesce(p_limit, 5), 1)
    ) p
  );
end
$f$;
revoke all on function app.proposals_to_send(uuid, integer) from public, anon, authenticated, service_role;
drop function app.proposals_to_send(integer);
drop function public.proposals_to_send(integer);

create function app.raise_proposals(p_office uuid, p_days integer DEFAULT 30, p_min integer DEFAULT 3, p_include_fixtures boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  t          record;
  v_new      int := 0;
  v_bumped   int := 0;
  v_silent   int := 0;
  v_title    text;
  v_remedy   text;
  v_arg      text;
  v_existed  boolean;
  v_rows     int;
  v_blocked  int := 0;
begin
  perform app.require_office(p_office);
  for t in
    select * from app.impediments_tally_in(p_office, p_days, p_min, coalesce(p_include_fixtures, false))
     where staff_slug is not null and kind <> 'not_capable' and (coalesce(p_include_fixtures, false)
          -- The switch that has meant "count the harness traffic too"
          -- since 0297. 0490 tightened the filter and forgot it.
          or not app.harness_proposal_in(p_office, staff_slug, needed))
  loop
    /*
      A declined proposal is left completely alone — not reopened, not
      re-counted, not re-delivered. Declining costs Grant one press and buys
      permanent silence on that subject, which is the whole point of the row.
    */
    if exists (
      select 1 from public.proposals
       where office_id = p_office and staff_slug = t.staff_slug and kind = t.kind and needed = t.needed
         and state = 'declined'
    ) then
      v_silent := v_silent + 1;
      continue;
    end if;

    /*
      Asked BEFORE the upsert. The first version asked afterwards, by looking
      for a row created in the last two seconds — which is a clock reading
      standing in for a fact the statement already knew, and would have
      miscounted a slow pass.
    */
    v_existed := exists (
      select 1 from public.proposals
       where office_id = p_office and staff_slug = t.staff_slug and kind = t.kind and needed = t.needed
    );

    v_title := format('%s could not: %s', initcap(replace(t.staff_slug, '-', ' ')), t.needed);
    v_remedy := case t.kind
      when 'missing_tool'     then format('Give this agent a tool that can %s.', t.needed)
      when 'missing_skill'    then format('The office has no way to %s at all — it needs building.', t.needed)
      when 'missing_data'     then format('Connect or supply the material needed to %s.', t.needed)
      when 'needs_permission' then format('Grant permission to %s.', t.needed)
      when 'ambiguous'        then format('Say which reading of "%s" is meant.', t.needed)
      else format('Decide whether the office should be able to %s.', t.needed)
    end;
    v_arg := format(
      '%s time(s) in the last %s day(s), across %s project(s). Most recently: %s',
      t.times, p_days, t.projects,
      coalesce(nullif(btrim(t.for_instance), ''), 'no detail recorded'));

    insert into public.proposals
      (office_id, staff_slug, kind, needed, title, remedy, argument,
       times_seen, first_seen, last_seen, for_instance)
    values (p_office, t.staff_slug, t.kind, t.needed, v_title, v_remedy, v_arg,
            t.times, t.first_seen, t.last_seen, coalesce(t.for_instance, ''))
    on conflict (staff_slug, kind, needed) do update
      set times_seen = excluded.times_seen,
          last_seen  = excluded.last_seen,
          argument   = excluded.argument,
          for_instance = excluded.for_instance
      -- Only while it is still open and unanswered. An approved or done
      -- proposal is history and must not be rewritten under Grant.
      where public.proposals.state = 'open' and public.proposals.office_id = p_office;
    get diagnostics v_rows = row_count;

    -- Nothing written: the key is held by another office (global until the P2 follow-up), or this office's own
    -- proposal is no longer open. It is not counted as raised, and nothing of the other office's was touched.
    if v_rows = 0 and not v_existed then
      v_blocked := v_blocked + 1;
    elsif v_existed then v_bumped := v_bumped + 1; else v_new := v_new + 1; end if;
  end loop;

  return jsonb_build_object('raised', v_new, 'updated', v_bumped, 'left_declined', v_silent, 'held_elsewhere', v_blocked);
end;
$function$;
revoke all on function app.raise_proposals(uuid, integer, integer, boolean) from public, anon, authenticated, service_role;
drop function app.raise_proposals(integer, integer, boolean);
drop function public.raise_proposals(integer, integer, boolean);

-- A scan: restores a proposal whose announcing job finished without sending anything. The job and the deliveries it is
-- judged by must be the PROPOSAL'S office's; a mark that points across offices proves nothing either way.
CREATE OR REPLACE FUNCTION app.proposals_undeliver()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_n int;
begin
  /*
    Only a FINISHED job is judged.

    A job still running, retrying or waiting has not failed to deliver — it
    has not finished trying. Sweeping those would put a proposal back in front
    of Grant while the message announcing it is still in flight, which is the
    duplicate half of the defect this function exists to prevent.

    A job with NO delivery row at all counts as not delivered, and that is
    deliberate: `notify` writes the row, so its absence means nothing was
    sent. 0304's asymmetry decides the direction — this can only ever restore
    a proposal, never hide one, so being wrong costs a repeated message rather
    than a lost one.
  */
  update public.proposals p
     set delivered_at = null,
         delivered_by_job = null
   where p.delivered_at is not null
     and p.state = 'open'
     and p.delivered_by_job is not null
     and exists (
       select 1 from public.jobs j
        where j.job_id = p.delivered_by_job
          and j.office_id = p.office_id
          and j.state in ('complete', 'failed', 'cancelled')
     )
     and not exists (
       select 1 from public.deliveries d
        where d.job_id = p.delivered_by_job
          and d.office_id = p.office_id
          and d.state = 'sent'
     );
  get diagnostics v_n = row_count;
  return v_n;
end
$function$;
drop function public.proposals_undeliver();

create function app.fan_in_ready(p_office uuid, p_group uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  perform app.require_office(p_office);
  return (
  with b as (
    select br.agent, coalesce(s.name, br.agent) as name, br.purpose, br.required,
           j.state::text as state, j.job_id,
           exists (select 1 from public.outputs o where o.job_id = j.job_id) as answered
      from public.job_branches br
      join public.jobs j on j.job_id = br.job_id
      left join public.staff s on s.slug = br.agent
     where br.group_id = p_group
       and exists (select 1 from public.branch_groups bg join public.jobs pj on pj.job_id = bg.parent_job_id
                    where bg.group_id = br.group_id and pj.office_id = p_office)
  ),
  g as (select bg.deadline from public.branch_groups bg
         where bg.group_id = p_group
           and exists (select 1 from public.jobs pj where pj.job_id = bg.parent_job_id and pj.office_id = p_office))
  select jsonb_build_object(
    'group', p_group,
    'total', (select count(*) from b),
    'done', (select count(*) from b where state = 'complete'),
    'failed', (select count(*) from b where state in ('failed', 'cancelled')),
    'running', (select count(*) from b where state not in ('complete', 'failed', 'cancelled')),
    'past_deadline', (select deadline is not null and deadline < app.now_utc() from g),
    /*
      Ready when every REQUIRED branch has settled and either every branch has,
      or the deadline has passed. A required branch that failed still counts as
      settled: the answer must then say the domain is missing rather than wait
      for ever.
    */
    'ready', (
      select not exists (
        select 1 from b where b.required
          and b.state not in ('complete', 'failed', 'cancelled'))
        and (
          not exists (select 1 from b where b.state not in ('complete', 'failed', 'cancelled'))
          or (select deadline is not null and deadline < app.now_utc() from g))),
    'waiting_for', coalesce((
      select jsonb_agg(jsonb_build_object('agent', b.agent, 'name', b.name,
                                          'purpose', b.purpose,
                                          'required', b.required, 'state', b.state)
             order by b.required desc, b.agent)
        from b where b.state not in ('complete', 'failed', 'cancelled')), '[]'::jsonb),
    /*
      The lost branches carry the person's NAME as well as the slug, because
      the gate that stops a synthesis crediting them matches on what a model
      would write. A model writes "Ruby", never "growth-director".
    */
    'lost', coalesce((
      select jsonb_agg(jsonb_build_object('agent', b.agent, 'name', b.name,
                                          'purpose', b.purpose,
                                          'required', b.required, 'state', b.state)
             order by b.agent)
        from b where b.state in ('failed', 'cancelled')), '[]'::jsonb)
  )
  );
end;
$function$;
revoke all on function app.fan_in_ready(uuid, uuid) from public, anon, authenticated, service_role;
drop function app.fan_in_ready(uuid);
drop function public.fan_in_ready(uuid);

create function app.branch_outputs(p_office uuid, p_group uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  perform app.require_office(p_office);
  return (
  select coalesce(jsonb_agg(v order by ord), '[]'::jsonb)
    from (
      select jsonb_build_object(
               'agent', br.agent,
               'name', coalesce(s.name, br.agent),
               'purpose', br.purpose,
               'required', br.required,
               'job_id', br.job_id,
               'body', o.body,
               'confidence', o.confidence,
               'evidence', o.evidence,
               'sources', o.sources) as v,
             br.created_at as ord
        from public.job_branches br
        join public.jobs j on j.job_id = br.job_id
        left join public.staff s on s.slug = br.agent
        join lateral (
          select o.body, o.confidence::text as confidence, o.evidence::text as evidence,
                 o.sources
            from public.outputs o where o.job_id = br.job_id
           order by o.created_at desc limit 1
        ) o on true
       where br.group_id = p_group
         and exists (select 1 from public.branch_groups bg join public.jobs pj on pj.job_id = bg.parent_job_id
                    where bg.group_id = br.group_id and pj.office_id = p_office)
    ) q
  );
end;
$function$;
revoke all on function app.branch_outputs(uuid, uuid) from public, anon, authenticated, service_role;
drop function app.branch_outputs(uuid);

create function app.fan_in_over(p_office uuid, p_parent uuid, p_objective text, p_branches jsonb, p_synthesis_kind text DEFAULT 'office.synthesise'::text, p_deadline timestamp with time zone DEFAULT NULL::timestamp with time zone, p_caller uuid DEFAULT NULL::uuid, p_caller_worker text DEFAULT NULL::text, p_caller_gen bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_group uuid; v_cap integer; v_count integer; v_branch jsonb;
  v_synth uuid; v_seen jsonb := '[]'::jsonb;
begin
  perform app.require_office(p_office);
  -- A caller that says who it is must still hold its job: a zombie opens no branch group (review of Run 5, 0625).
  -- A caller job of another office is not held by this office's worker, whatever its lease says.
  if p_caller is not null and p_caller_worker is not null and p_caller_gen is not null
     and (not exists (select 1 from public.jobs where job_id = p_caller and office_id = p_office)
          or not app.job_held(p_caller, p_caller_worker, (select attempt from public.jobs where job_id = p_caller), p_caller_gen)) then
    raise exception 'stale caller: % no longer holds job %', p_caller_worker, p_caller using errcode = '40001';
  end if;
  if not exists (select 1 from public.jobs where job_id = p_parent and office_id = p_office) then
    return jsonb_build_object('error', 'no such parent job');
  end if;
  if exists (select 1 from public.branch_groups where parent_job_id = p_parent) then
    -- Idempotent: a retried parent must not ask for a second answer.
    return jsonb_build_object('ok', true, 'already', true,
      'group', (select group_id from public.branch_groups where parent_job_id = p_parent));
  end if;

  v_count := coalesce(jsonb_array_length(p_branches), 0);
  /*
    0563. ONE IS ENOUGH.

    This refused fewer than two branches, matching the `>= 2` gate in
    `instruction.ts`, and canonical traffic says two has never happened:

        convened specialists   real turns
        0                      5138
        1                         2
        2 or more                 0

    So both halves agreed with each other and neither was reachable, which is
    CLAUDE.md's 0282/0293 trap for the third time — a caller loosened while
    the function that pre-checks the same thing stayed strict. Lowering the
    gate in TypeScript alone changed nothing, silently, because this returns
    an error OBJECT rather than raising and the caller only caught throws.

    Zero is still refused: a fan-in over no branches has nothing to wait for
    and would pause for ever.
  */
  if v_count < 1 then
    return jsonb_build_object('error',
      'a fan-in over no branches has nothing to wait for');
  end if;
  /*
    `system_config.value` is JSONB, not text.

    The first version wrote `nullif(value, '')::integer` and every call raised
    22P02 from inside a SECURITY DEFINER function — an empty string is not
    valid JSON, so the comparison itself threw before the cast was reached.
    `#>> '{}'` is how you get the scalar out, and CLAUDE.md's rule applies:
    query `information_schema` for the TYPE before writing the expression.
  */
  select coalesce(nullif(value #>> '{}', '')::integer, 3) into v_cap
    from public.system_config where key = 'agents.max_specialists_per_job';
  v_cap := coalesce(v_cap, 3);
  if v_count > v_cap then
    return jsonb_build_object('error',
      format('%s branches and the office allows %s at once', v_count, v_cap), 'cap', v_cap);
  end if;

  /*
    Every branch is checked BEFORE anything is written.

    The first version validated inside the insert loop, so a bad third branch
    returned an error and left a group with two branches in it — a refusal that
    changed something, which is the shape of a teardown that matches nothing.
    A function that says no must leave nothing behind.
  */
  for v_branch in select * from jsonb_array_elements(p_branches) loop
    if not exists (select 1 from public.staff where slug = v_branch ->> 'agent') then
      return jsonb_build_object('error',
        format('%L is nobody on the roster', v_branch ->> 'agent'));
    end if;
    if not exists (select 1 from public.jobs
                    where job_id = (v_branch ->> 'job_id')::uuid
                      and parent_job_id = p_parent and office_id = p_office) then
      -- A branch that is not a child of this parent is somebody else's work,
      -- and a group that could claim it would make the collaboration record a
      -- claim rather than a fact.
      return jsonb_build_object('error',
        format('job %L is not a child of this one', v_branch ->> 'job_id'));
    end if;
  end loop;

  insert into public.branch_groups (parent_job_id, objective, deadline)
  values (p_parent, p_objective, p_deadline)
  returning group_id into v_group;

  for v_branch in select * from jsonb_array_elements(p_branches) loop
    insert into public.job_branches (group_id, job_id, agent, purpose, required)
    values (v_group, (v_branch ->> 'job_id')::uuid, v_branch ->> 'agent',
            coalesce(nullif(btrim(coalesce(v_branch ->> 'purpose', '')), ''),
                     'part of the question'),
            coalesce((v_branch ->> 'required')::boolean, false));
    v_seen := v_seen || jsonb_build_object('job_id', v_branch ->> 'job_id',
                                           'agent', v_branch ->> 'agent');
  end loop;

  /*
    The answer is a child too, queued immediately.

    It does not wait in the database; it wakes, asks `fan_in_ready`, and pauses
    itself with `dependency_wait` when the branches are not in yet (#263). That
    is cheaper than a scheduler and it means a person looking at the job can
    see, in words, which branch it is waiting for.
  */
  v_synth := app.enqueue_child(p_parent, p_synthesis_kind,
    jsonb_build_object('group', v_group, 'objective', p_objective), interval '0', true, null, p_caller, p_caller_worker, p_caller_gen);
  update public.branch_groups set synthesis_job_id = v_synth where group_id = v_group;

  return jsonb_build_object('ok', true, 'group', v_group,
    'branches', v_seen, 'synthesis', v_synth);
end;
$function$;
revoke all on function app.fan_in_over(uuid, uuid, text, jsonb, text, timestamp with time zone, uuid, text, bigint) from public, anon, authenticated, service_role;
drop function app.fan_in_over(uuid, text, jsonb, text, timestamp with time zone, uuid, text, bigint);

create function app.unrouted_live_jobs(p_office uuid)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.require_office(p_office);
  return (
  select count(*)::int
  from public.jobs j
  where j.office_id = p_office
    and j.state not in ('complete', 'cancelled', 'failed')
    and not exists (
      select 1 from public.routing_decisions r where r.job_id = j.job_id
    )
  );
end;
$function$;
revoke all on function app.unrouted_live_jobs(uuid) from public, anon, authenticated, service_role;
drop function app.unrouted_live_jobs();

-- ---- job-bound readers: the second id a job points at must be the job's own office's ---------------------------------

CREATE OR REPLACE FUNCTION app.staff_behind_job(p_job_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  with recursive lineage as (
    select job_id, parent_job_id, 0 as depth
      from public.jobs where job_id = p_job_id
    union all
    select j.job_id, j.parent_job_id, l.depth + 1
      from public.jobs j join lineage l on j.job_id = l.parent_job_id
     where l.depth < 8
  ),
  routed as (
    select st.slug, l.depth, r.decided_at
      from lineage l
      join public.routing_decisions r on r.job_id = l.job_id
      join public.staff st on st.slug = r.roster[1]
  ),
  -- The duty's owner, for a job the dispatcher created (0098). Matched on
  -- `requested_by`, which it writes as `duty:<slug>` and which no client can
  -- set. A duty slug is unique within an OFFICE (0680), so the duty must be the job's own office's.
  owned as (
    select st.slug
      from public.jobs j
      join public.responsibilities resp
        on 'duty:' || resp.slug = j.requested_by and resp.office_id = j.office_id
      join public.staff st on st.staff_id = resp.staff_id
     where j.job_id = p_job_id and st.active
  )
  -- `coalesce` of two scalar subqueries, not a UNION with a LIMIT: a LIMIT
  -- inside a UNION branch needs parentheses, and the version that did not have
  -- them was a syntax error rather than a subtle bug — but the coalesce also
  -- says the precedence out loud, which the UNION did not.
  select coalesce(
    (select slug from routed order by depth asc, decided_at desc limit 1),
    (select slug from owned limit 1)
  )
$function$;

CREATE OR REPLACE FUNCTION app.owed_a_word(p_job_id uuid)
 RETURNS TABLE(channel text, account_ref text, target_ref text, thread_ref text, kind text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select c.origin_channel::text,
         split_part(c.origin_ref, ':', 1)::text,
         split_part(c.origin_ref, ':', 1)::text,
         nullif(split_part(c.origin_ref, ':', 2), '')::text,
         j.kind::text
    from public.jobs j
    join public.inbound_commands c
      on c.command_id = coalesce((j.pinned_config ->> 'command_id')::uuid,
                                 (select ic.command_id from public.inbound_commands ic
                                   where ic.job_id = coalesce(j.root_job_id, j.job_id) limit 1))
     -- the command a job points at is data; it is owed a word only on a command of the job's OWN office
     and c.office_id = j.office_id
   where j.job_id = p_job_id
     and (j.state = 'failed'
          or (j.state = 'paused'
              and exists (select 1 from public.job_pauses p
                           where p.job_id = j.job_id and p.resumed_at is null and p.resumable = false)
              and not exists (select 1 from public.blockers b
                               where b.job_id = j.job_id and b.state = 'open')
              and not app.harness_job(j.job_id)))
     and (j.parent_job_id is null or j.state = 'paused')
     and c.origin_channel in ('telegram', 'slack', 'teamhq', 'voice')
     and coalesce(nullif(btrim(c.origin_ref), ''), '') <> ''
     and not exists (select 1 from public.deliveries d where d.job_id = j.job_id)
$function$;

CREATE OR REPLACE FUNCTION app.job_forwarded(p_job uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select coalesce(
    (select coalesce(c.context ->> 'forwarded', 'false') = 'true'
       from public.jobs j join public.inbound_commands c on c.command_id = j.origin_command_id and c.office_id = j.office_id
      where j.job_id = p_job), false)
$function$;

CREATE OR REPLACE FUNCTION app.open_approval_for_job(p_job uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select blocker_id from public.blockers
   where job_id = p_job and state = 'open'
     and office_id = (select j.office_id from public.jobs j where j.job_id = p_job)
   order by created_at desc limit 1
$function$;

CREATE OR REPLACE FUNCTION app.job_origin(p_job_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with recursive up as (
    select j.job_id, j.parent_job_id, j.pinned_config, j.origin_kind, j.origin_class, j.office_id, 0 as depth
      from public.jobs j where j.job_id = p_job_id
    union all
    select p.job_id, p.parent_job_id, p.pinned_config, p.origin_kind, p.origin_class, p.office_id, up.depth + 1
      from up join public.jobs p on p.job_id = up.parent_job_id
     where up.depth < 64
  ),
  root as (select * from up where parent_job_id is null order by depth desc limit 1)
  select case
    when not exists (select 1 from up) then 'unknown'
    when app.harness_job(p_job_id) then 'harness'
    when not exists (select 1 from root) then 'unknown'      -- a chain that never ends
    -- Made after 0619: what was recorded when it was created (a child carries its tree's class from that
    -- moment, so a legacy root that later loses its command does not take a frozen child down with it).
    -- A pinned command_id is not read.
    when (select origin_kind from up where depth = 0) is not null then
      case
        when (select origin_class from up where depth = 0) is not null then (select origin_class from up where depth = 0)
        when app.internal_root_ok((select job_id from root)) then 'internal'
        else 'unknown'
      end
    -- Made before 0619: exactly as it was answered before, and no more. The command the root points at is data, so
    -- it counts only when it is the root's OWN office's; any other reads as no command, which is 'unknown'.
    when (select pinned_config ? 'command_id' from root) then
      app.command_origin((select (root.pinned_config ->> 'command_id')::uuid from root
                           where exists (select 1 from public.inbound_commands ic
                                          where ic.command_id = (root.pinned_config ->> 'command_id')::uuid
                                            and ic.office_id = root.office_id)))
    when app.internal_root_ok((select job_id from root)) then 'internal'
    else 'unknown'
  end
$function$;

-- Asked by job_origin: is this root job one the office itself made? A duty or a trigger is found by NAME, and names
-- repeat across offices (0680), so the duty or trigger must be the job's own office's.
CREATE OR REPLACE FUNCTION app.internal_root_ok(p_job_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce((
    select
      -- app.dispatch_due_responsibilities
      exists (select 1 from public.responsibilities r
               where j.requested_by = 'duty:' || r.slug and r.job_kind = j.kind and r.office_id = j.office_id)
      -- app.fire_triggers_for
      or exists (select 1 from public.event_triggers t
                  where j.requested_by = 'trigger:' || t.name and t.job_kind = j.kind and t.office_id = j.office_id)
      -- app.provision_missing_channels, app.hq_rename_project
      or (j.requested_by = 'hq' and j.kind in ('office.provision_channels', 'office.rename_channels'))
      -- app.google_revoke_begin (the dashboard's Disconnect Google)
      or (j.requested_by = 'grant' and j.kind = 'google.revoke')
      -- app.register_mcp_provider
      or (j.requested_by = 'connector:register' and j.kind = 'mcp.discover')
      -- app.mcp_enqueue: a client the office issued a credential to
      or exists (select 1 from public.mcp_clients m
                  where j.requested_by = 'mcp:' || m.client_id and m.enabled and 'write' = any (m.scopes))
      -- app.notice_new_document: the document it names, by the name it wrote
      or (j.kind = 'knowledge.read_source' and exists (
            select 1 from public.documents d
             where d.document_id::text = j.pinned_config ->> 'document_id'
               and j.requested_by = d.connector || ':' || coalesce(d.external_ref, 'source')
               and app.document_origin(d.document_id) in ('trusted', 'internal')))
    from public.jobs j where j.job_id = p_job_id), false)
$function$;

-- ---- deployment scans -------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.claim_pending_notification(p_worker text, p_lease_seconds integer DEFAULT 120)
 RETURNS TABLE(job_id uuid, correlation_id uuid, project_id uuid, kind text, output_id uuid)
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'app', 'public'
AS $function$
declare
  r record;
begin
  select j.job_id, j.correlation_id, j.project_id, j.kind
    into r
  from public.jobs j
  where j.state = 'notifying'
    -- A disabled office's work waits where it is, as in dequeue_job (0681).
    and exists (select 1 from public.offices o where o.office_id = j.office_id and o.state = 'active')
    and (j.leased_until is null or j.leased_until < now())
  order by j.updated_at
  for update skip locked
  limit 1;

  if not found then
    return;
  end if;

  update public.jobs j
     set leased_by = p_worker,
         leased_until = now() + make_interval(secs => p_lease_seconds)
   where j.job_id = r.job_id;

  return query
    select r.job_id, r.correlation_id, r.project_id, r.kind,
           (select o.output_id from public.outputs o
             where o.job_id = r.job_id
             order by o.created_at desc limit 1);
end;
$function$;

-- ---- the public wrappers of this cluster are retired -----------------------------------------------------------------

drop function public.conversation_extent(uuid);
drop function public.enqueue_orphans();
drop function public.failure_seen(text, text, text, uuid);
drop function public.job_plan_set(uuid, text, text[], jsonb, text, integer);
drop function public.recall_conversation(uuid, text, integer);
drop function public.recent_exchange(uuid, integer, integer);
drop function public.record_consultation(uuid, text, text, text, integer);
drop function public.resume_paused(text[]);
drop function public.understood(uuid, text);
