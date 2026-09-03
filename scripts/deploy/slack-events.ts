/**
 * Deploy the Slack events endpoint.
 *
 *   npm run deploy:slack
 *
 * Uploads `src/slack/events.ts` and `src/slack/signature.ts` alongside the
 * entrypoint rather than copies of them, so the running code IS the tested
 * code. That is not tidiness: the Telegram webhook shipped once with a
 * Node-only `Buffer.from()` in a copied file, and a single upload path is what
 * made the fix one line rather than two.
 *
 * The deploy verifies the endpoint afterwards by presenting a **correctly
 * signed** request and checking the response body, not the status code. A
 * Vercel deploy in this build returned 200 with `text/html` and 339,010 bytes
 * that turned out to be an auth wall; the rule since then is that a status code
 * is not a verification.
 */
import { readFile } from 'node:fs/promises'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { computeSignature } from '../../src/slack/signature.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
const botToken = process.env.SLACK_BOT_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}

const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const SLUG = 'slack-events'
const api = `https://api.supabase.com/v1/projects/${ref}`
const db = new ManagementApiExecutor(ref, token)

// --- the signing secret ----------------------------------------------------
// Preferred from the vault, because that is where credentials belong (§15) and
// where the rotation writes. The environment is the fallback for first run.
const vaulted = (
  await db.execute(
    `select decrypted_secret as v from vault.decrypted_secrets where name = 'slack.signing_secret'`,
  )
).rows[0]

let signingSecret = vaulted?.v === undefined ? '' : String(vaulted.v)
let source = 'vault'
if (signingSecret === '') {
  signingSecret = process.env.SLACK_SIGNING_SECRET ?? ''
  source = 'environment'
  if (signingSecret !== '') {
    // Move it into the vault on the way past, so the next deploy does not
    // depend on the environment being set.
    await db.execute(`
      select app.store_secret('slack.signing_secret',
        '${signingSecret.replace(/'/g, "''")}',
        'X-Slack-Signature verification — the only authentication the events endpoint has')
    `)
    source = 'environment, now vaulted'
  }
}
if (signingSecret === '') {
  console.error('no slack.signing_secret in the vault and SLACK_SIGNING_SECRET is not set')
  process.exit(1)
}
console.log(`signing secret: ${String(signingSecret.length)} chars, from the ${source}`)

// --- our own bot user id, so the app does not answer itself ----------------
let botUserId = ''
let teamId = ''
let teamName = ''
if (botToken !== undefined && botToken !== '') {
  const auth = (await (
    await fetch('https://slack.com/api/auth.test', {
      method: 'POST',
      headers: { Authorization: `Bearer ${botToken}` },
    })
  ).json()) as { ok?: boolean; user_id?: string; team_id?: string; team?: string }
  if (auth.ok === true) {
    botUserId = auth.user_id ?? ''
    teamId = auth.team_id ?? ''
    teamName = auth.team ?? ''
    console.log(`bot user: ${botUserId} in ${teamName} (${teamId})`)
  } else {
    console.log('auth.test failed; SLACK_BOT_USER_ID will be empty')
  }
}
if (botUserId === '') {
  // Fail rather than deploy without it. Without the bot's own user id the
  // handler cannot recognise its own messages coming back as events, and the
  // failure mode is the app talking to itself in a loop.
  console.error('cannot determine the bot user id — refusing to deploy a self-answering endpoint')
  process.exit(1)
}

// Record the workspace, so installation state is a fact in Postgres rather than
// something inferred from whether a call happens to work.
await db.execute(`
  insert into public.slack_workspaces (team_id, team_name, bot_user_id, installed)
  values ('${teamId}', '${teamName.replace(/'/g, "''")}', '${botUserId}', true)
  on conflict (team_id) do update
    set team_name = excluded.team_name,
        bot_user_id = excluded.bot_user_id,
        installed = true,
        uninstalled_at = null,
        revocation_reason = null
`)

// --- function secrets ------------------------------------------------------
const setSecrets = await fetch(`${api}/secrets`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify([
    { name: 'SLACK_SIGNING_SECRET', value: signingSecret },
    { name: 'SLACK_BOT_USER_ID', value: botUserId },
  ]),
})
console.log(`function secrets set: http ${String(setSecrets.status)}`)

// --- deploy ----------------------------------------------------------------
const [entrypoint, events, signature] = await Promise.all([
  readFile('supabase/functions/slack-events/index.ts', 'utf8'),
  readFile('src/slack/events.ts', 'utf8'),
  readFile('src/slack/signature.ts', 'utf8'),
])

const form = new FormData()
form.append(
  'metadata',
  JSON.stringify({ name: SLUG, entrypoint_path: 'index.ts', verify_jwt: false }),
)
form.append('file', new File([entrypoint], 'index.ts', { type: 'application/typescript' }))
form.append('file', new File([events], 'events.ts', { type: 'application/typescript' }))
form.append('file', new File([signature], 'signature.ts', { type: 'application/typescript' }))

const deployed = await fetch(`${api}/functions/deploy?slug=${SLUG}`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` },
  body: form,
})
const result = (await deployed.json()) as { slug?: string; version?: number; status?: string }
if (!deployed.ok) {
  console.error(`deploy failed: http ${String(deployed.status)} ${JSON.stringify(result)}`)
  process.exit(1)
}
const endpoint = `https://${ref}.supabase.co/functions/v1/${SLUG}`
console.log(`deployed ${String(result.slug)} v${String(result.version)} ${String(result.status)}`)
console.log(`endpoint: ${endpoint}`)

// --- verify the response, not the status code ------------------------------
// A correctly signed url_verification handshake must come back with our own
// challenge echoed. That proves the secret reached the function, the signature
// path works over the raw body, and the handler runs — three things a 200 alone
// would not.
const challenge = `deploy-check-${String(Date.now())}`
const body = JSON.stringify({ type: 'url_verification', challenge })
const ts = String(Math.floor(Date.now() / 1000))
const probe = await fetch(endpoint, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Slack-Request-Timestamp': ts,
    'X-Slack-Signature': await computeSignature(signingSecret, ts, body),
  },
  body,
})
const probeBody = await probe.text()
const echoed = probeBody.includes(challenge)
console.log(`\nsigned handshake: http ${String(probe.status)} challenge echoed: ${String(echoed)}`)
if (!echoed) {
  console.error(`the endpoint did not echo the challenge: ${probeBody.slice(0, 200)}`)
  process.exit(1)
}

const unsigned = await fetch(endpoint, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body,
})
console.log(`unsigned handshake: http ${String(unsigned.status)} (must be 401)`)
if (unsigned.status !== 401) {
  console.error('an unsigned request was not rejected')
  process.exit(1)
}
console.log('\n✅ slack-events deployed and verified')
