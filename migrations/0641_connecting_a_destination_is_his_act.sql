-- 0641 - connecting a destination is the act that authorises writing to it, and only a person's connecting counts.
--
-- Grant's decision 3 (Notion) and the `tasks.sync` half of decision 1 (Vikunja): a destination he deliberately
-- connected carries a standing yes to import or update THAT destination, without asking each time. The yes is not
-- granted by anything the destination contains, by the office, or by a service: it is minted here, inside the two
-- functions that ARE the connect press, from the verified principal the gateway wrote (`p_by`), or - for the chat
-- path that attaches databases on his request - from the job's own origin in `app.record_destination_authority`.
--
--   * `app.hq_set_vikunja(.., p_by)` mints `task.board.write` for `vikunja:<address>#<project>` and makes it the only
--     live destination (reconnecting elsewhere withdraws the old yes). A non-person principal is refused: a test
--     member does not connect a credential.
--   * `app.hq_attach(.., p_by)` mints `notion.write` for `notion:<database id>` on that project when a person attaches
--     a Notion `home` database. A test member attaches only to a fixture project (`authority_refusal`).
--   * `app.hq_forget_vikunja` withdraws it.
--
-- `p_by` is the LAST parameter and defaults to null, so a caller that does not pass it still connects and simply
-- mints nothing - an unauthorised connection asks, it never writes. The old signatures are dropped by exact
-- signature (an added parameter would otherwise be a second overload), and the public wrappers are rebuilt with it.
-- Rebuilt from the LIVE definitions; refuses to apply if the text it replaces is not there.

do $m$
declare
  v_def text;
  v_old text;
