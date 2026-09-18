/*
  Telegram was never disconnected, and the dashboard has said it was since
  14 September.

  Grant: *"I definitely set up a Telegram bot already, and it worked a couple
  of days ago, and I got messages up to a day ago, so I don't know what the
  hell you're talking about."* He is right, and the office was wrong.

  ## What actually happened

  `app.hq_disconnect('telegram')` ran at 2026-09-14 10:40:57 — `verify:disconnect`
  called it outside a transaction, which CLAUDE.md already records (it really
  disconnected Slack the same afternoon; Slack was reconnected at 12:06). Of
  the three things that branch does:

    delete from vault.secrets
     where name in ('telegram.bot_token', 'telegram.chief_bot_token')  -->  0 rows
    update public.system_config set value = false
     where key = 'telegram.enabled'                                    -->  0 rows
    update public.connection_health set state = 'missing' ...          -->  1 row

  The stored secret is `telegram.chief.bot_token`, with a dot. The config key
  has never existed. So the ONLY thing the disconnect achieved was to make the
  dashboard lie about a credential that was still there and still working —
  and it returned `ok: true` while doing it.

  Verified before writing this: the token resolves from the vault and
  `api.telegram.org/getMe` answers `ok: true, @agenticteamgrantbot`, and
  `public.telegram_bots` has that bot enabled. Nothing is broken.

  ## What this changes

  CLAUDE.md, #210: *"Assert that a destructive function actually removed
  something, by counting before and after, or it is a claim with nothing behind
  it."* That entry names this exact branch and was never acted on. Three
  things follow, and the first is the one that matters:

  1. **A disconnect that removed nothing does not touch the dashboard.** It
     returns `ok: false` and says what it could not find. Marking a live
     credential `missing` is worse than failing to remove it: the credential is
     still there AND the office now believes it is gone.

  2. **The secret is found through the REGISTRY, not by name.** Enumerating
     names is what broke it — `public.telegram_bots.token_ref` is where the
     office itself looks, so the disconnect asks the same question every reader
     asks. The two legacy names stay in the list, because a row that predates
     the registry should still be swept.

  3. **The ref is nulled in the same statement as the delete.** This branch has
     never once run its delete, so nobody has ever met what comes next:
     `app.resolve_secret` raises 23503 on a ref that resolves to nothing, and
     CLAUDE.md records a dangling Slack ref taking down every job in the
     building. A dangling `token_ref` on an enabled bot would do the same to
     Telegram.

  And the stale row is corrected, because Grant looks at that page.
*/

-- ---------------------------------------------------------------------------
-- The row that has been wrong for four days.
-- ---------------------------------------------------------------------------

update public.connection_health
   set state = 'ok',
       detail = 'the chief bot token resolves from the vault and getMe answers @agenticteamgrantbot',
       action = 'nothing outstanding',
       checked_at = app.now_utc()
 where service = 'Telegram'
   and credential like '%chief%'
   and state = 'missing';

-- ---------------------------------------------------------------------------
-- The branch that wrote it.
--
-- Spliced from the LIVE definition rather than transcribed: the function is
-- long, this changes one branch of it, and CLAUDE.md records twice what
-- rewriting a function from memory costs.
-- ---------------------------------------------------------------------------

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
    '    delete from vault.secrets where name in (''telegram.bot_token'', ''telegram.chief_bot_token'');' || E'\n' ||
    '    get diagnostics v_gone = row_count;';

  if position(v_old in v_def) = 0 then
    raise exception 'the telegram branch is not shaped the way 0487 expects; read it before editing';
  end if;

  v_new :=
    '    delete from vault.secrets s' || E'\n' ||
    '     where s.id in (select b.token_ref from public.telegram_bots b' || E'\n' ||
    '                     where b.staff_slug = ''chief-of-staff'' and b.token_ref is not null)' || E'\n' ||
    '        or s.name in (''telegram.bot_token'', ''telegram.chief_bot_token'',' || E'\n' ||
    '                      ''telegram.chief.bot_token'');' || E'\n' ||
    '    get diagnostics v_gone = row_count;' || E'\n' ||
    E'\n' ||
    '    if v_gone = 0 then' || E'\n' ||
    '      return jsonb_build_object(' || E'\n' ||
    '        ''ok'', false, ''service'', ''Telegram'', ''removed'', 0,' || E'\n' ||
    '        ''error'', ''Nothing was removed, so nothing was disconnected. There is no chief ''' || E'\n' ||
    '                 || ''bot token in the vault to take away. The dashboard is left alone ''' || E'\n' ||
    '                 || ''deliberately: saying a credential is missing when it is not is ''' || E'\n' ||
    '                 || ''worse than failing to remove it.'');' || E'\n' ||
    '    end if;' || E'\n' ||
    E'\n' ||
    '    update public.telegram_bots' || E'\n' ||
    '       set enabled = false,' || E'\n' ||
    '           token_ref = null,' || E'\n' ||
    '           disabled_reason = ''disconnected at your request''' || E'\n' ||
    '     where staff_slug = ''chief-of-staff'';';

  v_def := replace(v_def, v_old, v_new);
  execute v_def || ';';
end
$splice$;

-- ---------------------------------------------------------------------------
-- Drive it. A migration that applies cleanly is not a function that works.
-- ---------------------------------------------------------------------------

do $drive$
declare
  v_answer jsonb;
  v_state  text;
  v_live   int;
begin
  -- 1. With the token where it is, the branch disconnects for real: the secret
  --    goes, the ref is nulled with it, and the bot is switched off.
  v_answer := app.hq_disconnect('telegram');
  if coalesce(v_answer ->> 'ok', '') <> 'true' then
    raise exception '0487: a real disconnect should have succeeded, got %', v_answer;
  end if;
  if (v_answer ->> 'removed')::int < 1 then
    raise exception '0487: it reported success having removed nothing: %', v_answer;
  end if;
  select count(*) into v_live
    from public.telegram_bots
   where staff_slug = 'chief-of-staff' and (enabled or token_ref is not null);
  if v_live <> 0 then
    raise exception '0487: the bot is still enabled or still points at a secret';
  end if;

  -- Step 1 marked the dashboard `missing`, which is correct: it really did
  -- remove the credential. Put the row back to what a working Telegram looks
  -- like, so step 2 can tell the difference between a row it left alone and a
  -- row it wrote. Asserting on the state without this reads step 1's own
  -- writing as step 2's, which is what the first run of this drive did.
  update public.connection_health
     set state = 'ok', detail = '0487 drive'
   where service = 'Telegram' and credential like '%chief%';

  -- 2. And now that there is nothing left to remove, it must REFUSE rather
  --    than mark the dashboard. This is the defect Grant met.
  v_answer := app.hq_disconnect('telegram');
  if coalesce(v_answer ->> 'ok', '') <> 'false' then
    raise exception '0487: a disconnect that removes nothing still claimed success: %', v_answer;
  end if;
  if v_answer ->> 'error' not like '%Nothing was removed%' then
    raise exception '0487: it refused for the wrong reason: %', v_answer;
  end if;
  select state into v_state
    from public.connection_health
   where service = 'Telegram' and credential like '%chief%';
  if v_state = 'missing' then
    raise exception '0487: an empty disconnect still marked the dashboard missing';
  end if;

  -- Everything above happened for real. Put it all back.
  raise exception using errcode = 'ZZ000', message = '0487 drive: rolling back';
exception
  when others then
    if sqlerrm <> '0487 drive: rolling back' then raise; end if;
end
$drive$;
