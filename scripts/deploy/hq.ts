/**
 * Deploy Team HQ: the read endpoint to Supabase, the page to Vercel.
 *
 *   npm run deploy:hq
 *
 * Two hosts for one feature, and not by choice: **Supabase forces
 * `content-type: text/plain` on everything it serves**, with `nosniff`, so it
 * cannot serve a web page at all (ADR-0011, measured five ways). JSON is fine,
 * which is why the split falls where it does — API on Supabase, HTML on Vercel.
 *
 * The access token is generated once and stored in the vault. On every deploy
 * after that the existing one is reused, because rotating a token nobody asked
 * to rotate would silently lock Grant's phone out of the dashboard.
 */
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const supabaseToken = process.env.SUPABASE_ACCESS_TOKEN
const vercelToken = process.env.VERCEL_TOKEN
if (supabaseToken === undefined || supabaseToken === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}

const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const api = `https://api.supabase.com/v1/projects/${ref}`
const db = new ManagementApiExecutor(ref, supabaseToken)
const rotate = process.argv.includes('--rotate-token')

// --- the token -------------------------------------------------------------
const existing = (
  await db.execute(
    `select decrypted_secret as v from vault.decrypted_secrets where name = 'hq.api_token'`,
  )
).rows[0]

let token = existing?.v === undefined ? '' : String(existing.v)
if (token === '' || rotate) {
  // 32 bytes, base64url. Long enough that guessing is not a strategy, short
  // enough to paste on a phone once.
  token = randomBytes(32).toString('base64url')
  await db.execute(`
    select app.store_secret('hq.api_token', '${token.replace(/'/g, "''")}',
      'Bearer token for the Team HQ read endpoint. A capability, not a password: it grants exactly four read-only sections.')
  `)
  console.log(rotate ? 'token ROTATED (old devices must re-enter it)' : 'token generated')
} else {
  console.log('token: reusing the one in the vault')
}

// --- the endpoint ----------------------------------------------------------
const setSecrets = await fetch(`${api}/secrets`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${supabaseToken}`, 'Content-Type': 'application/json' },
  body: JSON.stringify([{ name: 'HQ_API_TOKEN', value: token }]),
})
console.log(`function secret set: http ${String(setSecrets.status)}`)

const entrypoint = await readFile('supabase/functions/hq-api/index.ts', 'utf8')
const form = new FormData()
form.append(
  'metadata',
  JSON.stringify({ name: 'hq-api', entrypoint_path: 'index.ts', verify_jwt: false }),
)
form.append('file', new File([entrypoint], 'index.ts', { type: 'application/typescript' }))

const deployed = await fetch(`${api}/functions/deploy?slug=hq-api`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${supabaseToken}` },
  body: form,
})
const result = (await deployed.json()) as { version?: number; status?: string }
if (!deployed.ok) {
  console.error(`endpoint deploy failed: http ${String(deployed.status)} ${JSON.stringify(result)}`)
  process.exit(1)
}
const endpoint = `https://${ref}.supabase.co/functions/v1/hq-api`
console.log(`endpoint v${String(result.version)} ${String(result.status)} — ${endpoint}`)

// --- verify the endpoint, by its answers rather than its status ------------
// A Vercel deploy in this project once returned 200 with 339,010 bytes of auth
// wall; the rule since then is that a status code is not a verification.
const unauthorized = await fetch(`${endpoint}?section=overview`)
const authorized = await fetch(`${endpoint}?section=overview`, {
  headers: { Authorization: `Bearer ${token}` },
})
const body = (await authorized.json()) as { data?: { counts?: unknown } }
console.log(`  unauthenticated: http ${String(unauthorized.status)} (must be 401)`)
console.log(
  `  authenticated:   http ${String(authorized.status)} counts=${body.data?.counts !== undefined ? 'present' : 'MISSING'}`,
)
if (unauthorized.status !== 401 || body.data?.counts === undefined) {
  console.error('the endpoint did not behave as required')
  process.exit(1)
}

// --- the page --------------------------------------------------------------
if (vercelToken === undefined || vercelToken === '') {
  console.log('\nVERCEL_TOKEN not set; endpoint deployed, page skipped')
  process.exit(0)
}

// Vercel turns SSO protection ON for a new project by default, and it applies
// to the deployment URL. The symptom is a 302 to `vercel.com/sso-api` and a
// 15-byte "Redirecting..." body — a page that looks deployed and cannot be
// opened. Turned off here rather than by hand, because a manual step that is
// only needed on the first deploy is a manual step nobody remembers on the
// second project.
//
// Safe to disable: the HTML holds no data. It is a login gate, and the API
// behind it requires the bearer token whoever loads the page must already have.
const projects = (await (
  await fetch('https://api.vercel.com/v9/projects?limit=100', {
    headers: { Authorization: `Bearer ${vercelToken}` },
  })
).json()) as { projects?: { id: string; name: string; ssoProtection: unknown }[] }
const project = projects.projects?.find((p) => p.name === 'ai-team-hq')
if (project !== undefined && project.ssoProtection !== null) {
  const off = await fetch(`https://api.vercel.com/v9/projects/${project.id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${vercelToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ssoProtection: null }),
  })
  console.log(`sso protection disabled: http ${String(off.status)}`)
}

const html = await readFile('web/hq/index.html', 'utf8')
const deployment = await fetch('https://api.vercel.com/v13/deployments', {
  method: 'POST',
  headers: { Authorization: `Bearer ${vercelToken}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'ai-team-hq',
    target: 'production',
    files: [{ file: 'index.html', data: html }],
    projectSettings: { framework: null },
  }),
})
const page = (await deployment.json()) as { url?: string; error?: { message?: string } }
if (!deployment.ok) {
  console.error(`page deploy failed: ${JSON.stringify(page.error ?? page).slice(0, 200)}`)
  process.exit(1)
}
// The page, checked by what it serves rather than by its status. A 302 to an
// auth wall is a 200 as far as `deployment.ok` is concerned.
const served = await fetch(`https://${String(page.url)}`, { redirect: 'follow' })
const servedBody = await served.text()
const looksRight =
  served.status === 200 &&
  (served.headers.get('content-type') ?? '').includes('text/html') &&
  servedBody.includes('Team HQ')
console.log(`\npage: https://ai-team-hq.vercel.app  (this deploy: https://${String(page.url)})`)
console.log(
  `  served: http ${String(served.status)} ${String(served.headers.get('content-type'))} ${String(servedBody.length)} bytes — ${looksRight ? 'ok' : 'NOT THE PAGE'}`,
)
if (!looksRight) {
  console.error('the page URL did not serve the page')
  process.exit(1)
}
// The token is deliberately NOT printed.
//
// This script printed it once, into a session transcript, which is the same
// mistake that put Google session cookies in one earlier in the week. A
// transcript is a durable, copied, searchable place; a token that reaches one
// has to be rotated.
//
// `npm run hq:token` sends it to Grant on Telegram instead — his own device,
// through the delivery path this system already owns.
console.log('\ntoken: in the vault as `hq.api_token`, deliberately not printed here.')
console.log('       `npm run hq:token` sends it to Grant on Telegram.')
