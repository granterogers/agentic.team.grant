/**
 * Deploy the `google-oauth` Edge Function.
 *
 *   npm run deploy:google
 *
 * There was no deploy script for this one, which is how it came to be running
 * a version that read a single `google.scopes` string while the database had
 * moved on to a row per service. A function nobody can redeploy from the
 * repository is a function that drifts from the code describing it.
 */
import { readFile } from 'node:fs/promises'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const SLUG = 'google-oauth'
const api = `https://api.supabase.com/v1/projects/${ref}`

const form = new FormData()
form.append(
  'metadata',
  JSON.stringify({
    name: SLUG,
    entrypoint_path: 'index.ts',
    // No JWT: Google sends the browser here with a code, and a browser
    // following a redirect carries no bearer token. The authorisation is the
    // one-time STATE the office minted for a signed-in operator (0648), which
    // the callback consumes before it exchanges anything.
    verify_jwt: false,
  }),
)
form.append(
  'file',
  new File([await readFile(`supabase/functions/${SLUG}/index.ts`, 'utf8')], 'index.ts', {
    type: 'application/typescript',
  }),
)

const deployed = await fetch(`${api}/functions/deploy?slug=${SLUG}`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` },
  body: form,
})
const result = (await deployed.json()) as { slug?: string; version?: number; status?: string }
if (!deployed.ok) {
  console.error(`deploy failed: ${String(deployed.status)} ${JSON.stringify(result)}`)
  process.exit(1)
}
console.log(
  `deployed ${String(result.slug)} v${String(result.version)} status=${String(result.status)}`,
)

const url = `https://${ref}.supabase.co/functions/v1/${SLUG}`

// --- does it behave? -------------------------------------------------------
//
// Checked here rather than found out by Grant pressing Connect. Until a client
// id exists the start endpoint must say so plainly; once it does, an unknown
// service must be refused rather than sent to Google asking for nothing.
const noSuch = await fetch(`${url}/start?service=not-a-service`, { redirect: 'manual' })
const body = await noSuch.text()
const refused = noSuch.status === 400
console.log(
  `unknown service: http ${String(noSuch.status)} ` +
    `${refused ? '(refused, correct)' : '(SHOULD be 400)'}`,
)
if (body.includes('No client id yet')) {
  console.log('\nnot registered with Google yet — the Set up page explains the one-time step.')
  console.log(`  https://ai-team-hq.vercel.app`)
} else if (!refused) {
  console.error('\nthe start endpoint accepted a service that does not exist')
  process.exit(1)
}
console.log(`\noauth: ${url}`)
