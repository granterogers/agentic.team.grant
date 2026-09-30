/**
 * Run 3 (#386): a copy of every credential goes to Grant's own private chat, and only once.
 *
 *   npx tsx scripts/isolated/vault-export-door.ts <replica-db>
 *
 * The REAL `office.vault_export` handler and the REAL sealing run against the replica. Telegram is a
 * counter: `fetch` to api.telegram.org is answered by a stand-in that records what it was asked to send,
 * so "what left the building" is a number this test reads back. What is asserted about content is only
 * that nothing secret reaches the OUTPUT body, which is stored, shown on a page and posted to Slack.
 */
import { vaultExportHandler } from '../../src/handlers/vault-export.ts'
import type { Job } from '../../src/jobs/worker.ts'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'vaultdoor')
const run = Date.now().toString(36)
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const results: { ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}

const GRANT_CHAT = '1386648496'
const STRANGER_CHAT = '5550009999'
const BOT_NEW = `77${run.replace(/\D/g, '').padEnd(8, '1').slice(0, 8)}`

const sends: { method: string; chat: string }[] = []
let messageOk = true
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input)
  const m = /^https:\/\/api\.telegram\.org\/bot[^/]+\/(\w+)$/.exec(url)
  if (m === null) throw new Error(`REFUSED: only the stand-in Telegram may be reached, not ${url}`)
  let chat = ''
  if (init?.body instanceof FormData) chat = String(init.body.get('chat_id') ?? '')
  else chat = String((JSON.parse(String(init?.body ?? '{}')) as { chat_id?: string }).chat_id ?? '')
  sends.push({ method: String(m[1]), chat })
  const ok = m[1] === 'sendMessage' ? messageOk : true
  return new Response(
    JSON.stringify(ok ? { ok: true } : { ok: false, description: 'chat not found' }),
    {
      status: 200,
      headers: { 'content-type': 'application/json' },
    },
  )
}) as typeof fetch

// The pager bot, and Grant's private chat registered as his.
const secret = await one(
  `insert into vault.secrets (name, secret) values (${lit(`isolated.vd.${run}`)}, 'isolated-fake-token') returning id::text as id`,
)
// The office's pager bot already exists in a replica (as it does in production): point it at the stand-in token.
await db.execute(
  `update public.telegram_bots set is_pager = false where is_pager and staff_slug is distinct from 'chief-of-staff'`,
)
const existing = await one(
  `select bot_id from public.telegram_bots where staff_slug = 'chief-of-staff'`,
)
let BOT = BOT_NEW
if (existing?.bot_id) {
  BOT = String(existing.bot_id)
  await db.execute(`update public.telegram_bots set is_pager = true, enabled = true, token_ref = ${lit(String(secret.id))}::uuid
                     where bot_id = ${lit(BOT)}`)
} else {
  await db.execute(`insert into public.telegram_bots (bot_id, username, staff_slug, is_pager, token_ref)
    values (${lit(BOT)}, 'isolated_vault_bot', 'chief-of-staff', true, ${lit(String(secret.id))})`)
}
await db.execute(`insert into public.subject_identities (subject, origin_channel, actor, note)
  values ('grant', 'telegram', ${lit(GRANT_CHAT)}, 'isolated proof') on conflict do nothing`)
const register = (chat: string, subject: string | null) =>
  db.execute(`insert into public.telegram_chats (chat_id, chat_type, bot_id, subject, last_seen_at)
    values (${lit(chat)}, 'private', ${lit(BOT)}, ${subject === null ? 'null' : lit(subject)}, now())
    on conflict (chat_id, bot_id) do update set subject = excluded.subject, last_seen_at = now()`)
await register(GRANT_CHAT, 'grant')

const handler = vaultExportHandler(db)
const job = async (): Promise<Job> => {
  const p = String((await one(`select app.unnamed_project()::text as p`)).p)
  const r =
    await one(`insert into public.jobs (kind, requested_by, project_id, idempotency_key, correlation_id)
    values ('office.vault_export', 'duty:vault-export', ${lit(p)}::uuid, 'vd-' || gen_random_uuid(), gen_random_uuid())
    returning job_id::text as id, correlation_id::text as cid, idempotency_key as k`)
  return {
    jobId: String(r.id),
    kind: 'office.vault_export',
    correlationId: String(r.cid),
    projectId: p,
    idempotencyKey: String(r.k),
    attempt: 1,
  }
}

// ---- the honest run: one file, one passphrase, to him ------------------------------------------------
{
  const j = await job()
  const out = await handler.handle(j, db)
  check(
    "a copy goes to Grant's own private chat: one file and one passphrase message",
    sends.length === 2 &&
      sends[0]?.method === 'sendDocument' &&
      sends[1]?.method === 'sendMessage' &&
      sends.every((s) => s.chat === GRANT_CHAT),
    JSON.stringify(sends),
  )
  check(
    'the output body says how many credentials and nothing else (it is stored and posted)',
    /Sent you \d+ credential/.test(out.body) &&
      !/openssl|pass:|isolated-fake-token|local-placeholder/i.test(out.body),
    out.body.slice(0, 90),
  )
  const before = sends.length
  const again = await handler.handle(j, db)
  check(
    'a RETRY of the same run sends no second copy',
    sends.length === before && /already been sent/.test(again.body),
    `${String(sends.length - before)} more send(s): ${again.body.slice(0, 60)}`,
  )
}

// ---- the recipient is his own private chat, not merely the newest one under his name -----------------
{
  await register(STRANGER_CHAT, 'grant') // the old defect: somebody else's chat attributed to him, and newer
  const before = sends.length
  const j = await job()
  const out = await handler.handle(j, db)
  check(
    'a newest-registered chat that is NOT his own Telegram id is refused, and nothing is sent',
    sends.length === before && /not his own private chat/.test(out.body),
    `${String(sends.length - before)} send(s): ${out.body.slice(0, 70)}`,
  )
  await db.execute(`delete from public.telegram_chats where chat_id = ${lit(STRANGER_CHAT)}`)
}

// ---- an interrupted send is reconciled, not repeated ---------------------------------------------------
{
  await register(GRANT_CHAT, 'grant')
  const j = await job()
  const before = sends.length
  messageOk = false
  let threw = false
  try {
    await handler.handle(j, db)
  } catch {
    threw = true
  }
  messageOk = true
  const mid = sends.length
  const retry = await handler.handle(j, db)
  const st = await one(
    `select state::text as s from public.jobs where job_id = ${lit(j.jobId)}::uuid`,
  )
  check(
    'the file went and the passphrase did not: the retry parks for a person and does not build a DIFFERENT file',
    threw &&
      mid - before === 2 &&
      sends.length === mid &&
      st.s === 'paused' &&
      /I stopped/.test(retry.body),
    `${String(mid - before)} then ${String(sends.length - mid)} send(s), job ${String(st.s)}`,
  )
}

globalThis.fetch = realFetch
const failed = results.filter((r) => !r.ok).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
await db.end()
process.exitCode = failed === 0 ? 0 : 1
