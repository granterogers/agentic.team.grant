/**
 * The conversation lifecycle of a delegated request, as a durable ordering invariant (#441).
 *
 *   npx tsx scripts/isolated/message-ordering.ts <replica-db>
 *
 * The experience: (1) he sends an instruction; (2) the team starts; (3) he gets a progress note ("I have asked N colleagues
 * ... will come back"); (4) the colleagues work; (5) Claire gives ONE synthesis; (6) nothing stale follows. The defect found
 * with a real model: the lead's own turn can finish AFTER the colleagues and the synthesis, so the hand-off announcement
 * arrived after the result it announces.
 *
 * Real concurrency, not timing assumptions: two `drain` calls run at once against the replica. The first claims the lead and
 * is HELD inside its model call (a latch); the second runs the colleagues and the synthesis. The invariant is read from rows
 * and from what the recorded Telegram transport received, in order:
 *   - the synthesis does not answer while the lead's reply is unsettled (a state, enforced in the handler);
 *   - a lead reply that is still about to be sent after the synthesis reached the same destination is SUPPRESSED by the
 *     database as superseded (migration 1035), never sent;
 *   - one synthesis and one lead reply, however many workers wake, retry or race.
 *
 * Hermetic, on a marked local replica. REAL: telegram-webhook, slack-events and voice edge code, the worker, handlers,
 * delivery layer and database. STAND-INS: the model (real ProviderRouter over a scripted fetch with latches) and Telegram's
 * API (recorded; can be made to refuse). Slack and Team HQ are driven through their real doors and read at the output/job
 * level (no Slack transport is installed); the ordering rule itself is channel-agnostic because it reads job and delivery
 * state.
 */
import { combinedNotifier } from '../../src/channels/notify.ts'
import { replyChannel } from '../../src/channels/reply.ts'
import { extractTasksHandler } from '../../src/handlers/extract-tasks.ts'
import { instructionHandler } from '../../src/handlers/instruction.ts'
import { pursueHandler } from '../../src/handlers/pursue.ts'
import { synthesiseHandler } from '../../src/handlers/synthesise.ts'
import { drain, type Handler, type Reviewer } from '../../src/jobs/worker.ts'
import { ProviderRouter } from '../../src/providers/router.ts'
import { computeSignature } from '../../src/slack/signature.ts'
import { startEdge } from './edge-emulator.ts'
import { isolated } from './guard.ts'
import { BOT, CHAT, registerBot } from './real-telegram.ts'
import { startTelegramDoor } from './telegram-door.ts'

const dbName = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'mo_x'
const db = await isolated(dbName)
const run = Date.now().toString(36)
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
type Row = Record<string, unknown>
const rows = async (sql: string): Promise<Row[]> => (await db.execute(sql)).rows as Row[]
const one = async (sql: string): Promise<Row> => (await rows(sql))[0] as Row
const count = async (sql: string): Promise<number> => Number((await one(sql)).n)
const n = (): number => Math.floor(Math.random() * 9_000_000) + 1_000_000
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

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

