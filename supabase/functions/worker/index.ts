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
import type { SqlExecutor } from '../../../src/db/executor.ts'
import { ManagementApiExecutor } from '../../../src/db/executor.ts'
import { buildPass } from '../../../src/office/pass.ts'
import { PostgresExecutor } from './pg.ts'

declare const Deno: {
  env: { get: (k: string) => string | undefined }
  /**
   * Declared optional on purpose. Subprocess spawning is a Deno API that the
   * edge runtime does not grant, and the capability probe below is the whole
   * point: the type says "this may not be here", which is exactly the fact.
   */
  Command?: new (
    command: string,
    options: { args: string[] },
  ) => { output: () => Promise<{ success: boolean }> }
}

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

/**
 * A kick that arrived while a pass was already running.
 *
 * Dropping it cost Grant a minute. Measured: a Slack message sent while the
 * worker was mid-pass answered in 72 seconds, because the kick was refused and
 * the message waited for the next heartbeat — against a budget of sixty.
 *
 * So the kick is remembered instead. When the current pass finishes, one more
 * runs immediately. A flag rather than a counter on purpose: ten kicks during
 * one pass need one more pass, not ten, and the pass drains up to `MAX_JOBS`
 * anyway.
 */
let kickPending = false

/**
 * What this runtime can do, worked out once.
 *
 * `canTranscribe` tries a subprocess and then makes a network call to the
 * speech API; `canSubprocess` tries to spawn Python. Neither answer can change
 * while an instance lives, and both were being computed on every single kick —
 * several seconds of a twenty-second empty pass, on the path Grant is waiting
 * on.
 *
 * Cached per instance rather than in the database on purpose: it is a fact
 * about THIS runtime, and a new instance should work it out for itself rather
 * than inherit another one's answer.
 */
let capabilities: { transcribe: boolean; subprocess: boolean } | null = null

/**
 * The fast way to the database, once per instance.
 *
 * `undefined` means not tried yet, `null` means tried and unavailable — the
 * distinction matters, because retrying a failed connection on every kick
 * would cost the ten seconds it was meant to save.
 */
let direct: PostgresExecutor | null | undefined
/**
 * When the direct connection last failed. A failure used to be final for the life of the instance, so one refused connection
 * (a pooler restart, a platform stall) pinned every later pass to the Management API: seventeen seconds an empty pass and the
 * API's own throttle in the way, for as long as the instance lived. It is retried once the cooldown has passed, never on
 * every kick (a failed connect costs its ten-second timeout, which is the cost this was written to avoid).
 */
let directFailedAt = 0
const DIRECT_RETRY_AFTER_MS = 5 * 60_000

/**
 * Can this runtime spawn a local process at all?
 *
 * The more general form of the question above, and the one that decides
 * whether this worker may claim notebook work — the live adapter shells out to
 * Python for every read (0137). Asked the same way and for the same reason:
 * the honest answer here is no, and a function that ASKS gives the honest
 * answer on any runtime rather than only on this one.
 */
const canSubprocess = async (): Promise<boolean> => {
  const Command = Deno.Command
  if (Command === undefined) return false
  try {
    return (await new Command('python3', { args: ['-c', 'pass'] }).output()).success
  } catch {
    // A permissions failure, or no such binary. Either way: no.
    return false
  }
}

/**
 * Can this runtime turn a voice note into words?
 *
 * Asked, not assumed. The answer decides whether the edge worker may take a
 * voice job at all, and guessing it wrong in either direction is expensive: say
 * yes wrongly and every voice note fails on the fast path; say no wrongly and
 * every voice note waits for a runner that fires six times in fourteen hours.
 */
