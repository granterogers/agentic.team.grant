/**
 * Run 3 (#388): a correctly signed Slack request from the wrong Slack user is still the wrong user.
 *
 *   npx tsx scripts/isolated/slack-sender.ts <replica-db>
 *
 * Every case drives the REAL `slack-events` handler with a REAL signature (computed with the
 * production signer over the exact body) against the replica, then asks the DATABASE what
 * happened: commands stored, jobs made, who the subject resolved to. The mirror of
 * sender-authorization.ts, which does the same for Telegram.
 *
 * Positive controls first: Grant's own message still becomes a job in his own name. A suite of
 * refusals passes against a door that refuses everybody.
 */
import { computeSignature } from '../../src/slack/signature.ts'
import { testOrigins } from '../verify/lib/test-origin.ts'
import { startEdge } from './edge-emulator.ts'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'slacksender')
const run = Date.now().toString(36)
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const count = async (sql: string) => Number((await one(sql)).c)
const results: { what: string; ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ what, ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}

const SECRET = 'isolated-slack-signing-secret'
const BOT_USER = 'U0BOTUSERX'
const GRANT = 'U0BUNF6AALC'
const STRANGER = 'U0STRANGER'
const CHANNEL = 'C0ISOLATED1'
const TEAM = 'T0ISOLATED'

await db.execute(
  `insert into public.subject_identities (subject, origin_channel, actor, note)
   values ('grant', 'slack', ${lit(GRANT)}, 'isolated proof') on conflict do nothing`,
)
// The installed workspace (0630): the app is installed in TEAM, and an event from anywhere else is not this office's.
await db.execute(
  `insert into public.slack_app_credentials (slack_app_id, team_id, app_name) values ('A0ISOLATED1', ${lit(TEAM)}, 'isolated proof') on conflict do nothing`,
)
const resolves = await one(`select app.subject_for('slack', ${lit(GRANT)}) as s`)
check(
  "the fixture resolves Grant's Slack user to grant",
  resolves.s === 'grant',
  String(resolves.s),
)

const door = await startEdge({
  db,
  edgeFile: 'supabase/functions/slack-events/index.ts',
  beside: [
    ['src/slack/events.ts', 'events.ts'],
    ['src/slack/interactions.ts', 'interactions.ts'],
    ['src/slack/signature.ts', 'signature.ts'],
  ],
  env: {
    SLACK_SIGNING_SECRET: SECRET,
    SLACK_BOT_USER_ID: BOT_USER,
    SUPABASE_SERVICE_ROLE_KEY: 'isolated-service-key',
  },
})

let n = 0
const stamp = () => `${String(Math.floor(Date.now() / 1000) - 5)}`
const post = async (
  raw: string,
  opts: { timestamp?: string; contentType?: string; badSignature?: boolean } = {},
) => {
  const ts = opts.timestamp ?? stamp()
  const sig = opts.badSignature ? 'v0=deadbeef' : await computeSignature(SECRET, ts, raw)
  const r = await door.call(
    new Request('https://door.invalid/functions/v1/slack-events', {
      method: 'POST',
      headers: {
        'X-Slack-Signature': sig,
        'X-Slack-Request-Timestamp': ts,
        'Content-Type': opts.contentType ?? 'application/json',
      },
      body: raw,
    }),
  )
  const text = await r.text()
  let body: Record<string, unknown> = {}
  try {
    body = JSON.parse(text) as Record<string, unknown>
  } catch {
    body = { raw: text }
  }
  return { status: r.status, body }
}
const message = (over: Record<string, unknown>, text: string) => {
  n += 1
  return JSON.stringify({
    type: 'event_callback',
    team_id: TEAM,
    event_id: `Ev${run}${String(n)}`,
    event: {
      type: 'message',
      channel: CHANNEL,
      channel_type: 'channel',
      text,
      ts: `17${String(Date.now()).slice(-8)}.${String(n).padStart(6, '0')}`,
      ...over,
    },
  })
}
const commandFor = (text: string) =>
  one(
    `select command_id::text as id, actor, subject, synthetic, job_id::text as job from public.inbound_commands where instruction = ${lit(text)} order by received_at desc limit 1`,
  )
const cmds = () =>
  count(`select count(*)::int as c from public.inbound_commands where origin_channel = 'slack'`)
const jobs = () =>
  count(
    `select count(*)::int as c from public.jobs where requested_by like 'slack:%' and created_at > now() - interval '10 minutes'`,
  )

// ---- positive controls -------------------------------------------------------------------
{
  const text = `grant on slack ${run}`
  const r = await post(message({ user: GRANT }, text))
  const row = await commandFor(text)
  check(
    "Grant's own Slack message is stored in his name and becomes a job",
    r.status === 200 && row?.subject === 'grant' && typeof row?.job === 'string',
    `http ${String(r.status)} ${JSON.stringify(row)}`,
  )
  const j = await one(
    `select requested_by from public.jobs where job_id = ${lit(String(row?.job))}::uuid`,
  )
  check(
    "the job is Grant's, from slack:grant",
    j?.requested_by === 'slack:grant',
    String(j?.requested_by),
  )
}

