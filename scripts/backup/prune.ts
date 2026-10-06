/**
 * Thin out the backups: keep the newest few, one a week for a while, and nothing else this system made.
 *
 *   npm run backup:prune                    # a DRY RUN: prints the plan, deletes nothing
 *   npm run backup:prune -- --go            # deletes exactly what the plan names
 *   npm run backup:prune -- --keep-last 10 --weeks 12
 *
 * Backups are never deleted automatically, on purpose (src/handlers/backup.ts): *"you should always check before making
 * any destructive action with me."* They also share the 1 GB Storage allowance with everything else, and G-1 of the
 * 6 October audit shows that allowance may be reached before the database's. This is the deliberate, attended way to give
 * the space back. It is a person's command, behind the production-writes gate, never a duty.
 *
 * Before it deletes anything it VERIFIES the newest complete backup (every object's checksum, byte for byte, the same read
 * `backup:rehearse` does). The policy (src/backup/retention.ts) refuses to delete anything unless one backup has been
 * verified, never deletes the newest complete or newest verified one, never touches a file this system did not create,
 * and deletes at most thirty runs a pass, oldest first. A run's manifest is removed last.
 */
import '../../src/safety/require-production-writes.ts'
import { newestFolder, readFolder } from '../../src/backup/portable.ts'
import { DEFAULT_POLICY, planRetention } from '../../src/backup/retention.ts'
import { applyRetention, listRuns } from '../../src/backup/runs.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const arg = (name: string, fallback: number): number => {
  const i = process.argv.indexOf(`--${name}`)
  const v = i < 0 ? undefined : Number(process.argv[i + 1])
  return v !== undefined && Number.isInteger(v) && v >= 0 ? v : fallback
}
const go = process.argv.includes('--go')

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const db = new ManagementApiExecutor(ref, token)
const serviceKey = String(
  (
    await db.execute(
      `select coalesce(decrypted_secret, '') as k from vault.decrypted_secrets where name = 'supabase.service_role_key'`,
    )
  ).rows[0]?.k ?? '',
)
if (serviceKey === '') {
  console.error('no supabase.service_role_key in the vault, so the bucket cannot be read')
  process.exit(2)
}

const policy = {
  ...DEFAULT_POLICY,
  keepLast: arg('keep-last', DEFAULT_POLICY.keepLast),
  keepWeeks: arg('weeks', DEFAULT_POLICY.keepWeeks),
}
const runs = await listRuns(ref, serviceKey)
console.log(
  `${String(runs.length)} item(s) in the bucket; policy: newest ${String(policy.keepLast)} + one a week for ${String(policy.keepWeeks)} weeks`,
)

// Verify the newest complete backup before anything is planned: the plan is only allowed to delete when one is proven.
const folder = await newestFolder(ref, serviceKey)
let verifiedName: string | null = null
if (folder !== null) {
  const read = await readFolder(ref, serviceKey, folder)
  if (read.corrupt.length === 0 && Object.keys(read.data).length > 0) verifiedName = folder.prefix
  console.log(
    verifiedName === null
      ? `the newest complete backup (${folder.prefix}) FAILED verification: ${read.corrupt.slice(0, 3).join(', ')}`
      : `verified ${folder.prefix}: ${String(Object.keys(read.data).length)} tables, every checksum clean`,
  )
}
const plan = planRetention(
  runs.map((r) => ({ ...r, verified: r.name === verifiedName })),
  new Date(),
  policy,
)

const mb = (b: number): string => `${(b / 1_000_000).toFixed(1)} MB`
if (plan.refused !== null) console.log(`REFUSED: ${plan.refused}`)
console.log(
  `keep   ${String(plan.keep.length)} run(s), ${mb(plan.keep.reduce((a, d) => a + d.bytes, 0))}`,
)
console.log(`remove ${String(plan.remove.length)} run(s), ${mb(plan.freedBytes)}`)
for (const d of plan.remove) console.log(`  - ${d.name}  ${mb(d.bytes)}  (${d.reason})`)
if (plan.foreign.length > 0) console.log(`left alone, not ours: ${plan.foreign.join(', ')}`)

const applied = await applyRetention(ref, serviceKey, plan, { go })
console.log(
  applied.dryRun
    ? 'DRY RUN: nothing was deleted. Run again with --go to delete exactly the list above.'
    : `deleted ${String(applied.objectsDeleted)} object(s) in ${String(applied.deleted.length)} run(s)`,
)
