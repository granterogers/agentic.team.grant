/**
 * Stopping work that is running (#41's cancellation dimension).
 *
 *   npm run verify:stop
 *
 * The office can spend a long time on the wrong thing, and until this run
 * Grant had no way to say so. `stop_job` has existed at the gateway since the
 * browser work and NOTHING had ever called it — `data-stop` in the studio is
 * an unrelated click-propagation stopper, which is the kind of name collision
 * that makes a grep look reassuring when it is not.
 *
 * The control is now on every running job. This proves the thing behind it,
 * which `verify:wired` structurally cannot: that audit walks screens without a
 * token and with nothing running, and a control drawn only when a ROW exists
 * is invisible to it — CLAUDE.md records that exact blind spot twice.
 *
 * ## What a stop IS, and the reason the wording matters
 *
 * A column the runner reads between steps, not a socket and not a kill. A step
 * already in flight finishes, which is what the effect declarations exist to
 * protect: interrupting a step mid-external-effect is how exactly-once
 * becomes at-least-once. So the office halts at its next checkpoint, and the
 * button says it asked rather than that it stopped.
 *
 * ## Every check has its opposite
 *
 * A stop that halted everything would pass a suite that only asserted halting.
 * So: an unstopped job runs to the end, a finished job cannot be stopped and
 * says why, and the steps completed BEFORE the stop stay completed — because a
 * stop that discarded finished work would make pressing it expensive enough
 * that nobody would.
 */

import { readFileSync } from 'node:fs'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { runSteps } from '../../src/jobs/checkpoint.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string): Promise<Record<string, unknown>> =>
  ((await db.execute(sql)).rows[0] ?? {}) as Record<string, unknown>
const asJson = (v: unknown): Record<string, unknown> =>
  (typeof v === 'string' ? JSON.parse(v) : (v ?? {})) as Record<string, unknown>

const checks: { what: string; outcome: string; passed: boolean }[] = []
const check = (what: string, outcome: string, passed: boolean): void => {
  checks.push({ what, outcome, passed })
  console.log(`  ${passed ? 'ok  ' : 'FAIL'} ${what} — ${outcome}`)
}

const run = Math.random().toString(36).slice(2, 10)
const MINE = `verify:stop-${run}`

console.log('stopping work that is running (#41) —\n')

/*
  Fixture jobs, by name. `requested_by` begins `verify:`, so `is_fixture` is
  generated true and none of this reaches Grant's health readings — asserted
  at the end rather than believed, because CLAUDE.md records two suites whose
  headers claimed exactly this and were wrong.

  No project: these jobs run nothing but the stub steps below, so a project
  would only be somewhere for debris to land.
*/
const makeJob = async (tag: string): Promise<string> =>
  String(
    (
      await one(`
        insert into public.jobs
          (correlation_id, project_id, idempotency_key, kind, requested_by, priority, announce)
        values (gen_random_uuid(), null, ${lit(`stop-${run}-${tag}`)}, ${lit(`stopprobe.${run}`)},
                ${lit(MINE)}, 100, false)
        returning job_id::text as id`)
    ).id,
  )

/** Three steps that record which of them ran. */
const stepsFor = (ran: string[]) => [
  {
    name: 'one',
    effect: 'none' as const,
    run: async () => {
      ran.push('one')
      return { outcome: { did: 1 } }
    },
  },
  {
    name: 'two',
    effect: 'none' as const,
    run: async () => {
      ran.push('two')
      return { outcome: { did: 2 } }
    },
  },
  {
    name: 'three',
    effect: 'none' as const,
    run: async () => {
      ran.push('three')
      return { outcome: { did: 3 } }
    },
  },
]

// --- 1. a job nobody stopped runs all the way through -----------------------
{
  const jobId = await makeJob('clean')
  const ran: string[] = []
  const out = await runSteps(db, jobId, `stop@${run}`, stepsFor(ran))
  check(
    'CONTROL: a job nobody stopped runs every step',
    `${ran.join(', ')} · ${out.kind}`,
    ran.length === 3 && out.kind === 'done',
  )
}

// --- 2. a stop asked for BEFORE the run halts at the first checkpoint -------
{
  const jobId = await makeJob('before')
  const asked = asJson((await one(`select app.request_stop(${lit(jobId)}::uuid, 'grant') as r`)).r)
  check(
    'a stop is accepted on a job that has not finished',
    JSON.stringify(asked),
    asked.ok === true,
  )

  const ran: string[] = []
  const out = await runSteps(db, jobId, `stop@${run}`, stepsFor(ran))
  check(
    'and the runner halts before doing anything at all',
    `${ran.length === 0 ? 'nothing ran' : ran.join(', ')} · ${out.kind}`,
    out.kind === 'stopped' && ran.length === 0,
  )
  check(
    'and it says WHERE it stopped, so the answer is resumable rather than lost',
    out.kind === 'stopped' ? String(out.at) : '(not stopped)',
    out.kind === 'stopped' && out.at === 'one',
  )
}