// ---- the stranger, in every shape a signed event takes ------------------------------------
for (const [label, over] of [
  ['a channel message', { user: STRANGER }],
  ['a direct message', { user: STRANGER, channel_type: 'im', channel: 'D0ISOLATED1' }],
  ['an app mention', { user: STRANGER, type: 'app_mention' }],
  ['a message with no user at all', {}],
] as const) {
  const text = `stranger ${label} ${run}`
  const c0 = await cmds()
  const j0 = await jobs()
  const r = await post(message(over, text))
  check(
    `a signed ${label} from somebody the office does not know: acknowledged, stored nowhere, no job`,
    r.status === 200 &&
      r.body.ignored === 'unrecognised sender' &&
      (await cmds()) === c0 &&
      (await jobs()) === j0 &&
      (await commandFor(text)) === undefined,
    `http ${String(r.status)} ${JSON.stringify(r.body)}`,
  )
}
{
  // The enqueue-side lock, for an edge function that has not been redeployed: a stranger's command that
  // did reach the table through the production door is refused when it is turned into work.
  const text = `stranger past the door ${run}`
  await db.execute(`set local application_name = 'PostgREST 14.5';
    insert into public.inbound_commands (origin_channel, origin_ref, actor, instruction, dedupe_key)
    values ('slack', ${lit(`${CHANNEL}:99${run}`)}, ${lit(STRANGER)}, ${lit(text)}, ${lit(`slack:message:${CHANNEL}:99${run}`)})`)
  const row = await commandFor(text)
  const j0 = await jobs()
  const enq = (await one(`select public.enqueue_inbound(${lit(String(row?.id))}::uuid) as v`)).v
  const v = (typeof enq === 'string' ? JSON.parse(enq) : enq) as Record<string, unknown>
  check(
    'the second lock: enqueue_inbound refuses a Slack command with no resolved subject',
    row?.synthetic === false && v.refused === true && (await jobs()) === j0,
    JSON.stringify(v),
  )
}

// ---- bots, edits, replays -----------------------------------------------------------------
{
  const c0 = await cmds()
  const a = await post(message({ user: 'U0OTHER', bot_id: 'B0X' }, `bot ${run}`))
  const b = await post(message({ user: BOT_USER }, `own ${run}`))
  const c = await post(message({ user: GRANT, subtype: 'message_changed' }, `edit ${run}`))
  check(
    'a bot message, our own message and an edit are ignored, and stored nowhere',
    [a, b, c].every((r) => r.status === 200 && typeof r.body.ignored === 'string') &&
      (await cmds()) === c0,
    `${JSON.stringify(a.body)} ${JSON.stringify(b.body)} ${JSON.stringify(c.body)}`,
  )
}
{
  const text = `retry ${run}`
  const raw = message({ user: GRANT }, text)
  const first = await post(raw)
  const second = await post(raw)
  check(
    'a redelivery of the same event is one command and one job',
    first.status === 200 &&
      second.status === 200 &&
      (await count(
        `select count(*)::int as c from public.inbound_commands where instruction = ${lit(text)}`,
      )) === 1 &&
      (await count(
        `select count(*)::int as c from public.jobs j join public.inbound_commands c on c.job_id = j.job_id where c.instruction = ${lit(text)}`,
      )) === 1,
    `${JSON.stringify(second.body)}`,
  )
  const old = await post(message({ user: GRANT }, `old ${run}`), {
    timestamp: String(Math.floor(Date.now() / 1000) - 400),
  })
  check(
    'a replay outside the five-minute window is refused',
    old.status === 401,
    `http ${String(old.status)}`,
  )
  const bad = await post(message({ user: GRANT }, `forged ${run}`), { badSignature: true })
  check(
    'a wrong signature is refused, and stores nothing',
    bad.status === 401 && (await commandFor(`forged ${run}`)) === undefined,
    `http ${String(bad.status)}`,
  )
}

// ---- failing to ASK is not a refusal --------------------------------------------------------
{
  const text = `outage ${run}`
  const c0 = await cmds()
  door.outage(true, 'sender_admitted')
  const r = await post(message({ user: GRANT }, text))
  door.outage(false)
  check(
    'the sender lookup failing answers 503 so Slack retries, and stores nothing',
    r.status === 503 && (await cmds()) === c0,
    `http ${String(r.status)}`,
  )
  const again = await post(message({ user: GRANT }, text))
  check(
    'and the retry, once the lookup answers, is admitted',
    again.status === 200 && (await commandFor(text)) !== undefined,
    `http ${String(again.status)}`,
  )
}

