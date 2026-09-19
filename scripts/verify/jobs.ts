/**
 * Demonstrate the Phase 1 job-engine acceptance criteria against the live
 * database.
 *
 *   npm run verify:jobs
 *
 * Criteria covered, from docs/implementation-plan.md:
 *
 *   * a job survives a hard kill at every one of its fourteen states and
 *     resumes correctly
 *   * re-enqueueing identical logical work collides instead of duplicating
 *   * capacity limits hold across a restart
 *
 * "Hard kill" here means what it means in production: the worker vanishes
 * without cleaning up, leaving the row exactly as it was, and the lease
 * eventually expires. Simulated by expiring the lease directly — which is the
 * same observable state a killed worker leaves behind, and is why the recovery
 * sweep keys on lease expiry rather than on a shutdown hook that a killed
 * process never runs.
 */

import type { SqlExecutor } from '../../src/db/executor.ts'
import { ManagementApiExecutor, SqlExecutionError } from '../../src/db/executor.ts'
import { hold, release } from '../../src/jobs/quiet.ts'
import type { JobState } from '../../src/jobs/states.ts'
import {
  DORMANT_STATES,
  IN_FLIGHT_STATES,
  JOB_STATES,
  TERMINAL_STATES,
} from '../../src/jobs/states.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(2)
}
const db: SqlExecutor = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

// Hold the queue for the duration.
//
// This suite kills jobs and then reads what recovery did with them. Since a
// pass began running every minute (0121) the heartbeat was getting there
// first: recovery moved a job to `retrying`, `requeue_retrying` promoted it to
// `queued`, and four checks failed at random on correct code. 0129 is the
// switch; this is the suite taking it. Bounded and self-lapsing, so a crash
// here cannot leave the office stopped.
await hold(db, 600)

const run = Date.now().toString(36)
interface Check {
  group: string
  what: string
  outcome: string
  passed: boolean
}
const checks: Check[] = []
const record = (group: string, what: string, outcome: string, passed: boolean): void => {
  checks.push({ group, what, outcome, passed })
}

const one = async (sql: string): Promise<Record<string, unknown> | undefined> =>
  (await db.execute(sql)).rows[0]

/** The legal route to each state, so nothing is forced into place. */
const PATH_TO: Readonly<Record<JobState, readonly JobState[]>> = {
  queued: [],
  running: ['running'],
  waiting_external: ['running', 'waiting_external'],
  waiting_user: ['running', 'waiting_user'],
  output_created: ['running', 'output_created'],
  quality_review: ['running', 'output_created', 'quality_review'],
  committing: ['running', 'output_created', 'quality_review', 'committing'],
  committed: ['running', 'output_created', 'quality_review', 'committing', 'committed'],
  notifying: [
    'running',
    'output_created',
    'quality_review',
    'committing',
    'committed',
    'notifying',
  ],
  complete: [
    'running',
    'output_created',
    'quality_review',
    'committing',
    'committed',
    'notifying',
    'complete',
  ],
  retrying: ['running', 'retrying'],
  paused: ['paused'],
  cancelled: ['cancelled'],
  failed: ['failed'],
}

async function createJob(key: string, priority = 100): Promise<string> {
  const row = await one(`
    insert into public.jobs (correlation_id, kind, idempotency_key, requested_by, priority)
    values (gen_random_uuid(), 'verification.probe', '${key}', 'phase-1-verification', ${priority})
    returning job_id
  `)
  return String(row?.job_id)
}

/**
 * Walk a job to a state along its legal route, in ONE request.
 *
 * The Management API applies a multi-statement request atomically, so this is
 * both faster than a request per step and a stronger test: every transition in
 * the path is enforced and logged inside a single transaction, which is how a
 * real worker would move a job through several states without pausing.
 */
async function driveTo(jobId: string, state: JobState): Promise<void> {
  const path = PATH_TO[state]
  if (path.length === 0) return
  const sql = path
    .map((step) => `update public.jobs set state = '${step}' where job_id = '${jobId}';`)
    .join('\n')
  await db.execute(sql)
}