// --- 3. a stop mid-run keeps what is already done ---------------------------
{
  const jobId = await makeJob('mid')
  const ran: string[] = []
  /*
    The stop is asked for BY the first step, which is the realistic shape: Grant
    presses the button while the office is working, and the runner sees it at
    the next checkpoint rather than in the middle of one.
  */
  const steps = [
    {
      name: 'one',
      effect: 'none' as const,
      run: async () => {
        ran.push('one')
        await db.execute(`select app.request_stop(${lit(jobId)}::uuid, 'grant')`)
        return { outcome: { did: 1 } }
      },
    },
    {
      name: 'two',
      effect: 'none' as const,
      run: async () => {
        ran.push('two')
        return { outcome: { did: 2 } }
      },
    },
  ]
  const out = await runSteps(db, jobId, `stop@${run}`, steps)
  check(
    'a step already in flight finishes, and the NEXT one does not start',
    `${ran.join(', ')} · ${out.kind}`,
    ran.join(',') === 'one' && out.kind === 'stopped',
  )
  /*
    The work already done survives. A stop that threw away a finished step
    would make the button expensive enough that nobody would press it, and
    #263's whole argument is that a checkpoint is what makes work resumable.
  */
  // `job_steps` records `finished_at`, not a state column. Read from
  // information_schema rather than assumed, after the assumption cost a run.
  const kept = await one(`
    select count(*)::int as n from public.job_steps
     where job_id = ${lit(jobId)}::uuid and finished_at is not null`)
  check(
    'and the step that DID finish is still recorded as finished',
    `${String(kept.n)} completed step(s) kept`,
    Number(kept.n) === 1,
  )
  /*
    Narrowed on `kind` rather than cast. A `paused` run has no `outcomes` at
    all, and asserting through a cast would have compiled and then read
    `undefined` on the one shape where this check would matter most.
  */
  const carried = out.kind === 'stopped' ? out.outcomes : {}
  check(
    'the outcome of that step survives too, so resuming would not redo it',
    JSON.stringify(carried),
    (carried as Record<string, unknown>).one !== undefined,
  )
}

// --- 4. what cannot be stopped ----------------------------------------------
{
  const jobId = await makeJob('done')
  await db.execute(`
    update public.jobs set state = 'cancelled', finished_at = app.now_utc(),
      state_reason = 'verify:stop fixture' where job_id = ${lit(jobId)}::uuid`)
  const asked = asJson((await one(`select app.request_stop(${lit(jobId)}::uuid, 'grant') as r`)).r)
  check(
    'CONTROL: a job that already finished cannot be stopped, and says why',
    String(asked.note ?? asked.error ?? '(said nothing)'),
    asked.ok === false && String(asked.note ?? '').includes('already finished'),
  )

  const missing = asJson(
    (
      await one(
        `select app.request_stop('00000000-0000-0000-0000-000000000000'::uuid, 'grant') as r`,
      )
    ).r,
  )
  check(
    'CONTROL: a job id that names nothing is an error rather than a silent success',
    String(missing.error ?? '(no error)'),
    String(missing.error ?? '').includes('no job by that id'),
  )
}

// --- 5. the gateway actually exposes it -------------------------------------
{
  /*
    The control on the page presses `stop_job`, and the binding between that
    name and `app.request_stop` lives in the edge function. A suite that only
    drove the SQL would be green on a product where the button reached nothing
    — which is the defect this whole file exists because of.
  */
  const source = readFileSync('supabase/functions/hq-api/index.ts', 'utf8')
  check(
    'the gateway binds stop_job to request_stop, which is what the button calls',
    /stop_job:\s*\{\s*fn:\s*'request_stop'/.test(source) ? 'bound' : 'NOT BOUND',
    /stop_job:\s*\{\s*fn:\s*'request_stop'/.test(source),
  )
  const page = readFileSync('web/studio/app.js', 'utf8')
  check(
    'and the studio has a control that calls it',
    /act\('stop_job'/.test(page) ? 'present' : 'NO CALLER IN THE PAGE',
    /act\('stop_job'/.test(page) && /data-stop-job/.test(page),
  )
}

// --- hygiene and teardown ---------------------------------------------------
console.log('')
const mine = await one(`
  select count(*)::int as all_of_them, count(*) filter (where is_fixture)::int as fixtures
    from public.jobs where requested_by = ${lit(MINE)}`)
check(
  'every job this suite wrote is harness traffic',
  `${String(mine.fixtures)} of ${String(mine.all_of_them)}`,
  Number(mine.all_of_them) > 0 && Number(mine.all_of_them) === Number(mine.fixtures),
)
await db.execute(`
  update public.jobs set state = 'cancelled', finished_at = app.now_utc(),
    state_reason = 'verify:stop teardown'
   where requested_by = ${lit(MINE)}
     and state not in ('complete', 'cancelled', 'failed', 'committing', 'committed', 'notifying')`)
const live = await one(`
  select count(*)::int as n from public.jobs
   where requested_by = ${lit(MINE)}
     and state not in ('complete', 'cancelled', 'failed')`)
check(
  'teardown — nothing of this run is still live',
  `${String(live.n)} live`,
  Number(live.n) === 0,
)

const failed = checks.filter((c) => !c.passed)
console.log(`\n${String(checks.length - failed.length)}/${String(checks.length)} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)
