/**
 * A backup model's answer is admitted on evidence, and a backup-served turn may not act on its own (#444).
 *
 *   npx tsx scripts/isolated/fallback-turns.ts <replica-db>
 *
 * The REAL Telegram webhook, worker, handlers, router (over the replica's own measured model order), delivery layer and policy.
 * STAND-INS: the providers (a scripted fetch that refuses, or answers with the sentences a real fallback model produced on 8
 * October) and Telegram's API (recorded). What a real model does is `real-model-acceptance.ts`, never claimed here.
 *
 * The sentences scripted for the backup models are the REAL off-target answers from the real-model run, so this proves the
 * mechanism catches what was observed; the unit tests (`tests/agents/fallback-policy.test.ts`) hold their neighbours.
 */
import { mayAct } from '../../src/agents/approval.ts'
import { combinedNotifier } from '../../src/channels/notify.ts'
import { replyChannel } from '../../src/channels/reply.ts'
import { extractTasksHandler } from '../../src/handlers/extract-tasks.ts'
import { instructionHandler } from '../../src/handlers/instruction.ts'
import { pursueHandler } from '../../src/handlers/pursue.ts'
import { synthesiseHandler } from '../../src/handlers/synthesise.ts'
import { drain, type Handler, type Reviewer } from '../../src/jobs/worker.ts'
import { ProviderRouter } from '../../src/providers/router.ts'
import { startEdge } from './edge-emulator.ts'
import { isolated } from './guard.ts'
import { BOT, CHAT, registerBot } from './real-telegram.ts'
import { startTelegramDoor } from './telegram-door.ts'

const dbName = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'fb_x'
const db = await isolated(dbName)
const run = Date.now().toString(36)
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
type Row = Record<string, unknown>
const rows = async (sql: string): Promise<Row[]> => (await db.execute(sql)).rows as Row[]
const one = async (sql: string): Promise<Row> => (await rows(sql))[0] as Row
const count = async (sql: string): Promise<number> => Number((await one(sql)).n)
const n = (): number => Math.floor(Math.random() * 9_000_000) + 1_000_000

let total = 0
let failed = 0
let section = '-'
const check = (what: string, ok: boolean, detail = ''): boolean => {
  total += 1
  if (!ok) failed += 1
  console.log(
    `${ok ? 'PROVEN' : 'FAILED'} ${section}: ${what}${detail === '' ? '' : ` - ${detail}`}`,
  )
  return ok
}
const part = (id: string, title: string): void => {
  section = id
  console.log(`\n=== ${id}: ${title}`)
}

// ---- the providers: the replica's measured order, scripted per model ---------------------------------------------------------
const ORDER = (await rows(`select model_id from app.model_order('(unattributed)')`)).map((r) =>
  String(r.model_id),
)
const [FIRST, SECOND, THIRD] = ORDER as [string, string, string]
type Behaviour = 'refuse' | 'good' | 'offtarget' | 'inference' | 'narration' | 'unavailable'
const script: Record<string, Behaviour> = {}
const GOOD =
  'The deposit is £2,000, due on 1 November. That is the figure in the Riverside venue contract [1].'
