// biome-ignore-all format: a dense proof kept readable as written
/**
 * The staged index build for the activity read model (src/activity/indexes.ts), proved on the isolated replica.
 *
 *   npx tsx scripts/isolated/activity-indexes.ts <replica-db> [rows]
 *
 * The replica must have 1060 and 1061 applied and NOT the indexes (the migration creates none). It proves:
 *   - the migration alone leaves every expected index missing and the health reading says so;
 *   - the build creates all of them, valid, WHILE a second connection keeps inserting into a table being indexed, with no
 *     write refused and no write stalled for the length of the build (the property CONCURRENTLY exists for);
 *   - a second run changes nothing; an invalid leftover (what a failed concurrent build leaves) is dropped and rebuilt;
 *   - the SQL list the health reading carries is the TypeScript list the build uses.
 */
import { ACTIVITY_INDEX_NAMES, ensureActivityIndexes, inspectActivityIndexes } from '../../src/activity/indexes.ts'
import { isolated } from './guard.ts'

const dbName = process.argv[2] ?? 'ledger'
const ROWS = Number(process.argv[3] ?? 1500000)
const db = await isolated(dbName)
const writer = await isolated(dbName)
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const results: { ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}
let exit = 1
try {
  const office = String((await one(`select office_id from public.offices where kind = 'person' order by created_at limit 1`)).office_id)
  const gaps0 = (await one('select app.activity_index_gaps() as g')).g as string[]
  check('the migration alone creates none of the access paths, and the gap list names every one', gaps0.length === ACTIVITY_INDEX_NAMES.length, `${gaps0.length} missing of ${ACTIVITY_INDEX_NAMES.length}`)
  const sameList = [...gaps0].sort().join() === [...ACTIVITY_INDEX_NAMES].sort().join()
  check('the SQL list of expected indexes is the TypeScript list', sameList, sameList ? 'identical' : `sql ${gaps0.join()} / ts ${ACTIVITY_INDEX_NAMES.join()}`)

  await db.execute(`set session_replication_role = replica`)
  await db.execute(`insert into public.events (correlation_id, actor_kind, actor, trigger, action_type, reversible, office_id, occurred_at)
    select gen_random_uuid(), 'system', 'lab', 'lab', 'lab.row', false, '${office}', now() - (g || ' seconds')::interval from generate_series(1, ${ROWS}) g`)
  await db.execute(`set session_replication_role = origin`)
  await db.execute('analyze public.events')

  // A live writer on the same table for the whole build.
  let stop = false
  let written = 0
  let refused = 0
  let slowest = 0
  const loop = (async () => {
    while (!stop) {
      const t = performance.now()
      try {
        await writer.execute(`insert into public.events (correlation_id, actor_kind, actor, trigger, action_type, reversible, office_id)
          values (gen_random_uuid(), 'system', 'live', 'live', 'lab.live', false, '${office}')`)
        written++
      } catch {
        refused++
      }
      slowest = Math.max(slowest, performance.now() - t)
      await new Promise((r) => setTimeout(r, 5))
    }
  })()
  const t0 = performance.now()
  const built = await ensureActivityIndexes(db)
  const buildMs = performance.now() - t0
  stop = true
  await loop
  const bad = built.filter((b) => b.outcome.startsWith('failed'))
  check('every index builds and is valid', bad.length === 0 && (await inspectActivityIndexes(db)).every((s) => s.present && s.valid), bad.map((b) => `${b.name} ${b.outcome}`).join('; ') || `${built.length} built in ${(buildMs / 1000).toFixed(1)}s`)
  check('a live writer on the table being indexed was never refused', refused === 0 && written > 0, `${written} inserts during the build, ${refused} refused`)
  check('no write stalled for anything like the build time', slowest < buildMs / 3, `slowest insert ${slowest.toFixed(0)} ms, build ${buildMs.toFixed(0)} ms`)

  // The control: the same measurement over a PLAIN build on the same table must see the stall, or the check above cannot fail.
  await db.execute('drop index public.events_office_time_idx')
  let ctlStop = false
  let ctlSlowest = 0
  const ctlLoop = (async () => {
    while (!ctlStop) {
      const t = performance.now()
      await writer.execute(`insert into public.events (correlation_id, actor_kind, actor, trigger, action_type, reversible, office_id)
        values (gen_random_uuid(), 'system', 'live', 'live', 'lab.live', false, '${office}')`)
      ctlSlowest = Math.max(ctlSlowest, performance.now() - t)
      await new Promise((r) => setTimeout(r, 5))
    }
  })()
  await new Promise((r) => setTimeout(r, 100))
  const c0 = performance.now()
  await db.execute('create index events_office_time_idx on public.events (office_id, occurred_at desc)')
  const plainMs = performance.now() - c0
  ctlStop = true
  await ctlLoop
  check('control: a plain build of the same index stalls the same writer, so the check above can fail', ctlSlowest > plainMs / 3, `slowest insert ${ctlSlowest.toFixed(0)} ms, plain build ${plainMs.toFixed(0)} ms`)
  check('the health reading agrees: nothing missing', ((await one('select app.activity_index_gaps() as g')).g as string[]).length === 0, 'gap list empty')

  const again = await ensureActivityIndexes(db)
  check('a second run changes nothing', again.every((a) => a.outcome === 'already-built'), again.map((a) => a.outcome).filter((o) => o !== 'already-built').join() || 'all already-built')

  await db.execute(`update pg_index set indisvalid = false where indexrelid = 'public.events_office_time_idx'::regclass`)
  const gapsInvalid = (await one('select app.activity_index_gaps() as g')).g as string[]
  check('an invalid leftover is reported as a gap', gapsInvalid.join() === 'events_office_time_idx', gapsInvalid.join() || 'none')
  const healed = await ensureActivityIndexes(db)
  const h = healed.find((x) => x.name === 'events_office_time_idx')
  check('an invalid leftover is dropped and rebuilt, and nothing else is touched', h?.outcome === 'rebuilt-after-invalid' && healed.filter((x) => x.outcome === 'already-built').length === ACTIVITY_INDEX_NAMES.length - 1, `${h?.outcome}`)
  check('the rebuilt index is valid', ((await one('select app.activity_index_gaps() as g')).g as string[]).length === 0, 'gap list empty')

  const failed = results.filter((r) => !r.ok).length
  console.log(`\n${results.length - failed}/${results.length} passed`)
  exit = failed === 0 ? 0 : 1
} finally {
  await writer.end()
  await db.end()
}
process.exit(exit)
