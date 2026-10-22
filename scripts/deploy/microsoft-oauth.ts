/**
 * Deploy the `microsoft-oauth` Edge Function (Microsoft To Do, ADR-0076).
 *
 *   SUPABASE_PROJECT_REF=<the target ref> npm run deploy:microsoft-oauth
 *
 * Unlike `deploy:google`, there is NO default project ref. A deploy that forgets the ref must fail, not reach for
 * production. In a staging shell (`TARGET_ENVIRONMENT=staging`) the staging binding refuses any other ref as well.
 */
import '../../src/safety/require-production-writes.ts'
import { readFile } from 'node:fs/promises'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const ref = process.env.SUPABASE_PROJECT_REF ?? ''
if (!/^[a-z0-9]{20}$/.test(ref)) {
  console.error(
    'SUPABASE_PROJECT_REF must name the project to deploy to (20 lowercase letters or digits)',
  )
  process.exit(2)
}
const SLUG = 'microsoft-oauth'
const api = `https://api.supabase.com/v1/projects/${ref}`

const form = new FormData()
form.append(
  'metadata',
  JSON.stringify({
    name: SLUG,
    entrypoint_path: 'index.ts',
    // No JWT: Microsoft sends the browser here with a code, and a redirect carries no bearer token. The authorisation
    // is the one-time STATE the office minted for a signed-in operator, which the callback consumes before it exchanges
    // anything (the same design as google-oauth, 0648).
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

// Checked here, not left for a person to find by pressing Connect: an unknown start must be refused, never sent to
// Microsoft asking for nothing.
const noState = await fetch(`${url}/start`, { redirect: 'manual' })
console.log(
  `start without a state: http ${String(noState.status)} ${noState.status === 400 ? '(refused, correct)' : '(SHOULD be 400)'}`,
)
if (noState.status !== 400) {
  console.error('the start endpoint accepted a request with no state')
  process.exit(1)
}
console.log(`\noauth: ${url}`)
console.log(`redirect address to register in Entra: ${url}/callback`)
