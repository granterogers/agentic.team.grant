/**
 * Version 1 acceptance suite, part A: realistic user journeys A, B, C, D, E, F and L, driven through the highest safe
 * level available locally.
 *
 *   npx tsx scripts/isolated/v1-acceptance-a.ts <replica-db>
 *
 * WHAT IS REAL
 *   - the three doors: `telegram-webhook`, `slack-events` and the Team HQ `voice/turn` + `hq-api` edge functions run
 *     unmodified in Node (edge-emulator.ts), writing the real ledger (`inbound_commands` -> `jobs`);
 *   - the REAL worker (`drain` -> `runJob`), the REAL `office.instruction` handler, the REAL `tasks.remind` duty
 *     (dispatched by `app.dispatch_due_responsibilities`), the REAL plan / notebook handlers;
 *   - the REAL notifier stack (`replyChannel` + `pagerChannel` -> `TelegramPager`/`DeliveryService` ->
 *     `TelegramTransport` -> `TelegramClient`), the real delivery state machine (1029) and its redrive;
 *   - the REAL coherence and consequence gates, the REAL approval policy and question binding.
 *
 * WHAT IS STOOD IN FOR
 *   - the model: a deterministic stub (`stub` below), routed by the prompt's first line. Journeys A to D need NO model
 *     call at all and the suite asserts that (the stub's call log is empty for them). E and F need a model for the
 *     wording of an answer; what the stub says is a script, and what a real model would say is MODEL-DEPENDENT;
 *   - the provider network: `globalThis.fetch` answers `api.telegram.org` and the notebook writer from a scripted fake
 *     that records every call, answers a scripted outcome, and REFUSES (and records) every other URL. Nothing can
 *     leave this process; Slack, Gmail and any other host appear in `refused` if anything tries;
 *   - time: the database clock is real (`now()`); "time passes" is made by moving the reminder's own timestamp (a
 *     series is moved back by exactly one period so its wall-clock anchor survives) or by rewinding a lease.
 *
 * Every assertion reads canonical rows (inbound_commands, jobs, tasks, outputs, deliveries, events, documents,
 * blockers) and the transport call log, never a return value. Each journey ends by printing what is DETERMINISTICALLY
 * PROVEN and what is MODEL-DEPENDENT, and a PASS/FAIL line. Exits non-zero on any failure.
 *
 * Needs migrations 1027 and 1029 applied to the clone (mkclone.sh does that). All writes are to the clone.
 */
import { consequenceClaims } from '../../src/agents/consequence.ts'
import { combinedNotifier, pagerChannel } from '../../src/channels/notify.ts'
import { replyChannel } from '../../src/channels/reply.ts'
import { instructionHandler } from '../../src/handlers/instruction.ts'
import { notebookHandlers } from '../../src/handlers/notebook.ts'
import { planHandler } from '../../src/handlers/plan.ts'
import { remindersHandler } from '../../src/handlers/reminders.ts'
import { drain, type Handler, type Reviewer, type WorkerResult } from '../../src/jobs/worker.ts'
import { computeSignature } from '../../src/slack/signature.ts'
import { TelegramClient } from '../../src/telegram/api.ts'
import { TelegramPager } from '../../src/telegram/pager.ts'
import { pagerBot } from '../../src/telegram/roster.ts'
import { startEdge } from './edge-emulator.ts'
import { isolated } from './guard.ts'
import { BOT, CHAT, registerBot } from './real-telegram.ts'
import { startTelegramDoor } from './telegram-door.ts'

const db = await isolated(process.argv[2] ?? 'va_x')
const run = Date.now().toString(36)
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const rows = async (sql: string) => (await db.execute(sql)).rows as Record<string, unknown>[]
const json = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v) as Record<string, unknown>
const num = async (sql: string) => Number((await one(sql)).c)
const n = () => Math.floor(Math.random() * 9_000_000) + 1_000_000

// ---------------------------------------------------------------------------------------------------------------
// reporting
// ---------------------------------------------------------------------------------------------------------------
interface JourneyRecord {
  readonly id: string
  readonly title: string
  ok: number
  bad: number
  readonly proven: string[]
  readonly model: string[]
  readonly unproven: string[]
  readonly defects: string[]
}
const journeys: JourneyRecord[] = []
let cur: JourneyRecord = {
  id: '?',
  title: '',
  ok: 0,
  bad: 0,
  proven: [],
  model: [],
  unproven: [],
  defects: [],
}
const begin = (id: string, title: string) => {
  cur = { id, title, ok: 0, bad: 0, proven: [], model: [], unproven: [], defects: [] }
  journeys.push(cur)
  console.log(`\n=== JOURNEY ${id}: ${title} ===`)
}
let totalOk = 0
let totalBad = 0
const check = (what: string, ok: boolean, detail = '') => {
  if (ok) {
    cur.ok += 1
    totalOk += 1
    cur.proven.push(what)
  } else {
    cur.bad += 1
    totalBad += 1
    cur.defects.push(`${what}${detail === '' ? '' : ` (${detail})`}`)
  }
  console.log(
    `${ok ? 'PROVEN  ' : 'FAILED  '} [${cur.id}] ${what}${detail === '' ? '' : ` - ${detail}`}`,
  )
}
const modelDependent = (what: string) => {
  cur.model.push(what)
  console.log(`MODEL-DEPENDENT [${cur.id}] ${what}`)
}
const unproven = (what: string) => {
  cur.unproven.push(what)
  console.log(`UNPROVEN [${cur.id}] ${what}`)
}
const observed = (what: string) => console.log(`OBSERVED [${cur.id}] ${what}`)
const end = () => {
  console.log(
    `\nJOURNEY ${cur.id} ${cur.bad === 0 ? 'PASS' : 'FAIL'} (${String(cur.ok)} proven, ${String(cur.bad)} failed): ${cur.title}`,
  )
  if (cur.model.length > 0) console.log(`  model-dependent: ${cur.model.join(' | ')}`)
  if (cur.unproven.length > 0) console.log(`  unproven here: ${cur.unproven.join(' | ')}`)
  if (cur.bad > 0) console.log(`  failures: ${cur.defects.join(' | ')}`)
}

// ---------------------------------------------------------------------------------------------------------------
// time oracle (independent of the product: Intl only)
// ---------------------------------------------------------------------------------------------------------------
interface Local {
  readonly weekday: string
  readonly date: string
  readonly hh: number
  readonly mm: number
}
const local = (d: Date, zone: string): Local => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>
  return {
    weekday: String(parts.weekday),
    date: `${String(parts.year)}-${String(parts.month)}-${String(parts.day)}`,
    hh: Number(parts.hour),
    mm: Number(parts.minute),
  }
}
const at = (v: unknown, zone: string): string => {
  const d = new Date(String(v))
  const l = local(d, zone)
  return `${l.weekday} ${l.date} ${String(l.hh).padStart(2, '0')}:${String(l.mm).padStart(2, '0')}`
}
const isLocal = (v: unknown, zone: string, weekday: string, hh: number, mm: number): boolean => {
  if (v === null || v === undefined) return false
  const l = local(new Date(String(v)), zone)
  return l.weekday === weekday && l.hh === hh && l.mm === mm
}
const ATHENS = 'Europe/Athens'
const NEW_YORK = 'America/New_York'
/** "Friday", unless today is Friday in the office zone, when the day the sentence names is Saturday (a date-proof run). */
const dayWord = (zone: string): { word: string; short: string } =>
  local(new Date(), zone).weekday === 'Fri'
    ? { word: 'Saturday', short: 'Sat' }
    : { word: 'Friday', short: 'Fri' }

// ---------------------------------------------------------------------------------------------------------------
// the office: duties off except the reminder duty, the timezone, the bot
// ---------------------------------------------------------------------------------------------------------------
const op = String((await one(`select app.operator_office()::text as o`)).o)
const O = `${lit(op)}::uuid`
for (const fn of [
  'office_timezone',
  'job_delivery_state',
  'reminders_settle',
  'deliveries_to_redrive',
]) {
  const have = await num(
    `select count(*)::int as c from pg_proc where proname = ${lit(fn)} and pronamespace = 'app'::regnamespace`,
  )
  if (have === 0) {
    console.log(
      `FAILED   the clone lacks app.${fn}: apply migrations 1027 and 1029 (mkclone.sh does)`,
    )
    process.exit(1)
  }
}
if (
  (await num(
    `select count(*)::int as c from public.inbound_commands where office_id = ${O} and origin_channel in ('telegram', 'slack', 'voice', 'teamhq')`,
  )) > 0
) {
  console.log(
    'FAILED   this clone has been used already (an open "Call Mum" task makes the office answer "already on your list"): run it on a FRESH clone (mkclone.sh)',
  )
  process.exit(1)
}
await db.execute(
  `update public.responsibilities set enabled = false where job_kind <> 'tasks.remind'`,
)
const setZone = (z: string) =>
  db.execute(`update public.offices set timezone = ${lit(z)} where office_id = ${O}`)
await setZone(ATHENS)
await registerBot(db)

// ---------------------------------------------------------------------------------------------------------------
// the fake provider network
// ---------------------------------------------------------------------------------------------------------------
interface TgCall {
  readonly method: string
  readonly chat: string
  readonly text: string
  readonly replyTo: number | null
  readonly body: Record<string, unknown>
}
const tgLog: TgCall[] = []
const refused: string[] = []
/** Scripted outcomes for the next sendMessage calls: 'ok', or an HTTP-ish failure. Consumed one per call. */
type TgStep =
  | 'ok'
  | { readonly status: number; readonly description: string; readonly retryAfter?: number }
const tgScript: TgStep[] = []
let tgMessageId = 7000
/** The notebook writer stand-in (approval journey): counts what was asked of it. */
const WRITER = 'http://notebook.invalid/act'
const notebookCalls: { action: string; args: Record<string, unknown> }[] = []
let notebookCreated = 0

// ---------------------------------------------------------------------------------------------------------------
// the doors (real edge code). Started BEFORE the fetch wrapper: each startEdge installs its own fetch.
// ---------------------------------------------------------------------------------------------------------------
const GRANT_TG = Number(CHAT)
const SLACK_SECRET = 'isolated-slack-signing-secret'
const SLACK_TEAM = 'T0ISOLATED'
const GRANT_SLACK = 'U0BUNF6AALC'
const SLACK_CHANNEL = `C0VA${run.toUpperCase().slice(0, 6)}`
const S_GRANT = `aaa.bbb.${'g'.repeat(70)}`
const slackProject = String(
  json(
    (
      await one(
        `select app.hq_create_project(${O}, ${lit(`Harbourview ${run}`)}, 'upload', ${lit(`va-${run}`)}, ${lit(`Harbourview ${run}`)}, true) as v`,
      )
    ).v,
  ).project_id,
)
await db.execute(
  `insert into public.subject_identities (office_id, subject, origin_channel, actor, note)
   values (${O}, 'grant', 'slack', ${lit(GRANT_SLACK)}, 'va') on conflict do nothing`,
)
await db.execute(
  `insert into public.slack_app_credentials (office_id, slack_app_id, team_id, app_name)
   values (${O}, 'A0ISOLATED1', ${lit(SLACK_TEAM)}, 'va') on conflict do nothing`,
)
await db.execute(
  `insert into public.slack_workspaces (team_id, team_name, bot_user_id, office_id)
   values (${lit(SLACK_TEAM)}, 'va', 'U0BOTUSERX', ${O}) on conflict do nothing`,
)
await db.execute(
  `insert into public.slack_channel_map (channel_id, team_id, project_id, channel_name, active)
   values (${lit(SLACK_CHANNEL)}, ${lit(SLACK_TEAM)}, ${lit(slackProject)}::uuid, 'va-harbourview', true)
   on conflict do nothing`,
)
const tg = await startTelegramDoor(db, BOT)
const slackEdge = await startEdge({
  db,
  edgeFile: 'supabase/functions/slack-events/index.ts',
  beside: [
    ['src/slack/events.ts', 'events.ts'],
    ['src/slack/interactions.ts', 'interactions.ts'],
    ['src/slack/signature.ts', 'signature.ts'],
  ],
  env: {
    SLACK_SIGNING_SECRET: SLACK_SECRET,
    SLACK_BOT_USER_ID: 'U0BOTUSERX',
    SUPABASE_SERVICE_ROLE_KEY: 'isolated-service-key',
  },
})
const edgeEnv = {
  HQ_API_TOKEN: 'isolated-hq-token',
  SUPABASE_SERVICE_ROLE_KEY: 'isolated-service-key',
  SUPABASE_ANON_KEY: 'isolated-anon',
  SIGNIN_ALLOWED_ORIGIN: 'https://page.invalid',
}
const authUsers = { [S_GRANT]: 'grant.e.rogers@gmail.com' }
const voiceEdge = await startEdge({
  db,
  edgeFile: 'supabase/functions/voice/index.ts',
  env: edgeEnv,
  authUsers,
})
const gw = await startEdge({
  db,
  edgeFile: 'supabase/functions/hq-api/index.ts',
  env: edgeEnv,
  authUsers,
})

