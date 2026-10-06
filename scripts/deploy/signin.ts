/**
 * Deploy the sign-in endpoint, and prove it refuses before saying it works.
 *
 *   npm run deploy:signin
 *
 * This is the last mile of the one bearer token, not a second credential: the
 * function hands out `hq.api_token` itself, to a browser whose request a human
 * approved on Telegram. So it is deployed from the same vault row everything
 * else reads, and the allowlist below is the only thing between a stranger's
 * page and that hand-off — the same arrangement, and the same reasoning, as
 * `voice-token`.
 */

import '../../src/safety/require-production-writes.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { bundleForm } from './lib/bundle.ts'

const supabaseToken = process.env.SUPABASE_ACCESS_TOKEN
if (supabaseToken === undefined || supabaseToken === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'

/**
 * The pages allowed to ask for a sign-in.
 *
 * Stable aliases only. Vercel gives every deployment its own hostname, and a
 * list that grew one entry per deploy would never shrink — so an integration
 * preview correctly cannot sign anybody in, and the suite that drives one
 * expects the refusal rather than treating it as a fault.
 */
const PAGE_ORIGINS = [
  'https://ai-team-hq.vercel.app',
  'https://agentic-team-hq-basecamp-agentic-team-grant.vercel.app',
]

const api = `https://api.supabase.com/v1/projects/${ref}`
const db = new ManagementApiExecutor(ref, supabaseToken)

// The function imports src/auth/redirect-target.ts (the sign-in link's redirect check), so it ships its import graph.
// Resolved and validated HERE, before any secret is written: a bundle the platform would refuse is known locally.
const signinBundle = await bundleForm('signin', 'supabase/functions/signin/index.ts')
const form = signinBundle.form
console.log(`signin: bundling ${String(signinBundle.files)} file(s) from the import graph`)

const token = String(
  (
    await db.execute(
      `select decrypted_secret as v from vault.decrypted_secrets where name = 'hq.api_token'`,
    )
  ).rows[0]?.v ?? '',
)
if (token === '') {
  console.error('no hq.api_token in the vault — run `npm run deploy:hq` first')
  process.exit(1)
}

const setSecrets = await fetch(`${api}/secrets`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${supabaseToken}`, 'Content-Type': 'application/json' },
  body: JSON.stringify([
    { name: 'HQ_API_TOKEN', value: token },
    { name: 'SIGNIN_ALLOWED_ORIGIN', value: PAGE_ORIGINS.join(',') },
  ]),
})
console.log(`function secrets set: http ${String(setSecrets.status)}`)

// No JWT: the browser asking to be signed in has, by definition, nothing to present (the bundle's metadata says so).
const deployed = await fetch(`${api}/functions/deploy?slug=signin`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${supabaseToken}` },
  body: form,
})
const result = (await deployed.json()) as { version?: number; status?: string }
if (!deployed.ok) {
  console.error(`deploy failed: http ${String(deployed.status)} ${JSON.stringify(result)}`)
  process.exit(1)
}
const endpoint = `https://${ref}.supabase.co/functions/v1/signin`
console.log(`signin v${String(result.version)} ${String(result.status)} — ${endpoint}`)

// --- verify by behaviour, not by status ------------------------------------
//
// Deliberately only the REFUSALS. A begin would ring Grant's phone, and a
// deploy that pages him every time is a deploy nobody runs.

const health = await fetch(`${endpoint}/health`)
const healthBody = (await health.json().catch(() => ({}))) as { configured?: boolean }
console.log(
  `  health:          http ${String(health.status)} configured=${String(healthBody.configured)}`,
)

const stranger = await fetch(endpoint, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'https://example.invalid' },
  body: JSON.stringify({ action: 'begin', asked_from: 'deploy probe' }),
})
console.log(`  a stranger:      http ${String(stranger.status)} (must be 403)`)

const noOrigin = await fetch(endpoint, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'begin' }),
})
console.log(`  no origin:       http ${String(noOrigin.status)} (must be 403)`)

// A refresh with a token nothing issued, from a page that IS allowed. It must
// come back as an ordinary no, never as a session.
const dud = await fetch(endpoint, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: PAGE_ORIGINS[0] ?? '' },
  body: JSON.stringify({ action: 'refresh', refresh_token: 'not-a-refresh-token' }),
})
const dudBody = (await dud.json().catch(() => ({}))) as {
  ok?: boolean
  reason?: string
  access_token?: string
}
console.log(
  `  a dud refresh:   http ${String(dud.status)} ok=${String(dudBody.ok)} ` +
    `reason=${String(dudBody.reason)} session=${dudBody.access_token === undefined ? 'absent' : 'PRESENT'}`,
)

// And a session nobody presented.
const nobody = await fetch(endpoint, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: PAGE_ORIGINS[0] ?? '' },
  body: JSON.stringify({ action: 'whoami' }),
})
const nobodyBody = (await nobody.json().catch(() => ({}))) as { ok?: boolean }
console.log(`  nobody at all:   http ${String(nobody.status)} ok=${String(nobodyBody.ok)}`)

const bad =
  health.status !== 200 ||
  healthBody.configured !== true ||
  stranger.status !== 403 ||
  noOrigin.status !== 403 ||
  dudBody.ok !== false ||
  dudBody.access_token !== undefined ||
  nobodyBody.ok !== false

if (bad) {
  console.error('the endpoint did not behave as required')
  process.exit(1)
}
console.log(
  '\nsign-in: deployed, and it refuses a stranger, a missing origin, a dud refresh and nobody.',
)
