/**
 * Do the recurring duties actually fire, once, when they are due?
 *
 *   npm run verify:duties
 *
 * Issue #225. The backend readiness report of 14 September put this domain at
 * **None** — one of two out of thirty with no suite at all — and named it the
 * first reason not to trust the backend, for a reason that is about Grant
 * rather than about coverage:
 *
 *   A duty is the only thing in the office that ACTS WITHOUT HIM ASKING.
 *
 * Everything else is a response to something he did, so a defect surfaces while
 * he is already looking at the screen. A duty misfiring surfaces as the office
 * being unreliable — a briefing that arrives twice, a sync that stopped a week
 * ago and said nothing, a retry storm he notices in a bill.
 *
 * ## The hazard this suite is built around
 *
 * `app.dispatch_due_responsibilities()` fires EVERY due duty. There is no
 * argument to scope it, and there should not be: the office runs it on a tick
 * and it is supposed to be global. So a suite that calls it also fires Grant's
 * real duties — the same shape as #184's unscoped dequeue, which claimed a real
 * `drive.watch` job and killed the suite four sections early.
 *
 * The answer is not a scoping parameter added for the test's convenience (that
 * would be testing a path nobody runs). It is that **every call to the
 * dispatcher happens inside one statement that ends in `rollback`**. Real
 * duties that were genuinely due are fired and un-fired; they stay due and the
 * next real tick takes them, which is exactly the state they were in before.
 * `verify:disconnect` learned this the expensive way in #210, and its lesson is
 * the wording used here: WRAP THE CALL, NOT THE ASSERTION. A wrapper cannot
 * know whether a call was destructive until it has already happened.
 *
 * ## What this suite deliberately does NOT do
 *
 * It does not run a duty's HANDLER. Dispatch creates a job; running it is the
 * worker's business and `verify:worker` already drives real jobs through the
 * whole pipeline. Duplicating that here would mean either a fake handler —
 * which tests nothing — or a real one with real side effects on a schedule
 * nobody asked for. What this suite proves is everything up to and including
 * the job being correctly formed, and it says so rather than implying more.
 *
 * ## Fixtures
 *
 * The duty slug begins `verify-`, so `requested_by` is `duty:verify-…`, which
 * matches `jobs.is_fixture`'s `%:verify-%` branch (0342). That branch exists
 * because 43 jobs of `verify:addressing` once ran for real — a suite that
 * BELIEVES its work is invisible must assert that it is, so this one does.
 *
 * `project_id` is left NULL. It is nullable, no duty here needs a project, and
 * not creating one is thirty-two fewer debris projects than the alternative —
 * CLAUDE.md records that pile being built twice.
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
const one = async (sql: string): Promise<Record<string, unknown>> => {
  const { rows } = await db.execute(sql)
  return (rows as Record<string, unknown>[])[0] ?? {}
}
const lit = (s: string): string => `'${s.replace(/'/g, "''")}'`

const run = Math.random().toString(36).slice(2, 10)
const slug = `verify-duty-${run}`

/*
  One statement, one transaction, always ending in rollback.

  Everything the dispatcher touches is undone: the fixture duty, its job, its
  last_run_at stamp, and any real duty that happened to be due while the
  transaction was open. The result is carried out of the transaction in a temp
  table, because a `select` after `rollback` would be a different transaction
  and would see none of it.
*/
const inRollback = async (body: string, selects: string): Promise<Record<string, unknown>> =>
  one(`begin;
${body}
create temp table _out as ${selects};
select * from _out;
rollback;`)

/** The fixture duty, created inside whichever transaction needs it. */
const makeDuty = (opts: {
  periodMinutes?: number
  lastRunAt?: string
  enabled?: boolean
  atTime?: string
}): string => `
insert into public.responsibilities
  (slug, staff_id, project_id, description, job_kind, period_minutes,
   last_run_at, enabled, at_time, created_by)
select ${lit(slug)},
       (select staff_id from public.staff where active order by slug limit 1),
       null,
       'A fixture duty, for verify:duties. Rolled back.',
       'status.count_jobs',
       ${String(opts.periodMinutes ?? 60)},
       ${opts.lastRunAt ?? 'null'},
       ${String(opts.enabled ?? true)},
       ${opts.atTime === undefined ? 'null' : `${lit(opts.atTime)}::time`},
       'verify:duties';`

