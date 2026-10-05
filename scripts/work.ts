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

import '../src/safety/require-production-writes.ts'
import { ManagementApiExecutor } from '../src/db/executor.ts'
import { buildPass } from '../src/office/pass.ts'

const supabase = process.env.SUPABASE_ACCESS_TOKEN
if (supabase === undefined || supabase === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  supabase,
)

// The wiring lives in `src/jobs/pass.ts` because the same pass now runs in two
// places: here, and in the `worker` edge function the Telegram webhook kicks
// the instant a message lands. Two copies of it is how the tested code and the
// running code become different code.
const pass = await buildPass(db, `work-${process.pid}-${Date.now().toString(36)}`, {
  log: (line) => {
    console.log(line)
  },
  openRouterKey: process.env.OPENROUTER_API_KEY ?? '',
})

const once = async (): Promise<number> => {
  const r = await pass()
  if (r.cannotThink) {
    console.error(
      'No inference key in the vault (openrouter.api_key) and none in the environment: ' +
        'the office cannot think, and every instruction will park unhandled.',
    )
  }
  return r.handled + r.buttons
}

if (process.argv.includes('--watch')) {
  console.log('watching; ctrl-c to stop')
  for (;;) {
    const n = await once()
    if (n === 0) process.stdout.write('.')
    await new Promise((r) => setTimeout(r, 10_000))
  }
}

const n = await once()
console.log(n === 0 ? 'nothing queued.' : `${String(n)} job(s) handled.`)
