/**
 * §31's second completion criterion, against the live database.
 *
 *   npm run verify:cross-interface
 *
 *   "The same instruction via Slack and via Voice produces identical backend
 *    behaviour."
 *
 * The pure half — that both adapters normalize to the same command — is
 * `tests/channels/cross-interface.test.ts`, which needs no database. This is
 * the half that does: an instruction actually stored through each channel's
 * path, read back, and compared as rows.
 *
 * The difference matters. The unit test proves the adapters agree; this proves
 * the *system* agrees, including the trigger that resolves identity and the
 * constraints that could reject one channel's row and not the other's.
 *
 * Voice is not a command source yet — it captures audio and holds a
 * conversation, and nothing in it writes an `inbound_commands` row. Reported as
 * a skip rather than quietly omitted, because a criterion that names three
 * interfaces and is tested on two should say so out loud.
 */

import { toCanonicalCommand as telegramCommand } from '../../src/channels/telegram.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { toCanonicalCommand as slackCommand } from '../../src/slack/events.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const run = Date.now().toString(36)

const supabase = process.env.SUPABASE_ACCESS_TOKEN
if (supabase === undefined || supabase === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  supabase,
)
const one = async (sql: string): Promise<Record<string, unknown> | undefined> =>
  (await db.execute(sql)).rows[0] as Record<string, unknown> | undefined

const checks: { what: string; outcome: string; passed: boolean }[] = []
const record = (what: string, outcome: string, passed: boolean): void => {
  checks.push({ what, outcome, passed })
  console.log(`${passed ? '✅' : '❌'} ${what} — ${outcome}`)
}

const AT = new Date()
const MESSAGE_ID = 900_000 + (Date.now() % 90_000)
const SLACK_TS = `${String(Math.floor(Date.now() / 1000))}.${String(Date.now() % 1000).padStart(3, '0')}100`
const INSTRUCTION = `Research the trade-offs in storing a project canonically (${run})`

// Real wire shapes, not shapes we invented — normalizing a fixture we wrote
// would prove our fixtures agree, not that our adapters do.
const fromSlack = slackCommand(
  {
    type: 'event_callback',
    team_id: 'T0BUCJ2L5FD',
    event_id: `Ev0XI${run}`,
    event: {
      type: 'message',
      user: 'U0BUNF6AALC',
      channel: 'C0BVD21Q9S5',
      text: INSTRUCTION,
      // A Slack ts is `seconds.microseconds`, and it is what the dedupe key is
      // derived from. Built from the full clock rather than a truncated run
      // stamp: the first five base-36 characters of a millisecond clock only
      // change every forty seconds, so two runs in the same minute collided on
      // `inbound_commands_dedupe` and it read as a product defect.
      ts: SLACK_TS,
    },
  },
  'U0BUG0RPZ8B',
  AT,
)
const fromTelegram = telegramCommand(
  {
    update_id: Number.parseInt(run.slice(-6), 36),
    message: {
      // Unique per run. Telegram's dedupe key is derived from chat and message
      // id, not from anything this suite chooses, so a constant message_id
      // makes the suite passable exactly once — the second run collides on
      // `inbound_commands_dedupe` and looks like a product defect.
      message_id: MESSAGE_ID,
      date: Math.floor(AT.getTime() / 1000),
      chat: { id: 1_386_648_496, type: 'private' },
      from: { id: 1_386_648_496, is_bot: false },
      text: INSTRUCTION,
    },
  },
  AT,
)

const store = async (c: {
  origin_channel: string
  origin_ref: string
  actor: string
  instruction: string
  dedupe_key: string
  received_at: string
}): Promise<Record<string, unknown> | undefined> =>
  one(`
    insert into public.inbound_commands
      (origin_channel, origin_ref, actor, instruction, dedupe_key, received_at)
    values (${lit(c.origin_channel)}, ${lit(c.origin_ref)}, ${lit(c.actor)},
            ${lit(c.instruction)}, ${lit(c.dedupe_key)}, ${lit(c.received_at)}::timestamptz)
    returning command_id::text, origin_channel, origin_ref, actor, subject,
              instruction, callback_action, compensates_event_id
  `)