// ---- the scripted model, with a latch on the first answer ------------------------------------------------------------------
let gateArmed = false
let gateHit: () => void = () => undefined
let gateHitP: Promise<void> = Promise.resolve()
let gateRelease: () => void = () => undefined
let gateReleaseP: Promise<void> = Promise.resolve()
const armGate = (): void => {
  gateArmed = true
  gateHitP = new Promise((r) => {
    gateHit = r
  })
  gateReleaseP = new Promise((r) => {
    gateRelease = r
  })
}
const roleOf = (system: string): string => {
  if (system.includes('You rewrite one sentence so it stands alone')) return 'resolve'
  if (system.includes('You read one message from')) return 'understand'
  if (
    system.includes('chief of staff of a small office') &&
    system.includes('THE ONLY CAPABILITIES')
  )
    return 'plan'
  if (system.includes('You are writing up what colleagues found')) return 'draft'
  if (system.startsWith('Several colleagues looked at different parts of one question'))
    return 'synth'
  if (system.startsWith('You decide whether a new request is asking for work that is ALREADY'))
    return 'already'
  if (system.startsWith('You find the things that need DOING inside a document')) return 'extract'
  if (/^You are \w+, .* on a small team\./.test(system)) return 'answer'
  return 'other'
}
/** When true the scripted planner returns a real two-step plan, as a real model does for "find X and Y and recommend". */
let planOn = false
const PLAN = JSON.stringify({
  goal: 'a recommendation on the venue',
  steps: [
    { id: 's1', capability: 'notebook.read', why: 'find the notes', needs: [], audience: 'office' },
    {
      id: 's2',
      capability: 'notebook.read',
      why: 'find the budget',
      needs: ['s1'],
      audience: 'office',
    },
  ],
})
const LEAD_FINDING = 'From a risk view the contract has no cap on the cancellation fee.'
const SYNTH =
  'Together they find the deposit is the main exposure. Recommendation: negotiate a cap before paying.'
const scriptedFetch = (async (_url: string, init: { body: string }): Promise<Response> => {
  const body = JSON.parse(init.body) as {
    model: string
    messages: { role: string; content: string }[]
  }
  const system = body.messages.find((m) => m.role === 'system')?.content ?? ''
  const role = roleOf(system)
  if (role === 'answer' && gateArmed) {
    // The FIRST answer call is the lead's (the colleagues are not enqueued to run until she has registered them): hold it.
    gateArmed = false
    gateHit()
    await gateReleaseP
  }
  const reply =
    role === 'already'
      ? 'NONE'
      : role === 'other'
        ? 'none'
        : role === 'synth'
          ? SYNTH
          : role === 'answer'
            ? LEAD_FINDING
            : role === 'plan' && planOn
              ? PLAN
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

// ---- the world ---------------------------------------------------------------------------------------------------------------
await registerBot(db)
const op = String((await one(`select app.operator_office()::text as o`)).o)
const mk = (await one(
  `select app.hq_create_project(${lit(op)}::uuid, ${lit(`Ordering ${run}`)}, 'upload', ${lit(`mo-${run}`)}, ${lit(`Ordering ${run}`)}, true) as v`,
)) as { v: unknown }
const projectId = ((typeof mk.v === 'string' ? JSON.parse(mk.v) : mk.v) as { project_id: string })
  .project_id

const GRANT_SLACK = 'U0MOGRANT01'
const TEAM = 'T0MOISOLATD'
const CHANNEL = `C0MO${run.toUpperCase().slice(0, 6)}`
const SECRET = 'isolated-slack-signing-secret'
const S_GRANT = `aaa.bbb.${'g'.repeat(70)}`
await db.execute(
  `insert into public.subject_identities (office_id, subject, origin_channel, actor, note)
   values (${lit(op)}::uuid, 'grant', 'slack', ${lit(GRANT_SLACK)}, 'mo') on conflict do nothing`,
)
await db.execute(
  `insert into public.slack_app_credentials (office_id, slack_app_id, team_id, app_name)
   values (${lit(op)}::uuid, 'A0MOISOL01', ${lit(TEAM)}, 'mo') on conflict do nothing`,
)
await db.execute(
  `insert into public.slack_workspaces (team_id, team_name, bot_user_id, office_id)
   values (${lit(TEAM)}, 'mo', 'U0BOTMO', ${lit(op)}::uuid) on conflict do nothing`,
)
await db.execute(
  `insert into public.slack_channel_map (channel_id, team_id, project_id, channel_name, active)
   values (${lit(CHANNEL)}, ${lit(TEAM)}, ${lit(projectId)}::uuid, 'mo-ordering', true) on conflict do nothing`,
)
const tgDoor = await startTelegramDoor(db, BOT)
const slackEdge = await startEdge({
  db,
  edgeFile: 'supabase/functions/slack-events/index.ts',
  beside: [
    ['src/slack/events.ts', 'events.ts'],
    ['src/slack/interactions.ts', 'interactions.ts'],
    ['src/slack/signature.ts', 'signature.ts'],
  ],
  env: {
    SLACK_SIGNING_SECRET: SECRET,
    SLACK_BOT_USER_ID: 'U0BOTMO',
    SUPABASE_SERVICE_ROLE_KEY: 'isolated-service-key',
  },
})
const voiceEdge = await startEdge({
  db,
  edgeFile: 'supabase/functions/voice/index.ts',
  env: {
    HQ_API_TOKEN: 'isolated-hq-token',
    SUPABASE_SERVICE_ROLE_KEY: 'isolated-service-key',
    SUPABASE_ANON_KEY: 'isolated-anon',
    SIGNIN_ALLOWED_ORIGIN: 'https://page.invalid',
  },
  authUsers: { [S_GRANT]: 'grant.e.rogers@gmail.com' },
})

interface TgCall {
  token: string
  chat: string
  text: string
  ok: boolean
}
const tgCalls: TgCall[] = []
let tgRefuse: (text: string) => boolean = () => false
const edgeFetch = globalThis.fetch
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input)
  const m = /^https:\/\/api\.telegram\.org\/bot([^/]+)\/(\w+)/.exec(url)
  if (m === null) return edgeFetch(input, init)
  const payload = JSON.parse(String(init?.body ?? '{}')) as {
    chat_id?: string | number
    text?: string
  }
  const text = String(payload.text ?? '')
  if (m[2] !== 'sendMessage')
    return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 })
  if (tgRefuse(text)) {
    tgCalls.push({ token: String(m[1]), chat: String(payload.chat_id ?? ''), text, ok: false })
    const error = new TypeError('fetch failed') as TypeError & { cause?: unknown }
    error.cause = Object.assign(new Error('connect ECONNREFUSED 149.154.167.220:443'), {
      code: 'ECONNREFUSED',
    })
    throw error
  }
  tgCalls.push({ token: String(m[1]), chat: String(payload.chat_id ?? ''), text, ok: true })
  return new Response(JSON.stringify({ ok: true, result: { message_id: 7000 + tgCalls.length } }), {
    status: 200,
  })
}) as typeof fetch
const delivered = (from: number): TgCall[] => tgCalls.slice(from).filter((c) => c.ok)

