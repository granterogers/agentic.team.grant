/**
 * A person installs Slack into their own workspace, and nobody else's (ADR-0065, migration 0891).
 *   npm run verify:slack-link
 *
 * ONE block that ends in a deliberate exception, so nothing is committed: the install, its challenges, the vault secret and the
 * workspace row are written in the Sample office and rolled back. Slack is never contacted (the OAuth exchange is the edge
 * function's and is proved against a transport double in scripts/isolated/slack-oauth.ts); the bot token below is a made-up string.
 *
 * Asserted, each beside the negative that stops it being bought by refusing everything:
 *   - begin says "not switched on" until the app's client id is set, then returns a state once and stores only its hash;
 *   - redeem binds the workspace and the installing user to the office the STATE names, once, and takes no office from its caller;
 *   - a malformed state, a bad workspace or user id, a token that is not a bot token, an expired state and a replay all refuse;
 *   - a workspace another office already holds, and a Slack user who already belongs to another office, are refused and not moved,
 *     and the state stays unspent;
 *   - the bot token is in the vault and in no result (begin, status, redeem), and a disconnect hands it back exactly once, to be
 *     revoked at Slack, and deletes the vault copy;
 *   - connected means what is true: receiving yes, replying no until the worker resolves a token per office;
 *   - disconnect retires everything in one step, from the right office only; the same office can connect again;
 *   - the operator's office cannot start one; five attempts an hour; the browser roles can reach no door and no table.
 */
import { db, lit, rows, sampleOffice } from '../sample/lib.ts'

let failed = 0
const check = (what: string, ok: boolean, detail = ''): void => {
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail === '' ? '' : ` - ${detail}`}`)
}

const sample = (await sampleOffice()).officeId
const stamp = String(Date.now())
  .slice(-8)
  .replace(/[0-9]/g, (d) => 'ABCDEFGHIJ'[Number(d)] as string)
const TEAM = `T0${stamp}` // a workspace
const TEAM2 = `T1${stamp}` // a workspace another office holds
const USER = `U0${stamp}` // the person installing
const USER2 = `U1${stamp}` // somebody who already belongs to another office
const BOT = `U2${stamp}`
const TOKEN = `xoxb-0000000000-${stamp}fake` // made up: no such credential exists

const script = `
declare
  v_s uuid := ${lit(sample)}::uuid;
  v_t uuid := app.test_office();
  v_op uuid := app.operator_office();
  v_grant_ids int := (select count(*) from public.subject_identities where office_id = v_op);
  v_grant_ws int := (select count(*) from public.slack_workspaces where office_id = v_op);
  o jsonb := '{}'::jsonb;
  r jsonb; s1 text; s2 text; s3 text; s4 text; s5 text; taken_hash text; back jsonb;
  v_sub text := app.office_actor(v_s);
