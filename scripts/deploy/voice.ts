/**
 * Deploy the voice endpoint, and prove it behaves before saying it works.
 *
 *   npm run deploy:voice
 *
 * The token is the HQ one, already in the vault: Talk to Team is a view of Team
 * HQ and a second credential for the same person on the same page would be a
 * second thing to lose.
 */

import { readFile } from 'node:fs/promises'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const supabaseToken = process.env.SUPABASE_ACCESS_TOKEN
if (supabaseToken === undefined || supabaseToken === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'

/**
 * The pages allowed to mint a voice credential.
 *
 * The canonical HQ page first, because a browser gets one origin and an
 * unmatched request is answered with this one. Vercel preview deployments get
 * their own hostnames and are deliberately NOT here: this endpoint takes no
 * authentication, so the allowlist is the only thing between a stranger's page
 * and a credential minted against Grant's OpenAI key.
 */
const PAGE_ORIGINS = [
  'https://ai-team-hq.vercel.app',
  /*
    The basecamp experiment's own origin (`claude/basecamp-team-hq`).
    `voice-token` takes NO authentication - the allowlist is the only thing
    between a stranger's page and a credential minted against Grant's OpenAI
    key - so an origin that is not on this list cannot mint one, and live voice
    on the experiment could never have worked from the deployed preview
    however good the client was. Adding it is what makes the microphone at the
    top of `/basecamp` able to open a real session at all.

    It is a stable alias, not a per-deployment URL: Vercel gives every
    deployment its own hostname, and putting those here would be an allowlist
    that grows without bound and never shrinks.
  */
  'https://agentic-team-hq-basecamp-agentic-team-grant.vercel.app',
]
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

// The function's own copy of the token, so it can compare. Never printed —
// `npm run hq:token` is the only thing that ever puts it in front of Grant,
// and it sends it to Telegram.
const setSecrets = await fetch(`${api}/secrets`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${supabaseToken}`, 'Content-Type': 'application/json' },
  body: JSON.stringify([
    { name: 'HQ_API_TOKEN', value: token },
    // Set here, on every deploy, because setting it by hand is how it broke.
    // It held one origin — the voice proof-of-concept's Vercel URL — while the
    // page moved to `ai-team-hq.vercel.app`, so the browser refused every
    // preflight and the phone button reported "Failed to fetch" on desktop and
    // mobile alike. Nothing in the repository set it, so nothing could notice.
    { name: 'VOICE_ALLOWED_ORIGIN', value: PAGE_ORIGINS.join(',') },
  ]),
})
console.log(`function secrets set: http ${String(setSecrets.status)}`)

const entrypoint = await readFile('supabase/functions/voice/index.ts', 'utf8')
const form = new FormData()
form.append(
  'metadata',
  // `verify_jwt: false` because the browser presents the HQ bearer token, not a
  // Supabase JWT — the same arrangement hq-api has, and the token comparison
  // inside the function is the whole of the authorisation.
  JSON.stringify({ name: 'voice', entrypoint_path: 'index.ts', verify_jwt: false }),
)
form.append('file', new File([entrypoint], 'index.ts', { type: 'application/typescript' }))

const deployed = await fetch(`${api}/functions/deploy?slug=voice`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${supabaseToken}` },
  body: form,
})
const result = (await deployed.json()) as { version?: number; status?: string }
if (!deployed.ok) {
  console.error(`deploy failed: http ${String(deployed.status)} ${JSON.stringify(result)}`)
  process.exit(1)
}
const endpoint = `https://${ref}.supabase.co/functions/v1/voice`
console.log(`voice v${String(result.version)} ${String(result.status)} — ${endpoint}`)

// --- verify by behaviour, not by status ------------------------------------
const unauthorized = await fetch(`${endpoint}/turn`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ said: 'what projects have we got', session: 'verify-deployprobe' }),
})
console.log(`  unauthenticated: http ${String(unauthorized.status)} (must be 401)`)

