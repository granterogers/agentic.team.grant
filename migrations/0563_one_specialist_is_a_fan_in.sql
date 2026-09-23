/*
  0563 — one specialist is a fan-in (#312)

  `instruction.ts` registered a fan-in at two or more convened specialists and
  `app.fan_in_over` refused fewer than two. Both halves agreed and neither was
  ever reachable:

      convened specialists   real turns
      0                      5138
      1                         2
      2 or more                 0

  So a single specialist's answer finished after the Chief had spoken,
  `only_chief_speaks` kept it off Grant's phone, and nothing owned it.

  Lowering the TypeScript gate alone did nothing and said nothing — this
  function returns an error OBJECT rather than raising, so the caller's
  `.catch` never fired. CLAUDE.md's 0282/0293 entry, third instance: loosening
  a constraint does not loosen the function that pre-checks it. The caller is
  fixed in the same commit to read the returned error rather than only
  catching throws.

  `office.synthesise` relays a single branch verbatim rather than drawing it
  together, so this costs no model call and can invent nothing.

  Spliced from the LIVE definition rather than retyped, and terminated —
  `pg_get_functiondef` emits no trailing semicolon, which this repository has
  paid for twice.
*/

CREATE OR REPLACE FUNCTION app.fan_in_over(p_parent uuid, p_objective text, p_branches jsonb, p_synthesis_kind text DEFAULT 'office.synthesise'::text, p_deadline timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_group uuid; v_cap integer; v_count integer; v_branch jsonb;
  v_synth uuid; v_seen jsonb := '[]'::jsonb;
begin
  if not exists (select 1 from public.jobs where job_id = p_parent) then
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
                      and parent_job_id = p_parent) then
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
    jsonb_build_object('group', v_group, 'objective', p_objective), interval '0', true, null);
  update public.branch_groups set synthesis_job_id = v_synth where group_id = v_group;

  return jsonb_build_object('ok', true, 'group', v_group,
    'branches', v_seen, 'synthesis', v_synth);
end;
$function$;

comment on function app.fan_in_over(uuid, text, jsonb, text, timestamptz) is
  'Register a fan-in over branches that already exist, so somebody owns the '
  'answer. One branch is enough: it is the only shape real traffic produces, '
  'and office.synthesise relays a lone branch rather than synthesising it. '
  'Zero is still refused — nothing to wait for. 0563.';

do $drive$
declare
  v_p uuid; v_parent uuid; v_kid uuid; v_got jsonb;
begin
  select project_id into v_p from public.projects
   where status = 'active' and not is_fixture
     and project_id <> app.unnamed_project() order by updated_at desc limit 1;
  if v_p is null then raise notice '0563: no real project; skipped'; return; end if;

  insert into public.jobs (correlation_id, project_id, idempotency_key, kind,
                           requested_by, priority, state)
  values (extensions.gen_random_uuid(), v_p, 'drive-0563-parent', 'office.instruction',
          'teamhq:grant', 10, 'queued')
  returning job_id into v_parent;
  insert into public.jobs (correlation_id, project_id, idempotency_key, kind,
                           requested_by, priority, state, parent_job_id)
  values (extensions.gen_random_uuid(), v_p, 'drive-0563-kid', 'office.instruction',
          'teamhq:grant', 10, 'queued', v_parent)
  returning job_id into v_kid;

  /* Zero branches is still refused — there would be nothing to wait for. */
  v_got := app.fan_in_over(v_parent, 'the venue', '[]'::jsonb, 'office.synthesise',
                           app.now_utc() + interval '20 minutes');
  if v_got ->> 'error' is null then
    raise exception '0563: a fan-in over nothing was allowed: %', v_got;
  end if;

  /* One IS enough, and that is the whole point. */
  v_got := app.fan_in_over(v_parent, 'the venue',
    jsonb_build_array(jsonb_build_object('agent', 'quality-director',
      'job_id', v_kid::text, 'purpose', 'what quality makes of it')),
    'office.synthesise', app.now_utc() + interval '20 minutes');
  if coalesce((v_got ->> 'ok')::boolean, false) is not true then
    raise exception '0563: one branch was refused: %', v_got;
  end if;
  if not exists (select 1 from public.branch_groups where parent_job_id = v_parent) then
    raise exception '0563: it reported ok and registered nothing: %', v_got;
  end if;

  raise exception '0563 drive: zero refused, one accepted and registered'
    using errcode = 'RS001';
exception when sqlstate 'RS001' then
  raise notice '0563 drive rolled back, as intended';
end
$drive$;
