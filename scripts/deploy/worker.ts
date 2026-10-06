/**
 * Deploy the `worker` Edge Function, with every file it imports.
 *
 *   npm run deploy:worker
 *
 * ## Why this walks an import graph
 *
 * The other edge functions here upload one or two named files. This one runs
 * the office: the pass it invokes reaches handlers, the provider router, the
 * Slack and Telegram clients, the quality gate — over two hundred files at last count.
 *
 * Listing them by hand would be a list that goes stale the first time someone
 * adds an import, and the failure would be a deploy that succeeds and a
 * function that 500s on its first real call. So the list is computed from the
 * code: start at the entrypoint, follow every relative import, upload what you
 * find, preserving the paths so the relative imports still resolve.
 *
 * This is the same rule ADR-0010 set for the telegram adapter — the running
 * code IS the tested code — applied to a graph instead of a file.
 *
 * The steps themselves live in `lib/deploy-worker.ts`, where their ORDER is tested: the bundle is resolved and validated
 * BEFORE any production write.
 */
import '../../src/safety/require-production-writes.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { BundleError } from './lib/bundle.ts'
import { DeployFailure, deployWorker } from './lib/deploy-worker.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'

try {
  await deployWorker({
    entry: 'supabase/functions/worker/index.ts',
    slug: 'worker',
    ref,
    token,
    api: `https://api.supabase.com/v1/projects/${ref}`,
    functionsBase: `https://${ref}.supabase.co/functions/v1`,
    db: new ManagementApiExecutor(ref, token),
    fetchFn: fetch,
    log: (line) => console.log(line),
    error: (line) => console.error(line),
  })
} catch (e) {
  if (e instanceof BundleError) {
    console.error(`not deployed, nothing was changed in production: ${e.message}`)
    process.exit(1)
  }
  if (e instanceof DeployFailure) {
    console.error(e.message)
    process.exit(1)
  }
  throw e
}
