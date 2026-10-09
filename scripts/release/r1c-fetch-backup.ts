/**
 * R1c step 1 (a production READ): copy the newest COMPLETE backup run out of the private `backups` bucket to a local folder, so it can be
 * restored into an isolated replica by `r1c-restore.ts`, which holds no production credential.
 *
 *   ALLOW_PRODUCTION_CHECKS=1 npx tsx scripts/release/r1c-fetch-backup.ts <out-dir>
 *
 * Reads only: one list per folder and a GET per object of the newest run. It deletes nothing, writes nothing to the project and enables no
 * retention. It prints identifiers of the RUN, sizes, counts and the manifest's own metadata; it prints no row and no credential. The copy
 * holds personal data, so the folder is created private (0700), belongs under the gitignored `.out/`, and is removed when the rehearsal ends.
 */
import '../../src/safety/require-production-checks.ts'
import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { downloadArchive, listUnder, newestFolder } from '../../src/backup/portable.ts'
import { gunzipText } from '../../src/backup/sources.ts'

const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const out = process.argv[2]
if (key === '' || out === undefined) {
  console.error('usage: r1c-fetch-backup.ts <out-dir>   (SUPABASE_SERVICE_ROLE_KEY required)')
  process.exit(2)
}
mkdirSync(out, { recursive: true, mode: 0o700 })
chmodSync(out, 0o700)

const top = await listUnder(ref, key, '')
const folders = top.filter((o) => o.name.startsWith('run-') && !o.name.includes('.'))
console.log(`bucket "backups" on ${ref}: ${String(folders.length)} run folder(s)`)
const newest = await newestFolder(ref, key)
if (newest === null) {
  console.error('no complete backup run found')
  process.exit(1)
}
console.log(`newest complete run: ${newest.prefix}; manifest stored ${newest.at}`)
const objects = (await listUnder(ref, key, newest.prefix)).filter((o) => o.name.includes('.'))
console.log(
  `objects listed in the run: ${String(objects.length)} (the list call returns at most 500)`,
)
let total = 0
let files = 0
const sums: string[] = []
for (const o of objects) {
  const bytes = await downloadArchive(ref, key, o.name)
  const target = join(out, o.name)
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
  writeFileSync(target, bytes, { mode: 0o600 })
  total += bytes.length
  files += 1
  sums.push(`${createHash('sha256').update(bytes).digest('hex')}  ${o.name}`)
}
writeFileSync(join(out, 'SHA256SUMS'), `${sums.join('\n')}\n`, { mode: 0o600 })
console.log(`downloaded ${String(files)} object(s), ${String(total)} bytes into ${out}`)
const manifest = JSON.parse(
  await gunzipText(await downloadArchive(ref, key, `${newest.prefix}/manifest.json.gz`)),
) as Record<string, unknown>
const aux = (manifest.aux ?? {}) as Record<string, unknown>
console.log(
  `manifest: format=${String(manifest.format)} exported_at=${String(manifest.exported_at)} project_ref=${String(manifest.project_ref)} latest_migration=${String(manifest.latest_migration)} tables=${String(manifest.tables)} rows=${String(manifest.rows)}`,
)
console.log(`manifest aux sections: ${Object.keys(aux).join(', ') || 'none'}`)
console.log(
  `manifest objects listed: ${String(Object.keys((manifest.objects ?? {}) as object).length)}`,
)
