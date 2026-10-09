/**
 * R1c step 2 (LOCAL ONLY): restore a backup run that `r1c-fetch-backup.ts` copied out of the bucket into an isolated replica database.
 *
 *   env -u SUPABASE_ACCESS_TOKEN -u SUPABASE_PROJECT_REF -u SUPABASE_SERVICE_ROLE_KEY -u SUPABASE_DB_URL \
 *     npx tsx scripts/release/r1c-restore.ts <backup-folder> <run-prefix> <target-database>
 *
 * The target must be a database on the local Unix socket carrying `public.isolated_replica_marker` that is not a template (the same guard
 * `restoreArchive` applies, and `scripts/isolated/guard.ts` first): it refuses anything else, so it cannot be pointed at production. It reads only
 * local files, opens no network connection of its own, and never starts a job or a worker: the replica has none, and every trigger that sends is
 * a no-op there. Nothing is printed from a row: only counts, steps and the checks below.
 *
 * Logins: the backup the deployed worker takes holds no `auth.users` (the manifest has no `aux`), so `offices.auth_user_id` cannot resolve in a clean
 * replica. This harness creates a placeholder login (id only, a synthetic address) for each id the backup's own offices and members name, which is what a real
 * recovery would have to do from some other record, and says how many it had to make. That count is a finding about the backup, not a restore step.
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Manifest, ObservedObject } from '../../src/backup/manifest.ts'
import type { ArchiveSource } from '../../src/backup/restore.ts'
import { restoreArchive } from '../../src/backup/restore.ts'
import { gunzipText } from '../../src/backup/sources.ts'
import { isolated } from '../isolated/guard.ts'

const [folder, prefix, target] = process.argv.slice(2)
if (folder === undefined || prefix === undefined || target === undefined) {
  console.error('usage: r1c-restore.ts <backup-folder> <run-prefix> <target-database>')
  process.exit(2)
}
for (const k of ['SUPABASE_ACCESS_TOKEN', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_DB_URL']) {
  if ((process.env[k] ?? '') !== '') {
    console.error(
      `REFUSED: ${k} is set. The restore rehearsal runs with no production credential in its environment.`,
    )
    process.exit(2)
  }
}
const run: string = prefix
const dir = join(folder, run)
const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex')

class LocalFolderSource implements ArchiveSource {
  readonly prefix: string = run
  async manifest(): Promise<Manifest> {
    return JSON.parse(
      await gunzipText(new Uint8Array(readFileSync(join(dir, 'manifest.json.gz')))),
    ) as Manifest
  }
  async observed(): Promise<ReadonlyMap<string, ObservedObject>> {
    const out = new Map<string, ObservedObject>()
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json.gz')) continue
      const bytes = new Uint8Array(readFileSync(join(dir, f)))
      let stated = ''
      try {
        stated =
          readFileSync(join(dir, `${f}.sha256`), 'utf8')
            .trim()
            .split(/\s+/)[0] ?? ''
      } catch {
        stated = ''
      }
      const actual = sha(bytes)
      out.set(`${run}/${f}`, {
        sha256: stated !== '' && stated !== actual ? stated : actual,
        bytes: bytes.length,
      })
    }
    return out
  }
  async table(qualified: string): Promise<{ text: string; sha256: string; bytes: number } | null> {
    try {
      const bytes = new Uint8Array(readFileSync(join(dir, `${qualified}.json.gz`)))
      return { text: await gunzipText(bytes), sha256: sha(bytes), bytes: bytes.length }
    } catch {
      return null
    }
  }
}

const db = await isolated(target)
const source = new LocalFolderSource()
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

// placeholder logins for the ids the backup's own rows name (see the header)
const ids = new Set<string>()
for (const t of ['public.offices', 'public.office_members']) {
  const got = await source.table(t)
  if (got === null) continue
  const parsed = JSON.parse(got.text) as { rows?: Record<string, unknown>[] }
  for (const r of parsed.rows ?? []) {
    const id = r.auth_user_id
    if (typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id)) ids.add(id)
  }
}
let made = 0
const prepareLogins = async (): Promise<void> => {
  for (const id of ids) {
    await db.execute(
      `insert into auth.users (id, email) values (${lit(id)}::uuid, ${lit(`placeholder-${String(made)}@invalid.example`)}) on conflict (id) do nothing`,
    )
    made += 1
  }
}
console.log(
  `placeholder logins needed (ids the backup's offices and members name): ${String(ids.size)}`,
)
await prepareLogins()

const t0 = Date.now()
const started = new Date().toISOString()
const report = await restoreArchive(db, source, {
  onNonEmpty: 'truncate',
  allowSchemaDrift: false,
  log: (l) => console.log(`  ${l.slice(0, 220)}`),
})
console.log(
  `restore ${report.ok ? 'OK' : 'FAILED'}: ${String(report.tables)} tables, ${String(report.rows)} rows, ${String(report.steps.length)} steps, ${String(report.errors.length)} error(s), ${String(report.warnings.length)} warning(s); started ${started}, took ${String(Math.round((Date.now() - t0) / 1000))} s`,
)
for (const e of report.errors.slice(0, 12)) console.log(`  ERROR ${e.slice(0, 300)}`)
for (const w of report.warnings.slice(0, 12)) console.log(`  WARN ${w.slice(0, 300)}`)
process.exit(report.ok ? 0 : 1)