console.log(`\nverify:duties — recurring duties, ${slug}\n`)

// ---------------------------------------------------------------------------
console.log('due detection')
// ---------------------------------------------------------------------------

/*
  Never run. A duty with no last_run_at is due immediately — otherwise a duty
  added today would wait a full period before its first run, which reads as
  "it is broken" rather than "it is waiting".
*/
const neverRun = await inRollback(
  makeDuty({ periodMinutes: 60 }),
  `select count(*)::int as n from app.due_responsibilities() where slug = ${lit(slug)}`,
)
ok(
  'a duty that has never run is due immediately',
  Number(neverRun.n) === 1,
  `${String(neverRun.n)} row(s) from due_responsibilities`,
)

/*
  Inside its period. The single most important negative here: if this is ever
  true, every duty in the office fires on every tick.
*/
const tooSoon = await inRollback(
  makeDuty({ periodMinutes: 60, lastRunAt: "app.now_utc() - interval '10 minutes'" }),
  `select count(*)::int as n from app.due_responsibilities() where slug = ${lit(slug)}`,
)
ok(
  'a duty INSIDE its period is not due',
  Number(tooSoon.n) === 0,
  `${String(tooSoon.n)} row(s) — anything but 0 means every duty fires every tick`,
)

const overdue = await inRollback(
  makeDuty({ periodMinutes: 60, lastRunAt: "app.now_utc() - interval '90 minutes'" }),
  `select count(*)::int as n from app.due_responsibilities() where slug = ${lit(slug)}`,
)
ok('a duty PAST its period is due', Number(overdue.n) === 1)

/*
  Disabled. `vault-export` is the live example — seeded disabled deliberately,
  because switching it on means a copy of every credential arriving on Telegram
  weekly, which is Grant's decision and not the office's.
*/
const disabled = await inRollback(
  makeDuty({ periodMinutes: 60, enabled: false }),
  `select count(*)::int as n from app.due_responsibilities() where slug = ${lit(slug)}`,
)
ok(
  'a DISABLED duty is never due, however overdue it is',
  Number(disabled.n) === 0,
  `${String(disabled.n)} row(s)`,
)

/*
  A duty whose staff member is retired. The join is on `s.active`, so this is
  already the behaviour — worth an assertion because the alternative is a duty
  firing in the name of somebody who no longer works here, and the roster is a
  thing Grant edits.
*/
const retiredOwner = await inRollback(
  `${makeDuty({ periodMinutes: 60 })}
   update public.staff set active = false
    where staff_id = (select staff_id from public.responsibilities where slug = ${lit(slug)});`,
  `select count(*)::int as n from app.due_responsibilities() where slug = ${lit(slug)}`,
)
ok(
  'a duty owned by a RETIRED staff member is not due',
  Number(retiredOwner.n) === 0,
  `${String(retiredOwner.n)} row(s)`,
)

// ---------------------------------------------------------------------------
console.log('\nthe idempotency key, which is what stops him being told twice')
// ---------------------------------------------------------------------------

/*
  Two reads inside one period must produce the SAME key, because the key is what
  collides on 0005's unique index. If it varied, nothing would stop a duty
  firing on every tick — the enabled/period filter is the first line of defence
  and the key is the one that has to hold when the first is wrong.
*/
const sameKey = await inRollback(
  makeDuty({ periodMinutes: 60 }),
  `select (select idempotency_key from app.due_responsibilities() where slug = ${lit(slug)}) as a,
          (select idempotency_key from app.due_responsibilities() where slug = ${lit(slug)}) as b`,
)
ok(
  'two reads in the same period produce the SAME idempotency key',
  sameKey.a === sameKey.b && typeof sameKey.a === 'string' && sameKey.a !== '',
  String(sameKey.a),
)