// The edge emulator installed a fetch that refuses everything but the replica; layer the provider fakes on top of it.
const replicaFetch = globalThis.fetch
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input)
  const m = /^https:\/\/api\.telegram\.org\/bot[^/]+\/(\w+)$/.exec(url)
  if (m !== null) {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    const method = String(m[1])
    if (method === 'sendMessage') {
      tgLog.push({
        method,
        chat: String(body.chat_id),
        text: String(body.text),
        replyTo: ((body.reply_parameters as { message_id?: number } | undefined)?.message_id ??
          null) as number | null,
        body,
      })
      const step = tgScript.shift() ?? 'ok'
      if (step !== 'ok') {
        return new Response(
          JSON.stringify({
            ok: false,
            error_code: step.status,
            description: step.description,
            ...(step.retryAfter === undefined
              ? {}
              : { parameters: { retry_after: step.retryAfter } }),
          }),
          { status: step.status },
        )
      }
      tgMessageId += 1
      return new Response(JSON.stringify({ ok: true, result: { message_id: tgMessageId } }), {
        status: 200,
      })
    }
    // anything else the bot does (answerCallbackQuery, editMessageReplyMarkup, ...) is recorded and acknowledged
    tgLog.push({ method, chat: String(body.chat_id ?? ''), text: '', replyTo: null, body })
    return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 })
  }
  if (url === WRITER) {
    const body = JSON.parse(String(init?.body ?? '{}')) as {
      action: string
      args: Record<string, unknown>
    }
    notebookCalls.push({ action: body.action, args: body.args })
    const reply = (v: unknown) =>
      new Response(JSON.stringify(v), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    if (body.action === 'artifacts') return reply({ ok: true, artifacts: [] })
    if (body.action === 'generate')
      return reply({ ok: true, task_id: `task-${String(notebookCalls.length)}`, state: 'started' })
    if (body.action === 'create_notebook') {
      notebookCreated += 1
      return reply({
        ok: true,
        notebook_id: `nb-${run}-${String(notebookCreated)}`,
        title: String(body.args.title),
      })
    }
    return reply({ ok: true })
  }
  if (url.startsWith('http://replica.invalid')) return replicaFetch(input, init)
  refused.push(url)
  throw new Error(`REFUSED: this suite may reach no provider and no host, not ${url}`)
}) as typeof fetch

await db.execute(`insert into vault.secrets (name, secret) values ('notebook.storage_state', 'isolated-jar')
                  on conflict (name) do update set secret = excluded.secret`)
await db.execute(`insert into vault.secrets (name, secret) values ('notebook.reader_secret', 'isolated-reader')
                  on conflict (name) do update set secret = excluded.secret`)
await db.execute(`insert into public.system_config (key, value, description) values ('notebook.writer_url', to_jsonb(${lit(WRITER)}::text), 'isolated stand-in for the notebook writer')
                  on conflict (key) do update set value = excluded.value`)

// ---------------------------------------------------------------------------------------------------------------
// the stub model: routed by the first line of the system prompt
// ---------------------------------------------------------------------------------------------------------------
type Role = 'rewrite' | 'read' | 'plan' | 'answer' | 'other'
interface ModelCall {
  readonly role: Role
  readonly system: string
  readonly user: string
  readonly seen: number
}
const modelLog: ModelCall[] = []
/** What the answering call says. Receives the whole prompt (system + user), so a script can react to a refusal in it. */
let answerScript: (prompt: string, attempt: number) => string = () => '{}'
/** What the thread resolver says for the latest message; null repeats it back unchanged (the honest resolver). */
let rewriteScript: ((latest: string) => string | null) | null = null
/** What the office's own "rewrite this answer so it promises nothing" call says (a correction pass; any other unrouted call). */
let correctionScript: (draft: string) => string = () => '{}'
let answerCalls = 0
const roleOf = (system: string): Role =>
  system.startsWith('You rewrite one sentence so it stands alone')
    ? 'rewrite'
    : system.startsWith('You read one message from')
      ? 'read'
      : system.startsWith('You are the chief of staff of a small office')
        ? 'plan'
        : /^You are [A-Z][a-z]+, /.test(system)
          ? 'answer'
          : 'other'
const stub = {
  complete: async (req: { messages: { role: string; content: string }[] }) => {
    const system = req.messages[0]?.content ?? ''
    const user = req.messages
      .slice(1)
      .map((m) => m.content)
      .join('\n')
    const role = roleOf(system)
    modelLog.push({ role, system: system.slice(0, 80), user, seen: modelLog.length })
    if (role === 'answer') {
      answerCalls += 1
      const said = answerScript(`${system}\n${user}`, answerCalls)
      if (process.env.VA_DEBUG)
        console.log(`  [answer #${String(answerCalls)}] ${said.slice(0, 90)}`)
      return { content: said, model: 'va/stub' }
    }
    // The roster's reading of a clause ("which specialist?"): a model with no view names nobody. It is a different
    // call from a correction pass and must not be answered by (or counted as) one: a turn typed to the chief's bot is
    // routed, so it can be asked. It stays in `modelLog` as an "other" call, so it is still counted as a model call.
    if (role === 'other' && system.startsWith('You route one request'))
      return { content: 'none', model: 'va/stub' }
    if (role === 'other') return { content: correctionScript(user), model: 'va/stub' }
    if (role === 'rewrite') {
      const latest = /Latest message:\n([\s\S]*)$/.exec(user)?.[1] ?? ''
      const said = rewriteScript === null ? null : rewriteScript(latest)
      return { content: said ?? latest, model: 'va/stub' }
    }
    return { content: '{}', model: 'va/stub' }
  },
}

// ---------------------------------------------------------------------------------------------------------------
// the real worker, the real handlers, the real notifier stack
// ---------------------------------------------------------------------------------------------------------------
const handlers: Handler[] = [
  instructionHandler({ db, router: stub as never, now: () => new Date() }),
  remindersHandler(db),
  planHandler(db),
  ...notebookHandlers(db),
]
const pager = await pagerBot(db)
if (pager === null) throw new Error('the clone has no pager bot')
const pagerFor = async () =>
  new TelegramPager(db, new TelegramClient(pager.token), { botId: pager.botId })
// The bar for a handler with no opinion is the floor the person set (pass.ts), 'routine' only when none is set.
const pagerFloor = String(
  (
    await one(
      `select coalesce((select value #>> '{}' from public.system_config where key = 'telegram.pager_floor'), 'routine') as v`,
    )
  ).v,
)
const notify = combinedNotifier([replyChannel(db), pagerChannel(pagerFor, pagerFloor as never)], db)
const review: Reviewer = async () => ({ status: 'approved', notes: 'v1 acceptance' })
const kinds = handlers.map((h) => h.kind)
const kindList = kinds.map(lit).join(', ')

/** Run the worker until nothing it can take is left. Time passes between ticks: a retry's delay is waived. */
const settle = async (max = 14): Promise<WorkerResult[]> => {
  const all: WorkerResult[] = []
  for (let i = 0; i < max; i++) {
    await db.execute(
      `update public.jobs set not_before = null where state in ('queued', 'retrying') and not_before is not null and kind in (${kindList})`,
    )
    const got = await drain(db, 'va-acceptance', handlers, review, 12, { notify })
    all.push(...got)
    const live = await num(
      `select count(*)::int as c from public.jobs where state in ('queued', 'retrying', 'running', 'output_created', 'quality_review', 'committing', 'committed', 'notifying') and kind in (${kindList})`,
    )
    if (got.length === 0 && live === 0) break
  }
  return all
}

// ---------------------------------------------------------------------------------------------------------------
// door helpers and canonical readers
// ---------------------------------------------------------------------------------------------------------------
interface Turn {
  readonly status: number
  readonly body: Record<string, unknown>
  readonly command: string | null
  readonly job: string | null
  readonly messageId: number
  readonly updateId: number
}
const commandByKey = async (key: string) =>
  (
    await rows(
      `select command_id::text as id, job_id::text as job, origin_channel, actor, instruction, synthetic, context::text as ctx, office_id::text as office
         from public.inbound_commands where dedupe_key = ${lit(key)}`,
    )
  )[0]
