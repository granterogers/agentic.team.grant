/**
 * Which migration number is actually free — `npm run migrate:next`.
 *
 * ## The risk this closes
 *
 * Three Claude sessions write migrations to ONE Supabase: this workstream,
 * the Basecamp frontend, and production-reliability. Their filesystems are
 * isolated and their branches never see each other, so the only thing that
 * knows what exists is the database.
 *
 * On 21 September that went wrong exactly as it was always going to.
 * `claude/production-reliability` had applied 0535 to 0538; this branch,
 * which had never seen them, wrote its own 0535. `npm run migrate` refused
 * — correctly, and with a message about deleted history that named the
 * wrong cause, because from inside one branch a concurrent branch's
 * migration is indistinguishable from one somebody removed.
 *
 * The fix is not a lock and not a registry file, both of which need every
 * branch to cooperate and neither of which survives a session that does not
 * know they exist. It is to ASK THE DATABASE, which all three already
 * write to and which cannot go stale.
 *
 * ## What it prints
 *
 *   - the next free number, which is one past the highest ANYWHERE
 *   - anything applied to the shared database that this checkout does not
 *     have, named, so a collision is visible before it is written rather
 *     than at the moment migrate refuses
 *   - anything here that is not applied yet, which is normal and is yours
 *
 * Read-only. It cannot change the database and does not try to reserve
 * anything: a reservation nobody else honours is worse than a clear reading
 * of what is true right now.
 */

import '../src/safety/require-production-checks.ts'
import { readdir } from 'node:fs/promises'
import { ManagementApiExecutor } from '../src/db/executor.ts'

const MIGRATIONS_DIR = 'migrations'

const numberOf = (name: string): number => Number(name.slice(0, 4))

const local = (await readdir(MIGRATIONS_DIR)).filter((n) => /^\d{4}_.*\.sql$/.test(n)).sort()

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  const next = Math.max(0, ...local.map(numberOf)) + 1
  console.log(`\n  Next free number, FROM THIS CHECKOUT ONLY: ${String(next).padStart(4, '0')}`)
  console.log('  No SUPABASE_ACCESS_TOKEN, so the shared database could not be asked.')
  console.log('  Another branch may hold this number. Re-run with a token before committing.\n')
  process.exit(0)
}

const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

const { rows } = await db.execute('select name from app.schema_migrations order by name')
const applied = (rows as { name: string }[]).map((r) => r.name)

const here = new Set(local)
const there = new Set(applied)

const elsewhere = applied.filter((n) => !here.has(n))
const notYetApplied = local.filter((n) => !there.has(n))

const next = Math.max(0, ...[...local, ...applied].map(numberOf)) + 1

console.log('\nMigration numbering, across every branch writing to this database\n')
console.log(
  `  here      ${String(local.length).padStart(4)} file(s), highest ${local.at(-1) ?? '(none)'}`,
)
console.log(
  `  applied   ${String(applied.length).padStart(4)} in the shared database, highest ${applied.at(-1) ?? '(none)'}`,
)
console.log(`\n  NEXT FREE NUMBER: ${String(next).padStart(4, '0')}\n`)

if (elsewhere.length > 0) {
  console.log('APPLIED TO THE SHARED DATABASE AND NOT IN THIS CHECKOUT')
  console.log('  Another branch wrote these. They are not deleted history, whatever')
  console.log('  check:migrations calls them, and migrate will refuse until this')
  console.log('  checkout has them. Copy the files in from the branch that owns them:\n')
  for (const n of elsewhere) console.log(`    ${n}`)
  console.log('\n  git fetch origin <their-branch>')
  console.log('  git show origin/<their-branch>:migrations/<file> > migrations/<file>\n')
}

if (notYetApplied.length > 0) {
  console.log('HERE AND NOT APPLIED YET')
  console.log('  Normal: these are yours, waiting for npm run migrate.\n')
  for (const n of notYetApplied) console.log(`    ${n}`)
  console.log()
}

if (elsewhere.length === 0 && notYetApplied.length === 0)
  console.log('This checkout and the shared database agree exactly.\n')