// A question this endpoint must answer from real state without making a job.
const asked = await fetch(`${endpoint}/turn`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    said: 'what projects have we got',
    session: `verify-deploy-${Date.now()}`,
  }),
})
const answer = (await asked.json()) as { speak?: string; did?: string }
console.log(
  `  a question:      http ${String(asked.status)} did=${String(answer.did)} — ` +
    `${String(answer.speak).slice(0, 80)}`,
)

if (unauthorized.status !== 401 || answer.did !== 'answered') {
  console.error('the endpoint did not behave as required')
  process.exit(1)
}

// --- and the other half: the credential the call itself runs on -------------
//
// `voice-token` used to be deployed by hand, which is how it spent two months
// minting a session whose instructions said it was a proof of concept. It is
// the same feature as `/voice` — one of them takes the call, the other decides
// who is on it — so it ships in the same command.
const mintSource = await readFile('supabase/functions/voice-token/index.ts', 'utf8')
const mintForm = new FormData()
mintForm.append(
  'metadata',
  // No JWT: the page is public and the endpoint hands out a credential that
  // expires in about a minute and can do nothing but hold one conversation.
  JSON.stringify({ name: 'voice-token', entrypoint_path: 'index.ts', verify_jwt: false }),
)
mintForm.append('file', new File([mintSource], 'index.ts', { type: 'application/typescript' }))

const mintDeployed = await fetch(`${api}/functions/deploy?slug=voice-token`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${supabaseToken}` },
  body: mintForm,
})
const mintResult = (await mintDeployed.json()) as { version?: number; status?: string }
if (!mintDeployed.ok) {
  console.error(`voice-token deploy failed: http ${String(mintDeployed.status)}`)
  process.exit(1)
}
console.log(`voice-token v${String(mintResult.version)} ${String(mintResult.status)}`)

// Behaviour again: a mint that returns a credential but silently dropped the
// tools is a call where Claire cannot reach the team, and it looks identical
// from the outside until you ask her to do something.
// The preflight, from the page's real origin.
//
// This is the check whose absence let the CORS misconfiguration live: the
// probe below sends no `Origin`, so it succeeded every single time while the
// browser was being refused. A server-side probe that does not do what the
// browser does is a probe that certifies the wrong thing.
const preflight = await fetch(`https://${ref}.supabase.co/functions/v1/voice-token`, {
  method: 'OPTIONS',
  headers: {
    Origin: PAGE_ORIGINS[0] ?? '',
    'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'content-type',
  },
})
const allowOrigin = preflight.headers.get('access-control-allow-origin') ?? ''
console.log(`  preflight:       http ${String(preflight.status)} allow-origin=${allowOrigin}`)
if (allowOrigin !== PAGE_ORIGINS[0] && allowOrigin !== '*') {
  console.error(
    `the page at ${String(PAGE_ORIGINS[0])} would be refused by the browser ` +
      `(allow-origin came back as "${allowOrigin}"). The phone button would say ` +
      '"Failed to fetch".',
  )
  process.exit(1)
}

const mintProbe = await fetch(`https://${ref}.supabase.co/functions/v1/voice-token`, {
  method: 'POST',
})
const mintBody = (await mintProbe.json()) as {
  client_secret?: string
  model?: string
  voice?: string
  tools?: string[]
  degraded?: boolean
}
console.log(
  `  mint:            http ${String(mintProbe.status)} model=${String(mintBody.model)} ` +
    `voice=${String(mintBody.voice)} tools=${JSON.stringify(mintBody.tools ?? [])}`,
)
if (mintProbe.status !== 200 || mintBody.client_secret === undefined) {
  console.error('the mint did not return a credential')
  process.exit(1)
}
if (mintBody.degraded === true) {
  console.error(
    'the mint fell back to a bare session — she has no tools and no transcript. ' +
      'Read the function logs for the rejected field.',
  )
  process.exit(1)
}

console.log('\nvoice is listening.')