// ===========================================================================
// 1. Idempotency
// ===========================================================================
const dupKey = `dup-${run}`
await createJob(dupKey)
try {
  await createJob(dupKey)
  record(
    'idempotency',
    'second enqueue of identical logical work',
    'SUCCEEDED — it must not have',
    false,
  )
} catch (error) {
  const message = error instanceof SqlExecutionError ? error.message : String(error)
  const ok = message.includes('23505') && message.includes('jobs_one_live_per_idempotency_key')
  record(
    'idempotency',
    'second enqueue of identical logical work',
    ok
      ? 'collided with 23505 on jobs_one_live_per_idempotency_key'
      : `wrong failure: ${message.slice(0, 90)}`,
    ok,
  )
}

// Once the original is terminal the key is free again — a deliberate design
// choice (§5 is about concurrent duplication, not about forbidding re-runs).
const reuseKey = `reuse-${run}`
const finished = await createJob(reuseKey)
await driveTo(finished, 'cancelled')
try {
  await createJob(reuseKey)
  record(
    'idempotency',
    'same key re-enqueued after the original reached a terminal state',
    'allowed, as designed',
    true,
  )
} catch (error) {
  record(
    'idempotency',
    'same key re-enqueued after the original reached a terminal state',
    `refused: ${(error as Error).message.slice(0, 80)}`,
    false,
  )
}

// ===========================================================================
// 2. The transition allow-list is enforced by the DATABASE
// ===========================================================================
const gateJob = await createJob(`gate-${run}`)
await driveTo(gateJob, 'output_created')
try {
  await db.execute(`update public.jobs set state = 'committing' where job_id = '${gateJob}'`)
  record(
    'quality gate',
    'output_created -> committing, skipping review',
    'SUCCEEDED — the gate was bypassed',
    false,
  )
} catch (error) {
  const message = (error as Error).message
  const ok = message.includes('illegal job transition') && message.includes('23514')
  record(
    'quality gate',
    'output_created -> committing, skipping review (§10)',
    ok
      ? 'refused: illegal job transition output_created -> committing'
      : `wrong failure: ${message.slice(0, 90)}`,
    ok,
  )
}

const terminalJob = await createJob(`terminal-${run}`)
await driveTo(terminalJob, 'complete')
try {
  await db.execute(`update public.jobs set state = 'running' where job_id = '${terminalJob}'`)
  record('transitions', 'reviving a complete job', 'SUCCEEDED — it must not have', false)
} catch (error) {
  const ok = (error as Error).message.includes('illegal job transition')
  record(
    'transitions',
    'reviving a complete job',
    ok ? 'refused: terminal states have no outgoing transitions' : 'wrong failure',
    ok,
  )
}

// Every transition is logged, by the trigger rather than by a caller.
// Creation, plus one row per step on the path to `complete`. Asserted against
// PATH_TO rather than a literal, because the first version of this hard-coded 7
// for a seven-step path and failed on its own arithmetic while the trigger was
// behaving perfectly. A magic number in an assertion is a second thing to keep
// correct.
const expectedTransitions = PATH_TO.complete.length + 1
const logged = await one(`
  select count(*)::int as n from public.job_state_transitions where job_id = '${terminalJob}'
`)
record(
  'transitions',
  `every state change logged (creation + ${PATH_TO.complete.length} moves to complete)`,
  `${String(logged?.n)} rows in job_state_transitions, expected ${expectedTransitions}`,
  logged?.n === expectedTransitions,
)

// The log is append-only too: recovery evidence that can be rewritten is not
// evidence.
try {
  await db.execute(`
    update public.job_state_transitions set to_state = 'complete'
    where job_id = '${terminalJob}'
  `)
  record('transitions', 'rewriting transition history', 'SUCCEEDED — it must not have', false)
} catch (error) {
  const ok = (error as Error).message.includes('append-only')
  record(
    'transitions',
    'rewriting transition history is refused',
    ok ? 'refused: append-only' : `wrong failure: ${(error as Error).message.slice(0, 80)}`,
    ok,
  )
}

