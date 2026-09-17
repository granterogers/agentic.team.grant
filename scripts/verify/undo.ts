/**
 * Demonstrate Undo against the live database.
 *
 *   npm run verify:undo
 *
 * The Phase 7 criterion is one sentence: *"Undo is idempotent under concurrent
 * duplicate delivery."*
 *
 * So the central check fires genuinely concurrent requests - `Promise.all` over
 * separate HTTP calls, which really do land in separate database sessions -
 * rather than calling the function twice in a row. A sequential double-call
 * proves nothing about a race: the second call sees a committed first call and
 * takes the easy branch. Every real duplicate this will meet (a Slack webhook
 * retry, a double tap, a job re-attempted after a crash) arrives while the
 * first is still in flight.
 */

import type { SqlExecutor } from '../../src/db/executor.ts'
import { ManagementApiExecutor, SqlExecutionError } from '../../src/db/executor.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(2)
}
const db: SqlExecutor = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

interface Check {
  what: string
  outcome: string
  passed: boolean
}
const checks: Check[] = []
const record = (what: string, outcome: string, passed: boolean): void => {
  checks.push({ what, outcome, passed })
}
const one = async (sql: string): Promise<Record<string, unknown> | undefined> =>
  (await db.execute(sql)).rows[0]
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const mustRefuse = async (sql: string): Promise<string> => {
  try {
    await db.execute(sql)
    return '(no error - it was ACCEPTED)'
  } catch (error) {
    return error instanceof SqlExecutionError || error instanceof Error
      ? error.message.replace(/\s+/g, ' ').slice(0, 250)
      : String(error)
  }
}

const mkAction = async (opts: {
  status?: string
  deadline?: string
  kind?: string
}): Promise<string> => {
  const status = opts.status ?? 'available'
  const deadline =
    status === 'not_undoable' ? 'null' : (opts.deadline ?? "app.now_utc() + interval '1 hour'")
  const row = await one(`
    insert into public.undoable_actions
      (correlation_id, kind, description, reversal, status, undo_deadline)
    values (gen_random_uuid(), ${lit(opts.kind ?? 'slack.post')},
            'A fixture action created to exercise the undo path.',
            ${status === 'not_undoable' ? `'{}'::jsonb` : `'{"channel":"C123","ts":"1.2"}'::jsonb`},
            ${lit(status)}::public.undo_status, ${deadline})
    returning action_id::text as id
  `)
  return String(row?.id)
}

// ===========================================================================
// The central property
// ===========================================================================

const contested = await mkAction({})
const CONCURRENCY = 8

// Separate HTTP requests, in flight together, so these really are separate
// database sessions racing for the same row.
const results = await Promise.all(
  Array.from({ length: CONCURRENCY }, (_, i) =>
    db
      .execute(
        `select app.request_undo(${lit(contested)}::uuid, 'verify:undo', ${lit(`racer-${String(i)}`)})::text as s`,
      )
      .then((r) => String(r.rows[0]?.s))
      .catch((e: unknown) => `ERROR:${(e as Error).message.slice(0, 60)}`),
  ),
)

record(
  `${String(CONCURRENCY)} concurrent undo requests all report success, none errors`,
  `outcomes: ${[...new Set(results)].join(', ')}`,
  results.every((r) => r === 'undone'),
)

const claims = await one(
  `select count(*)::int as n from public.undo_requests where action_id = ${lit(contested)}::uuid`,
)
record(
  'exactly ONE claim row exists, so the reversal was performed exactly once',
  `${String(claims?.n)} claim row(s) for ${String(CONCURRENCY)} requests`,
  Number(claims?.n) === 1,
)

const action = await one(`
  select status::text as s, undone_at from public.undoable_actions
  where action_id = ${lit(contested)}::uuid
`)
record(
  'the action is undone exactly once, with a single timestamp',
  `status=${String(action?.s)} undone_at=${action?.undone_at === null ? 'null' : 'set'}`,
  action?.s === 'undone' && action?.undone_at !== null,
)

// A later request, long after the race, must still not error.
const late = await one(
  `select app.request_undo(${lit(contested)}::uuid, 'verify:undo', 'late-retry')::text as s`,
)
record(
  'a retry arriving minutes later is told the truth, not given an error',
  `outcome=${String(late?.s)}`,
  late?.s === 'undone',
)

// ===========================================================================
// The other outcomes
// ===========================================================================

const expiredAction = await mkAction({ deadline: "app.now_utc() + interval '1 second'" })
await db.execute(`
  update public.undoable_actions set undo_deadline = app.now_utc() - interval '1 minute'
  where action_id = ${lit(expiredAction)}::uuid
`)
const expiredResult = await one(
  `select app.request_undo(${lit(expiredAction)}::uuid, 'verify:undo')::text as s`,
)
record(
  'an undo requested after its window reports expired, and does not reverse',
  `outcome=${String(expiredResult?.s)}`,
  expiredResult?.s === 'expired',
)

const impossible = await mkAction({ status: 'not_undoable', kind: 'gmail.send' })
const impossibleResult = await one(
  `select app.request_undo(${lit(impossible)}::uuid, 'verify:undo')::text as s`,
)
record(
  'an action that cannot be reversed says so, rather than pretending',
  `outcome=${String(impossibleResult?.s)}`,
  impossibleResult?.s === 'not_undoable',
)

