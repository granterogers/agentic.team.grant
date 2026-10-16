-- 1077: a restore brings back the project's own calendar events.
--
-- Migration 1076 put the calendar into the complete export. app.project_restore (1071) did not read it back, and reported
-- nothing about it. This restores the events the project OWNS (the export's `agentic-team` calendar) into the new project.
--
-- Events the project had filed from Google are NOT restored as events here. Their calendar is Google's, and a local copy
-- would claim an authority over them that the restore does not have. They are counted as not restored, so the report says
-- so rather than dropping them silently.
--
-- Restored events are written as origin_channel 'archive', created_by 'restore', authority 'person', sync_state 'local', so
-- nothing is synced to a calendar on the way in. Title, notes and location are clipped to the columns' limits, and an event
-- whose end is before its start is counted as not restored, because the table's own check would refuse the whole restore.
--
-- The live definition of app.project_restore is spliced at apply time (pg_get_functiondef). Each anchor must appear exactly
-- once, and a control refuses to apply unless the new block and the report key are in the live definition afterwards.

do $$
declare
  def text;
  a_declare constant text := 'v_tasks     jsonb;';
  a_block constant text := '-- ---- contacts and their labels ----';
  a_report constant text := '''tasks'', jsonb_build_object(''requested'', v_task_req, ''restored'', v_task_in, ''refused'', v_task_bad),';
  r_declare constant text :=
    'v_tasks     jsonb;' || E'\n' ||
    '  v_events    jsonb := coalesce(p_package -> ''events'', ''[]''::jsonb);' || E'\n' ||
    '  ev_row      jsonb;' || E'\n' ||
    '  v_ev_in     int := 0;' || E'\n' ||
    '  v_ev_skip   int := 0;';
  r_block constant text :=
    '-- ---- the calendar the project owns (migration 1076 exports it) ----' || E'\n' ||
    '  for ev_row in select e.value from jsonb_array_elements(v_events) e loop' || E'\n' ||
    '    if jsonb_typeof(ev_row) <> ''object'' or coalesce(ev_row ->> ''calendar_id'', '''') <> ''agentic-team''' || E'\n' ||
    '       or btrim(coalesce(ev_row ->> ''summary'', '''')) = '''' or (ev_row ->> ''starts_at'') is null' || E'\n' ||
    '       or (ev_row ->> ''ends_at'') is null' || E'\n' ||
    '       or (ev_row ->> ''ends_at'')::timestamptz < (ev_row ->> ''starts_at'')::timestamptz then' || E'\n' ||
    '      v_ev_skip := v_ev_skip + 1;' || E'\n' ||
    '      continue;' || E'\n' ||
    '    end if;' || E'\n' ||
    '    insert into public.project_events (' || E'\n' ||
    '      office_id, project_id, title, notes, location, starts_at, ends_at, all_day,' || E'\n' ||
    '      origin_channel, created_by, authority, sync_state' || E'\n' ||
    '    ) values (' || E'\n' ||
    '      p_office, v_pid, left(btrim(ev_row ->> ''summary''), 300), left(nullif(ev_row ->> ''excerpt'', ''''), 8000),' || E'\n' ||
    '      left(nullif(ev_row ->> ''location'', ''''), 500), (ev_row ->> ''starts_at'')::timestamptz,' || E'\n' ||
    '      (ev_row ->> ''ends_at'')::timestamptz, coalesce((ev_row ->> ''all_day'')::boolean, false),' || E'\n' ||
    '      ''archive'', ''restore'', ''person'', ''local''' || E'\n' ||
    '    );' || E'\n' ||
    '    v_ev_in := v_ev_in + 1;' || E'\n' ||
    '  end loop;' || E'\n' ||
    '' || E'\n' ||
    '  -- ---- contacts and their labels ----';
  r_report constant text :=
    '''events'', jsonb_build_object(''restored'', v_ev_in, ''not_restored'', v_ev_skip),' || E'\n      ' ||
    '''tasks'', jsonb_build_object(''requested'', v_task_req, ''restored'', v_task_in, ''refused'', v_task_bad),';
begin
  def := pg_get_functiondef('app.project_restore(uuid, text, jsonb, text)'::regprocedure);
  if (length(def) - length(replace(def, a_declare, ''))) / length(a_declare) <> 1 then
    raise exception 'the variable declarations in app.project_restore must match once; nothing was changed';
  end if;
  if (length(def) - length(replace(def, a_block, ''))) / length(a_block) <> 1 then
    raise exception 'the contacts block in app.project_restore must appear once; nothing was changed';
  end if;
  if (length(def) - length(replace(def, a_report, ''))) / length(a_report) <> 1 then
    raise exception 'the tasks report line in app.project_restore must appear once; nothing was changed';
  end if;
  def := replace(def, a_declare, r_declare);
  def := replace(def, a_block, r_block);
  def := replace(def, a_report, r_report);
  execute def;

  if position('v_ev_skip := v_ev_skip + 1' in pg_get_functiondef('app.project_restore(uuid, text, jsonb, text)'::regprocedure)) = 0
     or position('''events'', jsonb_build_object(''restored''' in pg_get_functiondef('app.project_restore(uuid, text, jsonb, text)'::regprocedure)) = 0 then
    raise exception 'app.project_restore does not carry the events block and report after 1077';
  end if;
end $$;
