/**
 * A person connecting their own Telegram, through the REAL webhook (#410, migrations 0885 and 0886).
 *
 *   npx tsx scripts/isolated/telegram-link.ts <replica-db>
 *
 * The real `telegram-webhook` handler runs in Node against the isolated replica (telegram-door.ts). The emulator REFUSES
 * and RECORDS every URL that is not the replica, so "it sent the person a message" is an observation (a refused call to
 * api.telegram.org is the message), and nothing leaves the machine. Positive controls first: Grant still gets a job.
 *
 * What is driven: a stranger who taps a good link becomes the person it names and then reaches THEIR office, not Grant's;
 * a replayed, expired, wrong-office, group, malformed and bot-sent link all connect nothing; a database that cannot be
 * asked is a retry (503) and spends nothing; and an ordinary stranger is still ignored without a word.
 */
import { isolated } from './guard.ts'
import { startTelegramDoor } from './telegram-door.ts'

const db = await isolated(process.argv[2] ?? 'tlink')
const run = Date.now().toString(36)
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const results: { ok: boolean }[] = []
const check = (what: string, ok: boolean, detail = '') => {
  results.push({ ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail === '' ? '' : ` - ${detail}`}`)
}
const n = () => Math.floor(Math.random() * 9_000_000) + 1_000_000
const GRANT = '1386648496'
const BOT = '8967954396'

// The chief's bot, as production has it, with a token the emulator will refuse to use.
if (
  Number(
    (await one(`select count(*)::int c from public.telegram_bots where bot_id = ${lit(BOT)}`)).c,
  ) === 0
) {
  const secret = await one(
    `insert into vault.secrets (name, secret) values (${lit(`isolated.tl.${run}`)}, 'isolated-fake-telegram-token') returning id::text id`,
  )
  await db.execute(`insert into public.telegram_bots (bot_id, username, staff_slug, is_pager, token_ref)
    values (${lit(BOT)}, 'isolated_chief_bot', 'chief-of-staff', true, ${lit(String(secret.id))})`)
}

// Two people with offices of their own.
const office = async (mail: string, name: string): Promise<string> => {
  const auth = String((await one(`select gen_random_uuid()::text a`)).a)
  await db.execute(
    `insert into auth.users (id, email) values (${lit(auth)}, ${lit(`${mail}.${run}@example.invalid`)})`,
  )
  await db.execute(
    `insert into public.offices (auth_user_id, kind, name) values (${lit(auth)}, 'person', ${lit(name)})`,
  )
  return String(
    (await one(`select office_id::text o from public.offices where auth_user_id = ${lit(auth)}`)).o,
  )
}
const A = await office('link.a', `Link A ${run}`)
const B = await office('link.b', `Link B ${run}`)
const door = await startTelegramDoor(db, BOT)

const msg = (from: number, chat: { id: number; type: string }, text: string, isBot = false) => ({
  update_id: n(),
  message: {
    message_id: n(),
    date: Math.floor(Date.now() / 1000),
    text,
    chat,
    from: { id: from, ...(isBot ? { is_bot: true } : {}) },
  },
})
const priv = (id: number) => ({ id, type: 'private' })
const begin = async (office: string): Promise<string> =>
  String((await one(`select app.link_begin(${lit(office)}::uuid, 'telegram') ->> 'token' t`)).t)
const idOf = async (actor: string): Promise<string | null> => {
  const r = await one(
    `select office_id::text o from public.subject_identities where origin_channel = 'telegram' and actor = ${lit(actor)}`,
  )
  return r === undefined ? null : String(r.o)
}
const sentFrom = (mark: number) =>
  door.refusedUrls.slice(mark).filter((u) => /api\.telegram\.org\/bot[^/]+\/sendMessage/.test(u))
const X = String(7_000_000_000 + n())
const Y = String(7_100_000_000 + n())
const Z = String(7_200_000_000 + n())

// ---- positive control: Grant is unaffected
{
  const r = await door.post(msg(Number(GRANT), priv(Number(GRANT)), `Hello from Grant ${run}`))
  check(
    'control: Grant’s own message still becomes a job',
    r.status === 200 && typeof r.body.queued === 'string',
    JSON.stringify(r.body),
  )
}

// ---- a stranger who is not linking is still ignored, without a word
{
  const mark = door.refusedUrls.length
  const before = Number((await one(`select count(*)::int c from public.inbound_commands`)).c)
  const r = await door.post(msg(Number(Z), priv(Number(Z)), `hello ${run}`))
  check(
    'control: an ordinary stranger is ignored, stores nothing and is sent nothing',
    r.status === 200 &&
      r.body.ignored === 'unrecognised sender' &&
      Number((await one(`select count(*)::int c from public.inbound_commands`)).c) === before &&
      sentFrom(mark).length === 0,
    JSON.stringify(r.body),
  )
}

// ---- the good link
const tokenA = await begin(A)
{
  const mark = door.refusedUrls.length
  const r = await door.post(msg(Number(X), priv(Number(X)), `/start link_${tokenA}`))
  check(
    'a stranger who taps a good link connects, and is told so',
    r.status === 200 && r.body.link === 'connected' && sentFrom(mark).length === 1,
    JSON.stringify(r.body),
  )
  check(
    'and is bound to the office the TOKEN names, as that office’s person',
    (await idOf(X)) === A,
    String(await idOf(X)),
  )
  const sent = await door.post(msg(Number(X), priv(Number(X)), `Hello from the new person ${run}`))
  const job = await one(
    `select office_id::text o from public.jobs where kind = 'office.instruction' order by created_at desc limit 1`,
  )
  check(
    'and their next message becomes work in THEIR office, never Grant’s',
    sent.status === 200 && typeof sent.body.queued === 'string' && String(job.o) === A,
    `${JSON.stringify(sent.body)} office=${String(job.o)}`,
  )
}

// ---- refusals
{
  const mark = door.refusedUrls.length
  const r = await door.post(msg(Number(Y), priv(Number(Y)), `/start link_${tokenA}`))
  check(
    'a replay by somebody else connects nothing and says only that the link is spent',
    r.status === 200 &&
      r.body.link === 'refused' &&
      (await idOf(Y)) === null &&
      sentFrom(mark).length === 1,
    JSON.stringify(r.body),
  )
}
{
  const t = await begin(B)
  await db.execute(
    `update public.channel_link_challenges set created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour' where office_id = ${lit(B)}::uuid`,
  )
  const r = await door.post(msg(Number(Y), priv(Number(Y)), `/start link_${t}`))
  check(
    'an expired link connects nothing',
    r.body.link === 'refused' && (await idOf(Y)) === null,
    JSON.stringify(r.body),
  )
}
{
  const t = await begin(B)
  const r = await door.post(msg(Number(X), priv(Number(X)), `/start link_${t}`))
  check(
    'a person already in one office is not moved by a link for another',
    r.body.link === 'refused' && (await idOf(X)) === A,
    `X is in ${String(await idOf(X))}`,
  )
  const unspent = await one(
    `select (used_at is null) u from public.channel_link_challenges where office_id = ${lit(B)}::uuid and revoked_at is null and expires_at > now()`,
  )
  check('and that refusal did not spend the link', unspent.u === true)
}
{
  const t = await begin(B)
  const mark = door.refusedUrls.length
  const asGroup = await door.post(
    msg(Number(Y), { id: -1000 - n(), type: 'supergroup' }, `/start link_${t}`),
  )
  check(
    'a link posted in a group is not a link: the sender is just ignored',
    asGroup.body.ignored === 'unrecognised sender' &&
      (await idOf(Y)) === null &&
      sentFrom(mark).length === 0,
    JSON.stringify(asGroup.body),
  )
  const asBot = await door.post(msg(Number(Y), priv(Number(Y)), `/start link_${t}`, true))
  check(
    'a link sent by a bot is not a link',
    asBot.body.ignored === 'unrecognised sender' && (await idOf(Y)) === null,
  )
  for (const [what, text] of [
    ['an upper-case token', `/start link_${t.toUpperCase()}`],
    ['a short token', `/start link_${t.slice(2)}`],
    ['a token with words after it', `/start link_${t} please`],
  ] as const) {
    const r = await door.post(msg(Number(Y), priv(Number(Y)), text))
    check(
      `${what} is not a link`,
      r.body.ignored === 'unrecognised sender' && (await idOf(Y)) === null,
      JSON.stringify(r.body),
    )
  }
  // the link, tapped by the right person afterwards, still works: nothing above spent it
  const ok = await door.post(msg(Number(Y), priv(Number(Y)), `/start link_${t}`))
  check(
    'and none of those spent the link: the real tap still connects',
    ok.body.link === 'connected' && (await idOf(Y)) === B,
    JSON.stringify(ok.body),
  )
}

