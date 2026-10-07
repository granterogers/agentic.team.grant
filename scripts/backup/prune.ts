/**
 * Thin out the backups to the owner's policy: the newest 7 daily verified backups, plus the newest verified backup of each
 * of the previous 8 ISO weeks. Nothing else this system made is ever deleted, and nothing it did not make is ever touched.
 *
 *   npm run backup:prune                    # a DRY RUN: verifies, prints the plan, deletes nothing
 *   npm run backup:prune -- --attended      # deletes exactly what the plan names (and needs the production-write approval)
 *
 * Backups are never deleted automatically, on purpose (src/handlers/backup.ts): *"you should always check before making
 * any destructive action with me."* They also share the 1 GB Storage allowance with everything else, and G-1 of the
 * 6 October audit shows that allowance may be reached before the database's. This is the deliberate, attended way to give
 * the space back. It is a person's command, behind the production-writes gate, never a duty.
 *
 * `--attended` alone is not enough: the deletion also needs ALLOW_PRODUCTION_CHECKS=1 and ALLOW_PRODUCTION_WRITES=1, and
 * running it against production additionally needs the owner's separate approval of that specific deletion
 * (docs/ops/backup-retention-policy.md). The policy was recorded on 7 October 2026 and has NOT been executed.
 *
 * Before it plans anything it VERIFIES every finished backup by reading it back (every object's checksum, byte for byte,
 * the same read `backup:rehearse` does). A backup that fails, or that is unfinished, is reported as unknown and is never
 * counted, never deleted, and never the reason a verified one is deleted.
 */
import '../../src/safety/require-production-writes.ts'
import { DEFAULT_POLICY, planRetention } from '../../src/backup/retention.ts'
import { applyRetention, listRuns, verifyRuns } from '../../src/backup/runs.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const arg = (name: string, fallback: number): number => {
  const i = process.argv.indexOf(`--${name}`)
  const v = i < 0 ? undefined : Number(process.argv[i + 1])
  return v !== undefined && Number.isInteger(v) && v >= 0 ? v : fallback
}
const attended = process.argv.includes('--attended')
if (process.argv.includes('--go')) {
  console.error(
    '--go no longer deletes. Use --attended (and the production-write approval) to delete.',
  )
  process.exit(2)
}

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
  keepDays: arg('keep-days', DEFAULT_POLICY.keepDays),
  keepWeeks: arg('weeks', DEFAULT_POLICY.keepWeeks),
}
const listed = await listRuns(ref, serviceKey)
console.log(
  `${String(listed.length)} item(s) in the bucket; policy: newest ${String(policy.keepDays)} daily verified + the newest verified of each of the previous ${String(policy.keepWeeks)} ISO weeks`,
)

// Verify every finished backup by reading it back: the plan may only delete what is proven readable.
const runs = await verifyRuns(ref, serviceKey, listed, (r, ok) => {
  if (r.complete) console.log(`  ${ok ? 'verified  ' : 'NOT VERIFIED'} ${r.name}`)
})
const plan = planRetention(runs, new Date(), policy)

const mb = (b: number): string => `${(b / 1_000_000).toFixed(1)} MB`
if (plan.refused !== null) console.log(`REFUSED: ${plan.refused}`)
console.log(
  `keep   ${String(plan.keep.length)} run(s), ${mb(plan.keep.reduce((a, d) => a + d.bytes, 0))}`,
)
console.log(`remove ${String(plan.remove.length)} run(s), ${mb(plan.freedBytes)}`)
for (const d of plan.remove) console.log(`  - ${d.name}  ${mb(d.bytes)}  (${d.reason})`)
if (plan.unknown.length > 0) {
  console.log(
    `unknown ${String(plan.unknown.length)} run(s): reported, never deleted by this policy`,
  )
  for (const d of plan.unknown) console.log(`  ? ${d.name}  ${mb(d.bytes)}  (${d.rule})`)
}
if (plan.foreign.length > 0) console.log(`left alone, not ours: ${plan.foreign.join(', ')}`)

const applied = await applyRetention(ref, serviceKey, plan, { go: attended, attended })
console.log(
  applied.dryRun
    ? 'DRY RUN: nothing was deleted. Run again with --attended to delete exactly the list above.'
    : `deleted ${String(applied.objectsDeleted)} object(s) in ${String(applied.deleted.length)} run(s)`,
)