begin
  -- ---- hq_set_vikunja ------------------------------------------------------------------------------------------
  v_def := pg_get_functiondef('app.hq_set_vikunja(text,integer,text)'::regprocedure);
  v_old := E'  update public.responsibilities set enabled = true where job_kind = ''tasks.sync'';\n';
  if position(v_old in v_def) = 0 or position('v_said jsonb;' in v_def) = 0 then
    raise exception '0641: hq_set_vikunja is not shaped as expected';
  end if;
  v_def := replace(v_def, 'p_api_token text)', 'p_api_token text, p_by text DEFAULT NULL::text)');
  v_def := replace(v_def, 'v_said jsonb;', E'v_said jsonb;\n  v_auth jsonb;');
  -- A credential is connected by a person. Refused before anything is written.
  v_def := replace(v_def, E'begin\n  if v_url = '''' or v_tok = '''' then',
    E'begin\n  if btrim(coalesce(p_by, '''')) <> '''' and app.principal_kind(p_by) <> ''person'' then\n    return jsonb_build_object(''error'', ''only a person connects a task board'');\n  end if;\n  if v_url = '''' or v_tok = '''' then');
  v_def := replace(v_def, v_old, v_old ||
    E'  -- The connection IS the yes: create and update on THIS board may proceed without asking; delete never can.\n'
    || E'  v_auth := case when btrim(coalesce(p_by, '''')) = '''' then null\n'
    || E'    else app.record_destination_authority(''task.board.write'', null,\n'
    || E'           format(''vikunja:%s#%s'', v_url, p_project_id), p_by, null, ''the task board you connected'', true) end;\n');
  v_def := replace(v_def, E'''note'', ''the office will keep your tasks in step from now on'');',
    E'''authorised'', coalesce((v_auth ->> ''ok'')::boolean, false),\n    ''note'', ''the office will keep your tasks in step from now on'');');
  drop function app.hq_set_vikunja(text, integer, text);
  execute v_def;

  -- ---- hq_forget_vikunja ---------------------------------------------------------------------------------------
  v_def := pg_get_functiondef('app.hq_forget_vikunja()'::regprocedure);
  v_old := E'  update public.responsibilities set enabled = false where job_kind = ''tasks.sync'';\n';
  if position(v_old in v_def) = 0 then raise exception '0641: hq_forget_vikunja is not shaped as expected'; end if;
  execute replace(v_def, v_old, v_old ||
    E'  update public.standing_authorizations\n     set revoked_at = app.now_utc(), revoked_reason = ''the task board was disconnected''\n   where tool = ''task.board.write'' and revoked_at is null;\n');

  -- ---- hq_attach -----------------------------------------------------------------------------------------------
  v_def := pg_get_functiondef('app.hq_attach(text,text,text,text,text,text)'::regprocedure);
  v_old := E'  return jsonb_build_object(\n    ''attachment_id'', v_row.attachment_id,\n    ''connector'', p_connector,\n    ''role'', p_role);';
  if position(v_old in v_def) = 0 then raise exception '0641: hq_attach is not shaped as expected'; end if;
  v_def := replace(v_def, 'p_display text DEFAULT NULL::text)', 'p_display text DEFAULT NULL::text, p_by text DEFAULT NULL::text)');
  v_def := replace(v_def, E'  v_row     public.project_attachments%rowtype;', E'  v_row     public.project_attachments%rowtype;\n  v_auth    jsonb;\n  v_refusal text;');
  -- A test member attaches only to a fixture project; nobody unknown at all (0614's rule, on this door).
  v_def := replace(v_def, E'  -- The registry, not a list.',
    E'  if btrim(coalesce(p_by, '''')) <> '''' then\n    v_refusal := app.authority_refusal(btrim(p_by), null, v_project);\n    if v_refusal is not null then return jsonb_build_object(''error'', v_refusal); end if;\n  end if;\n\n  -- The registry, not a list.');
  v_def := replace(v_def, v_old,
    E'  -- Connecting a Notion database IS the yes to writing into it - that database, on that project, from a person.\n'
    || E'  v_auth := case when p_connector = ''notion'' and p_role = ''home'' and v_row.attachment_id is not null\n'
    || E'                      and btrim(coalesce(p_by, '''')) <> ''''\n'
    || E'    then app.record_destination_authority(''notion.write'', v_project, ''notion:'' || btrim(p_ref), p_by, null,\n'
    || E'           format(''the Notion database %s'', coalesce(v_row.display_name, btrim(p_ref)))) end;\n\n'
    || E'  return jsonb_build_object(\n    ''attachment_id'', v_row.attachment_id,\n    ''connector'', p_connector,\n    ''role'', p_role,\n    ''authorised'', coalesce((v_auth ->> ''ok'')::boolean, false));');
  drop function app.hq_attach(text, text, text, text, text, text);
  execute v_def;
end $m$;

-- ---- the public wrappers carry the verified principal ----------------------------------------------------------
drop function public.hq_set_vikunja(text, integer, text);
create function public.hq_set_vikunja(p_base_url text, p_project_id integer, p_api_token text, p_by text default null)
returns jsonb language sql security definer set search_path to '' as $f$
  select app.hq_set_vikunja(p_base_url, p_project_id, p_api_token, p_by)
$f$;
drop function public.hq_attach(text, text, text, text, text, text);
create function public.hq_attach(p_slug text, p_connector text, p_ref text, p_role text default 'source',
                                 p_kind text default null, p_display text default null, p_by text default null)
returns jsonb language sql security definer set search_path to 'public', 'pg_catalog' as $f$
  select app.hq_attach(p_slug, p_connector, p_ref, p_role, p_kind, p_display, p_by)
$f$;

-- ---- letting go of a database withdraws the yes that connecting it gave -------------------------------------------
-- A trigger on the attachment, so EVERY route that detaches or disables it (the page, an undo, a sweep) takes the
-- authority with it, and re-enabling the same database later does not quietly bring it back: connecting again, as a
-- person, is the only way to mint it. (Review, 1 October: detach left the row live.)
--
-- There is deliberately NO backfill for databases attached before this migration, and `office.notion_adopt` mints
-- nothing: adopt chooses a database by its TITLE among whatever is shared with the integration, which is not the
-- same as Grant deliberately connecting that destination. Press Connect on the database once and it is his yes.
create function app.withdraw_notion_authority()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_catalog' as $f$
begin
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.enabled and not new.enabled) then
    update public.standing_authorizations
       set revoked_at = app.now_utc(), revoked_reason = 'the database was disconnected from the project'
     where tool = 'notion.write' and project_id = old.project_id and scope_ref = 'notion:' || old.external_ref
       and revoked_at is null;
  end if;
  return coalesce(new, old);
end;
$f$;
create trigger project_attachments_withdraw_notion_authority
  after update or delete on public.project_attachments
  for each row when (old.connector = 'notion') execute function app.withdraw_notion_authority();
