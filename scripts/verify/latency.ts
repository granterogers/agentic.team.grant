/**
 * How long a message actually takes to be answered, on each surface.
 *
 *   npm run verify:latency
 *
 * Grant: *"I need any messages that I send either in Telegram or in Slack to
 * be responded to within, say, a minute."*
 *
 * That is a number, so it is measured rather than reasoned about. Both
 * surfaces are driven through their DEPLOYED webhook — the same URL Telegram
 * and Slack post to — and the clock runs until the office has produced an
 * output for the job, which is the moment there is something to say back.
 *
 * ## What it does not measure
 *
 * The last hop: Telegram accepting the reply, Slack rendering it. Those are
 * milliseconds and they are somebody else's infrastructure. Everything this
 * system controls is between the two timestamps here.
 *
 * ## Why the messages look like work
 *
 * Because a question the office can answer from its own rows returns in
 * milliseconds and would flatter the number. Each probe is phrased as
 * something that has to be thought about, which is the slow path and the one
 * worth holding to a minute.
 *
 * ## Contained (#381)
 *
 * It used to post AS Grant, from his real chat and into the ai-team-hq-test
 * lobby, so its two probes were indistinguishable from his own turns and
 * delivered ~30 messages to him and to Slack between 9 and 21 September.
 *
 * Now it declares a fixture Telegram chat and a fixture Slack channel with
 * `app.register_test_origin` BEFORE posting, and posts from them. The door,
 * the signature, the adapter, the queue, the kick and the worker are all the
 * production path; the only thing that differs is that the turn is written
 * `synthetic` at the door, so its answer is refused at the delivery guard
 * instead of reaching anybody. That is the point of the change and it costs
 * the measurement nothing it had: the last hop to Telegram or Slack was never
 * measured (above). It asserts the containment BEFORE it waits, and stops if
 * the declaration was not honoured.
 */

import { createHmac } from 'node:crypto'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { testOrigins } from './lib/test-origin.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const run = Date.now().toString(36)