// ---- a database that cannot be asked is a retry, and spends nothing
{
  const t = await begin(A.replace(/^/, ''))
  void t
}
{
  await db.execute(`delete from public.subject_identities where office_id = ${lit(B)}::uuid`)
  const t = await begin(B)
  door.outage(true, 'channel_link_redeem')
  const r = await door.post(msg(Number(Z), priv(Number(Z)), `/start link_${t}`))
  door.outage(false)
  check(
    'an unreachable database is a 503 so Telegram retries',
    r.status === 503,
    `http ${String(r.status)}`,
  )
  const again = await door.post(msg(Number(Z), priv(Number(Z)), `/start link_${t}`))
  check(
    'and the retry connects, because nothing was spent',
    again.body.link === 'connected' && (await idOf(Z)) === B,
    JSON.stringify(again.body),
  )
}

// ---- nothing left the machine except what the door would send through the bot
const odd = door.refusedUrls.filter((u) => !/api\.telegram\.org\/bot[^/]+\/sendMessage/.test(u))
check('the only outbound calls were replies through the bot', odd.length === 0, JSON.stringify(odd))

const failed = results.filter((r) => !r.ok).length
console.log(
  failed === 0
    ? '\nTELEGRAM-LINK (isolated): PASS'
    : `\nTELEGRAM-LINK (isolated): ${failed} FAILED`,
)
await db.end()
process.exitCode = failed === 0 ? 0 : 1
