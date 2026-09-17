/**
 * Can the month's CI minutes be exceeded?
 *
 *   npm run verify:ci
 *
 * Issue #17. The incident was 1,800 of 2,000 free minutes going to a
 * five-minute cron nobody was counting, and Grant's answer was to switch
 * Actions off entirely. It comes back on demand only, under a ceiling this
 * suite exists to attack.
 *
 * Four properties, and the second is the one a running total cannot give:
 *
 *   1. A workflow the office was never told about cannot be run at all.
 *   2. Concurrent dispatches cannot both be told there is room, because the
 *      reservation is taken before the run starts.
 *   3. A run that never reports settles as SPENT, not released.
 *   4. The runner's own figure replaces the reservation, per JOB, rounded up,
 *      which is how GitHub bills.
 *
 * Everything runs inside begin and rollback against a fixture workflow, so no
 * real reservation is taken and the month's real figure never moves.
 *
 * No backticks in any comment inside a template literal below.
 */

import type { SqlExecutor } from '../../src/db/executor.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(2)
}
const db: SqlExecutor = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

let pass = 0
let fail = 0
let section = '(before the first section)'
const ok = (what: string, good: boolean, note = '') => {
  if (good) {
    pass++
    console.log(`  ok   ${what}${note === '' ? '' : ` — ${note}`}`)
  } else {
    fail++
    console.error(`  FAIL ${what}${note === '' ? '' : ` — ${note}`}`)
  }
}
const one = async (sql: string): Promise<Record<string, unknown>> => {
  try {
    return ((await db.execute(sql)).rows as Record<string, unknown>[])[0] ?? {}
  } catch (error) {
    ok(`${section} could not run at all`, false, String((error as Error).message).slice(0, 170))
    return {}
  }
}
const asJson = (v: unknown): Record<string, unknown> => {
  if (v === null || v === undefined) return {}
  return (typeof v === 'string' ? JSON.parse(v) : v) as Record<string, unknown>
}
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

const run = Math.random().toString(36).slice(2, 6)
const WF = `probe-${run}`
const SCRATCH = 'create temp table t (k text primary key, v jsonb) on commit drop;'
const KEEP = (k: string, e: string) => `insert into t values (${lit(k)}, ${e});`
const GET = (k: string) => `(select v from t where k = ${lit(k)})`
const MAKE = (minutes: number) => `
  insert into public.ci_workflows (workflow, purpose, expected_minutes, cap_minutes)
  values (${lit(WF)}, 'A probe of the minute ceiling, inside a rollback.',
          ${String(minutes)}, ${String(minutes * 2)});`

console.log('\nverify:ci — the month cannot be spent twice\n')

// ---------------------------------------------------------------------------
console.log('only a workflow the office was told about')
section = 'only a known workflow'
// ---------------------------------------------------------------------------

{
  const got = await one(`
    begin;
    ${SCRATCH}
    ${MAKE(5)}
    ${KEEP('unknown', "app.ci_may_run('no-such-workflow')")}
    ${KEEP('known', `app.ci_may_run(${lit(WF)})`)}
    update public.ci_workflows set enabled = false,
           disabled_reason = 'switched off by the probe'
     where workflow = ${lit(WF)};
    ${KEEP('off', `app.ci_may_run(${lit(WF)})`)}
    select ${GET('unknown')} as unknown, ${GET('known')} as known, ${GET('off')} as off;
    rollback;`)

  ok(
    'a workflow nobody registered cannot be run',
    asJson(got.unknown).may === false,
    String(asJson(got.unknown).why ?? '').slice(0, 70),
  )
  /*
    The control. Without it the check above passes against a gate that refuses
    everything, which is the found-nothing shape in its most dangerous form:
    a ceiling that blocks all work reads as a ceiling working perfectly.
  */
  ok('and a registered one can, so the refusal is about the name', asJson(got.known).may === true)
  ok(
    'a registered workflow that is switched off is refused with its reason',
    asJson(got.off).may === false &&
      String(asJson(got.off).why ?? '').includes('switched off by the probe'),
    String(asJson(got.off).why ?? '(it was allowed)').slice(0, 70),
  )
}

// ---------------------------------------------------------------------------
console.log('the ceiling holds against a second dispatch')
section = 'the ceiling holds'
// ---------------------------------------------------------------------------

