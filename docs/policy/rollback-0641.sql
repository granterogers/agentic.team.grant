-- Rollback of 0641: connecting no longer mints a destination yes; the three functions lose p_by.
begin;
do $m$
declare v_def text; v_old text;
begin
  v_def := pg_get_functiondef('app.hq_set_vikunja(text,integer,text,text)'::regprocedure);
  if position('record_destination_authority' in v_def) = 0 then raise exception 'rollback 0641: 0641 is not applied'; end if;
  v_def := replace(v_def, 'p_api_token text, p_by text DEFAULT NULL::text)', 'p_api_token text)');
  v_def := replace(v_def, E'v_said jsonb;\n  v_auth jsonb;', 'v_said jsonb;');
  v_def := replace(v_def, E'  if btrim(coalesce(p_by, '''')) <> '''' and app.principal_kind(p_by) <> ''person'' then\n    return jsonb_build_object(''error'', ''only a person connects a task board'');\n  end if;\n', '');
  v_def := replace(v_def,
    E'  -- The connection IS the yes: create and update on THIS board may proceed without asking; delete never can.\n'
    || E'  v_auth := case when btrim(coalesce(p_by, '''')) = '''' then null\n'
    || E'    else app.record_destination_authority(''task.board.write'', null,\n'
    || E'           format(''vikunja:%s#%s'', v_url, p_project_id), p_by, null, ''the task board you connected'', true) end;\n', '');
  v_def := replace(v_def, E'''authorised'', coalesce((v_auth ->> ''ok'')::boolean, false),\n    ''note'',', E'''note'',');
  drop function app.hq_set_vikunja(text, integer, text, text);
  execute v_def;

  v_def := pg_get_functiondef('app.hq_forget_vikunja()'::regprocedure);
  v_def := replace(v_def,
    E'  update public.standing_authorizations\n     set revoked_at = app.now_utc(), revoked_reason = ''the task board was disconnected''\n   where tool = ''task.board.write'' and revoked_at is null;\n', '');
  execute v_def;

  v_def := pg_get_functiondef('app.hq_attach(text,text,text,text,text,text,text)'::regprocedure);
  v_def := replace(v_def, 'p_display text DEFAULT NULL::text, p_by text DEFAULT NULL::text)', 'p_display text DEFAULT NULL::text)');
  v_def := replace(v_def, E'  v_row     public.project_attachments%rowtype;\n  v_auth    jsonb;\n  v_refusal text;', E'  v_row     public.project_attachments%rowtype;');
  v_def := replace(v_def,
    E'  if btrim(coalesce(p_by, '''')) <> '''' then\n    v_refusal := app.authority_refusal(btrim(p_by), null, v_project);\n    if v_refusal is not null then return jsonb_build_object(''error'', v_refusal); end if;\n  end if;\n\n', '');
  v_def := replace(v_def,
    E'  -- Connecting a Notion database IS the yes to writing into it - that database, on that project, from a person.\n'
    || E'  v_auth := case when p_connector = ''notion'' and p_role = ''home'' and v_row.attachment_id is not null\n'
    || E'                      and btrim(coalesce(p_by, '''')) <> ''''\n'
    || E'    then app.record_destination_authority(''notion.write'', v_project, ''notion:'' || btrim(p_ref), p_by, null,\n'
    || E'           format(''the Notion database %s'', coalesce(v_row.display_name, btrim(p_ref)))) end;\n\n', '');
  v_def := replace(v_def, E'    ''role'', p_role,\n    ''authorised'', coalesce((v_auth ->> ''ok'')::boolean, false));', E'    ''role'', p_role);');
  drop function app.hq_attach(text, text, text, text, text, text, text);
  execute v_def;
end $m$;
drop function public.hq_set_vikunja(text, integer, text, text);
create function public.hq_set_vikunja(p_base_url text, p_project_id integer, p_api_token text)
returns jsonb language sql security definer set search_path to '' as $f$
  select app.hq_set_vikunja(p_base_url, p_project_id, p_api_token)
$f$;
drop function public.hq_attach(text, text, text, text, text, text, text);
create function public.hq_attach(p_slug text, p_connector text, p_ref text, p_role text default 'source',
                                 p_kind text default null, p_display text default null)
returns jsonb language sql security definer set search_path to 'public', 'pg_catalog' as $f$
  select app.hq_attach(p_slug, p_connector, p_ref, p_role, p_kind, p_display)
$f$;
-- The standing rows minted by the connections are withdrawn with the mechanism that minted them.
update public.standing_authorizations set revoked_at = app.now_utc(), revoked_reason = 'rolled back with 0641'
 where tool in ('task.board.write', 'notion.write') and scope_ref is not null and revoked_at is null;
drop trigger if exists project_attachments_withdraw_notion_authority on public.project_attachments;
drop function if exists app.withdraw_notion_authority();
commit;
