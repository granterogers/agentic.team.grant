/**
 * Run the worker: drain whatever is queued.
 *
 *   npm run work            # one pass
 *   npm run work -- --watch # keep going, ten seconds apart
 *
 * ## Why this exists now
 *
 * Every previous caller of the job engine was a verification suite that
 * enqueued its own work and drained it in the same process. That was enough
 * while the only things enqueueing were tests. It stopped being enough the
 * moment an MCP client could enqueue: ChatGPT asks for an audio overview, the
 * job sits in `queued`, and nothing on earth picks it up.
 *
 * A queue with no consumer is a queue that looks like it is working.
 *
 * ## Scheduling
 *
 * No always-on VM (ADR-0001), so this is invoked — by GitHub Actions on the
 * same cron that runs the sync, and by hand while iterating. `--watch` is for
 * a person watching, not for production: a loop in a laptop terminal is not a
 * scheduler and pretending otherwise is how a system acquires an undocumented
 * dependency on somebody's open window.
 */

import { processCallbacks } from '../src/channels/callbacks.ts'
import { combinedNotifier, pagerChannel } from '../src/channels/notify.ts'
import { announceStart } from '../src/channels/progress.ts'
import { replyChannel } from '../src/channels/reply.ts'
import { ManagementApiExecutor } from '../src/db/executor.ts'
import { instructionHandler } from '../src/handlers/instruction.ts'
import { notebookHandlers } from '../src/handlers/notebook.ts'
import { planHandler } from '../src/handlers/plan.ts'
import type { Reviewer } from '../src/jobs/worker.ts'
import { drain } from '../src/jobs/worker.ts'
import { ProviderRouter } from '../src/providers/router.ts'
import { SlackClient } from '../src/slack/api.ts'
import { narrateHandoffs } from '../src/slack/narrate.ts'
import { slackChannel } from '../src/slack/notifier.ts'
import { SlackOffice } from '../src/slack/office.ts'
import { TelegramClient } from '../src/telegram/api.ts'
import { TelegramPager } from '../src/telegram/pager.ts'
import { pagerBot } from '../src/telegram/roster.ts'

const supabase = process.env.SUPABASE_ACCESS_TOKEN
if (supabase === undefined || supabase === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  supabase,
)

const workerId = `work-${process.pid}-${Date.now().toString(36)}`

// The same notifier the office uses, so work done here reaches the same places
// by the same path. A worker with its own notification code is a worker whose
// output looks different for no reason.
const channels = []
/** Set when Slack is installed, so the narrator can run after the drain. */
let floor: (() => Promise<void>) | null = null
const botToken = String(
  (
    await db.execute(
      `select app.resolve_secret(bot_token_ref) as t
         from public.slack_app_credentials where enabled and revoked_at is null limit 1`,
    )
  ).rows[0]?.t ?? '',
)
if (botToken !== '') {
  const slack = new SlackClient(botToken)
  const teamId = String(
    (
      await db.execute(
        `select team_id from public.slack_app_credentials where enabled and revoked_at is null limit 1`,
      )
    ).rows[0]?.team_id,
  )
  const office = await SlackOffice.configured(db, slack)
  channels.push(slackChannel(db, office, { teamId }))

  // Grant: *"create an additional channel in Slack where I see the
  // communications between the Chief of Staff and the rest of the members."*
  // Runs AFTER the drain, so a decision taken this pass is narrated this pass.
  floor = async (): Promise<void> => {
    for (const s of await narrateHandoffs(db, slack, office, teamId)) {
      if (s.outcome === 'sent') console.log(`floor: narrated ${s.jobId.slice(0, 8)}`)
    }
  }
}
const pager = await pagerBot(db)
if (pager !== null) {
  channels.push(
    pagerChannel(
      new TelegramPager(db, new TelegramClient(pager.token), {
        botId: pager.botId,
        subject: 'grant',
      }),
      'important',
    ),
  )
}
// The reply channel goes FIRST. An instruction that arrived in a Telegram chat
// is answered in that chat, by the bot it was sent to — a reply from the pager
// to a message sent to Ines would be a colleague answering through a
// switchboard. Everything else still gets its usual delivery.
const notify = combinedNotifier([replyChannel(db), ...channels], db)

// Notebook operations are deterministic — the notebook accepted the source or
// it did not — and §16 exempts those from review. The reviewer is here for
// anything else that lands in the same queue.
const review: Reviewer = () =>
  Promise.resolve({ status: 'approved' as const, notes: 'Deterministic notebook operation.' })

const orKey = process.env.OPENROUTER_API_KEY ?? ''
const handlers = [
  ...notebookHandlers(db),
  planHandler(db),
  ...(orKey === '' ? [] : [instructionHandler({ db, router: new ProviderRouter(db, orKey) })]),
]

/**
 * Button presses first, then work.
 *
 * ## The gap this closes, which was total
 *
 * `processCallbacks` existed, was tested from six angles, and was called by
 * NOTHING outside those tests. Every 👍, every Undo, every Mute in Slack and
 * Telegram since Phase 3 recorded an `inbound_commands` row and then sat there.
 * The buttons worked in the sense that they responded; they did nothing in the
 * sense that mattered. It is the same shape as `inbound_commands` having a
 * writer and no reader for text (0072) — a mechanism finished everywhere except
 * at the point where it meets the rest of the system.
 *
 * Found by adding a seventh button that had to work: Grant asked for manual
 * approval before any notebook generation (0083), and an approval button that
 * files a row nobody reads is a generation that never happens and never says
 * why.
 *
 * BEFORE the drain, deliberately. Approving a generation enqueues it, so
 * pressing the button and getting the artifact in the same five-minute tick is
 * the difference between "it works" and "it works eventually".
 */
const pass = async (): Promise<number> => {
  const pressed = await processCallbacks(db, { subject: 'grant' })
  for (const p of pressed) {
    console.log(`button ${p.action}: ${p.outcome} — ${p.note.slice(0, 100)}`)
  }

  // Grant: *"I want an individual message from each bot on Telegram so I can
  // see they are working."* Once per person per instruction, from their own
  // bot — see `src/channels/progress.ts` for why that is not the repetition he
  // complained about in the same breath.
  const done = await drain(db, workerId, handlers, review, 10, {
    notify,
    onStart: (job) => announceStart(db, job),
  })
  for (const r of done) {
    console.log(`${r.jobId.slice(0, 8)} ${r.finalState}: ${r.note.slice(0, 120)}`)
  }

  // Never fatal. A narration channel that fails takes nothing with it: the work
  // is done and delivered, and the running commentary is the least important
  // thing in this file.
  if (floor !== null) {
    try {
      await floor()
    } catch (error) {
      console.log(`floor: ${(error as Error).message.slice(0, 120)}`)
    }
  }

  return done.length + pressed.length
}

if (process.argv.includes('--watch')) {
  console.log(`worker ${workerId} watching; ctrl-c to stop`)
  for (;;) {
    const n = await pass()
    if (n === 0) process.stdout.write('.')
    await new Promise((r) => setTimeout(r, 10_000))
  }
}

const n = await pass()
console.log(n === 0 ? 'nothing queued.' : `${String(n)} job(s) handled.`)