// ---- a declared test conversation is the way a harness gets in -------------------------------
{
  const origins = await testOrigins(db, 'verify:slack-sender')
  const channel = origins.slackChannel()
  await origins.declare('slack', channel)
  const text = `declared ${run}`
  const r = await post(message({ user: STRANGER, channel }, text))
  const row = await commandFor(text)
  check(
    'a stranger inside a DECLARED test conversation is admitted, and the command is synthetic',
    r.status === 200 && row?.synthetic === true,
    `http ${String(r.status)} ${JSON.stringify(row)}`,
  )
  await origins.release()
}

// ---- button presses -------------------------------------------------------------------------
const press = async (user: string, action: string) => {
  const payload = JSON.stringify({
    type: 'block_actions',
    user: { id: user },
    team: { id: TEAM },
    channel: { id: CHANNEL },
    container: {
      channel_id: CHANNEL,
      message_ts: `17${String(Date.now()).slice(-8)}.${String(++n).padStart(6, '0')}`,
    },
    actions: [{ action_id: action, value: 'x' }],
  })
  return await post(`payload=${encodeURIComponent(payload)}`, {
    contentType: 'application/x-www-form-urlencoded',
  })
}
{
  const c0 = await count(
    `select count(*)::int as c from public.inbound_commands where callback_action is not null`,
  )
  const r = await press(STRANGER, 'undo')
  check(
    "a stranger's button press is acknowledged and stored nowhere, so it cannot claim an undo",
    r.status === 200 &&
      (await count(
        `select count(*)::int as c from public.inbound_commands where callback_action is not null`,
      )) === c0,
    `http ${String(r.status)} ${JSON.stringify(r.body)}`,
  )
  const g = await press(GRANT, 'undo')
  check(
    "Grant's own press is stored (the control)",
    g.status === 200 &&
      (await count(
        `select count(*)::int as c from public.inbound_commands where callback_action is not null`,
      )) ===
        c0 + 1,
    `http ${String(g.status)}`,
  )
}

// ---- the workspace (#392.3, 0630) ---------------------------------------------------------------------
{
  const before = await cmds()
  const text = `grant in the wrong workspace ${run}`
  const wrong = JSON.parse(message({ user: GRANT }, text))
  wrong.team_id = 'T0SOMEWHERE'
  const r = await post(JSON.stringify(wrong))
  const stored = await count(
    `select count(*)::int as c from public.inbound_commands where instruction = ${lit(text)}`,
  )
  check(
    'a correctly signed event from Grant in ANOTHER workspace is acknowledged and stored nowhere',
    r.status === 200 &&
      r.body.ignored === 'unrecognised workspace' &&
      stored === 0 &&
      (await cmds()) === before,
    `http ${String(r.status)} ${JSON.stringify(r.body)}`,
  )
  const noTeam = JSON.parse(message({ user: GRANT }, `no team ${run}`))
  noTeam.team_id = undefined
  const r2 = await post(JSON.stringify(noTeam))
  check(
    'an event with no team identity is refused the same way',
    r2.status === 200 && r2.body.ignored === 'unrecognised workspace',
    JSON.stringify(r2.body),
  )
  const lower = JSON.parse(message({ user: GRANT }, `lower ${run}`))
  lower.team_id = 't0isolated'
  const r3 = await post(JSON.stringify(lower))
  check(
    'a differently-cased team id is not the installed workspace',
    r3.body.ignored === 'unrecognised workspace',
    JSON.stringify(r3.body),
  )
  const okText = `grant in the right workspace ${run}`
  const ok = await post(message({ user: GRANT }, okText))
  const row = await commandFor(okText)
  check(
    'the control: the installed workspace and the same user still becomes a job',
    ok.status === 200 && typeof row?.job === 'string',
    `http ${String(ok.status)}`,
  )
  // replay: the same signed body twice is one command
  const replay = message({ user: GRANT }, `replay ${run}`)
  await post(replay)
  await post(replay)
  const replayed = await count(
    `select count(*)::int as c from public.inbound_commands where instruction = ${lit(`replay ${run}`)}`,
  )
  check('replaying a delivered event makes no second command', replayed === 1, String(replayed))
  // an installation that is disabled serves nothing
  await db.execute(
    `update public.slack_app_credentials set enabled = false, disabled_reason = 'proof' where team_id = ${lit(TEAM)}`,
  )
  const offText = `grant while disabled ${run}`
  const off = await post(message({ user: GRANT }, offText))
  check(
    'a disabled installation serves no workspace',
    off.body.ignored === 'unrecognised workspace',
    JSON.stringify(off.body),
  )
  await db.execute(
    `update public.slack_app_credentials set enabled = true, disabled_reason = null where team_id = ${lit(TEAM)}`,
  )
}
const failed = results.filter((r) => !r.ok).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
await db.end()
process.exitCode = failed === 0 ? 0 : 1
