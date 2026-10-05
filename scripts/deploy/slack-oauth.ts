/**
 * Deploy the Slack OAuth callback (ADR-0065) and probe it.
 *
 *   npm run deploy:slack-oauth
 *
 * The function holds ONE secret of its own, `SLACK_CLIENT_SECRET`, copied from the vault entry `slack.client_secret` at deploy
 * time (the same arrangement as the events endpoint's signing secret); nothing here prints it. `verify_jwt` is false because
 * Slack redirects a browser with no Supabase token; the single-use state is the authentication.
 *
 * The probe sends no code and no state, so it exchanges nothing and spends nothing: a GET must answer a redirect carrying
 * `slack=refused` and a POST must answer 405.
 */
import '../../src/safety/require-production-writes.ts'
import { readFile } from 'node:fs/promises'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN ?? ''
if (token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const api = `https://api.supabase.com/v1/projects/${ref}`
const db = new ManagementApiExecutor(ref, token)

const secret = String(
  (
    await db.execute(
      `select decrypted_secret as v from vault.decrypted_secrets where name = 'slack.client_secret'`,
    )
  ).rows[0]?.v ?? '',
)
if (secret === '') {
  console.error('no slack.client_secret in the vault; the callback cannot exchange a code')
  process.exit(1)
}
console.log(`client secret: ${String(secret.length)} chars, from the vault`)

const set = await fetch(`${api}/secrets`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify([{ name: 'SLACK_CLIENT_SECRET', value: secret }]),
})
console.log(`function secret set: http ${String(set.status)}`)

const form = new FormData()
form.append(
  'metadata',
  JSON.stringify({ name: 'slack-oauth', entrypoint_path: 'index.ts', verify_jwt: false }),
)
form.append(
  'file',
  new File([await readFile('supabase/functions/slack-oauth/index.ts', 'utf8')], 'index.ts', {
    type: 'application/typescript',
  }),
)
form.append(
  'file',
  new File([await readFile('src/slack/oauth.ts', 'utf8')], 'oauth.ts', {
    type: 'application/typescript',
  }),
)
const deployed = await fetch(`${api}/functions/deploy?slug=slack-oauth`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` },
  body: form,
})
const result = (await deployed.json()) as { version?: number; status?: string }
if (!deployed.ok) {
  console.error(`deploy failed: http ${String(deployed.status)} ${JSON.stringify(result)}`)
  process.exit(1)
}
console.log(`slack-oauth v${String(result.version)} ${String(result.status)}`)

const endpoint = `https://${ref}.supabase.co/functions/v1/slack-oauth`
let get = ''
let post = 0
for (let go = 0; go < 3; go += 1) {
  const g = await fetch(endpoint, { redirect: 'manual' })
  get = g.headers.get('location') ?? `http ${String(g.status)}`
  post = (await fetch(endpoint, { method: 'POST', redirect: 'manual' })).status
  if (get.includes('slack=refused') && post === 405) break
  await new Promise((r) => setTimeout(r, 1500))
}
console.log(
  `  GET with nothing -> ${get.replace(/^https?:\/\/[^/]+/, '')} (must say slack=refused); POST -> ${String(post)} (must be 405)`,
)
if (!get.includes('slack=refused') || post !== 405) process.exit(1)
