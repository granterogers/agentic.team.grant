/**
 * The experiment's own copy of the voice endpoint.
 *
 *   npm run deploy:voice-basecamp
 *
 * ## Why a second slug rather than deploying `hq-api`
 *
 * This branch's `supabase/functions/voice/index.ts` is 287 lines ahead of
 * main and 57 lines BEHIND `human-simulation-harness`, which is where the
 * backend work lives. Deploying this branch's copy over the shared one would
 * therefore quietly drop somebody else's change, and deploying THEIR unmerged
 * code to shared infrastructure to avoid that is worse.
 *
 * So the experiment gets its own deployment of the same source, under
 * `voice-basecamp`, and the page points at it by hostname. The shared gateway
 * and the default Team HQ are untouched by anything this branch does, which is
 * the branch's standing instruction anyway.
 *
 * ## What happens to it at integration
 *
 * It goes. The experimental page points back at `hq-api` the moment the two
 * copies are one file again, and this script and its slug are deleted. It is
 * recorded here rather than in a comment somewhere so that the removal is a
 * step somebody can find: see ADR-0043.
 *
 * The secrets are the same ones `deploy:hq` sets, read from the same vault
 * rows, so the two deployments cannot disagree about the token they compare.
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
const SLUG = 'voice-basecamp'
const api = `https://api.supabase.com/v1/projects/${ref}`
const db = new ManagementApiExecutor(ref, supabaseToken)

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

// The same value the shared gateway compares. Never printed.
const setSecrets = await fetch(`${api}/secrets`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${supabaseToken}`, 'Content-Type': 'application/json' },
  body: JSON.stringify([{ name: 'HQ_API_TOKEN', value: token }]),
})
console.log(`function secrets set: http ${String(setSecrets.status)}`)

// The voice function asks `src/auth/speaker.ts` who is calling, so this copy ships its import graph too.
const { form, files } = await bundleForm(SLUG, 'supabase/functions/voice/index.ts')
console.log(`${SLUG}: bundling ${String(files)} file(s) from the import graph`)

const deployed = await fetch(`${api}/functions/deploy?slug=${SLUG}`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${supabaseToken}` },
  body: form,
})
const result = (await deployed.json()) as { version?: number; status?: string }
if (!deployed.ok) {
  console.error(`deploy failed: http ${String(deployed.status)} ${JSON.stringify(result)}`)
  process.exit(1)
}
const endpoint = `https://${ref}.supabase.co/functions/v1/${SLUG}`
console.log(`${SLUG} v${String(result.version)} ${String(result.status)} — ${endpoint}`)

// --- verify by behaviour ----------------------------------------------------

const ask = (auth: string | null) =>
  fetch(`${endpoint}/turn`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(auth === null ? {} : { Authorization: `Bearer ${auth}` }),
    },
    body: JSON.stringify({
      said: 'what projects have we got',
      session: `verify-deploy-${Date.now()}`,
    }),
  })

const anonymous = await ask(null)
console.log(`  no credential:   http ${String(anonymous.status)} (must be 401)`)

const wrong = await ask('not-the-office-token')
console.log(`  a wrong one:     http ${String(wrong.status)} (must be 401)`)

const right = await ask(token)
console.log(`  the office key:  http ${String(right.status)} (must be 200)`)

// A session-shaped string nobody issued must not be waved through by the new
// branch that accepts sessions.
const fakeSession = await ask('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.not.a.session')
console.log(`  a fake session:  http ${String(fakeSession.status)} (must be 401)`)

if (
  anonymous.status !== 401 ||
  wrong.status !== 401 ||
  right.status !== 200 ||
  fakeSession.status !== 401
) {
  console.error('the endpoint did not behave as required')
  process.exit(1)
}
console.log(`\n${SLUG}: deployed, and it refuses everything it should.`)
