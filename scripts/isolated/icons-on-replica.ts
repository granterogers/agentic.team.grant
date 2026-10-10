/**
 * check:icons, asked of the isolated replica instead of production (integration, 10 October 2026).
 *
 *   npx tsx scripts/isolated/icons-on-replica.ts <replica-db>
 *
 * The same two questions as scripts/check-icons.ts: does every `icon_defaults` row name a mark the page can draw, and which live
 * connectors have no glyph. The rows are the ones the repository's own migrations seed, so this proves the repository agrees with
 * itself; it does not read production's rows, which check:icons does (and needs production read access for).
 */
import { readFileSync } from 'node:fs'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'bq')
const source = readFileSync('web/studio/vendor/icons-library.js', 'utf8')
const keys = new Set([...source.matchAll(/^ {2}"([a-z0-9-]+)":/gm)].map((m) => m[1] ?? ''))
const rows = (await db.execute('select term, icon from public.icon_defaults order by term'))
  .rows as {
  term: string
  icon: string
}[]
const orphans = rows.filter((r) => !keys.has(r.icon))
console.log(
  `library ${String(keys.size)} marks; ${String(rows.length)} default term(s) on the replica`,
)

const marks = new Set(
  [
    ...readFileSync('web/studio/logos/marks.js', 'utf8').matchAll(/^ {2}([a-z][a-z0-9_]*): \{$/gm),
  ].map((m) => String(m[1])),
)
const live = (
  await db.execute(
    `select connector from public.knowledge_connectors where connector not like 'fixture\\_%' order by connector`,
  )
).rows as { connector: string }[]
const bare = live.filter((c) => !marks.has(c.connector))
console.log(
  `${String(marks.size)} service mark(s); ${String(live.length)} connector(s) seeded; no glyph: ${bare.map((c) => c.connector).join(', ') || 'none'}`,
)

// Controls: a found-nothing check needs a positive. The parse must see marks, and the orphan test must fire on a name that is not one.
const controls =
  keys.size >= 100 &&
  marks.size >= 5 &&
  rows.length > 0 &&
  ['no-such-mark'].every((k) => !keys.has(k))
await db.end()
if (!controls) {
  console.error(
    'FAILED: a control did not hold (the parse read nothing, or the replica has no default rows)',
  )
  process.exit(1)
}
if (orphans.length > 0) {
  for (const o of orphans) console.error(`  ${o.term} -> ${o.icon}`)
  console.error('FAILED: a default names a mark the page cannot draw')
  process.exit(1)
}
console.log('every default names a mark the page can draw (replica)')
process.exit(0)
