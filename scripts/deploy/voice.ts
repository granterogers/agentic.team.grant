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
  body: JSON.stringify([{ name: 'HQ_API_TOKEN', value: token }]),
})
console.log(`function secret set: http ${String(setSecrets.status)}`)

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
  body: JSON.stringify({ said: 'what projects have we got', session: 'deployprobe' }),
})
console.log(`  unauthenticated: http ${String(unauthorized.status)} (must be 401)`)

// A question this endpoint must answer from real state without making a job.
const asked = await fetch(`${endpoint}/turn`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ said: 'what projects have we got', session: `deploy${Date.now()}` }),
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
console.log('\nvoice is listening.')