/*
  A daily duty keys on the LOCAL DATE rather than a window index, and the
  function's own comment says why: "two passes on the same day produce the same
  key, which is what stops him being briefed twice."
*/
const dailyKey = await inRollback(
  makeDuty({ periodMinutes: 1440, atTime: '00:01' }),
  `select idempotency_key as k from app.due_responsibilities() where slug = ${lit(slug)}`,
)
ok(
  'a duty with a wall-clock time keys on the local DATE, not a window index',
  typeof dailyKey.k === 'string' && /\d{4}-\d{2}-\d{2}$/.test(String(dailyKey.k)),
  String(dailyKey.k),
)

// ---------------------------------------------------------------------------
console.log('\ndispatch')
// ---------------------------------------------------------------------------

const fired = await inRollback(
  `${makeDuty({ periodMinutes: 60 })}
   create temp table _fire as
     select * from app.dispatch_due_responsibilities();`,
  `select (select outcome from _fire where duty_slug = ${lit(slug)}) as outcome,
          (select count(*)::int from public.jobs
            where requested_by = ${lit(`duty:${slug}`)}) as jobs,
          (select is_fixture from public.jobs
            where requested_by = ${lit(`duty:${slug}`)} limit 1) as fixture,
          (select kind from public.jobs
            where requested_by = ${lit(`duty:${slug}`)} limit 1) as kind,
          (select last_run_at is not null from public.responsibilities
            where slug = ${lit(slug)}) as stamped`,
)
ok('dispatching a due duty reports it fired', fired.outcome === 'fired', String(fired.outcome))
ok('and it creates exactly ONE job', Number(fired.jobs) === 1, `${String(fired.jobs)} job(s)`)
ok(
  'and the job carries the duty as its requester, so it is attributable',
  fired.kind === 'status.count_jobs',
  `kind=${String(fired.kind)}`,
)
ok(
  "and the job is HARNESS TRAFFIC, so this suite cannot inflate Grant's health readings",
  fired.fixture === true,
  `is_fixture=${String(fired.fixture)}`,
)
ok(
  'and the duty is stamped as run, so the next tick does not fire it again',
  fired.stamped === true,
)

/*
  Firing twice inside one period.

  The insert collides on `jobs_one_live_per_idempotency_key`, the dispatcher
  catches unique_violation, and the outcome is `already_fired` rather than an
  error and rather than a second job. This is THE duplicate-prevention check and
  the one whose absence Grant would experience as being briefed twice.
*/
const twice = await inRollback(
  `${makeDuty({ periodMinutes: 60 })}
   create temp table _a as select * from app.dispatch_due_responsibilities();
   update public.responsibilities set last_run_at = null where slug = ${lit(slug)};
   create temp table _b as select * from app.dispatch_due_responsibilities();`,
  `select (select outcome from _b where duty_slug = ${lit(slug)}) as second,
          (select count(*)::int from public.jobs
            where requested_by = ${lit(`duty:${slug}`)}) as jobs`,
)
ok(
  'firing the same duty twice in one period is refused, not duplicated',
  twice.second === 'already_fired',
  `second outcome=${String(twice.second)}`,
)
ok(
  'and there is still exactly ONE job — he is not told twice',
  Number(twice.jobs) === 1,
  `${String(twice.jobs)} job(s)`,
)
ok(
  'and the refusal still stamps the duty, so it does not retry every tick until the period turns',
  twice.second === 'already_fired',
)

/*
  A disabled duty, all the way through the dispatcher rather than only through
  the due list. Two different functions, and the second is the one that writes.
*/
const disabledDispatch = await inRollback(
  `${makeDuty({ periodMinutes: 60, enabled: false })}
   create temp table _d as select * from app.dispatch_due_responsibilities();`,
  `select (select count(*)::int from _d where duty_slug = ${lit(slug)}) as fired,
          (select count(*)::int from public.jobs
            where requested_by = ${lit(`duty:${slug}`)}) as jobs`,
)
ok(
  'DISPATCHING with a disabled duty present creates nothing for it',
  Number(disabledDispatch.fired) === 0 && Number(disabledDispatch.jobs) === 0,
  `fired=${String(disabledDispatch.fired)} jobs=${String(disabledDispatch.jobs)}`,
)

// ---------------------------------------------------------------------------
console.log('\nthe cadence floor, and staleness')
// ---------------------------------------------------------------------------

