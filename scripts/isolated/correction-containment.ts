/**
 * #378 sibling — the 👎 follow-up question, through the delivery guard.
 *
 *   npx tsx scripts/isolated/correction-containment.ts <replica-db>
 *
 * The REAL `processCallbacks` against the isolated replica. The only stand-in
 * is the network: `fetch` answers api.telegram.org like Telegram does and
 * refuses every other host, so nothing leaves this process.
 *
 * The follow-up ("What should I have done instead?") was a bare sendMessage to
 * whatever chat the press row named. Three presses on Grant's real chat id:
 * one on a message a harness job sent, one on a message we cannot trace, and
 * the control, one on a message a real job sent.
 */
import { processCallbacks } from '../../src/channels/callbacks.ts'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'corr378')
const run = Date.now().toString(36)
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const results: { what: string; ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ what, ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} — ${detail}`)
}

const sent: { method: string; chat: string; reply: unknown; text: string }[] = []
let messageId = 9000
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input)
  if (!url.startsWith('https://api.telegram.org/')) throw new Error(`REFUSED: ${url}`)
  const method = url.split('/').pop() ?? ''
  const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
  sent.push({
    method,
    chat: String(body.chat_id ?? ''),
    reply: body.reply_parameters ?? body.reply_to_message_id,
    text: String(body.text ?? ''),
  })
  messageId += 1
  return new Response(JSON.stringify({ ok: true, result: { message_id: messageId } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}) as typeof fetch

const CHAT = '1386648496'
let BOT = '9000000378'
const secret = await one(
  `insert into vault.secrets (name, secret) values ('isolated.telegram.${run}', 'isolated-fake-telegram-token') returning id::text as id`,
)
await db.execute(`insert into public.telegram_bots (bot_id, username, staff_slug, token_ref)
  values (${lit(BOT)}, 'isolated_bot', 'chief-of-staff', ${lit(String(secret.id))}) on conflict do nothing`)
/*
  The chief already owns a bot row on a faithful replica (one bot per person), so
  the insert above does nothing there and the turn's key names a bot that does
  not exist. Use the row that is really there.
*/
BOT = String(
  (await one(`select bot_id from public.telegram_bots where staff_slug = 'chief-of-staff' limit 1`))
    .bot_id,
)
await db.execute(`insert into public.telegram_chats (office_id, chat_id, chat_type, bot_id)
  values (app.operator_office(), ${lit(CHAT)}, 'private', ${lit(BOT)}) on conflict do nothing`)

const turn = async (channel: string, key: string, ref: string): Promise<string> => {
  const cmd = await one(`
    set local application_name = 'PostgREST 14.5';
    insert into public.inbound_commands (office_id, project_id, origin_channel, origin_ref, actor, instruction, dedupe_key, subject)
    values (app.operator_office(), app.unnamed_project(app.operator_office()), ${lit(channel)}, ${lit(ref)}, 'grant', ${lit(`Correction proof ${run}`)}, ${lit(key)}, 'grant')
    returning command_id::text as id`)
  const enq = await one(`select app.enqueue_inbound(${lit(String(cmd.id))}::uuid) as v`)
  return String(
    ((typeof enq.v === 'string' ? JSON.parse(enq.v) : enq.v) as { job_id: string }).job_id,
  )
}
const harness = await turn('voice', `voice:turn:verify-378c-${run}.1`, `verify-378c-${run}/x:1`)
const real = await turn(
  'telegram',
  `telegram:message:${BOT}:${CHAT}:${String(Date.now() % 100000)}`,
  `${CHAT}:1`,
)

/* A message each job sent earlier, recorded the way the delivery layer records one. */
const message = async (job: string, ref: string) =>
  db.execute(`insert into public.deliveries (channel, dedupe_key, account_ref, target_ref, job_id, purpose, state, message_ref, sent_at, lease_expires_at)
    values ('telegram', ${lit(`earlier:${ref}:${run}`)}, ${lit(BOT)}, ${lit(CHAT)}, ${lit(job)}::uuid, 'result', 'sent', ${lit(ref)}, app.now_utc(), app.now_utc())`)
await message(harness, '501')
await message(real, '502')

const press = async (ref: string) =>
  one(`
    set local application_name = 'PostgREST 14.5';
    insert into public.inbound_commands (origin_channel, origin_ref, actor, instruction, dedupe_key, subject, callback_action)
    values ('telegram', ${lit(`${CHAT}:${ref}`)}, ${lit(CHAT)}, '', ${lit(`telegram:callback:${run}${ref}:${CHAT}`)}, 'grant', 'not_useful')
    returning command_id::text as id`)
const pHarness = String((await press('501')).id)
const pUnknown = String((await press('503')).id)
const pReal = String((await press('502')).id)

const done = await processCallbacks(db)
check(
  'precondition: all three presses were processed',
  done.length >= 3,
  `${String(done.length)} processed`,
)

const asked = (ref: string) =>
  sent.filter(
    (s) =>
      s.method === 'sendMessage' &&
      s.chat === CHAT &&
      s.text.startsWith('What should I have done') &&
      JSON.stringify(s.reply ?? '').includes(ref),
  ).length
const row = async (id: string) =>
  ((
    await db.execute(
      `select state::text as s, coalesce(job_id::text, '') as j from public.deliveries where dedupe_key = ${lit(`correction:${id}`)}`,
    )
  ).rows[0] as { s?: string; j?: string } | undefined) ?? {}

const h = await row(pHarness)
check(
  "a 👎 on a harness job's message does not make the office speak",
  asked('501') === 0 && h.s !== 'sent',
  `sendMessage calls ${String(asked('501'))}, delivery ${String(h.s ?? 'none')}`,
)
check('and the attempt names that job', h.j === harness, `job_id ${String(h.j ?? 'none')}`)
const u = await row(pUnknown)
check(
  'a 👎 on a message nothing can trace does not make the office speak (fails closed)',
  asked('503') === 0 && u.s !== 'sent',
  `sendMessage calls ${String(asked('503'))}, delivery ${String(u.s ?? 'none')}`,
)
const r = await row(pReal)
check(
  "control: a 👎 on a real job's message asks what should have happened",
  asked('502') === 1 && r.s === 'sent' && r.j === real,
  `sendMessage calls ${String(asked('502'))}, delivery ${String(r.s ?? 'none')}, job ${String(r.j ?? 'none')}`,
)

const failed = results.filter((x) => !x.ok).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
await db.end()
process.exit(failed === 0 ? 0 : 1)
