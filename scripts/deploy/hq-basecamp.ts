/**
 * The experiment's own copy of the gateway.
 *
 *   npm run deploy:hq-basecamp
 *
 * ## Why a second slug rather than deploying `hq-api`
 *
 * This branch's `supabase/functions/hq-api/index.ts` is 287 lines ahead of
 * main and 57 lines BEHIND `human-simulation-harness`, which is where the
 * backend work lives. Deploying this branch's copy over the shared one would
 * therefore quietly drop somebody else's change, and deploying THEIR unmerged
 * code to shared infrastructure to avoid that is worse.
 *
 * So the experiment gets its own deployment of the same source, under
 * `hq-api-basecamp`, and the page points at it by hostname. The shared gateway
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

import { readFile } from 'node:fs/promises'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const supabaseToken = process.env.SUPABASE_ACCESS_TOKEN
if (supabaseToken === undefined || supabaseToken === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const SLUG = 'hq-api-basecamp'
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

const entrypoint = await readFile('supabase/functions/hq-api/index.ts', 'utf8')
const form = new FormData()
form.append(
  'metadata',
  JSON.stringify({ name: SLUG, entrypoint_path: 'index.ts', verify_jwt: false }),
)
form.append('file', new File([entrypoint], 'index.ts', { type: 'application/typescript' }))

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

const anonymous = await fetch(`${endpoint}?section=projects`)
console.log(`  no credential:   http ${String(anonymous.status)} (must be 401)`)

const wrong = await fetch(`${endpoint}?section=projects`, {
  headers: { Authorization: 'Bearer not-the-office-token' },
})
console.log(`  a wrong one:     http ${String(wrong.status)} (must be 401)`)

const right = await fetch(`${endpoint}?section=projects`, {
  headers: { Authorization: `Bearer ${token}` },
})
console.log(`  the office key:  http ${String(right.status)} (must be 200)`)

// A session-shaped string nobody issued must not be waved through by the new
// branch that accepts sessions.
const fakeSession = await fetch(`${endpoint}?section=projects`, {
  headers: { Authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.not.a.session' },
})
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