const BAD: Record<string, string> = {
  offtarget:
    "I can't schedule the payment reminder yet. To proceed, I need the insurance certificate. Once you have it, please let me know, and I will add the reminder.",
  inference:
    'The deposit is 2000 pounds, due on 1 November. [1]\n\nI have nothing on it here, but I infer the contract is not signed yet, because the insurance certificate is still outstanding.',
  narration:
    "I'm skipping the team review. The deposit is two thousand pounds and due 1 November, per the contract [1]. I'm not convening anyone because simple fact-checking isn't a meeting.",
}
const calls: { model: string; role: string }[] = []
const roleOf = (system: string): string => {
  if (system.includes('You rewrite one sentence so it stands alone')) return 'resolve'
  if (system.includes('You read one message from')) return 'understand'
  if (system.includes('THE ONLY CAPABILITIES')) return 'plan'
  if (system.includes('You are writing up what colleagues found')) return 'draft'
  if (system.startsWith('Several colleagues looked at different parts of one question'))
    return 'synth'
  if (system.startsWith('You decide whether a new request is asking for work that is ALREADY'))
    return 'already'
  if (system.startsWith('You find the things that need DOING')) return 'extract'
  if (/^You are \w+, .* on a small team\./.test(system)) return 'answer'
  return 'other'
}
const scriptedFetch = (async (_url: string, init: { body: string }): Promise<Response> => {
  const body = JSON.parse(init.body) as {
    model: string
    messages: { role: string; content: string }[]
  }
  const system = body.messages.find((m) => m.role === 'system')?.content ?? ''
  const role = roleOf(system)
  calls.push({ model: body.model, role })
  const how: Behaviour = script[body.model] ?? 'good'
  if (how === 'unavailable')
    return new Response(JSON.stringify({ error: { message: 'unavailable' } }), { status: 503 })
  if (role === 'answer' && how === 'refuse')
    return new Response(JSON.stringify({ error: { message: 'refused' } }), { status: 503 })
  const reply =
    role === 'answer'
      ? how === 'good'
        ? GOOD
        : (BAD[how] ?? GOOD)
      : role === 'already'
        ? 'NONE'
        : role === 'other'
          ? 'none'
          : '{}'
  return new Response(
    JSON.stringify({
      model: body.model,
      choices: [{ message: { content: reply } }],
      usage: { cost: 0, prompt_tokens: 11, completion_tokens: 7 },
    }),
    { status: 200 },
  )
}) as unknown as typeof fetch

// ---- the world ----------------------------------------------------------------------------------------------------------------
await registerBot(db)
const op = String((await one(`select app.operator_office()::text as o`)).o)
const tgDoor = await startTelegramDoor(db, BOT)
const S_GRANT = `aaa.bbb.${'g'.repeat(70)}`
const gw = await startEdge({
  db,
  edgeFile: 'supabase/functions/hq-api/index.ts',
  env: {
    HQ_API_TOKEN: 'isolated-hq-token',
    SUPABASE_SERVICE_ROLE_KEY: 'isolated-service-key',
    SUPABASE_ANON_KEY: 'isolated-anon',
    SIGNIN_ALLOWED_ORIGIN: 'https://page.invalid',
  },
  authUsers: { [S_GRANT]: 'grant.e.rogers@gmail.com' },
})
interface TgCall {
  chat: string
  text: string
}
const tgCalls: TgCall[] = []
const edgeFetch = globalThis.fetch
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input)
  const m = /^https:\/\/api\.telegram\.org\/bot([^/]+)\/(\w+)/.exec(url)
  if (m === null) return edgeFetch(input, init)
  const payload = JSON.parse(String(init?.body ?? '{}')) as {
    chat_id?: string | number
    text?: string
  }
  if (m[2] === 'sendMessage')
    tgCalls.push({ chat: String(payload.chat_id ?? ''), text: String(payload.text ?? '') })
  return new Response(JSON.stringify({ ok: true, result: { message_id: 7000 + tgCalls.length } }), {
    status: 200,
  })
}) as typeof fetch

const router = new ProviderRouter(db, 'k', scriptedFetch, 4, { requestTimeoutMs: 5_000 })
const review: Reviewer = async () => ({ status: 'approved', notes: 'fallback-turns' })
const handlers: Handler[] = [
  instructionHandler({ db, router }),
  pursueHandler({ db, router }),
  synthesiseHandler({ db, router }),
  extractTasksHandler({ db, router }),
]
const notify = combinedNotifier([replyChannel(db)], db)
let tickNo = 0
const tick = async () =>
  drain(db, `fb-${run}-${String(++tickNo)}`, handlers, review, 25, {
    notify,
    canTranscribe: false,
    canSubprocess: false,
  })
