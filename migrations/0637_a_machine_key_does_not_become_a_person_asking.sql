-- 0637 - two ways a credential that is not a person acted as one (final audit, reviews F3 and F5).
--
-- F3. 0629 let a write-scoped MCP client's job count as "a person asked", on the reasoning that the client is a
--     person's tool. The consent step that issues that client a credential is protected by `HQ_API_TOKEN` - the OFFICE
--     key, which Run 3 made a machine's - so possession of a machine credential could mint a client whose jobs proceed
--     at level 2 without asking (`asked_for: true`, "You asked for this"), where a typed instruction from a person is
--     the only thing that is meant to. The clause is removed: an MCP client's job asks like any other office-made root,
--     and a standing authorization (his press) is the way to let a tool proceed. Nothing real is affected today: the
--     only clients on record are "Flow probe" registrations with no calls.
--
-- F5. `app.hq_task_state` took the answering principal and never asked whether that principal may act on the task's
--     project, so a TEST member could tick or cancel a real task (`completed_by` named a harness operator). It now asks
--     `app.authority_refusal`, as every other decision function does; a person is unaffected.
--
-- Both are rebuilt from their LIVE definitions and refuse to apply if the text they replace is not there.

do $m$
declare
  v_def text;
  v_old1 constant text := E'                   and (app.job_origin(p_job) in (''trusted'', ''harness'')\n';
  v_def_start int;
  v_def_end int;
begin
  v_def := pg_get_functiondef('app.may_act(uuid,text,uuid)'::regprocedure);
  v_def_start := position(v_old1 in v_def);
  v_def_end := position(E'or (v_by like ''mcp:%'' and app.job_origin(p_job) = ''internal''));' in v_def);
  if v_def_start = 0 or v_def_end = 0 or v_def_end < v_def_start then
    raise exception '0637: the MCP clause is not in app.may_act';
  end if;
  v_def := substr(v_def, 1, v_def_start - 1)
        || E'                   and app.job_origin(p_job) in (''trusted'', ''harness'');'
        || substr(v_def, v_def_end + length(E'or (v_by like ''mcp:%'' and app.job_origin(p_job) = ''internal''));'));
  execute v_def;
  if position('mcp:%' in pg_get_functiondef('app.may_act(uuid,text,uuid)'::regprocedure)) > 0
     and position('and (v_by like ''mcp:%''' in pg_get_functiondef('app.may_act(uuid,text,uuid)'::regprocedure)) > 0 then
    raise exception '0637: the MCP clause is still in app.may_act';
  end if;
end
$m$;

do $m$
declare
  v_def text;
  v_a constant text := E'  v_now      text;\nbegin';
  v_b constant text := E'  select state, blocked_on, title into v_was, v_was_why, v_title\n    from public.tasks where task_id = v_id;\n  if v_was is null then\n    return jsonb_build_object(''error'', ''no such task'');\n  end if;';
begin
  v_def := pg_get_functiondef('app.hq_task_state(text,text,text,text)'::regprocedure);
  if position(v_a in v_def) = 0 or position(v_b in v_def) = 0 then
    raise exception '0637: an anchor is not in app.hq_task_state';
  end if;
  v_def := replace(v_def, v_a, E'  v_now      text;\n  v_project  uuid;\n  v_refusal  text;\nbegin');
  v_def := replace(v_def, v_b, E'  select state, blocked_on, title, project_id into v_was, v_was_why, v_title, v_project\n    from public.tasks where task_id = v_id;\n  if v_was is null then\n    return jsonb_build_object(''error'', ''no such task'');\n  end if;\n  -- A principal that is not a person decides only what is its own: a test member does not change a real task.\n  if btrim(coalesce(p_by, '''')) <> '''' then\n    v_refusal := app.authority_refusal(btrim(p_by), null, v_project);\n    if v_refusal is not null then\n      return jsonb_build_object(''error'', v_refusal);\n    end if;\n  end if;');
  execute v_def;
  if position('app.authority_refusal(btrim(p_by), null, v_project)' in pg_get_functiondef('app.hq_task_state(text,text,text,text)'::regprocedure)) = 0 then
    raise exception '0637: the task-state change did not land';
  end if;
end
$m$;