// ===========================================================================
// 3. Hard kill in every one of the fourteen states
// ===========================================================================
const killed: Record<string, string> = {}
for (const state of JOB_STATES) {
  const id = await createJob(`kill-${state}-${run}`)
  await driveTo(id, state)
  killed[state] = id
}

// Expire every lease: the observable state a killed worker leaves behind.
await db.execute(`
  update public.jobs
  set leased_by = 'dead-worker', leased_until = now() - interval '1 hour'
  where idempotency_key like 'kill-%-${run}'
    and state not in ('complete','cancelled','failed')
`)

const swept = await db.execute('select * from app.recover_stalled_jobs()')
const recovered = new Map(swept.rows.map((r) => [String(r.job_id), String(r.to_state)]))

for (const state of JOB_STATES) {
  const id = killed[state] as string
  const after = String((await one(`select state from public.jobs where job_id = '${id}'`))?.state)

  if ((IN_FLIGHT_STATES as readonly JobState[]).includes(state)) {
    // `committed` AND `notifying` are both §18's case: past the commit point,
    // so recovery resumes delivery rather than retrying.
    //
    // `notifying` was expected to sweep to `retrying` until 2026-09-06, and
    // that expectation was wrong in a way this suite could not see. Retrying
    // from `notifying` sends a job whose output already exists back through
    // its handler — measured, in `verify:chaos`: the handler ran a second time
    // and the job finished with two outputs, which is exactly the duplicate
    // substantive work §18 forbids. The transition is legal in the state
    // machine and was still the wrong move. 0058 and 0059 fix it.
    const expected = state === 'committed' || state === 'notifying' ? 'notifying' : 'retrying'
    record(
      'hard kill',
      `killed in ${state} (in-flight)`,
      `swept to ${after}, expected ${expected}`,
      after === expected && recovered.get(id) === expected,
    )
  } else {
    // Dormant and terminal states must be left alone. Sweeping `paused` would
    // silently resume work Grant told it to stop.
    const kind = (TERMINAL_STATES as readonly JobState[]).includes(state) ? 'terminal' : 'dormant'
    record(
      'hard kill',
      `killed in ${state} (${kind}) is left alone`,
      `still ${after}`,
      after === state && !recovered.has(id),
    )
  }
}

// A recovered job goes back through the QUEUE, so capacity is re-applied.
const requeued = await one('select app.requeue_retrying() as n')
record(
  'hard kill',
  'recovered jobs re-enter the queue rather than jumping to running',
  `${String(requeued?.n)} moved retrying -> queued`,
  Number(requeued?.n) >= 5,
)

// ===========================================================================
// 4. Capacity enforced AT DEQUEUE
// ===========================================================================
// Drain everything from earlier so the in-flight count starts from a known
// place. `failed` is the drain because it is reachable from EVERY non-terminal
// state — the first version of this used `cancelled` and the allow-list
// correctly refused `notifying -> cancelled`, since committed work is never
// cancelled (§6). The engine rejecting its own test harness is the allow-list
// working.
await db.execute(`
  update public.jobs set state = 'failed', state_reason = 'verification cleanup'
  where requested_by = 'phase-1-verification'
    and state not in ('complete','cancelled','failed')
`)

const live = await one(`
  select count(*)::int as n from public.jobs
  where state in ('running','output_created','quality_review','committing','committed','notifying')
`)
record(
  'capacity',
  'starting from an empty in-flight set',
  `${String(live?.n)} in flight`,
  live?.n === 0,
)

for (let i = 1; i <= 5; i++) await createJob(`cap-${i}-${run}`, i)