const LIVE = `('queued','running','retrying','committing','committed','notifying','output_created','quality_review','waiting_external')`
const corr = (root: string): string =>
  `(select correlation_id from public.jobs where job_id = ${lit(root)}::uuid)`
const settle = async (root: string, maxTicks = 12): Promise<void> => {
  for (let i = 1; i <= maxTicks; i += 1) {
    await db.execute(`delete from public.provider_health`)
    await db.execute(
      `update public.jobs set not_before = app.now_utc() - interval '1 second'
        where correlation_id = ${corr(root)} and state in ('retrying', 'queued')`,
    )
    const done = await tick()
    const live = await count(
      `select count(*)::int as n from public.jobs where correlation_id = ${corr(root)} and state in ${LIVE}`,
    )
    if (done.length === 0 && live === 0) return
  }
}
const quiet = async (): Promise<void> => {
  await db.execute(
    `update public.jobs set state = 'cancelled' where state in ('paused','queued','retrying','running') and office_id = ${lit(op)}::uuid`,
  )
  await db.execute(`delete from public.provider_health`)
  for (const k of Object.keys(script)) delete script[k]
  calls.length = 0
}
const mk = (await one(
  `select app.hq_create_project(${lit(op)}::uuid, ${lit(`Fallback ${run}`)}, 'upload', ${lit(`fb-${run}`)}, ${lit(`Fallback ${run}`)}, true) as v`,
)) as { v: unknown }
const projectId = ((typeof mk.v === 'string' ? JSON.parse(mk.v) : mk.v) as { project_id: string })
  .project_id
{
  const text =
    'Riverside venue contract. The deposit of 2000 pounds is due on 1 November. The cancellation fee is 100 percent of the booking with no cap. The insurance certificate is still outstanding. The venue holds 120 people and the hire is 4500 pounds for the day.'
  const r = await gw.call(
    new Request('https://gw.invalid/functions/v1/hq-api', {
      method: 'POST',
      headers: { Authorization: `Bearer ${S_GRANT}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'document_upload',
        args: {
          p_project_id: projectId,
          p_name: 'venue-contract.txt',
          p_mime: 'text/plain',
          p_base64: Buffer.from(text).toString('base64'),
        },
      }),
    }),
  )
  if (r.status !== 200) throw new Error(`document not uploaded (${String(r.status)})`)
}
const scopeChat = async (): Promise<void> => {
  await db.execute(
    `insert into public.project_switches (office_id, scope_kind, scope_ref, project_id, switched_by, reason)
     values (${lit(op)}::uuid, 'telegram_chat', ${lit(CHAT)}, ${lit(projectId)}::uuid, 'grant', 'fallback scope')`,
  )
}
const say = async (text: string): Promise<{ job: string; from: number }> => {
  const from = tgCalls.length
  const r = await tgDoor.post({
    update_id: n(),
    message: {
      message_id: n(),
      date: Math.floor(Date.now() / 1000),
      chat: { id: Number(CHAT), type: 'private' },
      from: { id: Number(CHAT) },
      text,
    },
  })
  const job = String(r.body.queued ?? '')
  if (job === '' || job === 'null') throw new Error('the door queued nothing')
  await settle(job)
  return { job, from }
}
const got = (from: number): string[] => tgCalls.slice(from).map((c) => c.text)
const ASK_BASE = 'How much is the deposit for the venue and when is it due?'
let askNo = 0
const ask = (): string => `${ASK_BASE} (${String(++askNo)})`
const outputModel = async (job: string): Promise<string> =>
  String(
    (
      await one(
        `select coalesce(model,'') as m from public.outputs where job_id = ${lit(job)}::uuid order by created_at desc limit 1`,
      )
    ).m,
  )
const traces = async (job: string, kind: string): Promise<Row[]> =>
  rows(
    `select detail from public.job_traces t join public.jobs j on j.job_id = t.job_id
      where j.correlation_id = ${corr(job)} and t.kind = ${lit(kind)}`,
  )

check(
  'the replica has a measured chain of at least three models to script',
  ORDER.length >= 3,
  ORDER.join(' > '),
)

// ============================================================================================================================
part(
  'F1',
  'the first model is refused, the second answers off-target, the third answers properly: the third is what he gets',
)
{
  await quiet()
  await scopeChat()
  script[FIRST] = 'refuse'
  script[SECOND] = 'offtarget'
  script[THIRD] = 'good'
  const t = await say(ask())
  const out = got(t.from)
  const refused = await traces(t.job, 'decision')
  check(
    'exactly one message, the proper answer, from the third model; the off-target one never reached him',
    out.length === 1 && /£2,000/.test(out[0] ?? '') && !/schedule the payment/i.test(out[0] ?? ''),
    out.map((o) => o.slice(0, 60)).join(' | '),
  )
  check(
    'the output records the model that actually wrote it',
    (await outputModel(t.job)) === THIRD,
    await outputModel(t.job),
  )
  check(
    'the router recorded that the turn was fallback-served (the authority half reads this)',
    refused.some((r) => JSON.stringify(r.detail).includes('"fallback":true')),
    String(refused.length),
  )
  check(
    'the second opinion cost one further call, to a different model, and no model answered the question twice',
    calls.filter((c) => c.role === 'answer' && c.model === SECOND).length === 1 &&
      calls.filter((c) => c.role === 'answer' && c.model === THIRD).length === 1,
    calls
      .filter((c) => c.role === 'answer')
      .map((c) => c.model.slice(0, 8))
      .join(','),
  )
}

part(
  'F2',
  'every backup answer is off-target: he gets what could not be established and what the turn held, never a fluent guess',
)
{
  await quiet()
  await scopeChat()
  script[FIRST] = 'refuse'
  script[SECOND] = 'inference'
  script[THIRD] = 'narration'
  const t = await say(ask())
  const out = got(t.from)
  const refusal = await traces(t.job, 'degradation')
  check(
    'one message that says it could not get a reliable answer, quotes the contract it held, and states no deposit of its own',
    out.length === 1 &&
      /could not get a reliable answer/.test(out[0] ?? '') &&
      /2000 pounds/.test(out[0] ?? '') &&
      !/I infer|not convening|signed yet/i.test(out[0] ?? ''),
    (out[0] ?? '').slice(0, 90),
  )
  check(
    'the refusal is on the job trace with each model and the reasons, so it is diagnosable',
    refusal.some((r) => JSON.stringify(r.detail).includes('fallback_answer_refused')),
    JSON.stringify(refusal.map((r) => r.detail)).slice(0, 160),
  )
  check(
    'it asked at most two backup models and then stopped (no endless loop)',
    calls.filter((c) => c.role === 'answer' && c.model !== FIRST).length <= 2,
    String(calls.filter((c) => c.role === 'answer').length),
  )
}

part(
  'F3',
  'the controls: a good backup answer is delivered as it is, and the first model is never second-guessed',
)
{
  await quiet()
  await scopeChat()
  script[FIRST] = 'refuse'
  script[SECOND] = 'good'
  const t = await say(ask())
  check(
    'a good first backup answer is delivered unchanged with no second opinion asked',
    got(t.from).length === 1 &&
      got(t.from)[0]?.includes('£2,000') === true &&
      calls.filter((c) => c.role === 'answer' && c.model === THIRD).length === 0,
    `${String(calls.filter((c) => c.role === 'answer').length)} answer call(s)`,
  )
  await quiet()
  await scopeChat()
  script[FIRST] = 'offtarget' // the first model says the off-target thing: the policy is about backups, so it is not this gate's
  const u = await say(ask())
  check(
    'a first-choice model is not subject to the backup gate (its answers go through the existing gates, unchanged)',
    got(u.from).length === 1 &&
      calls.filter((c) => c.role === 'answer' && c.model !== FIRST).length === 0,
    (got(u.from)[0] ?? '').slice(0, 60),
  )
}

part('F4', 'every provider unavailable: no fabricated answer; the person is told, once')
{
  await quiet()
  await scopeChat()
  for (const m of ORDER) script[m] = 'unavailable'
  const t = await say(ask())
  const out = got(t.from)
  check(
    'at most one message reached him and it states no deposit figure',
    out.length <= 1 && out.every((o) => !/£2,000|2000 pounds/.test(o)),
    out.map((o) => o.slice(0, 70)).join(' | ') || '(none)',
  )
  check(
    'the job did not complete with a made-up answer',
    (await count(
      `select count(*)::int as n from public.outputs o join public.jobs j on j.job_id = o.job_id where j.correlation_id = ${corr(t.job)} and o.body ~* '2,?000'`,
    )) === 0,
  )
}

// ============================================================================================================================
part('F5', 'authority: a turn a backup model helped work out asks before it changes anything')
{
  await quiet()
  const p = String(
    (
      await one(
        `select (app.hq_create_project(${lit(op)}::uuid, ${lit(`Fallback act ${run}`)}, 'upload', ${lit(`fba-${run}`)}, ${lit(`Fallback act ${run}`)}, true)::jsonb ->> 'project_id') as id`,
      )
    ).id,
  )
  await db.execute(
    `insert into public.autonomy_settings (office_id, project_id, level, set_by, reason) values (${lit(op)}::uuid, ${lit(p)}::uuid, 'act', 'grant', 'fallback proof')`,
  )
  const holder = String((await one(`select slug from public.staff order by slug limit 1`)).slug)
  await db.execute(
    `insert into public.staff_tools (office_id, staff_slug, tool) values (${lit(op)}::uuid, ${lit(holder)}, 'task.create') on conflict do nothing`,
  )
  const newJob = async (): Promise<string> =>
    String(
      (
        await one(`insert into public.jobs (office_id, kind, requested_by, project_id, idempotency_key, correlation_id)
          values (${lit(op)}::uuid, 'office.instruction', 'verify:fallback-${run}', ${lit(p)}::uuid, 'fb-' || gen_random_uuid(), gen_random_uuid())
          returning job_id::text as id`)
      ).id,
    )
  const control = await newJob()
  const degraded = await newJob()
  await db.execute(
    `select app.job_trace_add(${lit(op)}::uuid, ${lit(degraded)}::uuid, 'decision', '{"chose":"m","because":"","fallback":true,"rank":1}'::jsonb, null, null, null, null)`,
  )
  const a = await mayAct(db as never, {
    projectId: p,
    tool: 'task.create',
    staff: holder,
    job: control,
  })
  const b = await mayAct(db as never, {
    projectId: p,
    tool: 'task.create',
    staff: holder,
    job: degraded,
  })
  const c = await mayAct(db as never, { projectId: p, tool: 'db.read', job: degraded })
  const d = await mayAct(db as never, {
    projectId: p,
    tool: 'gmail.send',
    staff: holder,
    job: degraded,
  })
  check(
    'a write the dial allows PROCEEDS when the first model served the turn (the control)',
    a.verdict === 'proceed',
    `${a.verdict} ${String(a.reason)}`,
  )
  check(
    'the same write ASKS when a backup model served any call in the turn, saying why',
    b.verdict === 'ask' && b.reason === 'fallback_model' && /backup model/.test(b.because),
    `${b.verdict} ${String(b.reason)}`,
  )
  check(
    'a read still proceeds on a backup-served turn (it degrades gracefully, it does not stop working)',
    c.verdict === 'proceed',
    c.verdict,
  )
  check(
    'a refusal stays a refusal (the downgrade never softens a stronger answer)',
    d.verdict === 'refuse',
    d.verdict,
  )
}

await quiet()
console.log(`\n${String(total - failed)}/${String(total)} checks PROVEN, ${String(failed)} FAILED`)
process.exit(failed === 0 ? 0 : 1)
