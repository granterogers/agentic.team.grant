/**
 * A person connects their own Telegram, and nobody else's (#410, migrations 0885 and 0886).
 *   npm run verify:channel-link
 *
 * ONE block that ends in a deliberate exception, so nothing is committed: the connection, its challenges and the chat that
 * is made undeliverable are written in the Sample office and rolled back. No message is sent and nothing external is
 * contacted - the webhook's reply is composed in the edge function and is not exercised here (its shape is a unit test).
 *
 * What is asserted, each beside the negative that stops it being bought by refusing everything:
 *   - begin returns a token once and stores only its hash; asking again replaces the earlier token;
 *   - redeem binds the SENDER to the office the TOKEN names, once: replay, a wrong conversation, a malformed token and an
 *     expired one all refuse with the same word, and a refusal does not spend the token;
 *   - a Telegram user who already belongs to another office is not moved by a token for this one, and the token stays unspent;
 *   - the operator's office cannot start one, and a challenge somehow written for it cannot be redeemed;
 *   - an office that is connected cannot start another; five attempts an hour is the ceiling;
 *   - status is the office's own, and disconnecting one office touches nothing of another's;
 *   - disconnecting makes the person's chat undeliverable and the sender unrecognised again;
 *   - redeem takes no office from its caller, and the doors are not reachable by the browser roles.
 */
import { db, lit, rows, sampleOffice } from '../sample/lib.ts'

let failed = 0
const check = (what: string, ok: boolean, detail = ''): void => {
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail === '' ? '' : ` - ${detail}`}`)
}

const sample = (await sampleOffice()).officeId
const digits = String(Date.now()).slice(-9)
const A = `9${digits}` // the person's Telegram user, also their private chat id
const B = `8${digits}` // somebody who already belongs to another office
const GROUP = `-100${digits}`

const script = `
declare
  v_s uuid := ${lit(sample)}::uuid;
  v_t uuid := app.test_office();
  v_op uuid := app.operator_office();
  v_grant_ids int := (select count(*) from public.subject_identities where office_id = v_op);
  o jsonb := '{}'::jsonb;
  r jsonb; t1 text; t2 text; t3 text;
  v_sub text := app.office_actor(v_s);
