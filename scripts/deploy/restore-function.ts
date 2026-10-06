/**
 * Put a captured edge function back (the ROLLBACK for a function deploy).
 *
 *   npx tsx scripts/deploy/restore-function.ts .out/rollback-<date>/worker.v972          # plan only, sends nothing
 *   npx tsx scripts/deploy/restore-function.ts .out/rollback-<date>/worker.v972 --go     # deploy it
 *
 * The directory comes from `capture-functions.ts`, taken BEFORE the function was replaced. This re-hashes it, builds the
 * same request every deploy script sends, and (with --go) sends it. The platform rebuilds the bundle from the sources,
 * so the restored function is a NEW version number with the same code; the bundle is not byte-identical and the number
 * is not the old one. It touches no secret, no setting and no database row. Like every deploy it needs a clean, pushed
 * checkout and `ALLOW_PRODUCTION_WRITES=1`, set by a person for this one command.
 */
import '../../src/safety/require-production-writes.ts'
import { buildRestorePlan, RestoreRefusal } from '../lib/restore-plan.ts'

const dir = process.argv[2]
const go = process.argv.includes('--go')
const token = process.env.SUPABASE_ACCESS_TOKEN ?? ''
if (dir === undefined || dir.startsWith('--') || token === '') {
  console.error(
    'usage: restore-function.ts <captured-dir> [--go]   (SUPABASE_ACCESS_TOKEN required)',
  )
  process.exit(2)
}
const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
let plan: ReturnType<typeof buildRestorePlan>
try {
  plan = buildRestorePlan(dir)
} catch (e) {
  if (e instanceof RestoreRefusal) {
    console.error(`refused: ${e.message}`)
    process.exit(1)
  }
  throw e
}
console.log(
  `${plan.slug}: restore captured v${String(plan.capturedVersion)}: ${String(plan.files.length)} file(s), ` +
    `entrypoint ${plan.entrypoint}, verify_jwt ${String(plan.verifyJwt)}` +
    (plan.npmDependencies.length > 0 ? `, re-resolves ${plan.npmDependencies.join(', ')}` : ''),
)
if (!go) {
  console.log('plan only: nothing was sent')
  process.exit(0)
}
const res = await fetch(
  `https://api.supabase.com/v1/projects/${ref}/functions/deploy?slug=${plan.slug}`,
  {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: plan.form,
  },
)
const out = (await res.json().catch(() => ({}))) as {
  slug?: string
  version?: number
  status?: string
  message?: string
}
if (!res.ok) {
  console.error(`restore failed: ${String(res.status)} ${JSON.stringify(out).slice(0, 300)}`)
  process.exit(1)
}
console.log(`restored ${String(out.slug)} as v${String(out.version)} status=${String(out.status)}`)
