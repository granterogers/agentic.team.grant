/**
 * Is the queue actually draining?
 *
 *   npm run verify:drains
 *
 * Issue #231. Grant asked whether he gets prompt responses. The median real
 * instruction finishes in **53 seconds**, and fifteen of the last hundred and
 * twenty-nine took **over an hour** — one of them fifteen hours.
 *
 * The interesting part is not the number. It is that every one of those slow
 * jobs ran in UNDER A MINUTE once it started:
 *
 *     created 09-13 15:25   started 09-14 06:41   ran 0m
 *     created 09-13 16:06   started 09-14 06:41   ran 0m
 *     created 09-13 22:02   started 09-14 06:42   ran 0m
 *
 * They all drained in one burst at 06:41. The office was not slow. **The worker
 * was not there**, from about 15:25 on the 13th until 06:41 the next morning,
 * and eleven of Grant's messages sat in a queue for up to fifteen hours.
 *
 * ## Why nothing noticed
 *
 * `pg_cron` fires `worker-heartbeat` every minute and it logged **1,440
 * consecutive successes that day, zero failures.** A cron row says the HTTP
 * request was MADE. It says nothing about whether the worker on the other end
 * did any work — so the one thing watching the office reported perfect health
 * through a fifteen-hour outage.
 *
 * `app.office_health()` did not catch it either. It reports failed, stalled,
 * in_flight and finished — every one of which is about jobs that STARTED. A job
 * nobody ever picked up is none of those things. The office had no word for
 * "waiting", which is the exact state Grant was in.
 *
 * ## What this asserts
 *
 * The property, not the mechanism: **no real job has been waiting longer than a
 * person would wait.** It does not care why — a dead worker, a stranded job
 * blocking deploys, an exhausted lease, a provider outage. Any of those produce
 * the same symptom and this catches all of them, which a check written against
 * one cause would not.
 *
 * Harness traffic is excluded via `app.harness_job`, because a fixture sitting
 * in a queue is not Grant waiting for an answer, and CLAUDE.md records three
 * separate occasions when test traffic was about to be reported to him as the
 * office failing.
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
const ok = (what: string, good: boolean, note = '') => {
  if (good) {
    pass++
    console.log(`  ok   ${what}${note === '' ? '' : ` — ${note}`}`)
  } else {
    fail++
    console.error(`  FAIL ${what}${note === '' ? '' : ` — ${note}`}`)
  }
}
const one = async (sql: string): Promise<Record<string, unknown>> =>
  ((await db.execute(sql)).rows as Record<string, unknown>[])[0] ?? {}

/*
  Fifteen minutes.

  Not a service level anybody agreed — it is the point past which a person who
  sent a message concludes nothing is coming. The office's own median is 53
  seconds, so fifteen minutes is roughly seventeen times normal and cannot fire
  on an ordinary busy moment. A duty running its ten-minute period is inside it.
*/
const WAITING_TOO_LONG_MIN = 15

console.log('\nverify:drains — is the queue moving\n')

/*
  The question, written once.

  Both the live reading and the CONTROL at the bottom of this file ask it, and
  they must ask the SAME question or the control proves nothing about the
  check. CLAUDE.md: a list built twice is a list that will disagree — and a
  control built twice is worse, because it can go green while the thing it
  claims to exercise is broken.
*/
const WAITING = `
  select count(*)::int as n,
         coalesce(round(max(extract(epoch from (app.now_utc() - created_at)) / 60))::int, 0) as oldest_min,
         coalesce(
           (select string_agg(distinct kind, ', ')
              from public.jobs
             where state in ('queued', 'retrying')
               and not app.harness_job(job_id)
               and created_at < app.now_utc() - make_interval(mins => ${String(WAITING_TOO_LONG_MIN)})),
           '') as kinds
    from public.jobs
   where state in ('queued', 'retrying')
     and not app.harness_job(job_id)`

/*
  The VERDICT, written once, for the same reason the query is (#236).

  The controls below used to assert what the query SAW — "it returned a row
  with oldest_min 600" — which is one step short of what this Issue asks for.
  A query that sees a stuck job and a suite that fails because of one are
  different claims, and only the second is the guard. So the predicate that
  decides the live check is a named function, and the controls run the
  injected reading through THAT and require it to come back false.

  Proving it end to end by leaving a stuck job behind and re-running the
  command was the obvious alternative and is not available: a job cannot be
  deleted — `job_state_transitions` holds it by foreign key — so the proof
  would leave a permanent fifteen-hour-old stuck job in Grant's queue,
  injected by the suite written to prove his queue is not stuck. Wrong at
  every level.
*/
const drained = (reading: Record<string, unknown>): boolean =>
  Number(reading.oldest_min) <= WAITING_TOO_LONG_MIN

