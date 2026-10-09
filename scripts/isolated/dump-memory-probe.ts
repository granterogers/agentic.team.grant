/**
 * One dump of one table in a FRESH process, so its memory is its own (called by backup-restore-typed.ts).
 *
 *   node --max-old-space-size=96 --import tsx scripts/isolated/dump-memory-probe.ts <db> <paged|old> <schema.table>
 *
 * Prints one line, `RESULT rows=<n> peakMb=<n>`, and exits 0. Exits non-zero (the runtime's own out-of-memory abort)
 * when the strategy cannot do the table inside the heap it was given, which IS the measurement. `old` is the dump this
 * repository used before G-3: one `select *`, one `JSON.stringify` of every row, one gzip.
 */
import { pagedDump } from '../../src/backup/paged.ts'
import { isolated } from './guard.ts'

const [database, mode, qualified] = [
  process.argv[2] ?? '',
  process.argv[3] ?? '',
  process.argv[4] ?? '',
]
const [schema, table] = qualified.split('.') as [string, string]
const db = await isolated(database)

let peak = 0
const timer = setInterval(() => {
  const m = process.memoryUsage()
  peak = Math.max(peak, m.heapUsed + m.external + m.arrayBuffers)
}, 5)

let rows = 0
if (mode === 'paged') {
  rows = (await pagedDump(db, schema, table, { pageRows: 1000 })).rows
} else {
  const r = await db.execute(`select * from "${schema}"."${table}"`)
  const json = JSON.stringify({ table: qualified, rows: [...r.rows] })
  const bytes = new Uint8Array(
    await new Response(
      new Blob([json]).stream().pipeThrough(new CompressionStream('gzip')),
    ).arrayBuffer(),
  )
  rows = r.rows.length
  void bytes
}
clearInterval(timer)
console.log(`RESULT rows=${String(rows)} peakMb=${String(Math.round(peak / 1048576))}`)
await db.end()
process.exit(0)
