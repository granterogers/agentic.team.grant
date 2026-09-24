/*
 * PATH B — production's ledger against this candidate's files.
 *
 * Two questions and nothing else:
 *   UNEXPLAINED            a row in production naming a file this candidate
 *                          does not have, or a file this candidate has that
 *                          production applied under a different name
 *   CHECKSUM DISAGREEMENTS a file whose content differs from what production
 *                          recorded when it ran it
 *
 * Read-only. Nothing is written to production, nothing is replayed against it,
 * and no ledger row is touched. Production is evidence.
 */
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ManagementApiExecutor } from '../src/db/executor.ts'

const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  process.env.SUPABASE_ACCESS_TOKEN ?? '',
)
const { rows } = await db.execute('select name, checksum from app.schema_migrations order by name')
const ledger = rows as { name: string; checksum: string }[]

const dir = 'migrations'
const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()
const sha = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex')

const onDisk = new Map<string, string>()
for (const f of files) onDisk.set(f, sha(await readFile(join(dir, f), 'utf8')))

const recorded = new Map(ledger.map((r) => [r.name, r.checksum]))

const appliedNotInRepo = [...recorded.keys()].filter((n) => !onDisk.has(n))
const inRepoNotApplied = [...onDisk.keys()].filter((n) => !recorded.has(n))
const disagree = [...recorded.entries()]
  .filter(([n, c]) => onDisk.has(n) && onDisk.get(n) !== c)
  .map(([n]) => n)

console.log(`production ledger:        ${String(ledger.length)} row(s)`)
console.log(`candidate migrations/:    ${String(files.length)} file(s)`)
console.log('')
console.log(
  `UNEXPLAINED (applied in production, absent from the candidate): ${String(appliedNotInRepo.length)}`,
)
for (const n of appliedNotInRepo) console.log(`  ${n}`)
console.log('')
console.log(`CHECKSUM DISAGREEMENTS: ${String(disagree.length)}`)
for (const n of disagree) console.log(`  ${n}`)
console.log('')
console.log(
  `PENDING (in the candidate, never applied to production): ${String(inRepoNotApplied.length)}`,
)
for (const n of inRepoNotApplied) console.log(`  ${n}`)

const bad = appliedNotInRepo.length + disagree.length
console.log(`\nPATH B: ${bad === 0 ? 'CLEAN' : 'NOT CLEAN'}`)
process.exit(bad === 0 ? 0 : 1)