const missing = await mustRefuse(
  `select app.request_undo('00000000-0000-4000-8000-000000000000'::uuid, 'verify:undo')`,
)
record(
  'an undo for an action that does not exist is an error, not a silent success',
  missing.slice(0, 110),
  missing.includes('no undoable action'),
)

// ===========================================================================
// The offer surface
// ===========================================================================

const offerable = await mkAction({})
const offers = await one(`
  select count(*)::int as n from public.undo_offers where action_id = ${lit(offerable)}::uuid
`)
record(
  'an available action appears in the offer list with time remaining',
  `${String(offers?.n)} offer(s)`,
  Number(offers?.n) === 1,
)

const undoneNotOffered = await one(`
  select count(*)::int as n from public.undo_offers where action_id = ${lit(contested)}::uuid
`)
record(
  'an undone action is no longer offered',
  `${String(undoneNotOffered?.n)} offer(s)`,
  Number(undoneNotOffered?.n) === 0,
)

// The view filters on the deadline as well as the status, so a lapsed offer is
// never shown even in the window before the sweep runs.
const lapsed = await mkAction({})
await db.execute(`
  update public.undoable_actions set undo_deadline = app.now_utc() - interval '1 minute'
  where action_id = ${lit(lapsed)}::uuid
`)
const lapsedOffered = await one(`
  select count(*)::int as n from public.undo_offers where action_id = ${lit(lapsed)}::uuid
`)
const stillAvailable = await one(`
  select status::text as s from public.undoable_actions where action_id = ${lit(lapsed)}::uuid
`)
record(
  'a lapsed offer is hidden immediately, before the sweep has run',
  `status still ${String(stillAvailable?.s)}, offers=${String(lapsedOffered?.n)}`,
  stillAvailable?.s === 'available' && Number(lapsedOffered?.n) === 0,
)

const swept = await one(`select app.expire_undo_offers() as n`)
record(
  'the sweep then marks lapsed offers expired',
  `swept ${String(swept?.n)}`,
  Number(swept?.n) >= 1,
)

// ===========================================================================
// What the app role may not do
// ===========================================================================

const selfMark = await mustRefuse(`
  set local role ai_team_app;
  update public.undoable_actions set status = 'undone', undone_at = app.now_utc()
  where action_id = ${lit(offerable)}::uuid
`)
record(
  'the app role cannot mark something undone that was never reversed',
  selfMark.slice(0, 110),
  selfMark.includes('permission denied'),
)

const rewriteClaim = await mustRefuse(`
  update public.undo_requests set outcome = 'expired' where action_id = ${lit(contested)}::uuid
`)
record(
  'the claim record is append-only, with no exception for its own function',
  rewriteClaim.slice(0, 110),
  rewriteClaim.includes('append-only'),
)

// 0029 shipped a `request_undo` that DELETED its own claim row and re-inserted
// it. That is the exception 0030 removed, and this is the check that it stays
// removed: one row, inserted once, still bearing the original requester.
const firstRequester = await one(`
  select requested_by, source from public.undo_requests where action_id = ${lit(contested)}::uuid
`)
record(
  'the surviving claim is the FIRST one, not a replacement written afterwards',
  `requested_by=${String(firstRequester?.requested_by)} source=${String(firstRequester?.source)}`,
  String(firstRequester?.source ?? '').startsWith('racer-'),
)

// ===========================================================================
// Report, then clean up
// ===========================================================================
/*
  Teardown, keyed on the ACTIONS rather than on who asked.

  It used to delete `undo_requests where requested_by = 'verify:undo'` and then
  the actions, and it failed on the foreign key every single run: a fixture
  action can carry a claim this suite did not write - `app.request_undo` is
  called with 'grant' by `hq_undo` (0263) and with whatever a racer passes - so
  the first delete left claims behind and the second hit
  `undo_requests_action_id_fkey`.

  Deleting the claims OF THE FIXTURE ACTIONS is exact and cannot miss one.

  And the result is asserted, because a teardown that matches nothing looks
  exactly like a teardown that worked, and this one had been failing in plain
  sight under a line of prose nobody had cause to read.
*/
let sweptClean = false
let sweptSaid = ''
try {
  await db.execute(`
    delete from public.undo_requests
     where action_id in (select action_id from public.undoable_actions
                          where description like 'A fixture action%')
  `)
  await db.execute(`
    delete from public.undoable_actions where description like 'A fixture action%'
  `)
  const left = (
    await db.execute(`
    select count(*)::int as n from public.undoable_actions
     where description like 'A fixture action%'
  `)
  ).rows[0] as { n: number }
  sweptClean = Number(left.n) === 0
  sweptSaid = `${String(left.n)} fixture action(s) left behind`
} catch (error) {
  sweptSaid = (error as Error).message.replace(/\s+/g, ' ').slice(0, 140)
}
record('the suite leaves nothing behind', sweptSaid, sweptClean)

console.log('| check | outcome | |')
console.log('|---|---|---|')
for (const c of checks) {
  console.log(`| ${c.what} | ${c.outcome} | ${c.passed ? '✅' : '❌'} |`)
}
const failed = checks.filter((c) => !c.passed)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)

if (failed.length > 0) process.exit(1)