const slackRow = await store(fromSlack)
const telegramRow = await store(fromTelegram)

record(
  'the same instruction stores successfully through both channels',
  `slack=${slackRow === undefined ? 'no row' : 'stored'} telegram=${telegramRow === undefined ? 'no row' : 'stored'}`,
  slackRow !== undefined && telegramRow !== undefined,
)

// The equality §31 asks for, over what the database actually holds.
const MODULO = new Set(['command_id', 'origin_channel', 'origin_ref', 'actor'])
const differing = Object.keys(slackRow ?? {}).filter(
  (key) =>
    !MODULO.has(key) && JSON.stringify(slackRow?.[key]) !== JSON.stringify(telegramRow?.[key]),
)
record(
  'the stored rows are identical apart from the channel-native fields (§31)',
  differing.length === 0 ? 'every other column matches' : `differ: ${differing.join(', ')}`,
  differing.length === 0,
)

// CONTROL. Without it, a comparison over an empty column list — a typo in the
// select, a row that came back undefined — would pass with nothing compared.
record(
  'CONTROL: there were columns to compare, and the channel-native ones DID differ',
  `${String(Object.keys(slackRow ?? {}).length)} columns; origin_ref ${String(slackRow?.origin_ref)} vs ${String(telegramRow?.origin_ref)}`,
  Object.keys(slackRow ?? {}).length >= 6 && slackRow?.origin_ref !== telegramRow?.origin_ref,
)

// The point of the whole exercise: identity survives the channel.
record(
  'both channels resolve to the SAME person, though neither knows the other id',
  `slack actor=${String(slackRow?.actor)} -> ${String(slackRow?.subject)}; ` +
    `telegram actor=${String(telegramRow?.actor)} -> ${String(telegramRow?.subject)}`,
  slackRow?.subject === 'grant' && telegramRow?.subject === 'grant',
)

// And the negative that makes it a mapping rather than a default: an
// unrecognised actor must NOT inherit Grant's identity, preferences or
// authority just because he is the only person on file.
const stranger = await store({
  origin_channel: 'slack',
  origin_ref: `stranger-${run}`,
  actor: `U_STRANGER_${run.toUpperCase()}`,
  instruction: INSTRUCTION,
  dedupe_key: `verify:cross_interface:stranger-${run}`,
  received_at: AT.toISOString(),
})
record(
  'an unrecognised actor resolves to nobody, not to the only person on file',
  `subject=${JSON.stringify(stranger?.subject)}`,
  stranger?.subject === null,
)

// ---------------------------------------------------------------------------
// Voice, the third interface §31 names
// ---------------------------------------------------------------------------
//
// This used to be a SKIP: *"voice captures audio and holds a conversation; it
// is not yet a command source."* Grant settled §12's "optional premium"
// against §22's completion criterion — **"Voice is required"** — and 0102 made
// it one.
//
// The row is built the way the endpoint builds it, from the same fields, and
// then compared against Slack's on exactly the same terms. Not through the HTTP
// endpoint, deliberately: this suite is about what the DATABASE holds, and a
// live call would also be testing Deno, the deploy and the network.
const voiceRow = await store({
  origin_channel: 'voice',
  // `session:turn`, the same `chat:message` shape every other channel uses —
  // which is what lets conversation memory and the pairing window work on voice
  // with no special case.
  origin_ref: `sv${run}:t1`,
  actor: 'grant',
  instruction: INSTRUCTION,
  dedupe_key: `voice:turn:sv${run}.t1`,
  received_at: AT.toISOString(),
})

record(
  'the same instruction stores through VOICE as well (§31, third interface)',
  voiceRow === undefined ? 'no row' : 'stored',
  voiceRow !== undefined,
)