// Each dequeue is a SEPARATE request, therefore a separate transaction and a
// separate connection — the same conditions as separate worker processes, and
// the same conditions as a worker restart. If the limit lived in memory this
// would hand out all five.
const handed: string[] = []
for (let i = 1; i <= 5; i++) {
  const row = await one(`select job_id from app.dequeue_job('worker-${i}')`)
  if (row?.job_id !== undefined && row.job_id !== null) handed.push(String(row.job_id))
}
record(
  'capacity',
  'five dequeue attempts across five separate transactions, limit 3',
  `${handed.length} jobs handed out`,
  handed.length === 3,
)
record(
  'capacity',
  'the limit therefore holds across a restart — it is read from the database, not held in memory',
  `${handed.length} of 5 requests served`,
  handed.length === 3,
)

const priorities = await db.execute(`
  select idempotency_key from public.jobs
  where job_id in (${handed.map((h) => `'${h}'`).join(',')})
  order by priority
`)
record(
  'capacity',
  'dequeue respects priority order',
  priorities.rows.map((r) => String(r.idempotency_key).split('-')[1]).join(','),
  priorities.rows
    .map((r) => String(r.idempotency_key))
    .every((k, i) => k === `cap-${i + 1}-${run}`),
)

// Freeing a slot lets exactly one more through.
await db.execute(`update public.jobs set state = 'cancelled' where job_id = '${handed[0]}'`)
const afterFree = await one(`select job_id from app.dequeue_job('worker-6')`)
record(
  'capacity',
  'freeing one slot admits exactly one more job',
  afterFree?.job_id === undefined || afterFree.job_id === null
    ? 'none handed out'
    : 'one handed out',
  afterFree?.job_id !== undefined && afterFree.job_id !== null,
)

// ===========================================================================
// 5. Circuit breaker, state in the database
// ===========================================================================
const provider = `probe_${run.replace(/[^a-z0-9]/g, '')}`
await db.execute(`delete from public.provider_health where provider = '${provider}'`)

const availableInitially = await one(`select app.provider_available('${provider}') as ok`)
record(
  'breaker',
  'an unknown provider is available (no failures recorded)',
  `available=${String(availableInitially?.ok)}`,
  availableInitially?.ok === true,
)

for (let i = 1; i <= 4; i++) {
  await db.execute(`select app.record_provider_failure('${provider}', 'timeout ${i}')`)
}
const stillClosed = await one(
  `select state::text as s from public.provider_health where provider = '${provider}'`,
)
record(
  'breaker',
  'four failures against a threshold of five leaves it closed',
  `state=${String(stillClosed?.s)}`,
  stillClosed?.s === 'closed',
)

const opened = await one(
  `select app.record_provider_failure('${provider}', 'timeout 5')::text as s`,
)
record(
  'breaker',
  'the fifth failure opens the breaker',
  `state=${String(opened?.s)}`,
  opened?.s === 'open',
)

const refused = await one(`select app.provider_available('${provider}') as ok`)
record(
  'breaker',
  'an open breaker refuses further calls',
  `available=${String(refused?.ok)}`,
  refused?.ok === false,
)

// Elapse the cooldown rather than waiting 60 real seconds.
await db.execute(`
  update public.provider_health set next_probe_at = now() - interval '1 second'
  where provider = '${provider}'
`)
const probe = await one(`select app.provider_available('${provider}') as ok`)
const probeState = await one(
  `select state::text as s from public.provider_health where provider = '${provider}'`,
)
record(
  'breaker',
  'after cooldown, exactly one probe is admitted (half_open)',
  `available=${String(probe?.ok)} state=${String(probeState?.s)}`,
  probe?.ok === true && probeState?.s === 'half_open',
)

const secondProbe = await one(`select app.provider_available('${provider}') as ok`)
record(
  'breaker',
  'a second caller is refused while the probe is in flight',
  `available=${String(secondProbe?.ok)}`,
  secondProbe?.ok === false,
)

const failedProbe = await one(
  `select app.record_provider_failure('${provider}', 'still down')::text as s`,
)
const backoff = await one(
  `select cooldown_seconds from public.provider_health where provider = '${provider}'`,
)
record(
  'breaker',
  'a failed probe re-opens immediately and backs off',
  `state=${String(failedProbe?.s)} cooldown=${String(backoff?.cooldown_seconds)}s`,
  failedProbe?.s === 'open' && Number(backoff?.cooldown_seconds) === 120,
)

