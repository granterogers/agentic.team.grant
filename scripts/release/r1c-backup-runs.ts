/**
 * R1c (a production READ): when were the retained backup runs taken, and how big is each? Lists the private `backups` bucket one folder at a time
 * and prints the run folder's manifest time and total size. No object is downloaded, nothing is written or deleted, no retention is applied.
 *
 *   ALLOW_PRODUCTION_CHECKS=1 npx tsx scripts/release/r1c-backup-runs.ts
 */
import '../../src/safety/require-production-checks.ts'
import { listUnder } from '../../src/backup/portable.ts'

const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
if (key === '') {
  console.error('SUPABASE_SERVICE_ROLE_KEY is required')
  process.exit(2)
}
const top = await listUnder(ref, key, '')
const folders = top.filter((o) => o.name.startsWith('run-') && !o.name.includes('.'))
const rows: { at: string; objects: number; bytes: number; complete: boolean }[] = []
for (const f of folders) {
  const inside = await listUnder(ref, key, f.name)
  const manifest = inside.find((o) => o.name.endsWith('/manifest.json.gz'))
  const bytes = inside.reduce(
    (n, o) => n + Number(((o as { metadata?: { size?: number } }).metadata?.size ?? 0) as number),
    0,
  )
  rows.push({
    at: String(manifest?.created_at ?? ''),
    objects: inside.filter((o) => o.name.includes('.')).length,
    bytes,
    complete: manifest !== undefined,
  })
}
rows.sort((a, b) => a.at.localeCompare(b.at))
console.log(
  `runs in the bucket: ${String(rows.length)}; top-level non-run objects: ${String(top.length - folders.length)}`,
)
for (const r of rows)
  console.log(
    `  ${r.at || '(no manifest)'}  objects=${String(r.objects)}  bytes=${String(r.bytes)}  ${r.complete ? 'complete' : 'INCOMPLETE'}`,
  )
