-- Rollback of 0637: the MCP clause returns to app.may_act, and hq_task_state stops asking about the principal.
begin;
do $m$
declare v_def text;
begin
  v_def := pg_get_functiondef('app.may_act(uuid,text,uuid)'::regprocedure);
  if position(E'                   and app.job_origin(p_job) in (''trusted'', ''harness'');' in v_def) = 0 then
    raise exception 'rollback 0637: 0637 is not applied to app.may_act';
  end if;
  execute replace(v_def, E'                   and app.job_origin(p_job) in (''trusted'', ''harness'');',
    E'                   and (app.job_origin(p_job) in (''trusted'', ''harness'')\n                        or (v_by like ''mcp:%'' and app.job_origin(p_job) = ''internal''));');
  v_def := pg_get_functiondef('app.hq_task_state(text,text,text,text)'::regprocedure);
  v_def := replace(v_def, E'  v_now      text;\n  v_project  uuid;\n  v_refusal  text;\nbegin', E'  v_now      text;\nbegin');
  v_def := replace(v_def, E'  select state, blocked_on, title, project_id into v_was, v_was_why, v_title, v_project\n    from public.tasks where task_id = v_id;', E'  select state, blocked_on, title into v_was, v_was_why, v_title\n    from public.tasks where task_id = v_id;');
  v_def := replace(v_def, E'\n  -- A principal that is not a person decides only what is its own: a test member does not change a real task.\n  if btrim(coalesce(p_by, '''')) <> '''' then\n    v_refusal := app.authority_refusal(btrim(p_by), null, v_project);\n    if v_refusal is not null then\n      return jsonb_build_object(''error'', v_refusal);\n    end if;\n  end if;', '');
  execute v_def;
end $m$;
commit;
