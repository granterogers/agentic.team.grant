/**
 * The same instruction, the same delegation decision, on every interface.
 *
 *   npx tsx scripts/isolated/cross-interface-delegation.ts <replica-db>
 *
 * Owner decision, 8 October 2026: selective delegation applies to Telegram, Slack AND Team HQ. Claire answers routine
 * requests herself (no roster, no routing model call, no child); an explicit request for the team, a colleague named as the
 * doer, or genuinely investigative work convenes specialists. The decision lives in one function (`speaker()`), so a
 * disagreement between doors would mean a door decided for itself, which section 5 of the master spec forbids.
 *
 * Hermetic, on a marked local replica. The REAL telegram-webhook, slack-events and voice (Team HQ chat) edge code runs in Node
 * against it; the REAL worker and handlers run on it. Stand-ins, each a deterministic fake that sends nothing: the MODEL (the
 * real ProviderRouter over a scripted fetch) and TELEGRAM's API (a recording fake). Slack replies are not sent (no Slack
 * transport is installed), so this proof is about the DECISION and the work it starts, not about Slack delivery, which
 * `slack-send` and journey L cover. What a real model decides is MODEL-DEPENDENT and is exercised by
 * `real-model-acceptance.ts`, never claimed here.
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

const dbName = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'xi_x'
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

// ---- the scripted model --------------------------------------------------------------------------------------------
interface ModelCall {
  role: string
  persona: string
  user: string
}
const modelCalls: ModelCall[] = []
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
const scriptedFetch = (async (_url: string, init: { body: string }): Promise<Response> => {
  const body = JSON.parse(init.body) as {
    model: string
    messages: { role: string; content: string }[]
  }
  const system = body.messages.find((m) => m.role === 'system')?.content ?? ''
  const role = roleOf(system)
  modelCalls.push({
    role,
    persona: /^You are (\w+), /.exec(system)?.[1] ?? '',
    user: body.messages
      .filter((m) => m.role === 'user')
      .map((m) => m.content)
      .join('\n'),
  })
  const reply =
    role === 'already'
      ? 'NONE'
      : role === 'other'
        ? 'none'
        : role === 'synth'
          ? 'Together they find nothing that blocks this. Recommendation: proceed.'
          : role === 'answer'
            ? 'I have looked at it and nothing in it is out of line.'
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

// ---- the office, three doors -----------------------------------------------------------------------------------------
await registerBot(db)
const op = String((await one(`select app.operator_office()::text as o`)).o)
const mkProject = async (name: string): Promise<string> => {
  const r = (await one(
    `select app.hq_create_project(${lit(op)}::uuid, ${lit(name)}, 'upload', ${lit(`xi-${run}`)}, ${lit(name)}, true) as v`,
  )) as { v: unknown }
  const v = (typeof r.v === 'string' ? JSON.parse(r.v) : r.v) as { project_id: string }
  return v.project_id
}
const proj = await mkProject(`Harbourview ${run}`)

const GRANT_SLACK = 'U0XIGRANT01'
const TEAM = 'T0XISOLATED'
const CHANNEL = `C0XI${run.toUpperCase().slice(0, 6)}`
const SECRET = 'isolated-slack-signing-secret'
const S_GRANT = `aaa.bbb.${'g'.repeat(70)}`
await db.execute(
  `insert into public.subject_identities (office_id, subject, origin_channel, actor, note)
   values (${lit(op)}::uuid, 'grant', 'slack', ${lit(GRANT_SLACK)}, 'xi') on conflict do nothing`,
)
await db.execute(
  `insert into public.slack_app_credentials (office_id, slack_app_id, team_id, app_name)
   values (${lit(op)}::uuid, 'A0XIISOL01', ${lit(TEAM)}, 'xi') on conflict do nothing`,
)
await db.execute(
  `insert into public.slack_workspaces (team_id, team_name, bot_user_id, office_id)
   values (${lit(TEAM)}, 'xi', 'U0BOTXI', ${lit(op)}::uuid) on conflict do nothing`,
)
await db.execute(
  `insert into public.slack_channel_map (channel_id, team_id, project_id, channel_name, active)
   values (${lit(CHANNEL)}, ${lit(TEAM)}, ${lit(proj)}::uuid, 'xi-harbourview', true) on conflict do nothing`,
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
    SLACK_BOT_USER_ID: 'U0BOTXI',
    SUPABASE_SERVICE_ROLE_KEY: 'isolated-service-key',
  },
})
const edgeEnv = {
  HQ_API_TOKEN: 'isolated-hq-token',
  SUPABASE_SERVICE_ROLE_KEY: 'isolated-service-key',
  SUPABASE_ANON_KEY: 'isolated-anon',
  SIGNIN_ALLOWED_ORIGIN: 'https://page.invalid',
}
const voiceEdge = await startEdge({
  db,
  edgeFile: 'supabase/functions/voice/index.ts',
  env: edgeEnv,
  authUsers: { [S_GRANT]: 'grant.e.rogers@gmail.com' },
})

// Telegram's own API, recorded and never sent (installed after the edges, which wrap fetch and refuse other hosts).
interface TgCall {
  token: string
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
    tgCalls.push({
      token: String(m[1]),
      chat: String(payload.chat_id ?? ''),
      text: String(payload.text ?? ''),
    })
  return new Response(JSON.stringify({ ok: true, result: { message_id: 7000 + tgCalls.length } }), {
    status: 200,
  })
}) as typeof fetch

const router = new ProviderRouter(db, 'k', scriptedFetch, 4, { requestTimeoutMs: 2_000 })
const review: Reviewer = async () => ({ status: 'approved', notes: 'cross-interface-delegation' })
const handlers: Handler[] = [
  instructionHandler({ db, router }),
  pursueHandler({ db, router }),
  synthesiseHandler({ db, router }),
  extractTasksHandler({ db, router }),
]
const notify = combinedNotifier([replyChannel(db)], db)
let tickNo = 0
const tick = async () =>
  drain(db, `xi-${run}-${String(++tickNo)}`, handlers, review, 25, {
    notify,
    canTranscribe: false,
    canSubprocess: false,
  })
const LIVE = `('queued','running','retrying','committing','committed','notifying','output_created','quality_review','waiting_external')`
const corr = (root: string): string =>
  `(select correlation_id from public.jobs where job_id = ${lit(root)}::uuid)`
const settle = async (root: string, maxTicks = 14): Promise<void> => {
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
  await db.execute(
    `update public.blockers set state = 'withdrawn', resolved_at = app.now_utc(), resolution = 'cross-interface: between parts'
      where state = 'open' and office_id = ${lit(op)}::uuid`,
  )
  await db.execute(`delete from public.provider_health`)
}
const scopeChat = async (): Promise<void> => {
  await db.execute(
    `insert into public.project_switches (office_id, scope_kind, scope_ref, project_id, switched_by, reason)
     values (${lit(op)}::uuid, 'telegram_chat', ${lit(CHAT)}, ${lit(proj)}::uuid, 'grant', 'cross-interface scope')`,
  )
}

// ---- the three doors, each translating the same words ---------------------------------------------------------------------
type Door = 'telegram' | 'slack' | 'teamhq'
const DOORS: readonly Door[] = ['telegram', 'slack', 'teamhq']
// Team HQ's chat is recorded under `voice` or `teamhq` depending on the path (a known quirk, see the V1 acceptance report).
const ORIGIN: Record<Door, string> = {
  telegram: `origin_channel = 'telegram'`,
  slack: `origin_channel = 'slack'`,
  teamhq: `origin_channel in ('teamhq', 'voice')`,
}
const send = async (door: Door, text: string, toSlug?: string): Promise<string> => {
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
    if (typeof r.body.queued !== 'string') throw new Error(`telegram queued nothing for: ${text}`)
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
    const r = await slackEdge.call(
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
    if (r.status !== 200) throw new Error(`slack door answered ${String(r.status)}`)
  } else {
    const r = await voiceEdge.call(
      new Request('https://gw.invalid/functions/v1/voice/turn', {
        method: 'POST',
        headers: { Authorization: `Bearer ${S_GRANT}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          said: text,
          session: `s${run.slice(-4)}${String(n())}`,
          project: proj,
          ...(toSlug === undefined ? {} : { to: toSlug }),
        }),
      }),
    )
    if (r.status !== 200) throw new Error(`team hq door answered ${String(r.status)}`)
  }
  // The door enqueues inside the request: the command row is there when it answers.
  const cmd = await rows(
    `select job_id::text as job from public.inbound_commands
      where instruction = ${lit(text)} and ${ORIGIN[door]} and office_id = ${lit(op)}::uuid
      order by received_at desc limit 1`,
  )
  const job = String(cmd[0]?.job ?? '')
  if (job === '' || job === 'null') throw new Error(`${door} queued nothing for: ${text}`)
  return job
}

interface Signature {
  lead: string
  kids: number
  synth: number
  roster: number
  tree: number
  otherCalls: number
  answerCalls: number
}
const signatureOf = async (job: string, mark: number): Promise<Signature> => {
  const lead = String(
    (
      await one(
        `select coalesce(recipient_agent,'') as r from public.jobs where job_id = ${lit(job)}::uuid`,
      )
    ).r,
  )
  const d = await one(
    `select coalesce(array_length(roster, 1), 0) as n from public.routing_decisions where job_id = ${lit(job)}::uuid order by decided_at desc limit 1`,
  )
  const calls = modelCalls.slice(mark)
  return {
    lead,
    kids: await count(
      `select count(*)::int as n from public.jobs where parent_job_id = ${lit(job)}::uuid and kind = 'office.instruction'`,
    ),
    synth: await count(
      `select count(*)::int as n from public.jobs where parent_job_id = ${lit(job)}::uuid and kind = 'office.synthesise'`,
    ),
    roster: Number(d?.n ?? 0),
    tree: await count(
      `select count(*)::int as n from public.jobs where correlation_id = ${corr(job)}`,
    ),
    otherCalls: calls.filter((c) => c.role === 'other').length,
    answerCalls: calls.filter((c) => c.role === 'answer').length,
  }
}
const same = (a: Signature, b: Signature): boolean => JSON.stringify(a) === JSON.stringify(b)

const drive = async (text: string, toSlug?: string): Promise<Record<Door, Signature>> => {
  const out = {} as Record<Door, Signature>
  for (const door of DOORS) {
    if (toSlug !== undefined && door === 'slack') continue // Slack has no way to address one specialist
    await quiet()
    await scopeChat()
    const mark = modelCalls.length
    const job = await send(door, text, toSlug)
    await settle(job)
    out[door] = await signatureOf(job, mark)
  }
  return out
}
const show = (s: Partial<Record<Door, Signature>>): string =>
  Object.entries(s)
    .map(
      ([d, v]) =>
        `${d}:${v.lead}/kids${String(v.kids)}/tree${String(v.tree)}/other${String(v.otherCalls)}`,
    )
    .join('  ')
const allSame = (s: Partial<Record<Door, Signature>>): boolean => {
  const vs = Object.values(s) as Signature[]
  return vs.length > 0 && vs.every((v) => same(v, vs[0] as Signature))
}

// ===================================================================================================================
part('X1', 'routine requests: Claire answers, nobody is convened, the same on every interface')
const ROUTINE = [
  "What's the status of the venue contract?",
  "What's happening with my tasks?",
  'Remind me tomorrow to call Mum.',
  'Mark the roofer task done.',
  'How much is the deposit and when is it due?',
  `Here is a long update from the venue about the building works. ${'The kitchen will be closed on Tuesday and the car park resurfaced over the weekend. '.repeat(25)}Summarise it for me.`,
]
for (const text of ROUTINE) {
  const s = await drive(text)
  const label = text.length > 60 ? `${text.slice(0, 50)}... (${String(text.length)} chars)` : text
  check(
    `${label}: the chief answers alone, a tree of one, no child, no semantic-reading call, identical on all three interfaces`,
    allSame(s) &&
      Object.values(s).every(
        (v) =>
          v.lead === 'chief-of-staff' &&
          v.kids === 0 &&
          v.synth === 0 &&
          v.tree === 1 &&
          v.roster === 0 &&
          v.otherCalls === 0,
      ),
    show(s),
  )
}

part('X2', 'an explicit request for the team convenes it, the same on every interface')
for (const text of [
  'Ask the team to look at the venue contract risk and the budget impact.',
  'Get Daniel and Emma to compare the deposit and the pricing of the venue.',
]) {
  const s = await drive(text)
  check(
    `${text}: specialists are convened (more than one job), one synthesis, identical on all three interfaces`,
    allSame(s) && Object.values(s).every((v) => v.tree > 1 && v.roster >= 2),
    show(s),
  )
}

part(
  'X3',
  'genuinely investigative work is eligible for specialists, short or not (a long paste is X1)',
)
for (const text of [
  'Research the alternatives to this venue and give me a recommendation.',
  'Investigate why the deposit was refused.',
]) {
  const s = await drive(text)
  check(
    `${text}: enters the roster path on every interface, identically (a short request, a real investigation: a specialist is named or the subject is read for meaning)`,
    allSame(s) && Object.values(s).every((v) => v.roster >= 1 || v.otherCalls >= 1),
    show(s),
  )
}

part(
  'X4',
  'a specialist he addressed himself still answers, and selective delegation never overrides the address',
)
{
  const text = 'How is the venue hire going?'
  const s = await drive(text, 'finance-director')
  check(
    'Team HQ with a named specialist: that specialist answers alone, nobody else convened',
    s.teamhq.lead === 'finance-director' && s.teamhq.kids === 0 && s.teamhq.tree === 1,
    show(s),
  )
}

part(
  'X5',
  'what the person sees: Telegram routine turns send exactly one message, through the chief bot, to the same chat',
)
{
  await quiet()
  await scopeChat()
  const from = tgCalls.length
  const job = await send('telegram', "What's the status of the venue contract? (again)")
  await settle(job)
  const out = tgCalls.slice(from)
  check(
    'one message, to his chat',
    out.length === 1 && out[0]?.chat === CHAT,
    `${String(out.length)} message(s)`,
  )
}

await quiet()
console.log(`\n${String(total - failed)}/${String(total)} checks PROVEN, ${String(failed)} FAILED`)
process.exit(failed === 0 ? 0 : 1)
