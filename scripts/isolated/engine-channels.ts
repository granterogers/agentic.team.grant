// biome-ignore-all lint/suspicious/noExplicitAny: SQL results and HTTP bodies are untyped
// biome-ignore-all format: a dense proof script kept readable as written
/**
 * Choosing Hermes from Telegram and Slack, through the REAL doors, on the isolated replica (Hermes, M9).
 *
 *   bash scripts/isolated/replica.sh && npx tsx scripts/isolated/engine-channels.ts <replica-db>
 *
 * REAL: the Telegram webhook and the Slack events function (run in Node by edge-emulator.ts, every non-replica URL refused and recorded),
 * the adapters they import, the signed Slack request, the sender checks, and the database. NOTHING calls a model, Hermes, Telegram or
 * Slack, and no worker runs: every assertion reads the stored command (inbound_commands) and the job the door enqueued.
 *
 *   A. a typed `/hermes ` (Telegram) and `hermes:` (Slack) from the person records engine hermes and stores the instruction WITHOUT the prefix
 *   B. everything else is the team and is stored untouched: no prefix, a prefix in the middle, a prefix with nothing after it, another word
 *   C. forwarded and shared text never selects an engine, and the prefix is then part of what is stored
 *   D. the engine is the column the office reads: the job's own command says hermes (the worker's seam asks the column, never the text)
 *   E. a stranger's prefixed message is still refused by the sender checks before any engine is read (positive control: the same text from the person is stored)
 */
import { computeSignature } from '../../src/slack/signature.ts'
import { startEdge } from './edge-emulator.ts'
import { isolated } from './guard.ts'
import { BOT, CHAT, registerBot } from './real-telegram.ts'
import { startTelegramDoor } from './telegram-door.ts'