{
  /*
    The workflow expects more than half the ceiling, so the FIRST dispatch is
    allowed and the second cannot be — which is the concurrency property
    stated as arithmetic. A running total counted at completion would allow
    both, because neither has finished.
  */
  const got = await one(`
    begin;
    ${SCRATCH}
    ${MAKE(900)}
    ${KEEP('first', `app.ci_reserve(${lit(WF)}, 'probe', 'the first', 'verify:ci', null)`)}
    ${KEEP('mid', 'app.ci_budget()')}
    ${KEEP('second', `app.ci_reserve(${lit(WF)}, 'probe', 'the second', 'verify:ci', null)`)}
    select ${GET('first')} as first, ${GET('mid')} as mid, ${GET('second')} as second,
           (select count(*)::int from public.ci_runs where workflow = ${lit(WF)}) as rows;
    rollback;`)

  ok('the first dispatch is allowed', asJson(got.first).may === true)
  ok(
    'and its minutes count against the month while it is still running',
    Number(asJson(got.mid).used_minutes) >= 900,
    `${String(asJson(got.mid).used_minutes)} committed`,
  )
  ok(
    'the second is refused before it can reach GitHub',
    asJson(got.second).may === false,
    String(asJson(got.second).why ?? '(it was allowed)').slice(0, 90),
  )
  ok(
    'and the refusal wrote no reservation, so a refusal costs nothing',
    Number(got.rows) === 1,
    `${String(got.rows)} ledger row(s)`,
  )
}

// ---------------------------------------------------------------------------
console.log('what a run reports, and what it does not')
section = 'reporting'
// ---------------------------------------------------------------------------

{
  const ID = `(${GET('res')} ->> 'ci_run_id')::uuid`
  const got = await one(`
    begin;
    ${SCRATCH}
    ${MAKE(10)}
    ${KEEP('res', `app.ci_reserve(${lit(WF)}, 'probe', 'a run that reports', 'verify:ci', null)`)}
    ${KEEP('jobA', `app.ci_report(${ID}, 2.2, 'job one')`)}
    ${KEEP('jobB', `app.ci_report(${ID}, 0.1, 'job two')`)}
    ${KEEP('after', 'app.ci_budget()')}
    select ${GET('jobB')} as reported, ${GET('after')} as after,
           (select actual_minutes from public.ci_runs where workflow = ${lit(WF)}) as actual,
           (select outcome from public.ci_runs where workflow = ${lit(WF)}) as outcome;
    rollback;`)

  ok(
    'each job is rounded UP to the minute, the way GitHub bills',
    Number(got.actual) === 4,
    `2.2 and 0.1 minutes billed as ${String(got.actual)}`,
  )
  ok(
    'and both jobs are counted, not just the last',
    Number(asJson(got.reported).jobs_reported) === 2,
  )
  ok('the run settles as reported', got.outcome === 'reported')
  ok(
    'and the real figure replaces the reservation',
    Number(asJson(got.after).used_minutes) === 4,
    `${String(asJson(got.after).used_minutes)} counted, reserved 10`,
  )
}

// ---------------------------------------------------------------------------
console.log('a run that never reports')
section = 'expiry'
// ---------------------------------------------------------------------------

{
  const got = await one(`
    begin;
    ${SCRATCH}
    ${MAKE(7)}
    ${KEEP('res', `app.ci_reserve(${lit(WF)}, 'probe', 'a run that dies', 'verify:ci', null)`)}
    ${KEEP('early', 'app.ci_expire_stale()')}
    update public.ci_runs set expires_at = app.now_utc() - interval '1 minute'
     where workflow = ${lit(WF)};
    ${KEEP('late', 'app.ci_expire_stale()')}
    ${KEEP('after', 'app.ci_budget()')}
    select ${GET('early')} as early, ${GET('late')} as late, ${GET('after')} as after,
           (select outcome from public.ci_runs where workflow = ${lit(WF)}) as outcome;
    rollback;`)

  ok(
    'a reservation that is still in date is left alone',
    Number(asJson(got.early).expired) === 0,
    `${String(asJson(got.early).expired)} expired early`,
  )
  ok('one past its expiry is closed', Number(asJson(got.late).expired) === 1)
  ok('and recorded as expired rather than reported', got.outcome === 'expired')
  ok(
    'it still counts as SPENT — a run that died cost something',
    Number(asJson(got.after).used_minutes) === 7,
    `${String(asJson(got.after).used_minutes)} counted`,
  )
}

// ---------------------------------------------------------------------------
console.log('what the real ledger says')
section = 'the real ledger'
// ---------------------------------------------------------------------------

{
  const got = await one('select app.ci_budget() as b')
  const budget = asJson(got.b)
  ok(
    'the ceiling is set, and below the 2,000 GitHub gives',
    Number(budget.cap_minutes) > 0 && Number(budget.cap_minutes) < 2000,
    `${String(budget.cap_minutes)} minutes`,
  )
  ok(
    'and the reader names whose number it is, so nobody reads it as GitHub billing',
    String(budget.source ?? '').includes('not GitHub'),
    String(budget.source ?? ''),
  )

  const registered = await one(`
    select count(*)::int as n,
           count(*) filter (where workflow like 'probe-%')::int as debris
      from public.ci_workflows`)
  ok(
    'at least one workflow is registered, so the gate is not vacuous',
    Number(registered.n) >= 1,
    `${String(registered.n)} registered`,
  )
  ok(
    'and this run left no fixture workflow behind',
    Number(registered.debris) === 0,
    `${String(registered.debris)} probe workflow(s) survive`,
  )
}

console.log(`\n${String(pass)}/${String(pass + fail)} checks passed`)
if (fail > 0) process.exit(1)