const tgUpdate = (
  text: string,
  o: { messageId?: number; updateId?: number; extra?: Record<string, unknown> } = {},
) => ({
  update_id: o.updateId ?? n(),
  message: {
    message_id: o.messageId ?? n(),
    date: Math.floor(Date.now() / 1000),
    text,
    chat: { id: GRANT_TG, type: 'private' },
    from: { id: GRANT_TG },
    ...(o.extra ?? {}),
  },
})
const sayTelegram = async (
  text: string,
  o: { messageId?: number; updateId?: number; extra?: Record<string, unknown> } = {},
): Promise<Turn> => {
  const update = tgUpdate(text, o)
  const r = await tg.post(update)
  const key = typeof r.body.dedupe_key === 'string' ? r.body.dedupe_key : null
  const c = key === null ? undefined : await commandByKey(key)
  return {
    status: r.status,
    body: r.body,
    command: c === undefined ? null : String(c.id),
    job: c?.job === null || c?.job === undefined ? null : String(c.job),
    messageId: update.message.message_id,
    updateId: update.update_id,
  }
}
const sayTelegramAndWork = async (
  text: string,
  o: { messageId?: number; updateId?: number; extra?: Record<string, unknown> } = {},
) => {
  const turn = await sayTelegram(text, o)
  const work = await settle()
  return { turn, work }
}
/** Team HQ's own gateway: an action by a signed-in person (the dashboard's `say`, task presses, ...). */
const hqAct = async (action: string, args: Record<string, unknown>) => {
  const r = await gw.call(
    new Request('https://gw.invalid/functions/v1/hq-api', {
      method: 'POST',
      headers: { Authorization: `Bearer ${S_GRANT}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, args }),
    }),
  )
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> }
}
const sentTexts = (from = 0): TgCall[] =>
  tgLog.slice(from).filter((c) => c.method === 'sendMessage')
const deliveriesOf = (jobId: string) =>
  rows(
    `select d.state::text as state, d.channel, d.target_ref, d.purpose, d.message_ref, d.attempt, d.error_code, d.dedupe_key, d.thread_ref
       from public.deliveries d where d.job_id = ${lit(jobId)}::uuid order by d.created_at`,
  )
const jobState = async (jobId: string) =>
  (
    await rows(
      `select state::text as s, attempt, left(state_reason, 160) as why, kind from public.jobs where job_id = ${lit(jobId)}::uuid`,
    )
  )[0] as { s: string; attempt: number; why: string | null; kind: string } | undefined
const tasksOfJob = (jobId: string) =>
  rows(
    `select task_id::text as id, title, state, due_on::text as due, remind_at, reminded_at, remind_job_id::text as remind_job, remind_sends as sends,
            repeat_every::text as rep, assigned_to_human as mine, done_at, completed_by, added_by
       from public.tasks where job_id = ${lit(jobId)}::uuid order by created_at`,
  )
const taskById = async (id: string) =>
  (
    await rows(
      `select task_id::text as id, title, state, due_on::text as due, remind_at, reminded_at, remind_job_id::text as remind_job, remind_sends as sends,
              repeat_every::text as rep, assigned_to_human as mine, done_at, completed_by
         from public.tasks where task_id = ${lit(id)}::uuid`,
    )
  )[0] as Record<string, unknown>
const answerOf = async (jobId: string) =>
  String(
    (
      await rows(
        `select body from public.outputs where job_id = ${lit(jobId)}::uuid order by created_at desc limit 1`,
      )
    )[0]?.body ?? '',
  )
const officeTasks = () => num(`select count(*)::int as c from public.tasks where office_id = ${O}`)
const modelCalls = (role?: Role) =>
  modelLog.filter((c) => role === undefined || c.role === role).length

/** One run of the real reminder duty: it falls due, the dispatcher enqueues it, the worker runs it. */
const dutyTick = async () => {
  await db.execute(
    `update public.responsibilities set last_run_at = app.now_utc() - interval '20 minutes' where job_kind = 'tasks.remind'`,
  )
  if (process.env.VA_DEBUG) {
    console.log(
      `  (due now: ${JSON.stringify((await one(`select app.reminders_due(${O}) as v`)).v)})`,
    )
    console.log(
      `  (in flight: ${JSON.stringify(await rows(`select title, remind_at, reminded_at, remind_job_id::text, remind_sends from public.tasks where remind_job_id is not null or (remind_at is not null and reminded_at is null)`))})`,
    )
  }
  const fired = await rows(
    `select duty_slug, outcome, fired_job_id::text as job from app.dispatch_due_responsibilities() where duty_kind = 'tasks.remind'`,
  )
  const before = tgLog.length
  const work = await settle()
  const job = fired[0]?.job === null || fired[0]?.job === undefined ? null : String(fired[0].job)
  if (job === null) console.log(`  (tick: dispatcher said ${JSON.stringify(fired)})`)
  return { fired, job, work, sent: sentTexts(before) }
}
/** The clock reaches the reminder: it becomes due to the database. (A series is moved by whole periods, see rewindSeries.) */
const clockReaches = (id: string) =>
  db.execute(
    `update public.tasks set remind_at = app.now_utc() - interval '1 second', reminded_at = null, remind_job_id = null, remind_sends = 0 where task_id = ${lit(id)}::uuid`,
  )
const lapseLeases = (jobId: string) =>
  db.execute(
    `update public.deliveries set lease_expires_at = app.now_utc() - interval '1 second' where job_id = ${lit(jobId)}::uuid and state = 'claimed'`,
  )

console.log(`v1 acceptance suite A against ${process.argv[2] ?? 'va_x'} (run ${run}); office ${op}`)

// ===============================================================================================================
begin('A', 'TASK + REMINDER: "Remind me Friday at 10am to call Mum."')
{
  const D = dayWord(ATHENS)
  const sentence = `Remind me ${D.word} at 10am to call Mum.`
  const mark = tgLog.length
  const calls0 = modelCalls()
  const { turn } = await sayTelegramAndWork(sentence)
  check(
    'the Telegram door accepted the message and queued exactly one job',
    turn.status === 200 && turn.job !== null && turn.command !== null,
    JSON.stringify(turn.body).slice(0, 120),
  )
  const cmd =
    turn.command === null
      ? undefined
      : (
          await rows(
            `select origin_channel, actor, synthetic, office_id::text as office, instruction from public.inbound_commands where command_id = ${lit(turn.command)}::uuid`,
          )
        )[0]
  check(
    'the ledger holds one trusted command of the person (telegram, his chat, the operator office, not synthetic)',
    cmd?.origin_channel === 'telegram' &&
      cmd.actor === CHAT &&
      cmd.synthetic === false &&
      cmd.office === op &&
      cmd.instruction === sentence,
    JSON.stringify(cmd),
  )
  const jid = String(turn.job)
  const js = await jobState(jid)
  check(
    'the instruction job completed on the first attempt',
    js?.s === 'complete' && js.kind === 'office.instruction' && js.attempt === 1,
    JSON.stringify(js),
  )
  const tasks = await tasksOfJob(jid)
  const t = tasks[0]
  check(
    'exactly one task came of it, a personal one with a clean title',
    tasks.length === 1 && t?.title === 'Call Mum' && t.mine === true && t.state === 'todo',
    JSON.stringify(tasks),
  )
  check(
    `remind_at is ${D.short} 10:00 in the office zone (${ATHENS}) and in the future`,
    isLocal(t?.remind_at, ATHENS, D.short, 10, 0) &&
      new Date(String(t?.remind_at)).getTime() > Date.now(),
    `stored ${t?.remind_at === undefined ? 'null' : at(t.remind_at, ATHENS)} (${String(t?.remind_at)})`,
  )
  check(
    'the due date is that same local day',
    t?.due === local(new Date(String(t?.remind_at)), ATHENS).date,
    `due ${String(t?.due)}`,
  )
  const reply = sentTexts(mark)[0]
  check(
    'the person was answered in his own chat, as a reply to his message, naming the task, the time and the zone',
    sentTexts(mark).length === 1 &&
      reply?.chat === CHAT &&
      reply.replyTo === turn.messageId &&
      /Call Mum/.test(reply.text) &&
      /10:00/.test(reply.text) &&
      reply.text.includes(ATHENS),
    reply === undefined ? 'no message' : reply.text.slice(0, 160),
  )
  const dl = await deliveriesOf(jid)
  check(
    'the reply is one delivery row, sent, with the provider message id recorded',
    dl.length === 1 &&
      dl[0]?.state === 'sent' &&
      dl[0].target_ref === CHAT &&
      dl[0].message_ref !== null,
    JSON.stringify(dl),
  )
  check(
    'no model was consulted anywhere in this journey so far (deterministic path)',
    modelCalls() === calls0,
    `${String(modelCalls() - calls0)} model call(s)`,
  )

  const taskId = String(t?.id)
  // ---- not before its time
  const quiet = await dutyTick()
  check(
    'a tick BEFORE the reminder time says nothing: the duty ran, announced nothing, delivered nothing',
    quiet.job !== null &&
      quiet.sent.length === 0 &&
      (await deliveriesOf(String(quiet.job))).length === 0,
    `${String(quiet.sent.length)} message(s)`,
  )
  await db.execute(
    `update public.tasks set remind_at = app.now_utc() + interval '2 minutes' where task_id = ${lit(taskId)}::uuid`,
  )
  const quiet2 = await dutyTick()
  check(
    '...and two minutes before it still says nothing (the boundary is the clock, not the date)',
    quiet2.sent.length === 0 && (await taskById(taskId)).remind_job === null,
    `${String(quiet2.sent.length)} message(s)`,
  )

  // ---- the moment arrives, the first send is a provider 500: it is NOT a reminded reminder
  await clockReaches(taskId)
  tgScript.push({ status: 500, description: 'Internal Server Error' })
  const fire1 = await dutyTick()
  const afterFire1 = await taskById(taskId)
  const fireDeliveries = fire1.job === null ? [] : await deliveriesOf(fire1.job)
  check(
    'when its time comes the real duty announces it, naming the task, through the real pager to his chat',
    fire1.sent.length === 1 &&
      fire1.sent[0]?.chat === CHAT &&
      /Call Mum/.test(fire1.sent[0].text) &&
      /^Reminder/.test(fire1.sent[0].text),
    fire1.sent[0]?.text.slice(0, 100) ?? 'no message',
  )
  check(
    'the provider failed (500): the delivery is backing off, NOT sent, and the task is NOT marked reminded (said is not delivered)',
    fireDeliveries.length === 1 &&
      fireDeliveries[0]?.state === 'claimed' &&
      afterFire1.reminded_at === null &&
      afterFire1.remind_job === fire1.job,
    JSON.stringify({
      d: fireDeliveries.map((d) => `${String(d.state)}/${String(d.error_code)}`),
      reminded: afterFire1.reminded_at,
      inflight: afterFire1.remind_job === fire1.job,
    }),
  )
  const between = await dutyTick()
  check(
    'while its delivery is backing off a later tick does not announce it a second time',
    between.sent.length === 0,
    `${String(between.sent.length)} message(s)`,
  )
  // ---- the redrive sends it once the backoff has passed (time passes)
  const beforeRedrive = tgLog.length
  if (fire1.job !== null) await lapseLeases(fire1.job)
  await settle()
  const redriven = sentTexts(beforeRedrive)
  const afterRedrive = fire1.job === null ? [] : await deliveriesOf(fire1.job)
  check(
    'the delivery redrive resends it once the backoff has passed: one sent row for the job, the provider accepted it exactly once',
    afterRedrive.length === 1 &&
      afterRedrive[0]?.state === 'sent' &&
      afterRedrive[0].message_ref !== null &&
      redriven.length === 1 &&
      /Call Mum/.test(redriven[0]?.text ?? ''),
    JSON.stringify({
      rows: afterRedrive.map((d) => `${String(d.state)}#${String(d.attempt)}`),
      resent: redriven.length,
    }),
  )
  check(
    'still not marked reminded until the NEXT tick reads the delivery as sent',
    (await taskById(taskId)).reminded_at === null,
    '',
  )
  const settled = await dutyTick()
  const done = await taskById(taskId)
  check(
    'the next tick reads the delivery as sent and only then marks it reminded; nothing is said again',
    done.reminded_at !== null && done.remind_job === null && settled.sent.length === 0,
    JSON.stringify({ reminded: done.reminded_at !== null, said: settled.sent.length }),
  )
  for (let i = 0; i < 3; i++) await dutyTick()
  const reminderMessages = tgLog.filter(
    (c) => c.method === 'sendMessage' && /^Reminder/.test(c.text) && /Call Mum/.test(c.text),
  )
  check(
    'later ticks never send a duplicate: one reminder message was ACCEPTED, two were attempted (the 500 and the redrive)',
    reminderMessages.length === 2 &&
      (await num(
        `select count(*)::int as c from public.deliveries where purpose = 'result' and job_id in (select job_id from public.jobs where kind = 'tasks.remind') and state = 'sent' and dedupe_key like 'job:%'`,
      )) >= 1,
    `${String(reminderMessages.length)} attempts`,
  )
  check(
    'the task row is still ONE task and is still not done',
    (await num(
      `select count(*)::int as c from public.tasks where office_id = ${O} and title = 'Call Mum'`,
    )) === 1 && done.state === 'todo',
    '',
  )

  // ---- a terminal refusal (another reminder, so the office has not "already said" this sentence today)
  const plumber = await sayTelegramAndWork(`Remind me ${D.word} at 11am to pay the plumber.`)
  const plumberTask = (await tasksOfJob(String(plumber.turn.job)))[0]
  const plumberId = String(plumberTask?.id)
  await clockReaches(plumberId)
  // An unclassified 400 is terminal ('unknown_error') without telling the office that his chat is gone (a real
  // "chat not found" correctly stops the office writing to that chat, which would end this run's conversation).
  tgScript.push({ status: 400, description: 'Bad Request: something the office has no word for' })
  const refusedTick = await dutyTick()
  const afterRefuse = await taskById(plumberId)
  const refusedRows = refusedTick.job === null ? [] : await deliveriesOf(refusedTick.job)
  check(
    'a TERMINAL provider refusal is recorded failed (and surfaces on the undelivered list), and the task is NOT marked reminded',
    refusedRows.length === 1 &&
      refusedRows[0]?.state === 'failed' &&
      afterRefuse.reminded_at === null,
    JSON.stringify(refusedRows.map((d) => `${String(d.state)}/${String(d.error_code)}`)),
  )
  const failedEvents =
    refusedTick.job === null
      ? 0
      : await num(
          `select count(*)::int as c from public.events where related_job_id = ${lit(refusedTick.job)}::uuid and action_type = 'delivery.failed'`,
        )
  const undeliveredRaw = (await one(`select app.undelivered(null, 200) as u`)).u
  const undeliveredList = (
    typeof undeliveredRaw === 'string' ? JSON.parse(undeliveredRaw) : undeliveredRaw
  ) as { job: string }[]
  check(
    '...and the loss is visible where the office looks: a delivery.failed event in the ledger and a row on the undelivered list',
    failedEvents === 1 && undeliveredList.some((u) => u.job === refusedTick.job),
    JSON.stringify({
      events: failedEvents,
      listed: undeliveredList.some((u) => u.job === refusedTick.job),
    }),
  )
  const retryTick = await dutyTick()
  const retryTick2 = await dutyTick()
  const finalTask = await taskById(plumberId)
  check(
    'the next tick re-opens it and sends it again (a lost reminder is not a finished reminder); once that is delivered it is reminded; nothing more is said',
    retryTick.sent.length === 1 &&
      /pay the plumber/i.test(retryTick.sent[0]?.text ?? '') &&
      finalTask.reminded_at !== null &&
      retryTick2.sent.length === 0,
    JSON.stringify({
      resent: retryTick.sent.length,
      reminded: finalTask.reminded_at !== null,
      tick: retryTick.sent[0]?.text,
    }),
  )
  check(
    'every scripted provider outcome was consumed by the call it was meant for',
    tgScript.length === 0,
    `${String(tgScript.length)} left`,
  )

  // ---- a second office zone: the same sentence at 10:00 where he is
  await setZone(NEW_YORK)
  const D2 = dayWord(NEW_YORK)
  const nyMark = tgLog.length
  const ny = await sayTelegramAndWork(`Remind me ${D2.word} at 10am to call Dad.`)
  const nyTask = (await tasksOfJob(String(ny.turn.job)))[0]
  check(
    `in ${NEW_YORK} the same sentence is ${D2.short} 10:00 LOCAL there, a different instant from Athens`,
    isLocal(nyTask?.remind_at, NEW_YORK, D2.short, 10, 0) &&
      !isLocal(nyTask?.remind_at, ATHENS, D2.short, 10, 0),
    `stored ${nyTask?.remind_at === undefined ? 'null' : at(nyTask.remind_at, NEW_YORK)} NY = ${nyTask?.remind_at === undefined ? 'null' : at(nyTask.remind_at, ATHENS)} Athens`,
  )
  check(
    '...and the reply names the zone it used',
    sentTexts(nyMark).some((c) => c.text.includes(NEW_YORK) && /10:00/.test(c.text)),
    sentTexts(nyMark)[0]?.text.slice(0, 120) ?? '',
  )
  const nyId = String(nyTask?.id)
  await clockReaches(nyId)
  const nyFire = await dutyTick()
  await dutyTick()
  check(
    'the New York reminder fires once, to the same chat, and is marked reminded after delivery',
    nyFire.sent.length === 1 &&
      /Call Dad/.test(nyFire.sent[0]?.text ?? '') &&
      (await taskById(nyId)).reminded_at !== null,
    JSON.stringify({ sent: nyFire.sent.length }),
  )
  await setZone(ATHENS)

  // ---- NEIGHBOUR: two one-off reminders with the SAME words on the same day (take the pills at 4pm, ticked off, then at 8pm)
  const pills1 = await sayTelegramAndWork(`Remind me ${D.word} at 4pm to take the pills.`)
  const pillsTask1 = String((await tasksOfJob(String(pills1.turn.job)))[0]?.id)
  await clockReaches(pillsTask1)
  const pf1 = await dutyTick()
  await dutyTick()
  check(
    'first same-words reminder is delivered',
    pf1.sent.length === 1 &&
      /take the pills/i.test(pf1.sent[0]?.text ?? '') &&
      (await taskById(pillsTask1)).reminded_at !== null,
    JSON.stringify({ sent: pf1.sent.length }),
  )
  await db.execute(`select app.hq_task_state(${O}, ${lit(pillsTask1)}, 'done', null, 'grant')`)
  const pills2 = await sayTelegramAndWork(`Remind me ${D.word} at 8pm to take the pills.`)
  const pillsTask2 = String((await tasksOfJob(String(pills2.turn.job)))[0]?.id)
  check(
    'the second is its own task (the first was ticked off)',
    pillsTask2 !== 'undefined' && pillsTask2 !== pillsTask1,
    pillsTask2,
  )
  await clockReaches(pillsTask2)
  const pf2 = await dutyTick()
  for (let i = 0; i < 4; i++) await dutyTick()
  const pillsEnd = await taskById(pillsTask2)
  const pillsDeliveries = await num(
    `select count(*)::int as c from public.deliveries d join public.jobs j on j.job_id = d.job_id where j.kind = 'tasks.remind' and d.state = 'sent' and d.job_id in (select remind_job_id from public.tasks where task_id = ${lit(pillsTask2)}::uuid union select ${lit(String(pf2.job))}::uuid)`,
  )
  check(
    'NEIGHBOUR: the SECOND same-words reminder of the day is also delivered (it must not be muted as "already said" and then quietly given up)',
    pf2.sent.length === 1 &&
      /take the pills/i.test(pf2.sent[0]?.text ?? '') &&
      pillsDeliveries >= 1,
    JSON.stringify({
      sentOnItsFirstTick: pf2.sent.length,
      finishedWithoutDelivery: pillsEnd.reminded_at !== null && pillsDeliveries === 0,
      reminded: pillsEnd.reminded_at !== null,
    }),
  )
  // The person ticks the rest off before the next journey (a same-titled OPEN task is deduplicated by the office: "already on your list").
  for (const tid of [taskId, nyId, plumberId, pillsTask2])
    await db.execute(`select app.hq_task_state(${O}, ${lit(tid)}, 'done', null, 'grant')`)
  check(
    'no email or other channel was touched, nothing refused: every network call was Telegram to his chat',
    refused.length === 0 && tgLog.every((c) => c.chat === CHAT || c.chat === ''),
    `refused ${JSON.stringify(refused)}`,
  )

  modelDependent(
    'the real model is not on this path: the reminder sentence is read by the deterministic recogniser (no model call was made)',
  )
  modelDependent(
    'an unusual phrasing the recogniser does not know ("ping me once the week turns") would go to the real model; not exercised',
  )
  unproven(
    'Telegram delivery to the real Bot API: the transport is a scripted fake; real latency, formatting limits and bot blocking are not claimed',
  )
}
end()

// ===============================================================================================================
begin(
  'B',
  'DATE-ONLY REMINDER: "Remind me Friday to call Mum." (+ control "Task: renew X by Friday.")',
)
{
  const D = dayWord(ATHENS)
  const calls0 = modelCalls()
  const mark = tgLog.length
  const { turn } = await sayTelegramAndWork(`Remind me ${D.word} to call Mum.`)
  const jid = String(turn.job)
  const tasks = await tasksOfJob(jid)
  const t = tasks[0]
  check(
    'one task, a clean title, a personal task',
    tasks.length === 1 && t?.title === 'Call Mum' && t.mine === true,
    JSON.stringify(tasks),
  )
  check(
    `a sensible default time is given: ${D.short} 09:00 in the office zone, in the future`,
    isLocal(t?.remind_at, ATHENS, D.short, 9, 0) &&
      new Date(String(t?.remind_at)).getTime() > Date.now(),
    `stored ${t?.remind_at === undefined ? 'null' : at(t.remind_at, ATHENS)}`,
  )
  const reply = sentTexts(mark)[0]
  check(
    'the reply is truthful about the default: it says the person gave no time and names 09:00 and the zone it used',
    reply !== undefined &&
      /09:00/.test(reply.text) &&
      reply.text.includes(ATHENS) &&
      /did not say a time/i.test(reply.text),
    reply?.text.slice(0, 200) ?? 'no reply',
  )
  const taskId = String(t?.id)
  const quiet = await dutyTick()
  check('nothing is said before the time', quiet.sent.length === 0, '')
  await clockReaches(taskId)
  const fire = await dutyTick()
  check(
    'at the time the duty delivers it once, naming it',
    fire.sent.length === 1 &&
      /Call Mum/.test(fire.sent[0]?.text ?? '') &&
      fire.sent[0]?.chat === CHAT,
    fire.sent[0]?.text.slice(0, 80) ?? 'none',
  )
  await dutyTick()
  await dutyTick()
  const callMum = tgLog.filter(
    (c) =>
      c.method === 'sendMessage' &&
      /^Reminder/.test(c.text) &&
      /Call Mum/.test(c.text) &&
      c.text.includes('Call Mum'),
  )
  check(
    'once delivered it is marked reminded and never said again (later ticks are silent)',
    (await taskById(taskId)).reminded_at !== null &&
      callMum.filter((c) => c.replyTo === null).length >= 1,
    '',
  )
  const fires = await num(
    `select count(*)::int as c from public.deliveries d join public.jobs j on j.job_id = d.job_id where j.kind = 'tasks.remind' and d.state = 'sent' and d.job_id = ${lit(String(fire.job))}::uuid`,
  )
  check(
    'the firing is exactly one delivery row sent for that tick',
    fires === 1,
    `${String(fires)} sent row(s)`,
  )

  // ---- control: a due date is not a reminder
  const markC = tgLog.length
  const ctl = await sayTelegramAndWork('Task: renew X by Friday.')
  const ct = (await tasksOfJob(String(ctl.turn.job)))[0]
  check(
    'CONTROL: "Task: renew X by Friday." makes a task with a DUE DATE',
    ct?.due !== null && ct?.title !== undefined && /renew X/i.test(String(ct?.title)),
    JSON.stringify(ct),
  )
  check('...and NO reminder time', ct?.remind_at === null, String(ct?.remind_at))
  const creply = sentTexts(markC)[0]
  check(
    '...and the reply does not promise a reminder',
    creply !== undefined && !/remind you/i.test(creply.text),
    creply?.text.slice(0, 120) ?? 'none',
  )
  await db.execute(
    `update public.tasks set due_on = (app.now_utc() - interval '3 days')::date where task_id = ${lit(String(ct?.id))}::uuid`,
  )
  const lateTick = await dutyTick()
  check(
    'even long overdue it is never announced by the reminder duty (a due date is not a reminder)',
    lateTick.sent.every((c) => !/renew X/i.test(c.text)),
    `${String(lateTick.sent.length)} message(s)`,
  )
  check(
    'B needed no model call',
    modelCalls() === calls0,
    `${String(modelCalls() - calls0)} call(s)`,
  )
  modelDependent(
    'whether the real model would also ask "what time?" instead: this product does not (the recogniser defaults it and says so); a model-led turn is not exercised',
  )
}
end()

// ===============================================================================================================
begin(
  'C',
  'RECURRING: "Remind me every Monday at 9am to review my finances." (two occurrences, tick off completes that time only, then stop)',
)
{
  const calls0 = modelCalls()
  const { turn } = await sayTelegramAndWork('Remind me every Monday at 9am to review my finances.')
  const tasks = await tasksOfJob(String(turn.job))
  const t = tasks[0]
  const id = String(t?.id)
  check(
    'one task, a clean title, repeating every 7 days, a reminder series (no due date)',
    tasks.length === 1 && t?.title === 'Review my finances' && t.rep === '7 days' && t.due === null,
    JSON.stringify(tasks),
  )
  check(
    'the first reminder time is a Monday 09:00 in the office zone, in the future',
    isLocal(t?.remind_at, ATHENS, 'Mon', 9, 0) &&
      new Date(String(t?.remind_at)).getTime() > Date.now(),
    t?.remind_at === undefined ? 'null' : at(t.remind_at, ATHENS),
  )
  const anchor = new Date(String(t?.remind_at))

  // occurrence 1: time passes by exactly one period (the wall-clock anchor survives), the duty fires, the message is delivered
  // The rewind moves the wall clock, as the product does: 168 hours of absolute time would turn 09:00 into 10:00 across a
  // change of clocks (the anchor is after 25 October 2026, the rewound occurrence is before it).
  const rewindSeries = (periods: number) =>
    db.execute(
      `update public.tasks set remind_at = ((${lit(anchor.toISOString())}::timestamptz at time zone ${lit(ATHENS)}) - interval '${String(periods * 7)} days') at time zone ${lit(ATHENS)} where task_id = ${lit(id)}::uuid`,
    )
  await rewindSeries(1)
  const f1 = await dutyTick()
  check(
    'occurrence 1: the duty announces it once, naming it',
    f1.sent.length === 1 &&
      /Review my finances/.test(f1.sent[0]?.text ?? '') &&
      f1.sent[0]?.chat === CHAT,
    f1.sent[0]?.text.slice(0, 80) ?? 'none',
  )
  const inFlight = await taskById(id)
  check(
    '...it is in flight, not advanced, until the delivery is known (said is not delivered)',
    inFlight.remind_job === f1.job && inFlight.reminded_at === null,
    JSON.stringify({ job: inFlight.remind_job === f1.job }),
  )
  const s1 = await dutyTick()
  const after1 = await taskById(id)
  check(
    'the next tick sees the delivery sent and ADVANCES THE SAME ROW in place: still one row, a Monday 09:00 a period later, re-armed',
    s1.sent.length === 0 &&
      (await num(
        `select count(*)::int as c from public.tasks where office_id = ${O} and title = 'Review my finances'`,
      )) === 1 &&
      isLocal(after1.remind_at, ATHENS, 'Mon', 9, 0) &&
      new Date(String(after1.remind_at)).getTime() > Date.now() &&
      after1.reminded_at === null &&
      after1.remind_job === null &&
      Number(after1.sends) === 0 &&
      after1.id === id,
    `remind_at now ${after1.remind_at === undefined || after1.remind_at === null ? 'null' : at(after1.remind_at, ATHENS)}`,
  )
  check(
    '...and it is still a todo that repeats',
    after1.state === 'todo' && after1.rep === '7 days',
    JSON.stringify({ state: after1.state, rep: after1.rep }),
  )
  const quietBetween = await dutyTick()
  check('between occurrences nothing is said', quietBetween.sent.length === 0, '')

  // occurrence 2, a week later: the office's "already told him today" memory is a day old at most, so a week ages it
  await db.execute(
    `update public.duty_said set said_at = said_at - interval '8 days', last_seen_at = last_seen_at - interval '8 days'`,
  )
  await rewindSeries(1)
  const f2 = await dutyTick()
  check(
    'occurrence 2: the same row is announced again, a different tick, a different delivery',
    f2.sent.length === 1 && /Review my finances/.test(f2.sent[0]?.text ?? '') && f2.job !== f1.job,
    f2.sent[0]?.text.slice(0, 80) ?? 'none',
  )
  await dutyTick()
  const after2 = await taskById(id)
  check(
    'and advanced in place a second time: ONE row throughout, re-armed for the next Monday',
    (await num(
      `select count(*)::int as c from public.tasks where office_id = ${O} and title = 'Review my finances'`,
    )) === 1 &&
      isLocal(after2.remind_at, ATHENS, 'Mon', 9, 0) &&
      after2.reminded_at === null,
    after2.remind_at === null || after2.remind_at === undefined
      ? 'null'
      : at(after2.remind_at, ATHENS),
  )
  const sentPair = await num(
    `select count(*)::int as c from public.deliveries d join public.jobs j on j.job_id = d.job_id where d.state = 'sent' and j.job_id in (${lit(String(f1.job))}::uuid, ${lit(String(f2.job))}::uuid)`,
  )
  check(
    'two firings were two delivered messages, no more',
    sentPair === 2,
    `${String(sentPair)} sent rows`,
  )

  // ticking off completes THAT TIME only. FLIPPED 7 October 2026 by the owner's decision: it used to END the series (state
  // done, "no next occurrence row"); now the row stays open and repeating and only a separate "stop" ends it.
  const markT = tgLog.length
  const off = await sayTelegramAndWork('Tick off the review my finances task.')
  const ended = await taskById(id)
  const offAnswer = sentTexts(markT)[0]
  check(
    '"tick off" completes THAT TIME only: the row stays open (todo, not done) and repeating, and the occurrence is recorded',
    ended.state === 'todo' &&
      ended.done_at === null &&
      ended.rep === '7 days' &&
      (await num(
        `select count(*)::int as c from public.tasks where task_id = ${lit(id)}::uuid and last_completed_for is not null and last_completed_at is not null`,
      )) === 1,
    JSON.stringify({ state: ended.state, rep: ended.rep }),
  )
  check(
    '...and the reply says so truthfully: done for this time, still repeating, and how to stop it',
    offAnswer !== undefined &&
      /review my finances/i.test(offAnswer.text) &&
      /done for this time/i.test(offAnswer.text) &&
      /still repeating/i.test(offAnswer.text) &&
      /stop the .+ reminder/i.test(offAnswer.text),
    offAnswer?.text.slice(0, 160) ?? 'none',
  )
  check(
    '...and no occurrence row is created (still one row) and the next time is still a Monday 09:00 in the future',
    (await num(
      `select count(*)::int as c from public.tasks where office_id = ${O} and title = 'Review my finances'`,
    )) === 1 &&
      (await num(
        `select count(*)::int as c from public.tasks where job_id = ${lit(String(off.turn.job))}::uuid`,
      )) === 0 &&
      isLocal(ended.remind_at, ATHENS, 'Mon', 9, 0) &&
      new Date(String(ended.remind_at)).getTime() > Date.now(),
    ended.remind_at === null || ended.remind_at === undefined
      ? 'null'
      : at(ended.remind_at, ATHENS),
  )
  // occurrence 3 (a different time from the one just completed) fires and is delivered, once
  await db.execute(
    `update public.duty_said set said_at = said_at - interval '8 days', last_seen_at = last_seen_at - interval '8 days'`,
  )
  await rewindSeries(2)
  const f3 = await dutyTick()
  check(
    'after the completion the next occurrence still fires: announced once, naming it',
    f3.sent.length === 1 && /Review my finances/.test(f3.sent[0]?.text ?? ''),
    f3.sent[0]?.text.slice(0, 80) ?? 'none',
  )
  await dutyTick()
  // the explicit stop
  const stopT = tgLog.length
  await sayTelegramAndWork('Stop the review my finances reminder.')
  const stopAnswer = sentTexts(stopT)[0]
  const stopped = await taskById(id)
  check(
    '"stop the review my finances reminder" ENDS the series (cancelled) and the reply says so',
    stopped.state === 'cancelled' && /stopped/i.test(stopAnswer?.text ?? ''),
    `${String(stopped.state)} | ${stopAnswer?.text.slice(0, 100) ?? 'none'}`,
  )
  await db.execute(
    `update public.tasks set remind_at = app.now_utc() - interval '1 minute' where task_id = ${lit(id)}::uuid`,
  )
  const dead = await dutyTick()
  check(
    'after it is stopped it is never announced again, even with its time long past',
    dead.sent.every((c) => !/Review my finances/.test(c.text)),
    `${String(dead.sent.length)} message(s)`,
  )
  check(
    'C needed no model call',
    modelCalls() === calls0,
    `${String(modelCalls() - calls0)} call(s)`,
  )
  unproven(
    'the third and later Mondays: advancement is proven as a function of (stored time, now); real weeks are not waited for. DST changes are covered by tk-reminders.ts, not here',
  )
  modelDependent('the real model is not on this path')
}
end()

// ===============================================================================================================
begin('D', 'TASK COMPLETION: "Add a task to call the roofer." then "Mark the roofer task done."')
{
  const calls0 = modelCalls()
  const base = await officeTasks()
  const m1 = tgLog.length
  const add = await sayTelegramAndWork('Add a task to call the roofer.')
  const addTasks = await tasksOfJob(String(add.turn.job))
  check(
    'exactly one task was created, titled for the work, open, a personal task',
    addTasks.length === 1 &&
      addTasks[0]?.title === 'Call the roofer' &&
      addTasks[0].state === 'todo' &&
      addTasks[0].mine === true,
    JSON.stringify(addTasks),
  )
  const reply1 = sentTexts(m1)[0]
  check(
    'the first confirmation is truthful: it says it was added, names it, and does not claim it is done',
    reply1 !== undefined &&
      /roofer/i.test(reply1.text) &&
      /list|added|add/i.test(reply1.text) &&
      !/\bdone\b|ticked/i.test(reply1.text),
    reply1?.text.slice(0, 140) ?? 'none',
  )
  const afterAdd = await officeTasks()
  check(
    'one new row in the office, no more',
    afterAdd === base + 1,
    `${String(base)} -> ${String(afterAdd)}`,
  )
  const m2 = tgLog.length
  const done = await sayTelegramAndWork('Mark the roofer task done.')
  const finished = await taskById(String(addTasks[0]?.id))
  check(
    '"Mark the roofer task done" completes THE ORIGINAL task: same row, state done, done_at and completed_by set',
    finished.state === 'done' && finished.done_at !== null && finished.completed_by !== null,
    JSON.stringify({ state: finished.state, by: finished.completed_by }),
  )
  const afterDone = await officeTasks()
  check(
    'ZERO junk tasks: the completing turn created no task (no "the roofer task done"), and the office still holds exactly one more than before',
    (await num(
      `select count(*)::int as c from public.tasks where job_id = ${lit(String(done.turn.job))}::uuid`,
    )) === 0 && afterDone === base + 1,
    `${String(base)} -> ${String(afterAdd)} -> ${String(afterDone)}`,
  )
  const reply2 = sentTexts(m2)[0]
  check(
    'the second confirmation is truthful: it says the roofer task is done, names it, and claims nothing else',
    reply2 !== undefined &&
      /roofer/i.test(reply2.text) &&
      /done|ticked/i.test(reply2.text) &&
      !/\badded\b/i.test(reply2.text),
    reply2?.text.slice(0, 140) ?? 'none',
  )
  const dls = await deliveriesOf(String(done.turn.job))
  check(
    'exactly one delivery for each turn, both sent to his chat',
    dls.length === 1 &&
      dls[0]?.state === 'sent' &&
      (await deliveriesOf(String(add.turn.job))).length === 1,
    '',
  )

  // controls and neighbours
  const nothing = await sayTelegramAndWork('Mark the plasterer task done.')
  const ntasks = await num(
    `select count(*)::int as c from public.tasks where job_id = ${lit(String(nothing.turn.job))}::uuid`,
  )
  check(
    'CONTROL: completing a task that does not exist completes nothing, creates no junk task, and does not claim success',
    ntasks === 0 &&
      (await officeTasks()) === afterDone &&
      !/ticked off|is done/i.test(sentTexts(m2 + 1).slice(-1)[0]?.text ?? ''),
    sentTexts().slice(-1)[0]?.text.slice(0, 120) ?? '',
  )
  const twoA = await sayTelegramAndWork('Add a task to call the electrician about the fuse box.')
  const twoB = await sayTelegramAndWork(
    'Add a task to call the electrician about the garden lights.',
  )
  const pickBefore = await num(
    `select count(*)::int as c from public.tasks where office_id = ${O} and state = 'done'`,
  )
  const pick = await sayTelegramAndWork('Mark the electrician task done.')
  const pickAfter = await num(
    `select count(*)::int as c from public.tasks where office_id = ${O} and state = 'done'`,
  )
  check(
    'NEIGHBOUR: with TWO electrician tasks open, "mark the electrician task done" does not guess: neither is completed and it asks which',
    pickAfter === pickBefore &&
      (await num(
        `select count(*)::int as c from public.tasks where job_id = ${lit(String(pick.turn.job))}::uuid`,
      )) === 0 &&
      /which|both|more than one|two/i.test(sentTexts().slice(-1)[0]?.text ?? ''),
    `done ${String(pickBefore)} -> ${String(pickAfter)}; said: ${sentTexts().slice(-1)[0]?.text.slice(0, 140) ?? 'none'}`,
  )
  void twoA
  void twoB
  check(
    'D needed no model call',
    modelCalls() === calls0,
    `${String(modelCalls() - calls0)} call(s)`,
  )
  modelDependent(
    'picking the right task when two match is done by deterministic title matching here; a real model-led turn could resolve "the electrician one" differently and is not exercised',
  )
}
end()

// ===============================================================================================================
const DRAFT_TEXT = `Subject: Your quote is delayed\n\nHi Kevin,\n\nA quick note to say the quote will be a few days late. Sorry for the wait, and I will send it as soon as it is ready.\n\nBest,\nGrant`
/** Every consequence claim of the mail or outbound class in a delivered text (none may stand without a row behind it). */
const sendClaims = (text: string) =>
  consequenceClaims(text).filter((c) => c.cls === 'mail' || c.cls === 'outbound')
const contactsOutside = () =>
  num(
    `select count(*)::int as c from public.deliveries where office_id = ${O} and (channel <> 'telegram' or target_ref <> ${lit(CHAT)})`,
  )

begin(
  'E',
  'DRAFT WITHOUT SENDING: "Draft an email to Kevin explaining that the quote is delayed, but don\'t send it."',
)
{
  const sentence =
    "Draft an email to Kevin explaining that the quote is delayed, but don't send it."
  const outside0 = await contactsOutside()
  const m0 = tgLog.length
  answerScript = () =>
    process.env.VA_LEAD === undefined ? DRAFT_TEXT : `${process.env.VA_LEAD}\n\n${DRAFT_TEXT}`
  const { turn } = await sayTelegramAndWork(sentence)
  const jid = String(turn.job)
  const js = await jobState(jid)
  const said = sentTexts(m0)
  const body = await answerOf(jid)
  check(
    'the turn completed (not failed, not retried away) and the person got exactly one answer in his own chat',
    js?.s === 'complete' && said.length === 1 && said[0]?.chat === CHAT,
    JSON.stringify({ job: js, messages: said.length }),
  )
  check(
    'a draft exists and is durable: the stored output of the job holds the email text (subject and body)',
    /Subject: Your quote is delayed/.test(body) && /Hi Kevin/.test(body),
    body.slice(0, 80),
  )
  check(
    '...and the same draft is what the person was shown',
    /Your quote is delayed/.test(said[0]?.text ?? '') && /Hi Kevin/.test(said[0]?.text ?? ''),
    said[0]?.text.slice(0, 80) ?? 'none',
  )
  check(
    'the ledger recorded the committed finding for the turn (events: finding.committed, tied to the job)',
    (await num(
      `select count(*)::int as c from public.events where related_job_id = ${lit(jid)}::uuid and action_type = 'finding.committed'`,
    )) === 1,
    '',
  )
  const docs = await num(
    `select count(*)::int as c from public.documents where produced_by_job = ${lit(jid)}::uuid`,
  )
  observed(
    `what a draft leaves behind: an outputs row (the answer) and a delivered message; documents produced by the job: ${String(docs)} (a drafted email is conversation text, not a filed document)`,
  )
  check(
    'NO external contact: the only delivery rows are to the person himself, and no non-Telegram or non-owner destination exists',
    (await contactsOutside()) === outside0 &&
      (await deliveriesOf(jid)).every((d) => d.target_ref === CHAT && d.channel === 'telegram'),
    `${String((await contactsOutside()) - outside0)} outside`,
  )
  check(
    '...and no network call left the process except Telegram to his chat (nothing refused, no mail host)',
    refused.length === 0 && tgLog.every((c) => c.chat === CHAT || c.chat === ''),
    JSON.stringify(refused),
  )
  check(
    '...no send path exists: gmail.send is switched off in the registry and no gmail.send event was ever recorded',
    (await num(
      `select count(*)::int as c from public.tool_permissions where tool = 'gmail.send' and enabled`,
    )) === 0 &&
      (await num(`select count(*)::int as c from public.events where tool_used = 'gmail.send'`)) ===
        0,
    '',
  )
  check(
    'the answer does not claim it was sent (no completed-send claim of any kind in the delivered text)',
    sendClaims(said[0]?.text ?? '').length === 0,
    JSON.stringify(sendClaims(said[0]?.text ?? '').map((c) => c.quote)),
  )
  // product wording, read from the delivered text: a draft request must not be answered "I have not done this yet"
  check(
    'the reply to a DRAFT request does not open by telling the person the work was not done (the draft IS the work)',
    !/I have not done this/i.test(said[0]?.text ?? ''),
    (said[0]?.text ?? '').slice(0, 110),
  )

  // ---- a model's most natural lead: "I've drafted the email for you:" must not make the office throw the draft away
  {
    const mL = tgLog.length
    const otherBefore = modelCalls('other')
    // Counted at the correction pass itself. Role "other" is every model call that is not read, plan, answer or rewrite,
    // and a turn typed to the chief's bot is ROUTED now, so it includes the roster's reading of the clause: counting
    // "other" calls measured the wrong thing as soon as the roster could be asked.
    let correctionPasses = 0
    answerScript = () => `I've drafted the email for you:\n\n${DRAFT_TEXT}\n\nI have not sent it.`
    // a correction pass that behaves exactly as the office instructs it: begin with the truth, then ask what is needed (no draft)
    correctionScript = () => {
      correctionPasses += 1
      return 'I have not done this yet, and nothing has been changed. What would you like the email to say?'
    }
    const lead = await sayTelegramAndWork(
      "Draft an email to Kevin about the delivery slot, but don't send it.",
    )
    const ls = sentTexts(mL)
    check(
      'a model that leads with "I\'ve drafted the email for you:" still delivers the draft: it is not refused as a claim of completion and rewritten into a question',
      (await jobState(String(lead.turn.job)))?.s === 'complete' &&
        ls.length === 1 &&
        /Hi Kevin/.test(ls[0]?.text ?? '') &&
        correctionPasses === 0,
      JSON.stringify({
        delivered: ls.map((c) => c.text.slice(0, 120)),
        correctionCalls: correctionPasses,
        otherCalls: modelCalls('other') - otherBefore,
      }),
    )
    check(
      '...with no "I have not done this yet" in front of it and no claim of a send',
      !/I have not done this yet/i.test(ls[0]?.text ?? '') &&
        sendClaims(ls[0]?.text ?? '').length === 0,
      ls[0]?.text.slice(0, 100) ?? 'none',
    )
    correctionScript = () => '{}'
    // NEGATIVE CONTROLS: the same fix must not take the truth away from a request that also asks for the send
    const mN = tgLog.length
    answerScript = () => DRAFT_TEXT
    await sayTelegramAndWork('Draft an email to Kevin about the invoice and send it.')
    const both = sentTexts(mN)[0]?.text ?? ''
    check(
      'CONTROL: "Draft an email ... and send it" still opens by saying the work is not done (the send half is not done: "I have not done this yet", or the hand-off\'s "Nothing has changed yet", which the chief says when she routes it) and claims no send',
      /I have not done this yet|Nothing has changed yet/i.test(both) &&
        sendClaims(both).length === 0,
      both.slice(0, 120),
    )
    const mS = tgLog.length
    await sayTelegramAndWork('Send the draft to Kevin.')
    const sendDraft = sentTexts(mS)[0]?.text ?? ''
    check(
      'CONTROL: "Send the draft to Kevin." (no request to write) still opens "I have not done this yet" and claims no send',
      /I have not done this yet/i.test(sendDraft) && sendClaims(sendDraft).length === 0,
      sendDraft.slice(0, 120),
    )
  }

  // ---- the model says it was sent: the consequence gate refuses it, every time
  const m1 = tgLog.length
  const callsBefore = answerCalls
  answerScript = () => 'Email sent to Kevin: the quote is delayed and he has been told.'
  const lie = await sayTelegramAndWork(
    "Draft an email to Kevin about the revised delivery date, but don't send it.",
  )
  const lj = String(lie.turn.job)
  const lastState = await jobState(lj)
  const delivered1 = sentTexts(m1)
  check(
    'a model that claims "Email sent to Kevin" is refused by the consequence gate on every attempt (the retry loop ran, the job did not complete as an answer)',
    answerCalls - callsBefore >= 2 && lastState?.s === 'failed',
    JSON.stringify({ attempts: answerCalls - callsBefore, state: lastState }),
  )
  check(
    'the false claim itself was never delivered to anybody',
    delivered1.every((c) => !/Email sent to Kevin/i.test(c.text)) &&
      (await rows(`select body from public.outputs where job_id = ${lit(lj)}::uuid`)).every(
        (r) => !/Email sent to Kevin/i.test(String(r.body)),
      ),
    `${String(delivered1.length)} message(s)`,
  )
  check(
    'the person is told the truth instead: a message was delivered that claims no send, and says the job did not finish',
    delivered1.length >= 1 &&
      delivered1.every((c) => sendClaims(c.text).length === 0 && c.chat === CHAT),
    delivered1.map((c) => c.text.slice(0, 100)).join(' | '),
  )
  const imp = await num(
    `select count(*)::int as c from public.job_impediments where job_id = ${lit(lj)}::uuid`,
  )
  check(
    '...and the refusal is recorded as an impediment where the office looks (not a silent drop)',
    imp >= 1,
    `${String(imp)} impediment(s)`,
  )
  check(
    '...still no external contact',
    (await contactsOutside()) === outside0 && refused.length === 0,
    '',
  )

  // ---- the closed loop: a model that reads the refusal corrects itself on the next attempt
  const m2 = tgLog.length
  let sawRefusal = false
  answerScript = (prompt, attempt) => {
    if (process.env.VA_DEBUG && attempt > 1)
      console.log(`  [retry prompt tail] ${prompt.slice(-700).replace(/\n/g, ' / ')}`)
    // The retry's prompt must carry the gate's own sentence about THIS refusal, not merely the word "email".
    if (/the text \("Email sent to Kevin with the draft"\) says an email went out/i.test(prompt))
      sawRefusal = true
    return sawRefusal ? DRAFT_TEXT : 'Email sent to Kevin with the draft.'
  }
  const loop = await sayTelegramAndWork(
    "Draft an email to Kevin about the invoice, but don't send it.",
  )
  const loopSent = sentTexts(m2)
  check(
    "CLOSED LOOP: the refusal reaches the next attempt's prompt, the model corrects, and the person receives the honest draft only",
    sawRefusal &&
      (await jobState(String(loop.turn.job)))?.s === 'complete' &&
      loopSent.length === 1 &&
      /Hi Kevin/.test(loopSent[0]?.text ?? '') &&
      sendClaims(loopSent[0]?.text ?? '').length === 0,
    JSON.stringify({ sawRefusal, sent: loopSent.map((c) => c.text.slice(0, 60)) }),
  )
  answerScript = () => '{}'
  modelDependent(
    'the wording and quality of a real model\'s draft (the stub emits a fixed draft); whether a real model writes "I have not sent it" or says nothing about sending',
  )
  modelDependent(
    'whether a real model, shown the refusal, corrects itself on retry (the stub does; the loop and the gate are what is proven)',
  )
  unproven(
    'detection of a send claim in a phrasing the detector has not seen: consequence.ts is a detector, not a proof; the evidence side (no row, no claim accepted) is what is exact',
  )
}
end()

// ===============================================================================================================
begin(
  'F',
  'HUMAN-CONTACT BOUNDARY: "Send this to Kevin." and the approval boundary of an outward step that exists',
)
{
  const outside0 = await contactsOutside()
  const tasks0 = await officeTasks()
  // ---- F1: an outward request to a third human, where the office has no send path
  const m0 = tgLog.length
  answerScript = () =>
    "I can't send email from here: nothing in this office sends mail. Tell me what you want to say and I can draft it, and you can send it yourself."
  const honest = await sayTelegramAndWork('Send this to Kevin.')
  const hj = String(honest.turn.job)
  const hsent = sentTexts(m0)
  check(
    '"Send this to Kevin." completes as an answer to the person alone: one message, his own chat, a reply to his message',
    (await jobState(hj))?.s === 'complete' &&
      hsent.length === 1 &&
      hsent[0]?.chat === CHAT &&
      hsent[0].replyTo === honest.turn.messageId,
    JSON.stringify({ state: (await jobState(hj))?.s, sent: hsent.length }),
  )
  check(
    'NOTHING was sent to anybody else: no delivery outside his chat, no network call but Telegram to him, no mail event',
    (await contactsOutside()) === outside0 &&
      refused.length === 0 &&
      tgLog.every((c) => c.chat === CHAT || c.chat === '') &&
      (await num(`select count(*)::int as c from public.events where tool_used = 'gmail.send'`)) ===
        0,
    `${String((await contactsOutside()) - outside0)} outside, refused ${JSON.stringify(refused)}`,
  )
  check(
    'the sentence is not turned into junk work: no task, no document, no hand-off child',
    (await officeTasks()) === tasks0 &&
      (await num(
        `select count(*)::int as c from public.documents where produced_by_job = ${lit(hj)}::uuid`,
      )) === 0 &&
      (await num(
        `select count(*)::int as c from public.jobs where parent_job_id = ${lit(hj)}::uuid`,
      )) === 0,
    '',
  )
  check(
    'the answer the person got claims no send',
    sendClaims(hsent[0]?.text ?? '').length === 0,
    hsent[0]?.text.slice(0, 160) ?? 'none',
  )
  check(
    'the capability really does not exist: gmail.send is disabled at every level of the policy, for a typed turn too',
    (
      await rows(
        `select app.may_act(app.unnamed_project(${O}), 'gmail.send', ${lit(hj)}::uuid)::text as v`,
      )
    ).every((r) => JSON.parse(String(r.v)).verdict === 'refuse'),
    String(
      (
        await one(
          `select app.may_act(app.unnamed_project(${O}), 'gmail.send', ${lit(hj)}::uuid)::text as v`,
        )
      ).v,
    ).slice(0, 140),
  )
  // the model claims it sent it
  const m1 = tgLog.length
  const calls1 = answerCalls
  answerScript = () => "Done, I've emailed it to Kevin."
  const lie = await sayTelegramAndWork('Send the quote to Kevin.')
  const lsent = sentTexts(m1)
  check(
    'a model that says it emailed Kevin is refused on every attempt and the claim never reaches anyone',
    answerCalls - calls1 >= 2 &&
      (await jobState(String(lie.turn.job)))?.s === 'failed' &&
      lsent.every((c) => !/emailed it to Kevin/i.test(c.text)),
    JSON.stringify({ attempts: answerCalls - calls1, delivered: lsent.length }),
  )
  check(
    '...the person is told the truth (no send claimed), nobody else is contacted',
    lsent.length >= 1 &&
      lsent.every((c) => sendClaims(c.text).length === 0 && c.chat === CHAT) &&
      (await contactsOutside()) === outside0,
    lsent.map((c) => c.text.slice(0, 90)).join(' | '),
  )
  // the model offers to send it by email (a capability that does not exist)
  const m2 = tgLog.length
  const calls2 = answerCalls
  answerScript = () => "I'll email the quote to Kevin for you right away."
  correctionScript = () => 'I cannot send email from this office, so nothing has gone to Kevin.'
  const offer = await sayTelegramAndWork('Please get the quote over to Kevin.')
  const osent = sentTexts(m2)
  check(
    'a model that PROMISES to email (no email capability exists) is not allowed to: the promise is replaced and never delivered; the person reads that nothing was sent',
    answerCalls - calls2 >= 1 &&
      osent.length === 1 &&
      osent.every((c) => !/I'll email the quote/i.test(c.text)) &&
      /cannot send email/.test(osent[0]?.text ?? '') &&
      (await contactsOutside()) === outside0,
    JSON.stringify({
      attempts: answerCalls - calls2,
      delivered: osent.map((c) => c.text.slice(0, 120)),
    }),
  )
  void offer
  answerScript = () => '{}'
  correctionScript = () => '{}'
  modelDependent(
    'what a real model says to "Send this to Kevin." with no antecedent for "this" (it may ask what to send, say it cannot email, or offer a draft): the stub scripts an honest refusal; the gate, the policy and the absence of any send path are what is proven',
  )

  // ---- F2: an outward step that DOES exist asks, and only the owner's own typed yes starts it
  const slug = String(
    (await one(`select slug from public.projects where project_id = app.unnamed_project(${O})`))
      .slug,
  )
  const client = `va-${run}`
  await db.execute(`insert into public.mcp_clients (client_id, display_name, token_sha256, scopes, kind, office_id)
    values (${lit(client)}, 'v1 acceptance assistant', md5(${lit(client)}) || md5(${lit(`${client}x`)}), array['read','write'], 'claude', ${O})`)
  const PLAN =
    'Create a notebook called Velvet Harbor and make a slide deck and an audio overview from it.'
  const asked = await sayTelegramAndWork(PLAN)
  const planJob = String(asked.turn.job)
  const q = (
    await rows(
      `select blocker_id::text as id, state::text as state, requested_action, approval_options, job_id::text as job from public.blockers where job_id = ${lit(planJob)}::uuid order by created_at desc limit 1`,
    )
  )[0]
  const qid = String(q?.id)
  const qDelivery = (
    await rows(
      `select message_ref, state::text as state, target_ref from public.deliveries where blocker_id = ${lit(qid)}::uuid and state = 'sent' order by created_at limit 1`,
    )
  )[0]
  check(
    "the outward plan (it CREATES a notebook in the person's Google account) raised ONE bound question and delivered it to his chat",
    q?.state === 'open' &&
      /Carry out 3 steps/.test(String(q?.requested_action)) &&
      qDelivery?.state === 'sent' &&
      qDelivery.target_ref === CHAT &&
      qDelivery.message_ref !== null,
    JSON.stringify({ q: q?.state, d: qDelivery }),
  )
  // Reads of the provider (listing artifacts) are not an outward effect; creating, generating and adding are.
  const writes = () =>
    notebookCalls.filter((c) =>
      ['create_notebook', 'generate', 'add_url', 'add_text', 'add_file'].includes(c.action),
    )
  observed(`provider calls so far: ${notebookCalls.map((c) => c.action).join(',') || 'none'}`)
  const nothingRan = async () =>
    writes().length === 0 &&
    notebookCreated === 0 &&
    (await num(`select count(*)::int as c from public.projects where name = 'Velvet Harbor'`)) ===
      0 &&
    (await num(
      `select count(*)::int as c from public.jobs where kind in ('office.execute_plan', 'notebook.generate') and created_at >= (select created_at from public.jobs where job_id = ${lit(planJob)}::uuid)`,
    )) === 0
  const stillOpen = async () =>
    (await one(`select state::text as s from public.blockers where blocker_id = ${lit(qid)}::uuid`))
      .s === 'open'
  check(
    'NOTHING executed before approval: no notebook call, no project, no plan or generation job; the question is open',
    (await nothingRan()) && (await stillOpen()),
    JSON.stringify({ calls: notebookCalls.length }),
  )
  const replyRef = Number(qDelivery?.message_ref)
  const toQuestion = { reply_to_message: { message_id: replyRef } }

  // (a) a FORWARDED "yes" (somebody else's words) pointed at the question
  const fwd = await sayTelegramAndWork('yes', {
    extra: {
      ...toQuestion,
      forward_origin: {
        type: 'user',
        date: 1,
        sender_user: { id: 5, is_bot: false, first_name: 'X' },
      },
    },
  })
  check(
    'a FORWARDED "yes" does not approve: the question stays open, nothing ran',
    (await stillOpen()) &&
      (await nothingRan()) &&
      (await commandByKey(String(fwd.turn.body.dedupe_key)))?.ctx
        ?.toString()
        .includes('forwarded') === true,
    `forwarded recorded: ${String((await commandByKey(String(fwd.turn.body.dedupe_key)))?.ctx).slice(0, 80)}`,
  )

  // (b) a model PARAPHRASE: his own words are not a yes, the resolver rewrites them into one
  const rewrites0 = modelCalls('rewrite')
  rewriteScript = (latest) =>
    /what do you think of that/i.test(latest) ? 'Yes, go ahead and do it.' : null
  const para = await sayTelegramAndWork('hmm, what do you think of that?', { extra: toQuestion })
  rewriteScript = null
  check(
    '(the control that the paraphrase attack was really offered: the resolver was consulted and said "Yes, go ahead")',
    modelCalls('rewrite') > rewrites0,
    `${String(modelCalls('rewrite') - rewrites0)} resolver call(s)`,
  )
  check(
    'a model PARAPHRASE that reads as "yes" does not approve (his own words decide): still open, nothing ran',
    (await stillOpen()) && (await nothingRan()) && para.turn.job !== null,
    '',
  )

  // (d) an acknowledgement, not a go-ahead
  await sayTelegramAndWork('ok thanks', { extra: toQuestion })
  check(
    '"ok thanks" is an acknowledgement, not a go-ahead: still open, nothing ran',
    (await stillOpen()) && (await nothingRan()),
    '',
  )
  const m3 = tgLog.length

  // (e) the CONTROL: the owner's own typed yes, as a reply to the question
  const yes = await sayTelegramAndWork('yes', { extra: toQuestion })
  const afterYes = (
    await rows(
      `select state::text as state, answered_option, answered_by from public.blockers where blocker_id = ${lit(qid)}::uuid`,
    )
  )[0]
  check(
    'CONTROL: the owner\'s own typed "yes" (a reply to the question) answers it through the one answer door',
    afterYes?.state === 'resolved' && yes.turn.job !== null,
    JSON.stringify(afterYes),
  )
  const executed = await rows(
    `select job_id::text as id, state::text as state, kind from public.jobs where kind = 'office.execute_plan' and created_at >= (select created_at from public.jobs where job_id = ${lit(planJob)}::uuid)`,
  )
  check(
    '...and the approved plan ran: exactly one plan job, complete',
    executed.length === 1 && executed[0]?.state === 'complete',
    JSON.stringify(executed),
  )
  check(
    '...the outward step happened EXACTLY ONCE: one notebook created at the provider, one project filed',
    notebookCreated === 1 &&
      (await num(`select count(*)::int as c from public.projects where name = 'Velvet Harbor'`)) ===
        1,
    `${String(notebookCreated)} notebook(s), ${String(notebookCalls.map((c) => c.action).join(','))}`,
  )
  check(
    '...and nothing further went out unasked: no artifact was generated (each asks its own question first)',
    notebookCalls.filter((c) => c.action === 'generate').length === 0,
    `${String(notebookCalls.filter((c) => c.action === 'generate').length)} generate call(s)`,
  )
  // repeating the yes does not run it again
  const callsBefore = notebookCalls.length
  await sayTelegramAndWork('yes', { extra: toQuestion })
  await settle()
  check(
    'a second "yes" to the same, already-answered question runs nothing more (still one notebook, one plan job)',
    notebookCreated === 1 &&
      notebookCalls.length === callsBefore &&
      (await num(
        `select count(*)::int as c from public.jobs where kind = 'office.execute_plan' and created_at >= (select created_at from public.jobs where job_id = ${lit(planJob)}::uuid)`,
      )) === 1,
    `${String(notebookCalls.length - callsBefore)} new call(s)`,
  )
  check(
    'and the whole of F contacted nobody outside: only Telegram to his chat and the notebook stand-in were ever reached',
    refused.length === 0 &&
      (await contactsOutside()) === outside0 &&
      tgLog.every((c) => c.chat === CHAT || c.chat === ''),
    JSON.stringify(refused),
  )
  void m3

  // ---- the same boundary on the dashboard conversation, where an external assistant (mcp origin) shares the channel name
  // with the owner: the audit's D1. The owner asks from Team HQ; an assistant connected through the mcp door says "yes".
  const PLAN2 =
    'Create a notebook called Copper Meadow and make a slide deck and an audio overview from it.'
  const unnamed = String((await one(`select app.unnamed_project(${O})::text as p`)).p)
  const createdBefore = notebookCreated
  const dash = await hqAct('say', { p_project_id: unnamed, p_text: PLAN2 })
  await settle()
  observed(`hq say answered ${String(dash.status)}: ${JSON.stringify(dash.body).slice(0, 200)}`)
  const dashJob = String((dash.body.result as { job?: string } | undefined)?.job ?? '')
  const dq = (
    await rows(
      `select blocker_id::text as id, state::text as state from public.blockers where job_id = ${lit(dashJob)}::uuid order by created_at desc limit 1`,
    )
  )[0]
  const dqOpen = async () =>
    (
      await one(
        `select state::text as s from public.blockers where blocker_id = ${lit(String(dq?.id))}::uuid`,
      )
    ).s === 'open'
  const dashNothing = async () =>
    notebookCreated === createdBefore &&
    (await num(`select count(*)::int as c from public.projects where name = 'Copper Meadow'`)) === 0
  check(
    '(Team HQ) the same outward plan raised its question on the dashboard conversation and nothing ran',
    dq?.state === 'open' && (await dashNothing()),
    JSON.stringify({ q: dq?.state }),
  )
  const mcp = json(
    (
      await one(
        `set local application_name = 'PostgREST 14.5'; select app.mcp_ask_team(${O}, ${lit(client)}, ${lit(slug)}, 'yes', null) as v`,
      )
    ).v,
  )
  await settle()
  const mcpJob = String(mcp.job_id ?? '')
  const mcpCommand = String(
    (
      await rows(
        `select c.command_id::text as c from public.inbound_commands c where c.job_id = ${lit(mcpJob)}::uuid`,
      )
    )[0]?.c,
  )
  const mcpOrigin = String(
    (await one(`select app.command_origin(${lit(mcpCommand)}::uuid) as o`)).o,
  )
  check(
    'an EXTERNAL ASSISTANT\'s "yes" (mcp door; its command is not a recognised door, so its origin is "' +
      mcpOrigin +
      '") reached the real handler and answered nothing: the owner\'s question is still open, nothing ran',
    mcpJob !== '' &&
      mcpOrigin !== 'trusted' &&
      ['complete', 'failed'].includes(String((await jobState(mcpJob))?.s)) &&
      (await dqOpen()) &&
      (await dashNothing()),
    JSON.stringify({ job: await jobState(mcpJob), origin: mcpOrigin }),
  )
  // The positive control, on a question of its own and with no assistant turn in between (an interleaved turn of the
  // assistant becomes "the previous turn" of the conversation, so the owner would answer by the button instead: that is
  // the safe direction, and it is why the control is separate).
  const PLAN3 =
    'Create a notebook called Silver Birch and make a slide deck and an audio overview from it.'
  await hqAct('say', { p_project_id: unnamed, p_text: PLAN3 })
  await settle()
  const q3 = (
    await rows(
      `select blocker_id::text as id, state::text as state from public.blockers where requested_action like '%Silver Birch%' order by created_at desc limit 1`,
    )
  )[0]
  check(
    '(Team HQ control) a second plan request raised its own open question, nothing ran',
    q3?.state === 'open' &&
      (await num(`select count(*)::int as c from public.projects where name = 'Silver Birch'`)) ===
        0,
    JSON.stringify(q3),
  )
  await hqAct('say', { p_project_id: unnamed, p_text: 'yes' })
  await settle()
  const dAfter = (
    await rows(
      `select state::text as state, answered_by from public.blockers where blocker_id = ${lit(String(q3?.id))}::uuid`,
    )
  )[0]
  check(
    'CONTROL (Team HQ): the owner\'s own typed "yes" in that conversation answers it through the one answer door, and the plan runs exactly once',
    dAfter?.state === 'resolved' &&
      notebookCreated === createdBefore + 1 &&
      (await num(`select count(*)::int as c from public.projects where name = 'Silver Birch'`)) ===
        1 &&
      (await dqOpen()),
    JSON.stringify({ dAfter, created: notebookCreated - createdBefore }),
  )
  check(
    '...and the question the assistant tried to answer is STILL open (it was never answered by anybody)',
    await dqOpen(),
    '',
  )
  modelDependent(
    'whether a real model would phrase the plan say-back or the refusal differently; the question, its binding, the approval gate and the exactly-once execution are code and database',
  )
  unproven(
    'the notebook provider itself: only its stand-in was reached; real create/generate behaviour and quota are not claimed',
  )
}
end()

// ===============================================================================================================
const slackEvent = (text: string, o: { eventId?: string; ts?: string; channel?: string } = {}) => {
  const eventId = o.eventId ?? `Ev${run}${String(n())}`
  const ts = o.ts ?? `17${String(Date.now()).slice(-8)}.${String(n()).slice(0, 6)}`
  return {
    eventId,
    ts,
    raw: JSON.stringify({
      type: 'event_callback',
      team_id: SLACK_TEAM,
      event_id: eventId,
      event: {
        type: 'message',
        channel: o.channel ?? SLACK_CHANNEL,
        channel_type: 'channel',
        user: GRANT_SLACK,
        text,
        ts,
      },
    }),
  }
}
const slackPost = async (raw: string, retry = false) => {
  const stamp = String(Math.floor(Date.now() / 1000) - 5)
  const r = await slackEdge.call(
    new Request('https://door.invalid/functions/v1/slack-events', {
      method: 'POST',
      headers: {
        'X-Slack-Signature': await computeSignature(SLACK_SECRET, stamp, raw),
        'X-Slack-Request-Timestamp': stamp,
        'Content-Type': 'application/json',
        ...(retry ? { 'X-Slack-Retry-Num': '1', 'X-Slack-Retry-Reason': 'http_timeout' } : {}),
      },
      body: raw,
    }),
  )
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> }
}
const postVoice = async (
  said: string,
  session: string,
  project: string | null,
  message?: string,
) => {
  const r = await voiceEdge.call(
    new Request('https://gw.invalid/functions/v1/voice/turn', {
      method: 'POST',
      headers: { Authorization: `Bearer ${S_GRANT}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        said,
        session,
        ...(project === null ? {} : { project }),
        ...(message === undefined ? {} : { message }),
      }),
    }),
  )
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> }
}
const tasksTitled = (like: string) =>
  num(
    `select count(*)::int as c from public.tasks where office_id = ${O} and title ilike ${lit(like)}`,
  )
const commandsSaying = (text: string) =>
  num(
    `select count(*)::int as c from public.inbound_commands where office_id = ${O} and instruction = ${lit(text)}`,
  )
const jobsOfCommandsSaying = (text: string) =>
  num(
    `select count(distinct job_id)::int as c from public.inbound_commands where office_id = ${O} and instruction = ${lit(text)} and job_id is not null`,
  )

begin(
  'L',
  'DUPLICATE INPUT: the same Telegram update twice, the same Slack event twice, an HQ turn replayed',
)
{
  // ---- Telegram: the identical update delivered twice, once more concurrently, and once more after the work finished
  const text = 'Add a task to book the venue visit.'
  const m0 = tgLog.length
  const update = tgUpdate(text)
  const first = await tg.post(update)
  const second = await tg.post(update)
  const [third, fourth] = await Promise.all([tg.post(update), tg.post(update)])
  await settle()
  const late = await tg.post(update)
  await settle()
  check(
    'the door answers every delivery of the identical update 200 (Telegram must not be made to retry)',
    [first, second, third, fourth, late].every((r) => r.status === 200),
    JSON.stringify([first, second, third, fourth, late].map((r) => r.status)),
  )
  check(
    'ONE logical command in the ledger for six deliveries (one dedupe key)',
    (await commandsSaying(text)) === 1 &&
      (await num(
        `select count(*)::int as c from public.inbound_commands where dedupe_key = ${lit(String(first.body.dedupe_key))}`,
      )) === 1,
    `${String(await commandsSaying(text))} command(s)`,
  )
  check(
    'ONE job for it',
    (await jobsOfCommandsSaying(text)) === 1,
    `${String(await jobsOfCommandsSaying(text))} job(s)`,
  )
  check(
    'ONE action: one task',
    (await tasksTitled('Book the venue visit')) === 1,
    `${String(await tasksTitled('Book the venue visit'))} task(s)`,
  )
  const tgOnes = sentTexts(m0).filter((c) => c.replyTo === update.message.message_id)
  check(
    'ONE delivery: one reply message to him, one sent delivery row',
    tgOnes.length === 1 &&
      (await num(
        `select count(*)::int as c from public.deliveries d join public.jobs j on j.job_id = d.job_id join public.inbound_commands c on c.job_id = j.job_id where c.dedupe_key = ${lit(String(first.body.dedupe_key))} and d.state = 'sent'`,
      )) === 1,
    `${String(tgOnes.length)} message(s)`,
  )

  // ---- the person genuinely sends the same words again, as a new message (not a redelivery)
  const m1 = tgLog.length
  const again = await sayTelegramAndWork(text)
  check(
    'NEIGHBOUR: the same words sent again as a NEW message are two commands (he did say it twice) but still ONE task, and he is told it is already there',
    (await commandsSaying(text)) === 2 &&
      (await tasksTitled('Book the venue visit')) === 1 &&
      /already|twice|moment ago/i.test(sentTexts(m1)[0]?.text ?? ''),
    `${String(await commandsSaying(text))} commands, ${String(await tasksTitled('Book the venue visit'))} task(s); said: ${sentTexts(m1)[0]?.text.slice(0, 110) ?? 'none'}`,
  )
  void again

  // ---- Slack: the identical event twice (Slack retries after a slow acknowledgement), concurrently, and after the work finished
  const stext = 'Add a task to book the roof inspection.'
  const ev = slackEvent(stext)
  const s1 = await slackPost(ev.raw)
  const s2 = await slackPost(ev.raw, true)
  const [s3, s4] = await Promise.all([slackPost(ev.raw, true), slackPost(ev.raw, true)])
  await settle()
  const s5 = await slackPost(ev.raw, true)
  await settle()
  check(
    'the Slack door answers every delivery of the identical event 200',
    [s1, s2, s3, s4, s5].every((r) => r.status === 200),
    JSON.stringify([s1, s2, s3, s4, s5].map((r) => r.status)),
  )
  check(
    'ONE logical command for six deliveries of the event',
    (await commandsSaying(stext)) === 1,
    `${String(await commandsSaying(stext))} command(s)`,
  )
  check(
    'ONE job and ONE action (one task)',
    (await jobsOfCommandsSaying(stext)) === 1 &&
      (await tasksTitled('Book the roof inspection')) === 1,
    `${String(await jobsOfCommandsSaying(stext))} job(s), ${String(await tasksTitled('Book the roof inspection'))} task(s)`,
  )
  const sj = (
    await rows(
      `select job_id::text as j, origin_channel, project_id::text as p from public.inbound_commands where office_id = ${O} and instruction = ${lit(stext)}`,
    )
  )[0]
  check(
    "...it is a Slack command in the channel's project, and the job completed once",
    sj?.origin_channel === 'slack' &&
      sj.p === slackProject &&
      (await jobState(String(sj.j)))?.s === 'complete',
    JSON.stringify(sj),
  )
  check(
    '...no second delivery was ever attempted for it (no row beyond what the first processing made)',
    (await deliveriesOf(String(sj?.j))).length <= 1,
    `${String((await deliveriesOf(String(sj?.j))).length)} row(s)`,
  )
  unproven(
    "the Slack REPLY is not driven here: no Slack channel is in this suite's notifier (slack-send.ts proves the Slack transport); this suite proves one command, one job and one task for a Slack event delivered six times",
  )

  // ---- Team HQ: a turn replayed (the page re-sends after a timeout)
  const hqText = 'Add a task to order the banner.'
  // The page names each message once at send time and reuses the name for a replay of that message (chat.js).
  const hqMessage = `m${run}hqreplay`
  const hq1 = await postVoice(hqText, `va${run.slice(-6)}hq`, slackProject, hqMessage)
  const hq2 = await postVoice(hqText, `va${run.slice(-6)}hq`, slackProject, hqMessage)
  await settle()
  const hqCommands = await commandsSaying(hqText)
  const hqJobs = await jobsOfCommandsSaying(hqText)
  const hqTasks = await tasksTitled('Order the banner')
  observed(
    `HQ /voice/turn posted twice with the same words and session: ${String(hqCommands)} command(s), ${String(hqJobs)} job(s), ${String(hqTasks)} task(s); statuses ${String(hq1.status)}/${String(hq2.status)}`,
  )
  check(
    'HQ replay: the turn is accepted both times and the person is never left without an answer',
    hq1.status === 200 && hq2.status === 200,
    JSON.stringify([hq1.body.did, hq2.body.did]),
  )
  check(
    'HQ replay: ONE action (one task) however many times the page sent the words',
    hqTasks === 1,
    `${String(hqTasks)} task(s)`,
  )
  check(
    'HQ replay: ONE logical command and ONE job (an idempotent door)',
    hqCommands === 1 && hqJobs === 1,
    `${String(hqCommands)} command(s), ${String(hqJobs)} job(s)`,
  )
  check(
    'HQ replay: the second POST answers with the SAME acknowledgement (same job), not an error',
    hq1.body.did === 'delegated' &&
      hq2.body.did === 'delegated' &&
      hq1.body.command_id === hq2.body.command_id &&
      hq1.body.job_id === hq2.body.job_id,
    JSON.stringify([hq1.body, hq2.body]).slice(0, 220),
  )
  // NEIGHBOUR: the same words as a NEW message (a new name) are a second command - he did say it twice.
  await postVoice(hqText, `va${run.slice(-6)}hq`, slackProject, `m${run}hqagain`)
  check(
    'HQ NEIGHBOUR: the same words sent again as a NEW message (a different message id) are a second command',
    (await commandsSaying(hqText)) === 2,
    `${String(await commandsSaying(hqText))} command(s)`,
  )
  const sayText = 'Add a task to print the flyers.'
  const sayArgs = { p_project_id: slackProject, p_text: sayText, p_message_id: `m${run}sayreplay` }
  await hqAct('say', sayArgs)
  await hqAct('say', sayArgs)
  await settle()
  check(
    'HQ `say` replayed: ONE action (one task)',
    (await tasksTitled('Print the flyers')) === 1,
    `${String(await tasksTitled('Print the flyers'))} task(s); ${String(await commandsSaying(sayText))} command(s), ${String(await jobsOfCommandsSaying(sayText))} job(s)`,
  )
  check(
    'HQ `say` replayed: ONE logical command and ONE job',
    (await commandsSaying(sayText)) === 1 && (await jobsOfCommandsSaying(sayText)) === 1,
    `${String(await commandsSaying(sayText))} command(s), ${String(await jobsOfCommandsSaying(sayText))} job(s)`,
  )
  modelDependent(
    'none of L depends on a model: the dedupe is a unique key in the ledger and a title/job rule in the task writer',
  )
}
end()

console.log('\n=== JOURNEY TABLE ===')
for (const j of journeys) {
  console.log(
    `${j.id}  ${j.bad === 0 ? 'PASS' : 'FAIL'}  proven ${String(j.ok).padStart(3)}  failed ${String(j.bad).padStart(2)}  model-dependent ${String(j.model.length)}  unproven ${String(j.unproven.length)}  ${j.title}`,
  )
}
console.log(
  `\nstub model calls over the whole run: ${String(modelLog.length)} (rewrite ${String(modelCalls('rewrite'))}, read ${String(modelCalls('read'))}, plan ${String(modelCalls('plan'))}, answer ${String(modelCalls('answer'))}, other ${String(modelCalls('other'))}); network refused: ${String(refused.length)}; Telegram sendMessage calls: ${String(sentTexts().length)}`,
)
await db.end?.()
console.log(
  `\n${String(totalOk)}/${String(totalOk + totalBad)} PROVEN (${String(totalBad)} FAILED)`,
)
process.exitCode = totalBad === 0 ? 0 : 1
process.exit(process.exitCode)