const DB = process.argv[2] ?? 'post'
const db = await isolated(DB)
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const run = Date.now().toString(36)
const results: boolean[] = []
const check = (what: string, ok: boolean, detail = ''): void => {
  results.push(ok)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail === '' ? '' : ` - ${detail}`}`)
}
const q = async (sql: string): Promise<Record<string, any>[]> => (await db.execute(sql)).rows as Record<string, any>[]
const one = async (sql: string): Promise<Record<string, any>> => (await q(sql))[0] ?? {}
const json = (v: unknown): any => (typeof v === 'string' ? JSON.parse(v) : v)

await registerBot(db)
const op = String((await one('select app.operator_office()::text o')).o)
const project = String(json((await one(`select app.hq_create_project(${lit(op)}::uuid, ${lit(`Channels ${run}`)}, 'upload', ${lit(`ec-${run}`)}, ${lit(`Channels ${run}`)}, true) as v`)).v).project_id)

const GRANT_SLACK = 'U0ECGRANT01'
const STRANGER_SLACK = 'U0ECSTRNGR1'
const TEAM = 'T0ECISOLATD'
const CHANNEL = `C0EC${run.toUpperCase().slice(0, 6)}`
const SECRET = 'isolated-slack-signing-secret'
await q(`insert into public.subject_identities (office_id, subject, origin_channel, actor, note) values (${lit(op)}::uuid, 'grant', 'slack', ${lit(GRANT_SLACK)}, 'ec') on conflict do nothing`)
await q(`insert into public.slack_app_credentials (office_id, slack_app_id, team_id, app_name) values (${lit(op)}::uuid, 'A0ECISOL01', ${lit(TEAM)}, 'ec') on conflict do nothing`)
await q(`insert into public.slack_workspaces (team_id, team_name, bot_user_id, office_id) values (${lit(TEAM)}, 'ec', 'U0BOTEC', ${lit(op)}::uuid) on conflict do nothing`)
await q(`insert into public.slack_channel_map (channel_id, team_id, project_id, channel_name, active) values (${lit(CHANNEL)}, ${lit(TEAM)}, ${lit(project)}::uuid, 'ec-channels', true) on conflict do nothing`)

const tgDoor = await startTelegramDoor(db, BOT)
const slackEdge = await startEdge({
  db,
  edgeFile: 'supabase/functions/slack-events/index.ts',
  beside: [
    ['src/slack/events.ts', 'events.ts'],
    ['src/slack/interactions.ts', 'interactions.ts'],
    ['src/slack/signature.ts', 'signature.ts'],
  ],
  env: { SLACK_SIGNING_SECRET: SECRET, SLACK_BOT_USER_ID: 'U0BOTEC', SUPABASE_SERVICE_ROLE_KEY: 'isolated-service-key' },
})

let n = Math.floor(Math.random() * 1_000_000) + 1_000_000
const tg = async (text: string, extra: Record<string, unknown> = {}, chat: string = CHAT): Promise<{ status: number; body: any }> => {
  n += 1
  return tgDoor.post({ update_id: n, message: { message_id: n, date: Math.floor(Date.now() / 1000), chat: { id: Number(chat), type: 'private' }, from: { id: Number(chat) }, text, ...extra } })
}
const sl = async (text: string, extra: Record<string, unknown> = {}, user: string = GRANT_SLACK): Promise<number> => {
  n += 1
  const raw = JSON.stringify({ type: 'event_callback', team_id: TEAM, event_id: `Ev${run}${String(n)}`, event: { type: 'message', channel: CHANNEL, channel_type: 'channel', user, text, ts: `17${String(Date.now()).slice(-8)}.${String(n).slice(0, 6)}`, ...extra } })
  const ts = String(Math.floor(Date.now() / 1000) - 5)
  const r = await slackEdge.call(new Request('https://door.invalid/functions/v1/slack-events', { method: 'POST', headers: { 'X-Slack-Signature': await computeSignature(SECRET, ts, raw), 'X-Slack-Request-Timestamp': ts, 'Content-Type': 'application/json' }, body: raw }))
  return r.status
}
const stored = async (like: string): Promise<any[]> => {
  for (let i = 0; i < 15; i += 1) {
    const r = await q(`select command_id::text id, engine, instruction, job_id::text job, origin_channel from public.inbound_commands where instruction like ${lit(`%${like}%`)} and office_id = ${lit(op)}::uuid order by received_at`)
    if (r.length > 0) return r
    await new Promise((ok) => setTimeout(ok, 300))
  }
  return []
}
const absent = async (like: string): Promise<number> => Number((await one(`select count(*)::int n from public.inbound_commands where instruction like ${lit(`%${like}%`)}`)).n)

// ---- A. the prefix selects, and is removed ---------------------------------------------------------------------------------------
const tA = `venue deposit ${run} tgA`
await tg(`/hermes ${tA}`)
const rA = (await stored(tA))[0]
check('A1 Telegram: /hermes records engine hermes and stores the instruction without the prefix', rA?.engine === 'hermes' && rA?.instruction === tA, JSON.stringify(rA))
const tA2 = `venue deposit ${run} tgA2`
await tg(`/hermes@isolated_chief_bot ${tA2}`)
const rA2 = (await stored(tA2))[0]
check('A2 Telegram: the group form /hermes@bot works the same way', rA2?.engine === 'hermes' && rA2?.instruction === tA2, JSON.stringify(rA2))
const sA = `venue deposit ${run} slA`
const slStatus = await sl(`hermes: ${sA}`)
const rSA = (await stored(sA))[0]
check('A3 Slack: hermes: records engine hermes and stores the instruction without the prefix', slStatus === 200 && rSA?.engine === 'hermes' && rSA?.instruction === sA, `${slStatus} ${JSON.stringify(rSA)}`)
const sA2 = `venue deposit ${run} slA2`
await sl(`<@U0BOTEC> hermes: ${sA2}`)
const rSA2 = (await stored(sA2))[0]
check('A4 Slack: after the leading mention (addressing) hermes: still selects', rSA2?.engine === 'hermes' && rSA2?.instruction === sA2, JSON.stringify(rSA2))

// ---- B. everything else is the team and is untouched -------------------------------------------------------------------------------
for (const [label, build, via] of [
  ['no prefix', (t: string) => t, 'both'],
  ['the word in the middle', (t: string) => `please ask hermes: ${t}`, 'slack'],
  ['a slash command in the middle', (t: string) => `please /hermes ${t}`, 'tg'],
  ['the other channel\'s prefix', (t: string) => `hermes: ${t}`, 'tg'],
  ['the other channel\'s prefix', (t: string) => `/hermes ${t}`, 'slack'],
] as const) {
  const text = build(`venue deposit ${run} B ${label.replace(/\W/g, '')} ${via}`)
  if (via === 'both' || via === 'tg') { await tg(text); const r = (await stored(text))[0]; check(`B Telegram: ${label} is the team and the text is stored untouched`, r?.engine === 'team' && r?.instruction === text, JSON.stringify(r)) }
  if (via === 'both' || via === 'slack') { await sl(text); const r = (await stored(text)).find((x) => x.origin_channel === 'slack'); check(`B Slack: ${label} is the team and the text is stored untouched`, r?.engine === 'team' && r?.instruction === text, JSON.stringify(r)) }
}
const bare = `/hermes`
await tg(bare)
const bareRow = (await q(`select engine, instruction from public.inbound_commands where instruction = ${lit(bare)} and office_id = ${lit(op)}::uuid`))[0]
check('B Telegram: a prefix with nothing after it asks nothing of anybody, so it is the team\'s and is left as the person wrote it', bareRow?.engine === 'team' && bareRow?.instruction === bare, JSON.stringify(bareRow))

// ---- C. forwarded and shared text never selects ----------------------------------------------------------------------------------------
const fT = `venue deposit ${run} fwdtg`
await tg(`/hermes ${fT}`, { forward_origin: { type: 'user', date: 1 } })
const rF = (await stored(fT))[0]
check('C1 Telegram: a forwarded "/hermes ..." is the team\'s and the prefix stays in what is stored', rF?.engine === 'team' && rF?.instruction === `/hermes ${fT}`, JSON.stringify(rF))
const fS = `venue deposit ${run} fwdsl`
await sl(`hermes: ${fS}`, { attachments: [{ is_share: true }] })
const rFS = (await stored(fS))[0]
check('C2 Slack: a shared "hermes: ..." is the team\'s and the prefix stays in what is stored', rFS?.engine === 'team' && rFS?.instruction === `hermes: ${fS}`, JSON.stringify(rFS))

// ---- D. the job is the column's ---------------------------------------------------------------------------------------------------
const jobs = await q(`select j.job_id::text id, c.engine, c.instruction from public.jobs j join public.inbound_commands c on c.job_id = j.job_id where c.command_id in (${lit(rA?.id ?? '')}::uuid, ${lit(rSA?.id ?? '')}::uuid)`)
check('D1 the door enqueued a job for each Hermes message, and its own command says hermes (the seam asks the column, never the text)', jobs.length === 2 && jobs.every((j) => j.engine === 'hermes'), JSON.stringify(jobs))
const hermesInText = Number((await one(`select count(*)::int n from public.inbound_commands where office_id = ${lit(op)}::uuid and engine = 'hermes' and instruction ~* '^\\s*(/hermes|hermes\\s*:)'`)).n)
check('D2 no command that selected Hermes still carries the prefix in its instruction', hermesInText === 0, String(hermesInText))

// ---- E. a stranger is refused before any engine is read ---------------------------------------------------------------------------------------
const eT = `venue deposit ${run} stranger`
const strangerTg = await tg(`/hermes ${eT}`, {}, '999000111')
const strangerSl = await sl(`hermes: ${eT} slack`, {}, STRANGER_SLACK)
await new Promise((ok) => setTimeout(ok, 800))
check('E1 a stranger\'s prefixed message on Telegram stores nothing as the person\'s', (await absent(eT)) === 0 || (await q(`select engine from public.inbound_commands where instruction like ${lit(`%${eT}%`)}`)).every((r) => r.engine === 'team'), `${strangerTg.status} ${JSON.stringify(strangerTg.body).slice(0, 120)}`)
const strangerRows = await q(`select engine, instruction from public.inbound_commands where instruction like ${lit(`%${eT}%`)}`)
check('E2 a stranger\'s prefixed message on Slack never reaches Hermes either (positive control: the same prefix from the person was stored above)', strangerRows.every((r) => r.engine !== 'hermes') && strangerSl >= 200, `${strangerSl} ${JSON.stringify(strangerRows)}`)
check('E3 the doors reached nothing but the replica', tgDoor.refusedUrls.length === 0 && slackEdge.refusedUrls.length === 0, `${tgDoor.refusedUrls.join(',')} ${slackEdge.refusedUrls.join(',')}`)

const failed = results.filter((r) => !r).length
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed === 0 ? 0 : 1)
