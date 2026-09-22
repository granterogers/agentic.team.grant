/**
 * CI entrypoint for the migration integrity check.
 *
 * Reads `migrations/`, reads the applied-checksum ledger if one exists, and
 * reports every finding. Exits non-zero on any finding so CI fails.
 *
 * The checksum ledger is written by the migration runner when it applies a
 * migration — never by hand and never by this script, which only reads it.
 */
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { MigrationFile, RecordedChecksums } from '../src/migrations/check.ts'
import { checkMigrations } from '../src/migrations/check.ts'

const MIGRATIONS_DIR = 'migrations'
const CHECKSUM_LEDGER = join(MIGRATIONS_DIR, 'applied.json')

const sha256 = (content: string): string =>
  createHash('sha256').update(content, 'utf8').digest('hex')

async function readMigrations(): Promise<MigrationFile[]> {
  let names: string[]
  try {
    names = await readdir(MIGRATIONS_DIR)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }

  const candidates = names.filter((n) => n.toLowerCase().endsWith('.sql'))
  return Promise.all(
    candidates.map(async (name) => ({
      name,
      sql: await readFile(join(MIGRATIONS_DIR, name), 'utf8'),
    })),
  )
}

async function readRecorded(): Promise<RecordedChecksums> {
  try {
    const raw = await readFile(CHECKSUM_LEDGER, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${CHECKSUM_LEDGER} must contain a JSON object of name -> sha256`)
    }
    return parsed as RecordedChecksums
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
}

const [files, recorded] = await Promise.all([readMigrations(), readRecorded()])
const findings = checkMigrations(files, recorded, sha256)

const notes = findings.filter((f) => f.severity === 'note')
const errors = findings.filter((f) => f.severity !== 'note')
for (const note of notes) {
  console.log(`  NOTE  [${note.rule}]  ${note.message}\n`)
}

if (errors.length === 0) {
  console.log(
    `Migration check passed: ${files.length} migration(s), ${Object.keys(recorded).length} recorded as applied.`,
  )
  process.exit(0)
}

console.error(`Migration check FAILED — ${errors.length} finding(s):\n`)
for (const finding of errors) {
  console.error(`  ${finding.file ?? '(migrations/)'}  [${finding.rule}]`)
  console.error(`      ${finding.message}\n`)
}
process.exit(1)
