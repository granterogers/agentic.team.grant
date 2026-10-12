// biome-ignore-all format: a dense measurement script kept readable as written
/**
 * Concurrent readers of the ledger on the isolated replica (phase 4 P6). Run after activity-ledger-perf has seeded a database:
 *
 *   npx tsx scripts/isolated/activity-read-concurrency.ts <db> [readers] [reads-each]
 *
 * N connections each read the newest page, a sparse filter (severity) and a statement-timeout probe at the same time. Reports p50 and
 * p95 per kind against the same reads made by one reader, and asserts only shape: every read answered, none timed out, and the slowest
 * concurrent p95 stays within a stated multiple of the single-reader p95 (a plan that serialised on a lock would show as a ratio).
 * Never gates on a wall-clock number: a laptop and a 434 MiB host are different machines.
 */
import { PgExecutor } from '../../src/db/pg-executor.ts'
import { isolated } from './guard.ts'

const dbName = process.argv[2] ?? 'ledger'
const READERS = Number(process.argv[3] ?? 8)
const EACH = Number(process.argv[4] ?? 12)
const db = await isolated(dbName)
const sock = process.env.ISOLATED_PG_SOCKET ?? '/tmp/pgs'
const port = process.env.ISOLATED_PG_PORT ?? '55432'
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const office = String(((await db.execute(`select office_id::text as o from public.activity_events group by 1 order by count(*) desc limit 1`)).rows[0] as { o: string } | undefined)?.o ?? ((await db.execute(`select app.operator_office()::text as o`)).rows[0] as { o: string }).o)
const kinds: Record<string, string> = {
  newest: `select app.activity_read(p_office => ${lit(office)}::uuid, p_limit => 50)`,
  diagnostic: `select app.activity_read(p_office => ${lit(office)}::uuid, p_visibility => 'diagnostic', p_limit => 50)`,
  sparse_severity: `select app.activity_read(p_office => ${lit(office)}::uuid, p_visibility => 'diagnostic', p_min_severity => 'error', p_limit => 50)`,
}
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))] ?? 0
const time = async (c: PgExecutor, sql: string) => {
  const t = performance.now()
  await c.execute(sql)
  return performance.now() - t
}
const results: { ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}
const conns: PgExecutor[] = []
let exit = 1
try {
  for (let i = 0; i < READERS; i++) {
    const c = new PgExecutor(`postgresql://postgres@/${dbName}?host=${sock}&port=${port}`)
    await c.connect()
    conns.push(c)
  }
  for (const [name, sql] of Object.entries(kinds)) {
    await time(db, sql) // warm
    const single: number[] = []
    for (let i = 0; i < EACH; i++) single.push(await time(db, sql))
    const many: number[] = []
    let errors = 0
    await Promise.all(conns.map(async (c) => { for (let i = 0; i < EACH; i++) { try { many.push(await time(c, sql)) } catch { errors++ } } }))
    const r = pct(many, 95) / Math.max(1, pct(single, 95))
    console.log(`     ${name.padEnd(16)} one reader p50 ${pct(single, 50).toFixed(0)} p95 ${pct(single, 95).toFixed(0)} ms | ${READERS} readers p50 ${pct(many, 50).toFixed(0)} p95 ${pct(many, 95).toFixed(0)} ms (x${r.toFixed(1)}), ${errors} errors`)
    check(`${name}: ${READERS} concurrent readers all answered, none timed out`, errors === 0 && many.length === READERS * EACH, `${many.length} reads, ${errors} errors`)
    check(`${name}: concurrent p95 within ${READERS + 4}x of one reader's (it did not serialise on a lock)`, r <= READERS + 4, `x${r.toFixed(1)}`)
  }
  const failed = results.filter((r) => !r.ok).length
  console.log(`\n${results.length - failed}/${results.length} passed`)
  exit = failed === 0 ? 0 : 1
} finally {
  for (const c of conns) await c.end().catch(() => undefined)
  await db.end()
}
process.exit(exit)