begin
  delete from public.channel_link_challenges where office_id = v_s and channel = 'slack';
  delete from public.subject_identities where office_id = v_s and origin_channel = 'slack';
  delete from public.system_config where key = 'slack.client_id';

  -- not switched on: said, not offered
  r := app.slack_install_begin(v_s);
  o := o || jsonb_build_object('not_enabled', r ->> 'error', 'not_enabled_status', app.slack_install_status(v_s) #>> '{slack,available}',
                               'not_enabled_can_connect', app.slack_install_status(v_s) #>> '{slack,can_connect}');
  insert into public.system_config (key, value, description) values ('slack.client_id', to_jsonb('1234567890.1234567890'::text), 'verify');

  r := app.slack_install_begin(v_s); s1 := r ->> 'state';
  o := o || jsonb_build_object('begin_ok', r ->> 'ok', 'state_len', length(s1), 'client_id', r ->> 'client_id',
    'hash_only', (select count(*) from public.channel_link_challenges where token_sha256 = s1) = 0
                 and (select count(*) from public.channel_link_challenges where token_sha256 = encode(sha256(convert_to(s1,'utf8')),'hex')) = 1,
    'waiting', app.slack_install_status(v_s) #>> '{slack,state}');
  r := app.slack_install_begin(v_s); s2 := r ->> 'state';
  o := o || jsonb_build_object('replaced', app.slack_install_redeem(s1, ${lit(TEAM)}, 'Acme', ${lit(BOT)}, 'A0123456789', ${lit(USER)}, ${lit(TOKEN)}) ->> 'error');

  -- malformed input all refuses with the same word, and spends nothing
  o := o || jsonb_build_object(
    'bad_state', app.slack_install_redeem('nope', ${lit(TEAM)}, 'Acme', ${lit(BOT)}, null, ${lit(USER)}, ${lit(TOKEN)}) ->> 'error',
    'bad_team', app.slack_install_redeem(s2, 'team', 'Acme', ${lit(BOT)}, null, ${lit(USER)}, ${lit(TOKEN)}) ->> 'error',
    'bad_user', app.slack_install_redeem(s2, ${lit(TEAM)}, 'Acme', ${lit(BOT)}, null, 'someone', ${lit(TOKEN)}) ->> 'error',
    'not_a_bot_token', app.slack_install_redeem(s2, ${lit(TEAM)}, 'Acme', ${lit(BOT)}, null, ${lit(USER)}, 'xoxp-1234567890-abcdefghij') ->> 'error',
    'unknown_state', app.slack_install_redeem(repeat('a', 36), ${lit(TEAM)}, 'Acme', ${lit(BOT)}, null, ${lit(USER)}, ${lit(TOKEN)}) ->> 'error',
    'still_waiting', app.slack_install_status(v_s) #>> '{slack,state}');

  -- a Slack user who already belongs to ANOTHER office
  insert into public.subject_identities (office_id, subject, origin_channel, actor, note, kind)
  values (v_t, 'verify-slack-link-other', 'slack', ${lit(USER2)}, 'verify:slack-link', 'person');
  r := app.slack_install_redeem(s2, ${lit(TEAM)}, 'Acme', ${lit(BOT)}, null, ${lit(USER2)}, ${lit(TOKEN)});
  o := o || jsonb_build_object('user_taken', r ->> 'error',
    'user_not_moved', (select office_id from public.subject_identities where origin_channel = 'slack' and actor = ${lit(USER2)}) = v_t,
    'user_state_unspent', (select used_at is null from public.channel_link_challenges where token_sha256 = encode(sha256(convert_to(s2,'utf8')),'hex')),
    'user_no_workspace', (select count(*) from public.slack_workspaces where team_id = ${lit(TEAM)}) = 0);
  delete from public.subject_identities where origin_channel = 'slack' and actor = ${lit(USER2)};

  -- a workspace another office already holds
  insert into public.slack_workspaces (team_id, team_name, bot_user_id, installed, office_id)
  values (${lit(TEAM2)}, 'Held', ${lit(BOT)}, true, v_t);
  r := app.slack_install_redeem(s2, ${lit(TEAM2)}, 'Held', ${lit(BOT)}, null, ${lit(USER)}, ${lit(TOKEN)});
  o := o || jsonb_build_object('workspace_taken', r ->> 'error',
    'workspace_not_moved', (select office_id from public.slack_workspaces where team_id = ${lit(TEAM2)}) = v_t,
    'workspace_state_unspent', (select used_at is null from public.channel_link_challenges where token_sha256 = encode(sha256(convert_to(s2,'utf8')),'hex')),
    'workspace_no_install', (select count(*) from public.slack_installs where team_id = ${lit(TEAM2)}) = 0);
  delete from public.slack_workspaces where team_id = ${lit(TEAM2)};

  -- expiry: the same state, aged
  update public.channel_link_challenges set created_at = app.now_utc() - interval '2 hours', expires_at = app.now_utc() - interval '1 hour'
   where token_sha256 = encode(sha256(convert_to(s2,'utf8')),'hex');
  o := o || jsonb_build_object('expired', app.slack_install_redeem(s2, ${lit(TEAM)}, 'Acme', ${lit(BOT)}, null, ${lit(USER)}, ${lit(TOKEN)}) ->> 'error');

  -- a fresh state installs
  r := app.slack_install_begin(v_s); s3 := r ->> 'state';
  r := app.slack_install_redeem(s3, ${lit(TEAM)}, 'Acme Studio', ${lit(BOT)}, 'A0123456789', ${lit(USER)}, ${lit(TOKEN)});
  o := o || jsonb_build_object('redeem_ok', r ->> 'ok', 'redeem_names_workspace', r ->> 'team_name',
    'redeem_leaks_token', r::text like '%xoxb%',
    'workspace_is_samples', (select office_id from public.slack_workspaces where team_id = ${lit(TEAM)}) = v_s,
    'workspace_installed', (select installed from public.slack_workspaces where team_id = ${lit(TEAM)}),
    'install_active', (select state from public.slack_installs where team_id = ${lit(TEAM)}) = 'active',
    'token_in_vault', (select decrypted_secret from vault.decrypted_secrets where id = (select bot_token_ref from public.slack_installs where team_id = ${lit(TEAM)})) = ${lit(TOKEN)},
    'bound_as_owner', (select subject from public.subject_identities where origin_channel = 'slack' and actor = ${lit(USER)}) = v_sub,
    'admitted_as_sample', (public.sender_admitted('slack', ${lit(USER)}, 'C0123456789') ->> 'office_id') = v_s::text,
    'status', app.slack_install_status(v_s) -> 'slack',
    'status_leaks_token', app.slack_install_status(v_s)::text like '%xoxb%',
    'replay', app.slack_install_redeem(s3, ${lit(TEAM)}, 'Acme', ${lit(BOT)}, null, ${lit(USER)}, ${lit(TOKEN)}) ->> 'error',
    'already_connected', app.slack_install_begin(v_s) ->> 'error',
    'other_office_status', app.slack_install_status(v_t) #>> '{slack,state}');

  -- another office disconnecting touches nothing of the Sample's
  r := app.slack_install_disconnect(v_t);
  o := o || jsonb_build_object('foreign_disconnect_removed', r ->> 'removed',
    'sample_still_connected', (select count(*) from public.slack_installs where office_id = v_s and state = 'active') = 1);

  -- the Sample disconnects: the token comes back exactly once, to be revoked at Slack, and is gone from the vault
  r := app.slack_install_disconnect(v_s);
  o := o || jsonb_build_object('disconnect_removed', r ->> 'removed', 'returns_the_token', r ->> 'bot_token' = ${lit(TOKEN)},
    'vault_copy_gone', (select count(*) from vault.secrets where name = 'slack.install.' || ${lit(TEAM)}) = 0,
    'install_revoked', (select state = 'revoked' and bot_token_ref is null from public.slack_installs where team_id = ${lit(TEAM)}),
    'workspace_uninstalled', (select not installed and revocation_reason = 'manual' from public.slack_workspaces where team_id = ${lit(TEAM)}),
    'unrecognised_again', (public.sender_admitted('slack', ${lit(USER)}, 'C0123456789') ->> 'office_id') is null,
    'status_none', app.slack_install_status(v_s) #>> '{slack,state}',
    'second_disconnect_removed', app.slack_install_disconnect(v_s) ->> 'removed');

  -- the same office connects again (a re-install of its own workspace)
  r := app.slack_install_begin(v_s); s4 := r ->> 'state';
  r := app.slack_install_redeem(s4, ${lit(TEAM)}, 'Acme Studio', ${lit(BOT)}, 'A0123456789', ${lit(USER)}, ${lit(TOKEN)});
  o := o || jsonb_build_object('reconnect_ok', r ->> 'ok',
    'reconnect_workspace_installed', (select installed and uninstalled_at is null from public.slack_workspaces where team_id = ${lit(TEAM)}),
    'installs_kept_as_history', (select count(*) from public.slack_installs where team_id = ${lit(TEAM)}));
  perform app.slack_install_disconnect(v_s);

  -- the operator
  o := o || jsonb_build_object('operator_begin', app.slack_install_begin(v_op) ->> 'error',
    'operator_disconnect', app.slack_install_disconnect(v_op) ->> 'error',
    'operator_status_managed', (app.slack_install_status(v_op) #>> '{slack,managed_by_operator}'));
  insert into public.channel_link_challenges (office_id, channel, token_sha256, expires_at)
  values (v_op, 'slack', encode(sha256(convert_to('0123456789abcdef0123456789abcdef0123','utf8')),'hex'), app.now_utc() + interval '5 minutes');
  o := o || jsonb_build_object('operator_state_redeem',
      app.slack_install_redeem('0123456789abcdef0123456789abcdef0123', ${lit(TEAM)}, 'Acme', ${lit(BOT)}, null, ${lit(USER)}, ${lit(TOKEN)}) ->> 'error',
    'grant_identities_unchanged', (select count(*) from public.subject_identities where office_id = v_op) = v_grant_ids,
    'grant_workspaces_unchanged', (select count(*) from public.slack_workspaces where office_id = v_op) = v_grant_ws);

  -- the ceiling: five an hour
  delete from public.channel_link_challenges where office_id = v_s and channel = 'slack';
  for i in 1..5 loop perform app.slack_install_begin(v_s); end loop;
  o := o || jsonb_build_object('sixth', app.slack_install_begin(v_s) ->> 'error');

  -- the shape of the doors
  o := o || jsonb_build_object(
    'redeem_takes_no_office', pg_get_function_arguments('app.slack_install_redeem(text,text,text,text,text,text,text)'::regprocedure) !~ 'office',
    'browser_cannot_redeem', not has_function_privilege('anon', 'public.slack_link_redeem(text,text,text,text,text,text,text)', 'execute')
                         and not has_function_privilege('authenticated', 'public.slack_link_redeem(text,text,text,text,text,text,text)', 'execute'),
    'browser_cannot_begin', not has_function_privilege('anon', 'public.slack_link_begin(uuid)', 'execute')
                        and not has_function_privilege('authenticated', 'public.slack_link_begin(uuid)', 'execute'),
    'tables_closed', not has_table_privilege('anon', 'public.slack_installs', 'select')
                 and not has_table_privilege('authenticated', 'public.slack_installs', 'select'));

  raise exception 'RESULT %', o::text;
end`

const answer = await db
  .execute(`do $x$ ${script} $x$`)
  .then(() => null)
  .catch(
    (e: Error) => /RESULT (\{.*\})/s.exec(e.message)?.[1] ?? `ERROR ${e.message.slice(0, 600)}`,
  )

if (answer === null || answer.startsWith('ERROR')) {
  check('the block ran and reported', false, answer ?? 'no result')
} else {
  const g = JSON.parse(answer) as Record<string, unknown>
  const is = (k: string, v: unknown): boolean => g[k] === v
  const st = (g.status ?? {}) as Record<string, unknown>
  check(
    'until the app is opened to other workspaces, Connect says so instead of offering a button',
    is('not_enabled', 'not_enabled') &&
      is('not_enabled_status', 'false') &&
      is('not_enabled_can_connect', 'false'),
  )
  check(
    'begin returns a state once, with the client id to authorise against, and says it is waiting',
    is('begin_ok', 'true') &&
      is('state_len', 36) &&
      is('client_id', '1234567890.1234567890') &&
      is('waiting', 'waiting'),
  )
  check('only the hash of the state is stored', is('hash_only', true))
  check('asking again replaces the earlier state', is('replaced', 'invalid'), String(g.replaced))
  check(
    'a malformed state, workspace, user and a token that is not a bot token all refuse alike',
    is('bad_state', 'invalid') &&
      is('bad_team', 'invalid') &&
      is('bad_user', 'invalid') &&
      is('not_a_bot_token', 'invalid') &&
      is('unknown_state', 'invalid'),
  )
  check('and those refusals did not spend the state', is('still_waiting', 'waiting'))
  check(
    'a Slack user who belongs to another office is refused, not moved, and nothing was created',
    is('user_taken', 'taken') &&
      is('user_not_moved', true) &&
      is('user_state_unspent', true) &&
      is('user_no_workspace', true),
  )
  check(
    'a workspace another office holds is refused, not moved, and the state stays unspent',
    is('workspace_taken', 'taken') &&
      is('workspace_not_moved', true) &&
      is('workspace_state_unspent', true) &&
      is('workspace_no_install', true),
  )
  check('an expired state refuses', is('expired', 'invalid'), String(g.expired))
  check(
    'a fresh state installs: the workspace and the installer are the STATE’s office’s, and the token is in the vault',
    is('redeem_ok', 'true') &&
      is('workspace_is_samples', true) &&
      is('workspace_installed', true) &&
      is('install_active', true) &&
      is('token_in_vault', true) &&
      is('bound_as_owner', true) &&
      is('admitted_as_sample', true),
  )
  check(
    'the token is in no result (redeem, status)',
    is('redeem_leaks_token', false) && is('status_leaks_token', false),
  )
  check(
    'status says what is true: connected, can receive, and cannot yet reply',
    st.state === 'connected' &&
      st.workspace === 'Acme Studio' &&
      st.can_receive === true &&
      st.can_reply === false,
    JSON.stringify(st),
  )
  check(
    'a replay refuses, and a connected office cannot start another',
    is('replay', 'invalid') && is('already_connected', 'already_connected'),
  )
  check('another office’s status is its own', is('other_office_status', 'none'))
  check(
    'another office disconnecting removes nothing of the Sample’s',
    is('foreign_disconnect_removed', '0') && is('sample_still_connected', true),
  )
  check(
    'disconnect hands the token back once for revocation at Slack and deletes the vault copy',
    is('disconnect_removed', '1') && is('returns_the_token', true) && is('vault_copy_gone', true),
  )
  check(
    'and retires everything: install revoked, workspace uninstalled, sender unrecognised, status none',
    is('install_revoked', true) &&
      is('workspace_uninstalled', true) &&
      is('unrecognised_again', true) &&
      is('status_none', 'none'),
  )
  check('a second disconnect is a no-op', is('second_disconnect_removed', '0'))
  check(
    'the same office connects again, the old install is kept as history',
    is('reconnect_ok', 'true') &&
      is('reconnect_workspace_installed', true) &&
      is('installs_kept_as_history', 2),
    String(g.installs_kept_as_history),
  )
  check(
    'the operator’s office cannot start or end one, and says it is managed',
    is('operator_begin', 'operator') &&
      is('operator_disconnect', 'operator') &&
      is('operator_status_managed', 'true'),
  )
  check(
    'a state written for the operator’s office cannot be redeemed, and his identities and workspaces are untouched',
    is('operator_state_redeem', 'invalid') &&
      is('grant_identities_unchanged', true) &&
      is('grant_workspaces_unchanged', true),
  )
  check('the sixth attempt in an hour is refused', is('sixth', 'too_many'), String(g.sixth))
  check('redeem takes no office from its caller', is('redeem_takes_no_office', true))
  check(
    'the browser roles can reach no door and no table',
    is('browser_cannot_redeem', true) &&
      is('browser_cannot_begin', true) &&
      is('tables_closed', true),
  )
}

const left = Number(
  (
    await rows(
      `select (select count(*) from public.slack_workspaces where team_id in (${lit(TEAM)}, ${lit(TEAM2)}))
            + (select count(*) from public.subject_identities where actor in (${lit(USER)}, ${lit(USER2)}))
            + (select count(*) from vault.secrets where name like ${lit(`slack.install.${TEAM}%`)})
            + (select count(*) from public.system_config where key = 'slack.client_id') as n`,
    )
  )[0]?.n,
)
check(
  'nothing was left behind (the block rolled back, and the client id is still unset)',
  left === 0,
  `${left} rows`,
)
console.log(failed === 0 ? '\nSLACK-LINK: PASS' : `\nSLACK-LINK: ${failed} FAILED`)
process.exitCode = failed === 0 ? 0 : 1