const waiting = await one(WAITING)

ok(
  `no real job has been waiting longer than ${String(WAITING_TOO_LONG_MIN)} minutes`,
  drained(waiting),
  Number(waiting.n) === 0
    ? 'the queue is empty'
    : `${String(waiting.n)} waiting, oldest ${String(waiting.oldest_min)}m${String(waiting.kinds) === '' ? '' : ` (${String(waiting.kinds)})`}`,
)

/*
  The heartbeat, asked properly.

  A cron row saying `succeeded` means the request went out. So the useful
  question is not "did it succeed" but "did it RUN AT ALL RECENTLY" — a cron
  that was disabled, dropped or never re-created after a database restore
  produces no rows, and no rows is the silence this suite exists to break.
*/
const beat = await one(`
  select coalesce(round(extract(epoch from (app.now_utc() - max(start_time))) / 60)::int, 99999) as ago_min,
         count(*) filter (where start_time > app.now_utc() - interval '1 hour')::int as last_hour
    from cron.job_run_details`)
ok(
  'the worker heartbeat has fired in the last few minutes',
  Number(beat.ago_min) <= 5,
  `last beat ${String(beat.ago_min)}m ago, ${String(beat.last_hour)} in the past hour`,
)

/*
  And the half the heartbeat cannot tell you.

  1,440 successful beats accompanied a fifteen-hour outage, so a beating cron is
  not evidence of a working worker. What IS evidence is a job having actually
  moved: something started or finished recently. Only asserted when there was
  work to do — an idle office finishing nothing is correct behaviour, and a
  check that demanded constant throughput would fire every quiet evening.
*/
const moved = await one(`
  select coalesce(round(extract(epoch from (app.now_utc() - max(greatest(started_at, finished_at)))) / 60)::int, 99999) as ago_min
    from public.jobs
   where greatest(started_at, finished_at) > app.now_utc() - interval '24 hours'`)
const idle = Number(waiting.n) === 0
ok(
  idle
    ? 'CONTROL: nothing is waiting, so the office is idle rather than stuck — no throughput required'
    : 'something has actually started or finished recently, so the worker is not merely being pinged',
  idle || Number(moved.ago_min) <= WAITING_TOO_LONG_MIN,
  `last movement ${Number(moved.ago_min) === 99999 ? 'not in 24h' : `${String(moved.ago_min)}m ago`}`,
)

/*
  A job stuck in a state that can only go to `failed`.

  CLAUDE.md records what these cost: two of them sat in `committing` and
  stranded EVERY `deploy:worker` for a day, reported four steps from the cause
  as "illegal job transition committing -> notifying". A worker that cannot be
  deployed is a worker that stops draining, which is the outage above — so this
  is the same incident caught one layer earlier.
*/
const stranded = await one(`
  select count(*)::int as n,
         coalesce(string_agg(distinct state::text, ', '), '') as states
    from public.jobs
   where state in ('committing', 'committed', 'notifying')
     and updated_at < app.now_utc() - interval '30 minutes'`)
ok(
  'no job is stranded in a state whose only exit is failure',
  Number(stranded.n) === 0,
  Number(stranded.n) === 0
    ? 'none'
    : `${String(stranded.n)} stranded in ${String(stranded.states)} — these block deploy:worker`,
)

/*
  CONTROL: this suite goes RED when the queue actually stalls (#236).

  Every other line here reports that nothing is wrong, and a check that has
  only ever been green is indistinguishable from a check that cannot fail.
  This one manufactures the exact condition — a REAL job, backdated well past
  the threshold, still queued — and asserts the same query the live reading
  above uses now says so.

  Three things make the subject real rather than harness traffic, and each was
  a way to write a control that passes for the wrong reason:

  - `requested_by` must not match any `is_fixture` branch. That column is
    GENERATED, so a fixture-shaped name would be filtered out by the very
    predicate under test and the control would report "0 waiting" as a pass.
  - The project must not be a fixture project either: `app.harness_job` derives
    from the project as well as the row (0355), which is the whole point of it.
  - And `created_at` has to actually stick. A backdate reverted by a trigger is
    CLAUDE.md's `projects_touch_updated_at` trap, so the assertion reads the
    age back out of the same query rather than trusting the insert.

  Inside one `begin … rollback`. The CALL is wrapped, not the assertion —
  `verify:disconnect` deleted Slack's credentials for a day by getting that
  exactly the wrong way round.
*/
const proof = (
  (
    await db.execute(`
      begin;
      insert into public.jobs
        (kind, state, requested_by, correlation_id, created_at, idempotency_key, announce)
      values ('office.instruction', 'queued', 'telegram:grant', gen_random_uuid(),
              app.now_utc() - interval '${String(WAITING_TOO_LONG_MIN * 4)} minutes',
              'drains-control-' || gen_random_uuid(), false);
      ${WAITING};
      rollback;`)
  ).rows as Record<string, unknown>[]
)[0]
ok(
  'CONTROL: a real job stuck past the threshold makes this suite go red',
  // `!drained(...)` is the point: the live check above would have FAILED on
  // this reading, which is the verdict rather than the row count.
  Number(proof?.n) > 0 && !drained(proof ?? {}),
  Number(proof?.n) === 0
    ? 'the manufactured job was NOT SEEN by the query — this check cannot fail'
    : `saw ${String(proof?.n)} waiting, oldest ${String(proof?.oldest_min)}m, and the live predicate returns false on it`,
)