await db.execute(`
  update public.provider_health set next_probe_at = now() - interval '1 second'
  where provider = '${provider}'
`)
await db.execute(`select app.provider_available('${provider}')`)
await db.execute(`select app.record_provider_success('${provider}')`)
const closed = await one(`
  select state::text as s, consecutive_failures, cooldown_seconds
  from public.provider_health where provider = '${provider}'
`)
record(
  'breaker',
  'a successful probe closes the breaker and resets the backoff',
  `state=${String(closed?.s)} failures=${String(closed?.consecutive_failures)} cooldown=${String(closed?.cooldown_seconds)}s`,
  closed?.s === 'closed' && closed?.consecutive_failures === 0 && closed?.cooldown_seconds === 60,
)

// ===========================================================================
// Report
// ===========================================================================
console.log('| group | check | outcome | |')
console.log('|---|---|---|---|')
for (const c of checks) {
  console.log(`| ${c.group} | ${c.what} | ${c.outcome} | ${c.passed ? '✅' : '❌'} |`)
}
const failedChecks = checks.filter((c) => !c.passed)
console.log(`\n${checks.length - failedChecks.length}/${checks.length} checks passed`)
console.log(
  `\nStates exercised: ${JOB_STATES.length} (${IN_FLIGHT_STATES.length} in-flight, ` +
    `${DORMANT_STATES.length} dormant, ${TERMINAL_STATES.length} terminal)`,
)

// ---------------------------------------------------------------------------
// Retire this run's jobs.
//
// Absent until it mattered. These jobs carry no project, so `purge:fixtures` -
// which finds debris by project slug - could not see them, and the capacity
// probes accumulated as LIVE jobs against a global limit of three. The queue
// eventually held three permanently-running jobs with expired leases, and the
// next thing that tried to dequeue simply got nothing, which looks like a bug
// in the dequeue rather than a leak here.
//
// That is the sharper version of the fixture-leak lesson: a leaked row
// distorts a summary, but a leaked LEASE stops the queue and misattributes the
// fault to whatever runs next.
//
// `failed` is reachable from every non-terminal state and is the honest label
// for a probe abandoned mid-flight.
// ---------------------------------------------------------------------------
try {
  const retired = await db.execute(`
    update public.jobs set state = 'failed', finished_at = now(),
      state_reason = 'verification probe retired by verify:jobs'
    where idempotency_key like '%-${run}'
      and state not in ('complete', 'cancelled', 'failed')
    returning job_id
  `)
  console.log(`Retired ${retired.rows.length} probe job(s) from this run.`)
  /*
    AND the circuit-breaker row, which was only ever cleaned at the START.

    Line 396 deletes `provider_health` for this run's provider before the
    section that exercises it, which works perfectly while you are running the
    suite and leaves one row behind for ever after the last run. `check:leaks`
    counts it — *"1 probe provider(s) in provider_health — a circuit breaker
    suite is not clearing up after itself"* — and `purge:fixtures` does not
    sweep that table, so the witness reported a class nothing could clear.

    Asserted, not merely attempted: CLAUDE.md, *"a teardown that matches
    nothing looks exactly like a teardown that worked."*
  */
  await db.execute(`delete from public.provider_health where provider = '${provider}'`)
  const stillThere = (
    await db.execute(
      `select count(*)::int as n from public.provider_health where provider = '${provider}'`,
    )
  ).rows[0] as { n: number }
  if (Number(stillThere.n) !== 0) {
    failedChecks.push({
      group: 'teardown',
      what: 'the probe provider is removed',
      outcome: `${provider} is still in provider_health`,
      passed: false,
    })
    console.log(`  FAIL teardown — ${provider} is still in provider_health`)
  } else {
    console.log(`Removed the probe provider ${provider}.`)
  }
} catch (error) {
  console.log(`Cleanup did not complete: ${(error as Error).message.slice(0, 160)}`)
}

await release(db)

if (failedChecks.length > 0) process.exit(1)