const router = new ProviderRouter(db, 'k', scriptedFetch, 4, { requestTimeoutMs: 20_000 })
const review: Reviewer = async () => ({ status: 'approved', notes: 'message-ordering' })
const handlers: Handler[] = [
  instructionHandler({ db, router }),
  pursueHandler({ db, router }),
  synthesiseHandler({ db, router }),
  extractTasksHandler({ db, router }),
]
const notify = combinedNotifier([replyChannel(db)], db)
let tickNo = 0
const tick = async () =>
  drain(db, `mo-${run}-${String(++tickNo)}`, handlers, review, 25, {
    notify,
    canTranscribe: false,
    canSubprocess: false,
  })
const LIVE = `('queued','running','retrying','committing','committed','notifying','output_created','quality_review','waiting_external','paused')`
const corr = (root: string): string =>
  `(select correlation_id from public.jobs where job_id = ${lit(root)}::uuid)`
/** Wake anything waiting (a paused synthesis, a retrying job) and run a pass, until the correlation is quiet. */
const settle = async (root: string, maxTicks = 16): Promise<void> => {
  for (let i = 1; i <= maxTicks; i += 1) {
    await db.execute(`delete from public.provider_health`)
    await db.execute(
      `update public.jobs set not_before = app.now_utc() - interval '1 second'
        where correlation_id = ${corr(root)} and state in ('retrying', 'queued', 'paused')`,
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
  await db.execute(
    `update public.blockers set state = 'withdrawn', resolved_at = app.now_utc(), resolution = 'ordering: between parts'
      where state = 'open' and office_id = ${lit(op)}::uuid`,
  )
  await db.execute(`delete from public.provider_health`)
  tgRefuse = () => false
}
const scopeChat = async (): Promise<void> => {
  await db.execute(
    `insert into public.project_switches (office_id, scope_kind, scope_ref, project_id, switched_by, reason)
     values (${lit(op)}::uuid, 'telegram_chat', ${lit(CHAT)}, ${lit(projectId)}::uuid, 'grant', 'ordering scope')`,
  )
}

type Door = 'telegram' | 'slack' | 'teamhq'
const ASK =
  'Ask the team to investigate the venue contract risk, the budget impact and the competitor pricing and give me a recommendation.'
const send = async (door: Door, text: string): Promise<string> => {
  if (door === 'telegram') {
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
    if (typeof r.body.queued !== 'string') throw new Error('telegram queued nothing')
    return r.body.queued
  }
  if (door === 'slack') {
    const raw = JSON.stringify({
      type: 'event_callback',
      team_id: TEAM,
      event_id: `Ev${run}${String(n())}`,
      event: {
        type: 'message',
        channel: CHANNEL,
        channel_type: 'channel',
        user: GRANT_SLACK,
        text,
        ts: `17${String(Date.now()).slice(-8)}.${String(n()).slice(0, 6)}`,
      },
    })
    const ts = String(Math.floor(Date.now() / 1000) - 5)
    await slackEdge.call(
      new Request('https://door.invalid/functions/v1/slack-events', {
        method: 'POST',
        headers: {
          'X-Slack-Signature': await computeSignature(SECRET, ts, raw),
          'X-Slack-Request-Timestamp': ts,
          'Content-Type': 'application/json',
        },
        body: raw,
      }),
    )
  } else {
    await voiceEdge.call(
      new Request('https://gw.invalid/functions/v1/voice/turn', {
        method: 'POST',
        headers: { Authorization: `Bearer ${S_GRANT}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          said: text,
          session: `s${run.slice(-4)}${String(n())}`,
          project: projectId,
        }),
      }),
    )
  }
  const cmd = await rows(
    `select job_id::text as job from public.inbound_commands
      where instruction = ${lit(text)} and office_id = ${lit(op)}::uuid
        and origin_channel ${door === 'slack' ? `= 'slack'` : `in ('teamhq', 'voice')`}
      order by received_at desc limit 1`,
  )
  const job = String(cmd[0]?.job ?? '')
  if (job === '' || job === 'null') throw new Error(`${door} queued nothing`)
  return job
}

const stateOf = async (root: string) => ({
  lead: String(
    (await one(`select state::text as s from public.jobs where job_id = ${lit(root)}::uuid`)).s,
  ),
  synth: String(
    (
      await one(
        `select coalesce((select state::text from public.jobs where parent_job_id = ${lit(root)}::uuid and kind = 'office.synthesise' limit 1), 'none') as s`,
      )
    ).s,
  ),
  kidsDone: await count(
    `select count(*)::int as n from public.jobs where parent_job_id = ${lit(root)}::uuid and kind = 'office.instruction' and state = 'complete'`,
  ),
  kids: await count(
    `select count(*)::int as n from public.jobs where parent_job_id = ${lit(root)}::uuid and kind = 'office.instruction'`,
  ),
})
const deliveriesOf = async (root: string): Promise<Row[]> =>
  rows(
    `select j.kind, d.state::text as state, d.purpose, d.suppressed_reason, d.sent_at, d.attempt
       from public.deliveries d join public.jobs j on j.job_id = d.job_id
      where j.correlation_id = ${corr(root)} order by d.created_at`,
  )

/** Run one delegation with the lead HELD inside its model call while the colleagues and the synthesis run beside it. */
const raceWithSlowLead = async (
  door: Door,
): Promise<{
  root: string
  heldState: Awaited<ReturnType<typeof stateOf>>
  from: number
  sentWhileHeld: number
}> => {
  await quiet()
  await scopeChat()
  const from = tgCalls.length
  armGate()
  const root = await send(door, `${ASK} (${door})`)
  const tickA = tick() // claims the lead; blocks inside her answer's model call
  await Promise.race([gateHitP, sleep(20_000)])
  // The lead is held. Everything else runs beside her until the colleagues are done and the synthesis has had every chance.
  for (let i = 0; i < 6; i += 1) {
    await db.execute(
      `update public.jobs set not_before = app.now_utc() - interval '1 second'
        where correlation_id = ${corr(root)} and state in ('retrying', 'queued', 'paused') and job_id <> ${lit(root)}::uuid`,
    )
    await tick()
  }
  const heldState = await stateOf(root)
  const sentWhileHeld = delivered(from).length
  gateRelease()
  await tickA
  await settle(root)
  return { root, heldState, from, sentWhileHeld }
}

// =====================================================================================================================
part(
  'O1',
  'a slow lead: the synthesis waits for the first reply, so the order is progress note, then the answer (Telegram)',
)
{
  const { root, heldState, from, sentWhileHeld } = await raceWithSlowLead('telegram')
  const out = delivered(from)
  const dels = await deliveriesOf(root)
  check(
    'while the lead was held the colleagues FINISHED and the synthesis had NOT delivered (it was waiting, not racing)',
    heldState.kids >= 2 &&
      heldState.kidsDone === heldState.kids &&
      heldState.lead !== 'complete' &&
      heldState.synth !== 'complete' &&
      sentWhileHeld === 0,
    JSON.stringify(heldState),
  )
  check(
    'then exactly two messages reached his chat, in order: the lead reply (progress note and her finding), then the single synthesis',
    out.length === 2 &&
      /asked 2 colleagues to look into this/.test(out[0]?.text ?? '') &&
      (out[1]?.text ?? '').includes('Recommendation: negotiate a cap') &&
      out.every((o) => o.token === 'isolated-fake-telegram-token' && o.chat === CHAT),
    out.map((o) => o.text.slice(0, 40)).join(' | '),
  )
  const leadD = dels.find((d) => d.kind === 'office.instruction')
  const synD = dels.find((d) => d.kind === 'office.synthesise')
  check(
    'the delivery rows agree: one lead result and one synthesis result, both sent, the lead sent first',
    dels.length === 2 &&
      leadD?.state === 'sent' &&
      synD?.state === 'sent' &&
      String(leadD?.sent_at) <= String(synD?.sent_at),
    dels.map((d) => `${String(d.kind)}:${String(d.state)}`).join(' '),
  )
  check(
    'nothing stale follows: no further message after the synthesis once everything has settled',
    delivered(from).length === 2,
  )
}

part(
  'O2',
  'the same race through Slack and Team HQ doors: the first reply is recorded before the answer',
)
for (const door of ['slack', 'teamhq'] as const) {
  const { root, heldState } = await raceWithSlowLead(door)
  const o = await rows(
    `select j.kind, o.created_at from public.outputs o join public.jobs j on j.job_id = o.job_id
      where j.correlation_id = ${corr(root)} and j.kind in ('office.synthesise') or (j.correlation_id = ${corr(root)} and j.job_id = ${lit(root)}::uuid)
      order by o.created_at`,
  )
  check(
    `${door}: the colleagues were done while the lead was held, the synthesis had not answered, and the lead's output precedes the synthesis's`,
    heldState.kidsDone === heldState.kids &&
      heldState.synth !== 'complete' &&
      o.length === 2 &&
      o[0]?.kind === 'office.instruction' &&
      o[1]?.kind === 'office.synthesise',
    `${JSON.stringify(heldState)} ${o.map((r) => String(r.kind)).join(',')}`,
  )
}

part(
  'O3',
  "the lead's send is retrying (a transient transport failure): the answer waits for it, never overtakes it",
)
{
  await quiet()
  await scopeChat()
  const from = tgCalls.length
  // The lead's reply is refused as a connect failure (retryable, nothing left the machine); the synthesis is never refused.
  tgRefuse = (text) => /asked 2 colleagues/.test(text)
  const root = await send('telegram', `${ASK} (retry)`)
  for (let i = 0; i < 4; i += 1) {
    await db.execute(
      `update public.jobs set not_before = app.now_utc() - interval '1 second'
        where correlation_id = ${corr(root)} and state in ('retrying', 'queued', 'paused')`,
    )
    await tick()
  }
  const midDeliveries = await deliveriesOf(root)
  const synthSent = midDeliveries.some((d) => d.kind === 'office.synthesise' && d.state === 'sent')
  const leadClaimed = midDeliveries.some(
    (d) => d.kind === 'office.instruction' && d.state === 'claimed',
  )
  check(
    'while the lead reply is retrying (claimed, backing off) the synthesis has NOT been delivered ahead of it',
    leadClaimed && !synthSent && delivered(from).length === 0,
    midDeliveries.map((d) => `${String(d.kind)}:${String(d.state)}`).join(' '),
  )
  // The transport recovers and the backoff lapses: the redrive sends the lead; only then does the synthesis go.
  tgRefuse = () => false
  await db.execute(
    `update public.deliveries set lease_expires_at = app.now_utc() - interval '1 second'
      where state = 'claimed' and job_id in (select job_id from public.jobs where correlation_id = ${corr(root)})`,
  )
  await settle(root)
  const out = delivered(from)
  check(
    'once the transport recovers: the lead reply first, then the synthesis, each exactly once',
    out.length === 2 &&
      /asked 2 colleagues/.test(out[0]?.text ?? '') &&
      (out[1]?.text ?? '').includes('Recommendation'),
    out.map((o) => o.text.slice(0, 36)).join(' | '),
  )
}

part(
  'O4',
  'a lead that never settles cannot hold the answer for ever; its reply, if it ever arrives, is suppressed as superseded',
)
{
  await quiet()
  await scopeChat()
  const from = tgCalls.length
  tgRefuse = (text) => /asked 2 colleagues/.test(text)
  const root = await send('telegram', `${ASK} (stuck)`)
  for (let i = 0; i < 4; i += 1) {
    await db.execute(
      `update public.jobs set not_before = app.now_utc() - interval '1 second'
        where correlation_id = ${corr(root)} and state in ('retrying', 'queued', 'paused')`,
    )
    await tick()
  }
  check(
    'before the bound: the synthesis still waits (the lead reply is claimed and unsent)',
    delivered(from).length === 0,
  )
  // The lead's claim is held far into the future (a worker that is not coming back), and the team finished long ago.
  await db.execute(
    `update public.deliveries set lease_expires_at = app.now_utc() + interval '1 hour'
      where state = 'claimed' and job_id in (select job_id from public.jobs where correlation_id = ${corr(root)})`,
  )
  await db.execute(
    `update public.jobs set finished_at = app.now_utc() - interval '4 minutes'
      where parent_job_id = ${lit(root)}::uuid and kind = 'office.instruction'`,
  )
  tgRefuse = () => false
  await settle(root)
  const afterBound = delivered(from)
  check(
    'past the bound the synthesis is delivered anyway (liveness), once',
    afterBound.length === 1 &&
      afterBound[0]?.text.includes('Recommendation: negotiate a cap') === true,
    afterBound.map((o) => o.text.slice(0, 40)).join(' | '),
  )
  // Now the lead's reply finally comes back to life: its lease lapses and the redrive claims it.
  await db.execute(
    `update public.deliveries set lease_expires_at = app.now_utc() - interval '1 second'
      where state = 'claimed' and job_id = ${lit(root)}::uuid`,
  )
  await tick()
  await tick()
  const dels = await deliveriesOf(root)
  const leadD = dels.find((d) => d.kind === 'office.instruction')
  check(
    "the lead's stale reply is SUPPRESSED by the database as superseded and never sent",
    leadD?.state === 'suppressed' &&
      /superseded/.test(String(leadD?.suppressed_reason)) &&
      delivered(from).length === 1,
    `${String(leadD?.state)} ${String(leadD?.suppressed_reason).slice(0, 60)}; ${String(delivered(from).length)} message(s) delivered`,
  )
  check(
    "the person received exactly ONE final answer for the request, and the lead's output still exists on the job (auditable, not erased)",
    (await count(
      `select count(*)::int as n from public.outputs where job_id = ${lit(root)}::uuid`,
    )) >= 1,
  )
}

part(
  'O5',
  'duplicates and races: several workers waking the synthesis at once still deliver it once',
)
{
  await quiet()
  await scopeChat()
  const from = tgCalls.length
  const root = await send('telegram', `${ASK} (race)`)
  // Three passes at once, repeatedly, over the same correlation.
  for (let i = 0; i < 4; i += 1) {
    await db.execute(
      `update public.jobs set not_before = app.now_utc() - interval '1 second'
        where correlation_id = ${corr(root)} and state in ('retrying', 'queued', 'paused')`,
    )
    await Promise.all([tick(), tick(), tick()])
  }
  await settle(root)
  const out = delivered(from)
  const dels = await deliveriesOf(root)
  check(
    'one lead reply and one synthesis, each delivered exactly once, in order, however many workers raced',
    out.length === 2 &&
      new Set(out.map((o) => o.text)).size === 2 &&
      dels.filter((d) => d.kind === 'office.synthesise' && d.state === 'sent').length === 1 &&
      dels.filter((d) => d.kind === 'office.instruction' && d.state === 'sent').length === 1,
    `${String(out.length)} message(s); ${dels.map((d) => `${String(d.kind)}:${String(d.state)}`).join(' ')}`,
  )
  check(
    'exactly one synthesis job and one fan-in group exist for the request',
    (await count(
      `select count(*)::int as n from public.jobs where parent_job_id = ${lit(root)}::uuid and kind = 'office.synthesise'`,
    )) === 1 &&
      (await count(
        `select count(*)::int as n from public.branch_groups where parent_job_id = ${lit(root)}::uuid`,
      )) === 1,
  )
}

part(
  'O6',
  'a convened team is the work: the planner is not ALSO allowed to start its own pursuit and dump the sources after the answer (#441, found with a real model)',
)
{
  await quiet()
  await scopeChat()
  const from = tgCalls.length
  planOn = true
  const root = await send('telegram', `${ASK} (planned)`)
  await settle(root)
  await settle(root)
  planOn = false
  const out = delivered(from)
  const dels = await deliveriesOf(root)
  const pursues = await count(
    `select count(*)::int as n from public.jobs where correlation_id = ${corr(root)} and kind = 'office.pursue'`,
  )
  check(
    'with a team convened and the planner returning a plan, NO pursuit job is started for the same request',
    pursues === 0,
    `${String(pursues)} office.pursue job(s)`,
  )
  check(
    'so what reaches him is the lead reply then the ONE synthesis, and nothing after it (no source dump, no second hand-off)',
    out.length === 2 &&
      /asked 2 colleagues/.test(out[0]?.text ?? '') &&
      (out[1]?.text ?? '').includes('Recommendation') &&
      dels.every((d) => d.kind !== 'office.pursue'),
    out.map((o) => o.text.slice(0, 40)).join(' | '),
  )
  // The control: a lone request with NO team still plans (the fix must not switch planning off).
  await quiet()
  await scopeChat()
  planOn = true
  const lone = await send(
    'telegram',
    'Find the venue notes and the budget notes and list them for me. (planned alone)',
  )
  await settle(lone)
  planOn = false
  check(
    'control: the same planner output on a request that convened nobody DOES still plan and pursue',
    (await count(
      `select count(*)::int as n from public.jobs where correlation_id = ${corr(lone)} and kind = 'office.pursue'`,
    )) >= 1,
  )
}

await quiet()
console.log(`\n${String(total - failed)}/${String(total)} checks PROVEN, ${String(failed)} FAILED`)
process.exit(failed === 0 ? 0 : 1)
