/**
 * Ask the database a question and print the answer as a table.
 *
 *   npm run q -- "select 1 as n"
 *
 * `scripts/db-query.sh` returns JSON on stdout mixed with other lines, which is
 * fine for a script that knows what it asked and awkward for exploratory work —
 * three consecutive attempts to read a fifteen-row answer failed on the shape of
 * the wrapper rather than on the query. This is the same executor every suite
 * uses, with no wrapper in the way.
 */
import '../src/safety/require-production-checks.ts'
import { ManagementApiExecutor } from '../src/db/executor.ts'

const sql = process.argv.slice(2).join(' ')
if (sql.trim() === '') {
  console.error('usage: npm run q -- "select …"')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  process.env.SUPABASE_ACCESS_TOKEN ?? '',
)
const { rows } = await db.execute(sql)
const list = rows as Record<string, unknown>[]
if (list.length === 0) {
  console.log('(no rows)')
  process.exit(0)
}
const cols = Object.keys(list[0] ?? {})
const width = Object.fromEntries(
  cols.map((c) => [
    c,
    Math.min(60, Math.max(c.length, ...list.map((r) => String(r[c] ?? '').length))),
  ]),
)
const line = (cells: string[]): string =>
  cells
    .map((v, i) => v.slice(0, width[cols[i] ?? ''] ?? 20).padEnd(width[cols[i] ?? ''] ?? 20))
    .join('  ')
console.log(line(cols))
console.log(cols.map((c) => '-'.repeat(width[c] ?? 3)).join('  '))
for (const r of list) console.log(line(cols.map((c) => String(r[c] ?? ''))))
console.log(`\n${String(list.length)} row(s)`)