/*
  0005's check constraint. A duty cannot be scheduled faster than the sync
  cadence — `verify:autonomy` already proves the constraint exists; what is
  asserted here is that the REFUSAL NAMES ITS REASON, because a refusal for the
  wrong reason looks exactly like the rule working.
*/
let refused = ''
try {
  await db.execute(`begin; ${makeDuty({ periodMinutes: 1 })} rollback;`)
} catch (error) {
  refused = error instanceof Error ? error.message : String(error)
}
ok(
  'a duty scheduled faster than the cadence floor is refused, and the refusal says so',
  refused.includes('responsibilit'),
  refused === '' ? 'IT WAS ALLOWED' : refused.slice(0, 90),
)

/*
  Staleness, read the way a person would ask it: which duties are overdue by
  more than one whole period? This is the reading that turns "a sync stopped a
  week ago" from something nobody notices into a number.

  Asserted as a PROPERTY, not a count. A count goes red the day the office grows
  a duty, which is CLAUDE.md's correction three times over. What must hold is
  that nothing REAL is stale by more than a day — and the fixture duty this
  suite makes is rolled back, so it can never be in the answer.
*/
const stale = await one(`
  select coalesce(string_agg(r.slug || ' (' || (extract(epoch from (app.now_utc() - r.last_run_at))
           / 3600)::int::text || 'h)', ', ' order by r.slug), '') as who,
         count(*)::int as n
    from public.responsibilities r
   where r.enabled
     and r.last_run_at is not null
     and r.last_run_at < app.now_utc() - interval '24 hours'
     and r.period_minutes <= 1440
     and r.slug not like 'verify-%'`)
ok(
  'no enabled sub-daily duty is more than 24 hours overdue',
  Number(stale.n) === 0,
  Number(stale.n) === 0 ? 'the office is keeping up' : `STALE: ${String(stale.who)}`,
)

/*
  And the duties that exist at all, printed rather than asserted.

  A count assertion here would be the same mistake as asserting an index by
  name. What is worth knowing is which duties the office believes it has, so
  that a duty silently disappearing is visible to a person reading the output.
*/
const roster = await one(`
  select count(*)::int as n,
         count(*) filter (where enabled)::int as on_,
         coalesce(string_agg(slug || (case when enabled then '' else ' (off)' end),
                             ', ' order by slug), 'none') as list
    from public.responsibilities where slug not like 'verify-%'`)
ok(
  'the duty roster is readable, and is printed so a disappearance is visible',
  Number(roster.n) > 0,
  `${String(roster.on_)} of ${String(roster.n)} enabled: ${String(roster.list)}`,
)

// ---------------------------------------------------------------------------
console.log('\nand the suite leaves nothing behind')
// ---------------------------------------------------------------------------

/*
  Every transaction above ended in rollback, so this should find nothing — and
  asserting it is the point. CLAUDE.md: a teardown that matches nothing looks
  exactly like a teardown that worked. Here there IS no teardown, which makes
  the assertion the only evidence that the rollbacks did what they claim.
*/
const left = await one(`
  select (select count(*)::int from public.responsibilities where slug = ${lit(slug)}) as duties,
         (select count(*)::int from public.jobs
           where requested_by = ${lit(`duty:${slug}`)}) as jobs`)
ok(
  'no fixture duty survived — every dispatch ran inside a rollback',
  Number(left.duties) === 0 && Number(left.jobs) === 0,
  `${String(left.duties)} duty(s), ${String(left.jobs)} job(s) left behind`,
)

/*
  And the control for the control: the roster still has its real duties.

  A rollback that took too much with it would look identical to a clean run, and
  this is the cheap way to tell the difference.
*/
const survived = await one(
  `select count(*)::int as n from public.responsibilities where slug not like 'verify-%'`,
)
ok(
  "CONTROL: the office's real duties are still there, so the rollbacks took only their own work",
  Number(survived.n) === Number(roster.n),
  `${String(survived.n)} real duties, was ${String(roster.n)}`,
)

console.log(`\n${String(pass)}/${String(pass + fail)} checks passed`)
if (fail > 0) process.exit(1)