/*
  CONTROL: a green heartbeat cannot mask a queue that is not moving (#236).

  This is the incident itself, reproduced rather than described. On 13-14
  September `pg_cron` logged 1,440 consecutive SUCCEEDED heartbeats while
  eleven of Grant's messages sat queued for about fifteen hours, and nothing
  noticed — because a cron row proves a request was MADE, not that the worker
  did anything with it.

  So the property worth asserting is not "the heartbeat fired" (the check
  above already asks that, and asks it the useful way round, as "did it run at
  all recently"). It is that the heartbeat's own health is NOT an input to the
  waiting reading. Manufacture a stuck job with the heartbeat untouched and
  perfectly green: the waiting query must still see it.

  A separate control from the one above even though both inject the same job,
  because they assert different things and folding them together would let one
  carry the other. That one proves the query can see a stuck job at all; this
  one proves a healthy cron does not exempt it.
*/
const masked = (
  (
    await db.execute(`
      begin;
      insert into public.jobs
        (kind, state, requested_by, correlation_id, created_at, idempotency_key, announce)
      values ('office.instruction', 'queued', 'telegram:grant', gen_random_uuid(),
              app.now_utc() - interval '${String(WAITING_TOO_LONG_MIN * 40)} minutes',
              'drains-masked-' || gen_random_uuid(), false);
      ${WAITING};
      rollback;`)
  ).rows as Record<string, unknown>[]
)[0]
ok(
  'CONTROL: a heartbeat that is firing does not exempt a queue that is not moving',
  Number(beat.last_hour) > 0 && !drained(masked ?? {}),
  Number(beat.last_hour) === 0
    ? 'the heartbeat is not firing, so this control could not be run — it proves nothing today'
    : `heartbeat fired ${String(beat.last_hour)}x in the last hour and the query still saw ${String(masked?.oldest_min)}m of waiting`,
)

/*
  CONTROL: the rollback put it back (#236).

  Both controls above write a real job inside `begin ... rollback`, and a
  rollback that did not take would leave a permanent stuck job in Grant's
  queue — injected by the suite written to prove the queue is not stuck, which
  is the worst possible way to fail. Asked AFTER them, and asked of the live
  query rather than by counting rows, so it is the same question the check
  itself asks.
*/
const after = await one(WAITING)
ok(
  'CONTROL: and the injected jobs are gone — the rollback took',
  Number(after.n) === Number(waiting.n) && drained(after),
  `${String(after.n)} waiting now, ${String(waiting.n)} before the controls ran`,
)

/*
  CONTROL: the operational half (#236).

  The gate catching an outage the DASHBOARD cannot show is only half a fix —
  0406 gave `app.office_health()` a `waiting` reading because failed, stalled,
  in_flight and finished are every one of them about a job that STARTED, and a
  job nobody picked up is none of them.

  Asserted as agreement rather than as a number: the screen Grant reads and
  the gate that fails the build must say the same thing about the same queue,
  or a red gate and a calm dashboard will be resolved in favour of the
  dashboard.
*/
const health = (
  (await db.execute(`select app.office_health(app.operator_office()) -> 'waiting' as w`)).rows as {
    w: { jobs: number; oldest_minutes: number; threshold_minutes: number }
  }[]
)[0]
ok(
  'the dashboard has a word for waiting, and it agrees with this gate',
  health?.w !== undefined &&
    Number(health.w.threshold_minutes) === WAITING_TOO_LONG_MIN &&
    Number(health.w.oldest_minutes) <= WAITING_TOO_LONG_MIN,
  health?.w === undefined
    ? 'app.office_health() has no waiting reading'
    : `${String(health.w.jobs)} waiting past ${String(health.w.threshold_minutes)}m, oldest ${String(health.w.oldest_minutes)}m`,
)

console.log(`\n${String(pass)}/${String(pass + fail)} checks passed`)
if (fail > 0) process.exit(1)