const voiceDiffering = Object.keys(slackRow ?? {}).filter(
  (key) => !MODULO.has(key) && JSON.stringify(slackRow?.[key]) !== JSON.stringify(voiceRow?.[key]),
)
record(
  'and the voice row is identical to the Slack row apart from the channel-native fields',
  voiceDiffering.length === 0
    ? 'every other column matches'
    : `differ: ${voiceDiffering.join(', ')}`,
  voiceDiffering.length === 0,
)

// The half that only voice has: it can answer some questions itself, and it
// must delegate everything else rather than inventing an answer. Both
// directions, because a `voice_answer` that always returned null would pass a
// one-sided check while making the surface useless — and one that never
// returned null would be an adapter deciding, which §5 forbids.
const answerable = await store({
  origin_channel: 'voice',
  origin_ref: `sv${run}:t2`,
  actor: 'grant',
  instruction: 'what projects have we got',
  dedupe_key: `voice:turn:sv${run}.t2`,
  received_at: AT.toISOString(),
})
const answered = await one(
  `select app.voice_answer(${lit(String(answerable?.command_id))}::uuid) as a`,
)
const spoken = (answered?.a as { speak?: string } | null)?.speak
record(
  'a question about state is answered from real rows, here and now',
  spoken === undefined ? 'not answered' : String(spoken).slice(0, 90),
  typeof spoken === 'string' && spoken.length > 0,
)

const delegated = await one(
  `select app.voice_answer(${lit(String(voiceRow?.command_id))}::uuid) as a`,
)
record(
  'CONTROL: an instruction is NOT answered — it returns null so it goes to the team',
  delegated?.a === null
    ? 'null, as required'
    : `answered: ${JSON.stringify(delegated?.a).slice(0, 70)}`,
  delegated?.a === null,
)

// §18 case 7, which the degradation map has carried as "not covered — voice is
// not a command source yet, there is no session to fail". There is now, and
// the failure that matters is not the recogniser dying: it is the endpoint
// being unreachable while Grant is mid-sentence. What must survive is the rule
// every other case is held to — canonical state preserved, no duplicate work.
const beforeCount = Number(
  (
    await one(
      `select count(*)::int as n from public.jobs where idempotency_key like ${lit(`inbound-%`)}`,
    )
  )?.n,
)
// The same turn arriving twice, which is what a retry after a dropped response
// looks like from the browser's side.
const retried = await one(`
  insert into public.inbound_commands
    (origin_channel, origin_ref, actor, instruction, dedupe_key, received_at)
  values ('voice', ${lit(`sv${run}:t1`)}, 'grant', ${lit(INSTRUCTION)},
          ${lit(`voice:turn:sv${run}.t1`)}, ${lit(AT.toISOString())}::timestamptz)
  on conflict (dedupe_key) do nothing
  returning command_id::text
`)
const afterCount = Number(
  (
    await one(
      `select count(*)::int as n from public.jobs where idempotency_key like ${lit(`inbound-%`)}`,
    )
  )?.n,
)
record(
  'a voice turn redelivered after a dropped reply is discarded, not repeated (§18 case 7)',
  `insert returned ${retried === undefined ? 'nothing' : 'a row'}; jobs ${String(beforeCount)} -> ${String(afterCount)}`,
  retried === undefined && beforeCount === afterCount,
)

console.log('\n| check | outcome | |')
console.log('|---|---|---|')
for (const c of checks) console.log(`| ${c.what} | ${c.outcome} | ${c.passed ? '✅' : '❌'} |`)
const failed = checks.filter((c) => !c.passed)
console.log(`\n${String(checks.length - failed.length)}/${String(checks.length)} checks passed`)

// Deleted by every identity the rows can carry, not just the run stamp: the
// Telegram dedupe key is derived from chat and message id and contains no
// stamp at all, so a cleanup that only matched the stamp left it behind.
await db.execute(
  `delete from public.inbound_commands
     where dedupe_key like ${lit(`%${run}%`)}
        or origin_ref like ${lit(`%${run}%`)}
        or dedupe_key = ${lit(fromTelegram.dedupe_key)}
        or dedupe_key = ${lit(fromSlack.dedupe_key)}`,
)
console.log('fixtures removed.')

if (failed.length > 0) process.exit(1)