const supabase = process.env.SUPABASE_ACCESS_TOKEN
if (supabase === undefined || supabase === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const db = new ManagementApiExecutor(ref, supabase)

const one = async (sql: string): Promise<Record<string, unknown> | undefined> =>
  (await db.execute(sql)).rows[0] as Record<string, unknown> | undefined

const checks: { what: string; outcome: string; passed: boolean }[] = []
const record = (what: string, outcome: string, passed: boolean): void => {
  checks.push({ what, outcome, passed })
  console.log(`${passed ? '✅' : '❌'} ${what} — ${outcome}`)
}

/** The number Grant named. */
const BUDGET_MS = 60_000

const secret = async (name: string): Promise<string> =>
  String(
    (
      await one(
        `select decrypted_secret as v from vault.decrypted_secrets where name = ${lit(name)}`,
      )
    )?.v ?? '',
  )

/**
 * Wait for the office to produce an output for a command, and say how long.
 *
 * Polls rather than subscribes, at a resolution well under the budget being
 * measured. Returns null on timeout, which is a result and not an error.
 */
const timeToAnswer = async (dedupeKey: string, startedAt: number): Promise<number | null> => {
  for (let waited = 0; waited < BUDGET_MS + 60_000; waited += 1_000) {
    // The job FINISHING, not the output row appearing.
    //
    // The first version stopped at the output, which is written before the
    // notifier runs — so it reported 42 seconds for a message that reached
    // Grant at 66. A latency check that stops before the last step measures
    // the part of the work that is not the part he is waiting for.
    const row = await one(`
      select j.finished_at from public.inbound_commands c
        join public.jobs j on j.job_id = c.job_id
       where c.dedupe_key = ${lit(dedupeKey)} and j.state = 'complete'
       limit 1
    `)
    if (row !== undefined) return Date.now() - startedAt
    await new Promise((r) => setTimeout(r, 1_000))
  }
  return null
}

// ===========================================================================
// Telegram
// ===========================================================================

const webhookSecret = await secret('telegram.webhook_secret')
const chief = await one(`
  select bot_id, app.resolve_secret(token_ref) as token
    from public.telegram_bots where is_pager and enabled limit 1
`)
const botId = String(chief?.bot_id ?? '')

// Declared before anything is posted (#381): the door writes both probes synthetic.
const origins = await testOrigins(db, 'verify:latency')
const TG_CHAT = origins.telegramChat()
const SLACK_CHANNEL = origins.slackChannel()
const SLACK_USER = `U0ZTLAT${run
  .toUpperCase()
  .replace(/[^A-Z0-9]/g, '')
  .slice(-6)}`
await origins.declare('telegram', TG_CHAT)
await origins.declare('slack', SLACK_CHANNEL)

/**
 * Containment, asserted before the wait: the probe is synthetic and its work
 * may not act outside. If the declaration was not honoured, stop here - the
 * answer would otherwise be on its way to somebody.
 */
const contained = async (dedupeKey: string, surface: string): Promise<boolean> => {
  for (let i = 0; i < 20; i += 1) {
    const row = await one(`
      select c.synthetic, j.job_id is not null as has_job,
             coalesce(app.may_act_outside(j.job_id), false) as outside
        from public.inbound_commands c left join public.jobs j on j.job_id = c.job_id
       where c.dedupe_key = ${lit(dedupeKey)}`)
    if (row?.has_job === true) {
      const ok = row.synthetic === true && row.outside === false
      record(
        `the ${surface} probe is contained at the door (synthetic, may not act outside)`,
        `synthetic=${String(row.synthetic)} outside=${String(row.outside)}`,
        ok,
      )
      if (!ok) {
        console.error(`STOP: the ${surface} probe was not contained. Nothing further is measured.`)
        process.exit(1)
      }
      return ok
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  record(`the ${surface} probe is contained at the door`, 'no job appeared to check', false)
  process.exit(1)
}

const telegramMessageId = 800_000 + (Date.now() % 90_000)
// `telegram:message:<bot>:<chat>:<id>`. The first version of this guessed the
// order and reported a working surface as broken for ninety seconds, which is
// the harness lying rather than the product.
const telegramKey = `telegram:message:${botId}:${TG_CHAT}:${String(telegramMessageId)}`
const telegramStart = Date.now()

const telegramResponse = await fetch(
  `https://${ref}.supabase.co/functions/v1/telegram-webhook?bot=${botId}`,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Bot-Api-Secret-Token': webhookSecret,
    },
    body: JSON.stringify({
      update_id: Number(run.slice(-6).replace(/\D/g, '') || '1') + 991,
      message: {
        message_id: telegramMessageId,
        date: Math.floor(Date.now() / 1000),
        text: `Give me one sentence on whether we should worry about anything today (${run})`,
        chat: { id: Number(TG_CHAT), type: 'private' },
        from: { id: 4242, is_bot: false },
      },
    }),
  },
)
const telegramBody = (await telegramResponse.json()) as { kicked?: boolean; dedupe_key?: string }
record(
  'the Telegram webhook accepts the message and starts a pass at once',
  `http ${String(telegramResponse.status)} kicked=${String(telegramBody.kicked)}`,
  telegramResponse.status === 200 && telegramBody.kicked === true,
)

// ===========================================================================
// And how long Telegram took
// ===========================================================================
//
// Measured BEFORE Slack is sent, one surface at a time.
//
// The first version fired both and then waited for both, so the second
// message queued behind the first and the number reported for it was
// contention rather than latency. Two people messaging at once is a real case
// and worth its own check one day; it is not the case Grant described.

await contained(telegramKey, 'Telegram')
const telegramMs = await timeToAnswer(telegramKey, telegramStart)
record(
  'a Telegram message is answered inside a minute',
  telegramMs === null
    ? 'no answer within two minutes'
    : `${String(Math.round(telegramMs / 100) / 10)}s`,
  telegramMs !== null && telegramMs <= BUDGET_MS,
)

// ===========================================================================
// Slack
// ===========================================================================
//
// Signed the way Slack signs it, because the endpoint checks — an unsigned
// probe would measure the 401 path.

const signingSecret = await secret('slack.signing_secret')
const slackTs = `${String(Math.floor(Date.now() / 1000))}.${String(Date.now() % 1000).padStart(3, '0')}200`
const slackEnvelope = JSON.stringify({
  type: 'event_callback',
  team_id: 'T0BUCJ2L5FD',
  event_id: `Ev0LAT${run}`,
  event: {
    type: 'message',
    user: SLACK_USER,
    channel: SLACK_CHANNEL,
    text: `Give me one sentence on whether we should worry about anything today (${run})`,
    ts: slackTs,
  },
})
const stamp = String(Math.floor(Date.now() / 1000))
const signature = `v0=${createHmac('sha256', signingSecret).update(`v0:${stamp}:${slackEnvelope}`).digest('hex')}`

const slackStart = Date.now()
const slackResponse = await fetch(`https://${ref}.supabase.co/functions/v1/slack-events`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Slack-Request-Timestamp': stamp,
    'X-Slack-Signature': signature,
  },
  body: slackEnvelope,
})
const slackBody = (await slackResponse.json()) as { kicked?: boolean; dedupe_key?: string }
record(
  'the Slack webhook accepts the message and starts a pass at once',
  `http ${String(slackResponse.status)} kicked=${String(slackBody.kicked)}`,
  slackResponse.status === 200 && slackBody.kicked === true,
)

// ===========================================================================
// And how long Slack took
// ===========================================================================

await contained(String(slackBody.dedupe_key ?? ''), 'Slack')
const slackMs = await timeToAnswer(String(slackBody.dedupe_key ?? ''), slackStart)
record(
  'a Slack message is answered inside a minute',
  slackMs === null ? 'no answer within two minutes' : `${String(Math.round(slackMs / 100) / 10)}s`,
  slackMs !== null && slackMs <= BUDGET_MS,
)

// The heartbeat is the floor under both: if a kick is ever lost, this is how
// late the answer gets. Worth reporting beside the two measurements, because
// "fast when the kick works" is only half of what Grant asked.
const heartbeat = await one(`
  select schedule from cron.job where jobname = 'worker-heartbeat'
`).catch(() => undefined)
record(
  'and if a kick is ever lost, the heartbeat is the floor',
  heartbeat?.schedule === undefined
    ? 'no worker-heartbeat cron — a lost kick would mean a lost minute or more'
    : `cron ${String(heartbeat.schedule)}`,
  heartbeat?.schedule !== undefined,
)

const passed = checks.filter((c) => c.passed).length
console.log(`\n| check | outcome | |`)
console.log('|---|---|---|')
for (const c of checks) console.log(`| ${c.what} | ${c.outcome} | ${c.passed ? '✅' : '❌'} |`)
console.log(`\n${String(passed)}/${String(checks.length)} checks passed`)
await db.execute(`delete from public.telegram_chats where chat_id = ${lit(TG_CHAT)}`)
console.log(
  `Two contained probes were answered; their answers were refused at the guard. Declarations released: ${String(await origins.release())}.`,
)

process.exit(passed === checks.length ? 0 : 1)
