/*
  The same defect, one branch along.

  0487 fixed the Telegram branch of `app.hq_disconnect`: it marked the
  dashboard `missing` and returned `ok: true` having removed nothing, and the
  row sat wrong on Grant's Settings page for four days before he said so.

  CLAUDE.md's rule about abstraction is the whole point of this migration:
  *"Ask whether the thing that failed is an instance or a class BEFORE patching
  the instance."* So the other branches were read, not assumed. Two are
  already honest — `notion` refuses when it removed nothing, and the notebook
  branch says so in a note. **Slack is the same shape as Telegram was**: no
  guard, the health row written unconditionally, `ok: true` regardless.

  It has not gone wrong yet only because Slack's five secret names happen to
  be the names actually stored. That is luck, and 0350's Telegram branch is
  what luck looks like when it runs out.

  So the rule is stated in both places it applies: a disconnect that removed
  nothing does not touch the dashboard, because a live credential reported
  `missing` is worse than a credential that failed to be removed — the office
  then believes something false about itself, and Grant reads it.

  The other half of 0487, deleting by registry rather than by name, does NOT
  carry across: Slack has no registry table pointing at its secrets, and
  inventing one to make two branches look alike would be the abstraction
  mistake #249 and #254 record, in the direction of too much.
*/

do $splice$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'hq_disconnect';

  v_old :=
    '    get diagnostics v_gone = row_count;' || E'\n' ||
    E'\n' ||
    '    update public.connection_health' || E'\n' ||
    '       set state = ''missing'',' || E'\n' ||
    '           detail = ''disconnected at your request'',' || E'\n' ||
    '           action = ''Reconnect in Setting up, or uninstall the app at Slack to finish it'',';

  if position(v_old in v_def) = 0 then
    raise exception 'the slack branch is not shaped the way 0488 expects; read it before editing';
  end if;

  v_new :=
    '    get diagnostics v_gone = row_count;' || E'\n' ||
    E'\n' ||
    '    if v_gone = 0 then' || E'\n' ||
    '      return jsonb_build_object(' || E'\n' ||
    '        ''ok'', false, ''service'', ''Slack'', ''removed'', 0,' || E'\n' ||
    '        ''error'', ''Nothing was removed, so nothing was disconnected. There are no ''' || E'\n' ||
    '                 || ''Slack credentials in the vault to take away. The dashboard is ''' || E'\n' ||
    '                 || ''left alone deliberately: saying a credential is missing when it ''' || E'\n' ||
    '                 || ''is not is worse than failing to remove it.'');' || E'\n' ||
    '    end if;' || E'\n' ||
    E'\n' ||
    '    update public.connection_health' || E'\n' ||
    '       set state = ''missing'',' || E'\n' ||
    '           detail = ''disconnected at your request'',' || E'\n' ||
    '           action = ''Reconnect in Setting up, or uninstall the app at Slack to finish it'',';

  v_def := replace(v_def, v_old, v_new);
  execute v_def || ';';
end
$splice$;

-- ---------------------------------------------------------------------------
-- Drive it, both ways, inside a rollback. CLAUDE.md, #210: wrap the CALL, not
-- the assertion — a wrapper cannot know a call was destructive until it
-- already has been, and this one deletes Slack's live credentials.
-- ---------------------------------------------------------------------------

do $drive$
declare
  v_answer jsonb;
  v_state  text;
begin
  -- A real disconnect still works and still says so.
  v_answer := app.hq_disconnect('slack');
  if coalesce(v_answer ->> 'ok', '') <> 'true' then
    raise exception '0488: a real Slack disconnect should have succeeded, got %', v_answer;
  end if;
  if (v_answer ->> 'removed')::int < 1 then
    raise exception '0488: it reported success having removed nothing: %', v_answer;
  end if;

  -- Put the dashboard back, so the second call is judged on what IT wrote
  -- rather than on what the first call wrote. 0487's drive failed its first
  -- run for want of exactly this line.
  update public.connection_health
     set state = 'ok', detail = '0488 drive'
   where service = 'Slack';

  -- And with nothing left to remove, it refuses and leaves the page alone.
  v_answer := app.hq_disconnect('slack');
  if coalesce(v_answer ->> 'ok', '') <> 'false' then
    raise exception '0488: an empty Slack disconnect still claimed success: %', v_answer;
  end if;
  if v_answer ->> 'error' not like '%Nothing was removed%' then
    raise exception '0488: it refused for the wrong reason: %', v_answer;
  end if;
  select min(state) into v_state from public.connection_health where service = 'Slack';
  if v_state = 'missing' then
    raise exception '0488: an empty disconnect still marked the dashboard missing';
  end if;

  -- The Telegram branch 0487 fixed must still behave. A splice of a live
  -- definition rewrites the WHOLE function, so this is not a spare check.
  v_answer := app.hq_disconnect('telegram');
  if coalesce(v_answer ->> 'ok', '') <> 'true' then
    raise exception '0488: 0487 did not survive the splice: %', v_answer;
  end if;

  raise exception using errcode = 'ZZ000', message = '0488 drive: rolling back';
exception
  when others then
    if sqlerrm <> '0488 drive: rolling back' then raise; end if;
end
$drive$;
