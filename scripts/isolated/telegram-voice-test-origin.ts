/**
 * A declared test origin never makes the webhook reach a provider (final audit, review finding B2).
 *
 *   npx tsx scripts/isolated/telegram-voice-test-origin.ts <replica-db>
 *
 * The real `telegram-webhook` handler runs in Node against the replica; the emulator REFUSES and RECORDS every
 * URL that is not the replica, so "it tried to reach api.telegram.org or api.github.com" is an observation, not a
 * reading of the source. A voice note from a declared test conversation must queue like any turn and then do
 * NOTHING outside: no refusal reply through the bot, no runner dispatch that spends Actions minutes. The same note
 * from Grant is the positive control - it DOES try both, under each configuration - so a detector that could not
 * see an outbound call cannot pass this.
 */
import { testOrigins } from '../verify/lib/test-origin.ts'
import { isolated } from './guard.ts'
import { startTelegramDoor } from './telegram-door.ts'

const db = await isolated(process.argv[2] ?? 'tvo')
const run = Date.now().toString(36)
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const results: { ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}
const GRANT = '1386648496'
const BOT = '8967954396'
const n = () => Math.floor(Math.random() * 9_000_000) + 1_000_000
if (
  Number(
    (await one(`select count(*)::int as c from public.telegram_bots where bot_id = ${lit(BOT)}`)).c,
  ) === 0
) {
  const secret = await one(
    `insert into vault.secrets (name, secret) values (${lit(`isolated.tvo.${run}`)}, 'isolated-fake-telegram-token') returning id::text as id`,
  )
  await db.execute(`insert into public.telegram_bots (bot_id, username, staff_slug, is_pager, token_ref)
    values (${lit(BOT)}, 'isolated_chief_bot', 'chief-of-staff', true, ${lit(String(secret.id))})`)
}
// A dispatch token must exist for the dispatch path to be reachable at all.
await db.execute(`delete from vault.secrets where name = 'github.dispatch_token'`)
await db.execute(
  `insert into vault.secrets (name, secret) values ('github.dispatch_token', 'isolated-fake-dispatch-token')`,
)
const door = await startTelegramDoor(db, BOT)
const origins = await testOrigins(db, 'isolated:tvo')

const voice = (actor: string, chat: string) => ({
  update_id: n(),
  message: {
    message_id: n(),
    date: Math.floor(Date.now() / 1000),
    voice: { file_id: `file-${run}-${n()}`, duration: 7 },
    chat: { id: Number(chat), type: 'private' },
    from: { id: Number(actor) },
  },
})
const outbound = (from: number) =>
  door.refusedUrls.slice(from).filter((u) => /api\.telegram\.org|api\.github\.com/.test(u))
const setTranscription = (v: string) =>
  db.execute(
    `update public.system_config set value = ${lit(JSON.stringify(v))}::jsonb where key = 'voice.transcription'`,
  )

for (const mode of ['none', 'api']) {
  await setTranscription(mode)
  const want = mode === 'none' ? /api\.telegram\.org/ : /api\.github\.com/
  const label = mode === 'none' ? 'the refusal reply through the bot' : 'the runner dispatch'

  let mark = door.refusedUrls.length
  const real = await door.post(voice(GRANT, GRANT))
  const realOut = outbound(mark)
  check(
    `control (${mode}): Grant's own voice note queues and DOES reach for ${label}`,
    real.status === 200 && realOut.some((u) => want.test(u)),
    `http ${String(real.status)} outbound ${JSON.stringify(realOut.map((u) => u.slice(0, 40)))}`,
  )

  const chat = origins.telegramChat()
  await origins.declare('telegram', chat)
  mark = door.refusedUrls.length
  const before = Number((await one(`select count(*)::int as c from public.ci_runs`)).c)
  const test = await door.post(voice('4242', chat))
  const out = outbound(mark)
  const after = Number((await one(`select count(*)::int as c from public.ci_runs`)).c)
  const stored = await one(
    `select count(*)::int as c from public.inbound_commands where origin_ref like ${lit(`${chat}:%`)}`,
  )
  check(
    `a declared test origin (${mode}): the note is stored as a turn and ${label} is NOT attempted`,
    test.status === 200 && Number(stored.c) === 1 && out.length === 0,
    `http ${String(test.status)} stored ${String(stored.c)} outbound ${JSON.stringify(out.map((u) => u.slice(0, 40)))}`,
  )
  check(
    `a declared test origin (${mode}): no CI minutes were reserved`,
    after === before,
    `ci_runs ${String(before)} -> ${String(after)}`,
  )
}
await origins.release()
const failed = results.filter((r) => !r.ok).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
await db.end?.()
process.exitCode = failed === 0 ? 0 : 1