const canTranscribe = async (db: ManagementApiExecutor): Promise<boolean> => {
  // Route one: a subprocess running faster-whisper. Never available here — no
  // Python, no subprocesses — but asked rather than assumed, because the same
  // function is the honest answer on any runtime.
  const Command = Deno.Command
  if (Command !== undefined) {
    try {
      if (
        (await new Command('python3', { args: ['-c', 'import faster_whisper'] }).output()).success
      ) {
        return true
      }
    } catch {
      // Fall through to route two.
    }
  }

  // Route two: an HTTP speech service (0135). This one IS available here, and
  // it is why voice notes work again after Grant switched Actions off — the
  // edge can make an API call even though it cannot spawn a process.
  try {
    const { rows } = await db.execute('select app.voice_transcriber() as j')
    const raw = rows[0]?.j
    const t = (typeof raw === 'string' ? JSON.parse(raw) : raw) as {
      mode?: string
      key?: string
    }
    return t?.mode === 'api' && typeof t.key === 'string' && t.key !== ''
  } catch {
    return false
  }
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'GET') {
    // Says whether it COULD run, and nothing about what is queued. An
    // unauthenticated caller learning the queue depth is a probing aid.
    //
    // `can_transcribe` is here because it is the one capability that differs
    // between the two places a pass runs. Transcription shells out to
    // faster-whisper (`scripts/voice/transcribe.py`) — deliberately, so
    // Grant's voice never leaves our own compute — and this runtime has no
    // subprocesses and no Python. Reported rather than assumed: a voice note
    // silently failing on the fast path and only working when a GitHub runner
    // happens to fire is precisely the class of bug this whole change exists
    // to remove.
    return json({
      ok: true,
      endpoint: 'worker',
      configured: PROJECT_REF !== '' && ACCESS_TOKEN !== '' && KICK_SECRET !== '',
      can_transcribe: await canTranscribe(new ManagementApiExecutor(PROJECT_REF, ACCESS_TOKEN)),
      can_subprocess: await canSubprocess(),
      // Whether a direct database connection is available here, never its
      // value. ADR-0007 rules out raw TCP from a Claude Code session; this is
      // a different runtime, on Supabase's own network, and every query going
      // over the Management API instead costs about a second and a half.
      db_url_present: (Deno.env.get('SUPABASE_DB_URL') ?? '') !== '',
      // Which way this instance reaches the database. Reported because a
      // silent fall back to the slow path is the kind of thing that gets
      // discovered as "it feels sluggish again" three weeks later.
      db: direct === undefined ? 'not tried yet' : direct === null ? 'management api' : 'direct',
    })
  }

  const presented = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!(await secretMatches(presented))) return json({ error: 'unauthorized' }, 401)

  if (ACCESS_TOKEN === '' || PROJECT_REF === '') {
    return json({ error: 'not configured' }, 503)
  }

  if (running) {
    kickPending = true
    return json({ ok: true, skipped: 'a pass is already running; queued one behind it' })
  }

  // Held? Then hold, whoever asked.
  //
  // pg_cron checks this too, so this is the second of two gates rather than
  // the only one — deliberately, because a webhook kick does not go through
  // pg_cron, and the point of a pause is that NOTHING touches the queue while
  // a verification suite is measuring it. `verify:jobs` failed four checks at
  // random once a pass began running every minute: recovery moved a job to
  // `retrying` exactly as designed, and the heartbeat had already promoted it
  // to `queued` before the suite looked.
  // Direct to Postgres where possible, over the Management API where not.
  // See `pg.ts`: this is the difference between an empty pass costing
  // seventeen seconds and costing one, and the fallback means a failure here
  // is slow rather than broken.
  if (direct === undefined || (direct === null && Date.now() - directFailedAt > DIRECT_RETRY_AFTER_MS)) {
    direct = await PostgresExecutor.connect(Deno.env.get('SUPABASE_DB_URL') ?? '')
    if (direct === null) directFailedAt = Date.now()
  }
  const db: SqlExecutor = direct ?? new ManagementApiExecutor(PROJECT_REF, ACCESS_TOKEN)
  try {
    const { rows } = await db.execute('select app.worker_paused() as held')
    if (rows[0]?.held === true) return json({ ok: true, skipped: 'the office is paused' })
  } catch {
    // A pause we cannot read is not a pause. Working is the safer default: a
    // failed check that stopped the queue would turn a transient blip into
    // Grant waiting again, which is the thing this path exists to fix.
  }

  running = true

  if (capabilities === null) {
    // Both at once: they are independent, and the second is not waiting on the
    // first to finish talking to a speech API.
    const [transcribe, subprocess] = await Promise.all([canTranscribe(db), canSubprocess()])
    capabilities = { transcribe, subprocess }
  }

  const lines: string[] = []
  try {
    const pass = await buildPass(db, `edge-${crypto.randomUUID().slice(0, 8)}`, {
      log: (line) => lines.push(line),
      max: MAX_JOBS,
      deadlineMs: DEADLINE_MS,
      // Asked, not assumed — and the answer is no here. An untranscribed voice
      // note is therefore left for the runner that can hear it (0125), instead
      // of being claimed and failed three times by the worker that cannot.
      canTranscribe: capabilities.transcribe,
      canSubprocess: capabilities.subprocess,
    })
    let result = await pass()

    // Anything that arrived while that ran gets a pass of its own, now, rather
    // than waiting up to a minute for the heartbeat. Bounded to two extra
    // rounds: a steady stream of kicks should be absorbed by the heartbeat and
    // the next request, not by one invocation running until the platform
    // kills it.
    for (let extra = 0; extra < 2 && kickPending; extra += 1) {
      kickPending = false
      lines.push('another kick arrived while that ran — going again')
      const again = await pass()
      result = {
        ...again,
        handled: result.handled + again.handled,
        buttons: result.buttons + again.buttons,
      }
    }

    return json({ ok: true, ...result, log: lines })
  } catch (error) {
    // Returned rather than thrown, so a kick that fails leaves a readable
    // answer instead of a 500 with a stack trace in somebody's log.
    return json({ ok: false, error: (error as Error).message.slice(0, 300), log: lines }, 500)
  } finally {
    running = false
    kickPending = false
  }
})
