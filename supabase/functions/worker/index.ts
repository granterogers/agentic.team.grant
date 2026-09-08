/**
 * The worker, next to the database, reachable over HTTP.
 *
 * ## Why this exists
 *
 * Grant sent a voice note to his Chief of Staff and waited ten minutes for
 * nothing. Everything upstream had worked: the webhook received it, the
 * transcript was recorded, the job was queued in under a second. The only
 * consumer of that queue was a GitHub Actions cron declared as every five
 * minutes, which over the fourteen hours before he complained ran six times.
 *
 * That is not a bug in the workflow. Actions schedules are best-effort and
 * GitHub drops them under load; a high-frequency cron is the first thing
 * dropped. A five-minute promise built on it is a promise the scheduler never
 * made.
 *
 * So the queue gets a consumer that can be called the moment work arrives:
 * `telegram-webhook` kicks this the instant it enqueues, and pg_cron kicks it
 * every minute as the floor. GitHub Actions stays as a slow backstop for the
 * case where both of those are down.
 *
 * ## Why it runs the same code
 *
 * Every file under `src/` in the pass's import graph is uploaded alongside
 * this one by `scripts/deploy/worker.ts`, so this runs the code the unit tests
 * drive. The same rule the telegram adapter has followed since ADR-0010: the
 * running code IS the tested code, because a copy drifts.
 *
 * ## Why it answers before it finishes
 *
 * Telegram retries a webhook that does not answer in seconds, and a retried
 * update would be a second copy of the same message. The kick from the webhook
 * is fire-and-forget for that reason, and this function returns as soon as the
 * pass is done — it is never in the webhook's critical path.
 */
import { ManagementApiExecutor } from '../../../src/db/executor.ts'
import { buildPass } from '../../../src/office/pass.ts'

declare const Deno: { env: { get: (k: string) => string | undefined } }

// Not `SUPABASE_*`: that prefix is reserved for the platform's own injected
// variables and the secrets API rejects the whole batch with a 400 if you use
// it — which deploys a function that looks fine and answers 401 forever.
const PROJECT_REF = Deno.env.get('HQ_PROJECT_REF') ?? ''
const ACCESS_TOKEN = Deno.env.get('HQ_MANAGEMENT_TOKEN') ?? ''
const KICK_SECRET = Deno.env.get('WORKER_KICK_SECRET') ?? ''

/**
 * How long to keep starting new jobs.
 *
 * The edge runtime kills a function at a wall-clock limit. A pass killed
 * mid-job leaves a lease to expire — recoverable, but it costs whoever was
 * waiting their reply, so the pass declines a new job past this point rather
 * than starting one it cannot finish. Well under the limit, because the job it
 * declines to start might have been the long one.
 */
const DEADLINE_MS = 60_000

/** Jobs per invocation. A chat reply should not queue behind ten of anything. */
const MAX_JOBS = 5

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

/**
 * Constant-time comparison, same reasoning as `hq-api`: a shared secret
 * compared with `===` is guessable by timing in principle, and it costs four
 * lines not to be.
 */
const secretMatches = async (presented: string): Promise<boolean> => {
  if (KICK_SECRET === '' || presented === '') return false
  const digest = async (v: string): Promise<Uint8Array> =>
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)))
  const [a, b] = await Promise.all([digest(presented), digest(KICK_SECRET)])
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
  return diff === 0
}

/**
 * Only one pass at a time in this instance.
 *
 * Not a substitute for the database lease — two edge instances can still run
 * at once, and `dequeue_job` is what makes that safe. This just stops one
 * instance from stacking passes when the webhook kicks twice in a second,
 * which would burn the wall-clock budget on contention.
 */
let running = false

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'GET') {
    // Says whether it COULD run, and nothing about what is queued. An
    // unauthenticated caller learning the queue depth is a probing aid.
    return json({
      ok: true,
      endpoint: 'worker',
      configured: PROJECT_REF !== '' && ACCESS_TOKEN !== '' && KICK_SECRET !== '',
    })
  }

  const presented = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!(await secretMatches(presented))) return json({ error: 'unauthorized' }, 401)

  if (ACCESS_TOKEN === '' || PROJECT_REF === '') {
    return json({ error: 'not configured' }, 503)
  }

  if (running) return json({ ok: true, skipped: 'a pass is already running' })
  running = true

  const lines: string[] = []
  try {
    const db = new ManagementApiExecutor(PROJECT_REF, ACCESS_TOKEN)
    const pass = await buildPass(db, `edge-${crypto.randomUUID().slice(0, 8)}`, {
      log: (line) => lines.push(line),
      max: MAX_JOBS,
      deadlineMs: DEADLINE_MS,
    })
    const result = await pass()
    return json({ ok: true, ...result, log: lines })
  } catch (error) {
    // Returned rather than thrown, so a kick that fails leaves a readable
    // answer instead of a 500 with a stack trace in somebody's log.
    return json({ ok: false, error: (error as Error).message.slice(0, 300), log: lines }, 500)
  } finally {
    running = false
  }
})
