/**
 * Deploy the `worker` Edge Function, with every file it imports.
 *
 *   npm run deploy:worker
 *
 * ## Why this walks an import graph
 *
 * The other edge functions here upload one or two named files. This one runs
 * the office: the pass it invokes reaches handlers, the provider router, the
 * Slack and Telegram clients, the quality gate — 47 files at last count.
 *
 * Listing them by hand would be a list that goes stale the first time someone
 * adds an import, and the failure would be a deploy that succeeds and a
 * function that 500s on its first real call. So the list is computed from the
 * code: start at the entrypoint, follow every relative import, upload what you
 * find, preserving the paths so the relative imports still resolve.
 *
 * This is the same rule ADR-0010 set for the telegram adapter — the running
 * code IS the tested code — applied to a graph instead of a file.
 */
import '../../src/safety/require-production-writes.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { bundlePath, walk } from './lib/bundle.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const SLUG = 'worker'
const api = `https://api.supabase.com/v1/projects/${ref}`
const db = new ManagementApiExecutor(ref, token)

const ENTRY = 'supabase/functions/worker/index.ts'

const files = await walk(ENTRY)

const form = new FormData()
form.append(
  'metadata',
  JSON.stringify({
    name: SLUG,
    entrypoint_path: ENTRY,
    // No JWT: the kick secret is the whole of the authorisation, and the
    // callers are a webhook and pg_cron, neither of which holds a user token.
    verify_jwt: false,
  }),
)
for (const [abs, source] of files) {
  const rel = bundlePath(abs)
  form.append('file', new File([source], rel, { type: 'application/typescript' }))
}
console.log(`bundling ${String(files.size)} file(s) from the import graph`)

// --- secrets ---------------------------------------------------------------
//
// The function needs a Management API token to reach the database over the
// same transport everything else uses (ADR-0007), and a kick secret so an
// anonymous caller cannot make the office work on demand.
//
// The kick secret is generated here if it does not exist and stored in the
// vault (§15). It is NEVER printed: this script says whether one is configured
// and nothing more.
const existing = (
  await db.execute(
    `select decrypted_secret as v from vault.decrypted_secrets where name = 'worker.kick_secret'`,
  )
).rows[0]
let kick = existing?.v === undefined ? '' : String(existing.v)
if (kick === '') {
  kick = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, '')
  await db.execute(
    `select vault.create_secret(${`'${kick.replace(/'/g, "''")}'`}, 'worker.kick_secret',
       'Shared secret the telegram webhook and pg_cron present to kick a worker pass.')`,
  )
  console.log('kick secret: generated and stored in the vault')
} else {
  console.log('kick secret: already in the vault')
}

const setSecret = await fetch(`${api}/secrets`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify([
    // NOT prefixed `SUPABASE_`: that prefix is reserved and the API rejects
    // the entire batch with a 400, silently leaving the function unconfigured.
    { name: 'HQ_MANAGEMENT_TOKEN', value: token },
    { name: 'HQ_PROJECT_REF', value: ref },
    { name: 'WORKER_KICK_SECRET', value: kick },
  ]),
})
console.log(`function secrets set: http ${String(setSecret.status)}`)
if (!setSecret.ok) {
  // Refused rather than carried on. A 400 here deploys a function that reports
  // healthy and answers 401 to every kick, which is the most expensive kind of
  // working-looking failure.
  console.error(`  ${(await setSecret.text()).slice(0, 200)}`)
  process.exit(1)
}

const deployed = await fetch(`${api}/functions/deploy?slug=${SLUG}`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` },
  body: form,
})
const result = (await deployed.json()) as {
  slug?: string
  version?: number
  status?: string
  message?: string
}
if (!deployed.ok) {
  console.error(`deploy failed: ${String(deployed.status)} ${JSON.stringify(result)}`)
  process.exit(1)
}
console.log(
  `deployed ${String(result.slug)} v${String(result.version)} status=${String(result.status)}`,
)

const url = `https://${ref}.supabase.co/functions/v1/${SLUG}`

// --- does it actually run? -------------------------------------------------
//
// A deploy that reports success and a function that throws on its first import
// is the failure this whole script exists to avoid, so it is checked here
// rather than discovered by Grant waiting for a reply.
const live = (await (await fetch(url)).json()) as { ok?: boolean; configured?: boolean }
console.log(`liveness: ok=${String(live.ok)} configured=${String(live.configured)}`)

const refused = await fetch(url, { method: 'POST' })
console.log(`unauthenticated kick: http ${String(refused.status)} (must be 401)`)

const kicked = await fetch(url, {
  method: 'POST',
  headers: { Authorization: `Bearer ${kick}` },
})
const body = (await kicked.json()) as Record<string, unknown>
console.log(
  `authenticated kick: http ${String(kicked.status)} ok=${String(body.ok)} ` +
    `handled=${String(body.handled ?? '-')} buttons=${String(body.buttons ?? '-')} ` +
    `duties=${String(body.duties ?? '-')}`,
)
if (body.error !== undefined) console.log(`  error: ${String(body.error)}`)
for (const line of (body.log as string[] | undefined) ?? []) console.log(`  ${line}`)

if (refused.status !== 401 || live.configured !== true || body.ok !== true) {
  console.error('\nthe worker is not usable — see above')
  process.exit(1)
}
// The deployed worker answers a person in their own Slack workspace with that person's token (src/slack/installs.ts,
// ADR-0065). The Settings page says "replying in Slack is not switched on" until this is true, so it is stated HERE, by the
// deploy that proved the worker runs, and by nothing earlier: a flag set before the code is live is a promise the product
// cannot keep (a migration is not a deploy).
await db.execute(`
  insert into public.system_config (key, value, description)
  values ('slack.per_office_delivery', 'true'::jsonb,
          'The deployed worker answers a person in their own Slack workspace with their own token (ADR-0065). Set by deploy:worker after its probe passes.')
  on conflict (key) do update set value = excluded.value`)
console.log('slack.per_office_delivery: true (this worker answers personal Slack workspaces)')

console.log(`\nworker: ${url}`)
console.log('kick secret is in the vault as `worker.kick_secret`, deliberately not printed.')
