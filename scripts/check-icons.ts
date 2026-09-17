/**
 * Every default names a mark the page can actually draw (#221).
 *
 * `public.icon_defaults` gives a new project a mark that fits its name, and
 * `app.icon_key_ok` checks the SHAPE of a key rather than its existence — the
 * right check for a free-text field and no help at all here. 0408 shipped
 * twelve defaults naming real lucide icons that are not in the 451 this office
 * selected, and its own header had already said that would be a defect.
 *
 * The database cannot answer "does this exist": a copy of 451 keys in SQL is a
 * second place for them to rot, which is 0310's whole argument. So the check
 * lives where both halves are visible — the library on disk and the table in
 * Postgres — and that layer is a pre-push script.
 *
 * Reads the library by parsing the generated module's keys rather than
 * importing it, because it is a browser module and this is Node; a key list is
 * all that is wanted and a regex over a generated file is honest about that.
 */
import { readFileSync } from 'node:fs'
import { ManagementApiExecutor } from '../src/db/executor.ts'

const LIBRARY = 'web/studio/vendor/icons-library.js'

const source = readFileSync(LIBRARY, 'utf8')
const keys = new Set([...source.matchAll(/^ {2}"([a-z0-9-]+)":/gm)].map((m) => m[1] ?? ''))

/*
  A found-nothing check needs a control that must come back positive. If the
  generated file's shape ever changes, this parse returns zero keys and every
  default is "missing" — or, with the comparison the other way round, nothing
  is. Assert the library is non-empty first, and name the file, so the failure
  says the parse broke rather than blaming the table.
*/
if (keys.size < 100) {
  console.error(
    `check:icons FAILED — parsed only ${String(keys.size)} keys out of ${LIBRARY}. ` +
      'The generated shape has changed; this check is reading nothing.',
  )
  process.exit(1)
}

const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  process.env.SUPABASE_ACCESS_TOKEN ?? '',
)

const rows = (await db.execute('select term, icon from public.icon_defaults order by term'))
  .rows as { term: string; icon: string }[]

const orphans = rows.filter((r) => !keys.has(r.icon))

// The other direction, reported and not failed: a library icon nothing
// defaults to is entirely normal — 451 marks and 39 defaults — so this is a
// count, not a finding.
console.log(
  `check:icons — ${String(keys.size)} marks in the library, ` +
    `${String(rows.length)} name term(s), ` +
    `${String(new Set(rows.map((r) => r.icon)).size)} distinct default(s)`,
)

if (orphans.length > 0) {
  console.error('\ncheck:icons FAILED — a default names a mark the page cannot draw:')
  for (const o of orphans) console.error(`  ${o.term} → ${o.icon}`)
  console.error(
    '\nEither the key is wrong, or the mark should be in the library: add its ' +
      'domain term to DOMAINS in scripts/build-icons.ts and run it again.',
  )
  process.exit(1)
}

console.log('every default names a mark the page can draw.')