begin
  -- a clean slate for the Sample inside this block
  delete from public.subject_identities where office_id = v_s and origin_channel = 'telegram';

  r := app.link_begin(v_s, 'telegram'); t1 := r ->> 'token';
  o := o || jsonb_build_object('begin_ok', r ->> 'ok', 'token_len', length(t1), 'has_bot', (r ->> 'bot') is not null,
    'hash_only', (select count(*) from public.channel_link_challenges where office_id = v_s and token_sha256 = t1) = 0
                 and (select count(*) from public.channel_link_challenges where token_sha256 = encode(sha256(convert_to(t1,'utf8')),'hex')) = 1,
    'waiting', app.link_status(v_s) #>> '{telegram,state}');

  r := app.link_begin(v_s, 'telegram'); t2 := r ->> 'token';
  o := o || jsonb_build_object('replaced', app.link_redeem('telegram', t1, ${lit(A)}, ${lit(A)}) ->> 'error');

  o := o || jsonb_build_object(
    'wrong_conversation', app.link_redeem('telegram', t2, ${lit(A)}, ${lit(GROUP)}) ->> 'error',
    'malformed', app.link_redeem('telegram', 'not-a-token', ${lit(A)}, ${lit(A)}) ->> 'error',
    'wrong_channel', app.link_redeem('slack', t2, ${lit(A)}, ${lit(A)}) ->> 'error',
    'still_waiting_after_refusals', app.link_status(v_s) #>> '{telegram,state}');

  -- a user who already belongs to ANOTHER office
  insert into public.subject_identities (office_id, subject, origin_channel, actor, note, kind)
  values (v_t, 'verify-channel-link-other', 'telegram', ${lit(B)}, 'verify:channel-link', 'person');
  r := app.link_redeem('telegram', t2, ${lit(B)}, ${lit(B)});
  o := o || jsonb_build_object('taken', r ->> 'error',
    'taken_not_moved', (select office_id from public.subject_identities where origin_channel = 'telegram' and actor = ${lit(B)}) = v_t,
    'taken_token_unspent', (select used_at is null from public.channel_link_challenges where token_sha256 = encode(sha256(convert_to(t2,'utf8')),'hex')));
  delete from public.subject_identities where origin_channel = 'telegram' and actor = ${lit(B)};

  -- expiry: the same token, aged
  update public.channel_link_challenges set created_at = app.now_utc() - interval '2 hours', expires_at = app.now_utc() - interval '1 hour'
   where token_sha256 = encode(sha256(convert_to(t2,'utf8')),'hex');
  o := o || jsonb_build_object('expired', app.link_redeem('telegram', t2, ${lit(A)}, ${lit(A)}) ->> 'error');

  -- a fresh one connects
  r := app.link_begin(v_s, 'telegram'); t3 := r ->> 'token';
  r := app.link_redeem('telegram', t3, ${lit(A)}, ${lit(A)});
  o := o || jsonb_build_object('redeem_ok', r ->> 'ok',
    'bound_to_sample', (select office_id from public.subject_identities where origin_channel = 'telegram' and actor = ${lit(A)}) = v_s,
    'bound_as_owner', (select subject from public.subject_identities where origin_channel = 'telegram' and actor = ${lit(A)}) = v_sub,
    'admitted_as_sample', (public.sender_admitted('telegram', ${lit(A)}, ${lit(A)}) ->> 'office_id') = v_s::text,
    'connected', app.link_status(v_s) #>> '{telegram,state}',
    'replay', app.link_redeem('telegram', t3, ${lit(A)}, ${lit(A)}) ->> 'error',
    'already_linked', app.link_begin(v_s, 'telegram') ->> 'error',
    'other_office_status', app.link_status(v_t) #>> '{telegram,state}');

  -- a chat of theirs, then disconnecting
  insert into public.telegram_chats (chat_id, chat_type, bot_id, office_id, subject, deliverable)
  values (${lit(A)}, 'private', 'verify', v_s, v_sub, true);
  r := app.link_disconnect(v_t, 'telegram');
  o := o || jsonb_build_object('foreign_disconnect_removed', r ->> 'removed',
    'sample_still_linked', (select count(*) from public.subject_identities where office_id = v_s and origin_channel = 'telegram') = 1);
  r := app.link_disconnect(v_s, 'telegram');
  o := o || jsonb_build_object('disconnect_removed', r ->> 'removed',
    'chat_undeliverable', (select not deliverable from public.telegram_chats where chat_id = ${lit(A)}),
    'unrecognised_again', (public.sender_admitted('telegram', ${lit(A)}, ${lit(A)}) ->> 'office_id') is null,
    'status_none', app.link_status(v_s) #>> '{telegram,state}');

  -- the operator
  o := o || jsonb_build_object('operator_begin', app.link_begin(v_op, 'telegram') ->> 'error',
    'operator_disconnect', app.link_disconnect(v_op, 'telegram') ->> 'error',
    'operator_status_managed', (app.link_status(v_op) #>> '{telegram,managed_by_operator}'));
  insert into public.channel_link_challenges (office_id, channel, token_sha256, expires_at)
  values (v_op, 'telegram', encode(sha256(convert_to('0123456789abcdef0123456789abcdef0123','utf8')),'hex'), app.now_utc() + interval '5 minutes');
  o := o || jsonb_build_object('operator_challenge_redeem', app.link_redeem('telegram', '0123456789abcdef0123456789abcdef0123', ${lit(A)}, ${lit(A)}) ->> 'error',
    'grant_identities_unchanged', (select count(*) from public.subject_identities where office_id = v_op) = v_grant_ids);

  -- the ceiling: five an hour
  delete from public.channel_link_challenges where office_id = v_s;
  for i in 1..5 loop perform app.link_begin(v_s, 'telegram'); end loop;
  o := o || jsonb_build_object('sixth', app.link_begin(v_s, 'telegram') ->> 'error');

  -- the shape of the doors
  o := o || jsonb_build_object(
    'redeem_takes_no_office', pg_get_function_arguments('app.link_redeem(text,text,text,text,text)'::regprocedure) !~ 'office',
    'browser_cannot_redeem', not has_function_privilege('anon', 'public.channel_link_redeem(text,text,text,text,text)', 'execute')
                         and not has_function_privilege('authenticated', 'public.channel_link_redeem(text,text,text,text,text)', 'execute'),
    'browser_cannot_begin', not has_function_privilege('anon', 'public.channel_link_begin(uuid,text)', 'execute')
                        and not has_function_privilege('authenticated', 'public.channel_link_begin(uuid,text)', 'execute'),
    'table_closed', not has_table_privilege('anon', 'public.channel_link_challenges', 'select')
                and not has_table_privilege('authenticated', 'public.channel_link_challenges', 'select'));

  raise exception 'RESULT %', o::text;
end`

const answer = await db
  .execute(`do $x$ ${script} $x$`)
  .then(() => null)
  .catch(
    (e: Error) => /RESULT (\{.*\})/s.exec(e.message)?.[1] ?? `ERROR ${e.message.slice(0, 500)}`,
  )

if (answer === null || answer.startsWith('ERROR')) {
  check('the block ran and reported', false, answer ?? 'no result')
} else {
  const g = JSON.parse(answer) as Record<string, string | number | boolean | null>
  const is = (k: string, v: string | number | boolean | null): boolean => g[k] === v
  check(
    'begin returns a token, the bot to open, and says it is waiting',
    is('begin_ok', 'true') &&
      is('token_len', 36) &&
      is('has_bot', true) &&
      is('waiting', 'waiting'),
    `${String(g.begin_ok)} ${String(g.token_len)} ${String(g.waiting)}`,
  )
  check('only the hash is stored, never the token', is('hash_only', true))
  check('asking again replaces the earlier token', is('replaced', 'invalid'), String(g.replaced))
  check(
    'a wrong conversation (a group), a malformed token and the wrong channel all refuse',
    is('wrong_conversation', 'invalid') &&
      is('malformed', 'invalid') &&
      is('wrong_channel', 'invalid'),
  )
  check('and those refusals did not spend the token', is('still_waiting_after_refusals', 'waiting'))
  check(
    'a Telegram user who belongs to another office is refused',
    is('taken', 'taken'),
    String(g.taken),
  )
  check(
    'and is not moved, and the token stays unspent',
    is('taken_not_moved', true) && is('taken_token_unspent', true),
  )
  check('an expired token refuses', is('expired', 'invalid'), String(g.expired))
  check(
    'a fresh token connects, binding the SENDER to the office the TOKEN names',
    is('redeem_ok', 'true') &&
      is('bound_to_sample', true) &&
      is('bound_as_owner', true) &&
      is('admitted_as_sample', true),
  )
  check('and the office reads as connected', is('connected', 'connected'))
  check('a replay refuses', is('replay', 'invalid'), String(g.replay))
  check(
    'a connected office cannot start another connection',
    is('already_linked', 'already_linked'),
  )
  check('another office’s status is its own', is('other_office_status', 'none'))
  check(
    'disconnecting from another office removes nothing of the Sample’s',
    is('foreign_disconnect_removed', '0') && is('sample_still_linked', true),
    String(g.foreign_disconnect_removed),
  )
  check('disconnecting removes the identity', is('disconnect_removed', '1'))
  check(
    'and makes their chat undeliverable, and the sender unrecognised, and the status none',
    is('chat_undeliverable', true) && is('unrecognised_again', true) && is('status_none', 'none'),
  )
  check(
    'the operator’s office cannot start or end one, and says its channels are managed',
    is('operator_begin', 'operator') &&
      is('operator_disconnect', 'operator') &&
      is('operator_status_managed', 'true'),
  )
  check(
    'a challenge written for the operator’s office cannot be redeemed, and his identities are untouched',
    is('operator_challenge_redeem', 'invalid') && is('grant_identities_unchanged', true),
  )
  check('the sixth attempt in an hour is refused', is('sixth', 'too_many'), String(g.sixth))
  check('redeem takes no office from its caller', is('redeem_takes_no_office', true))
  check(
    'the browser roles can reach no door and no table',
    is('browser_cannot_redeem', true) &&
      is('browser_cannot_begin', true) &&
      is('table_closed', true),
  )
}

const left = Number(
  (
    await rows(
      `select count(*) n from public.subject_identities where actor in (${lit(A)}, ${lit(B)}) or subject = 'verify-channel-link-other'`,
    )
  )[0]?.n,
)
check('nothing was left behind (the block rolled back)', left === 0, `${left} identities`)
console.log(failed === 0 ? '\nCHANNEL-LINK: PASS' : `\nCHANNEL-LINK: ${failed} FAILED`)
process.exitCode = failed === 0 ? 0 : 1
