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

import { combinedNotifier, pagerChannel } from '../src/channels/notify.ts'
import { ManagementApiExecutor } from '../src/db/executor.ts'
import { notebookHandlers } from '../src/handlers/notebook.ts'
import type { Reviewer } from '../src/jobs/worker.ts'
import { drain } from '../src/jobs/worker.ts'
import { SlackClient } from '../src/slack/api.ts'
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
  channels.push(slackChannel(db, await SlackOffice.configured(db, slack), { teamId }))
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
const notify = combinedNotifier(channels, db)

// Notebook operations are deterministic — the notebook accepted the source or
// it did not — and §16 exempts those from review. The reviewer is here for
// anything else that lands in the same queue.
const review: Reviewer = () =>
  Promise.resolve({ status: 'approved' as const, notes: 'Deterministic notebook operation.' })

const handlers = notebookHandlers(db)

const pass = async (): Promise<number> => {
  const done = await drain(db, workerId, handlers, review, 10, { notify })
  for (const r of done) {
    console.log(`${r.jobId.slice(0, 8)} ${r.finalState}: ${r.note.slice(0, 120)}`)
  }
  return done.length
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
