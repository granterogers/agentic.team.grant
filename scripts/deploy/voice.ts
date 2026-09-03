/**
 * Deploy the Gate 1 voice POC.
 *
 *   npm run deploy:voice
 *
 * Two functions:
 *   voice-token  mints an ephemeral Realtime credential (§12 — the browser
 *                never receives the permanent key)
 *   voice        serves the POC page
 *
 * On Supabase Edge Functions rather than Vercel (ADR-0010), so this needs no
 * credential beyond the ones already in use.
 *
 * `verify_jwt: false` on both: Grant opens the page in Safari with no Supabase
 * session, and the mint endpoint is called from that page. The exposure is
 * deliberate and bounded — see the note at the end of this file.
 */
import { readFile } from 'node:fs/promises'

const token = process.env.SUPABASE_ACCESS_TOKEN
const openaiKey = process.env.OPENAI_API_KEY
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
if (openaiKey === undefined || openaiKey === '') {
  console.error('OPENAI_API_KEY is required — the mint endpoint needs it')
  process.exit(2)
}

const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const api = `https://api.supabase.com/v1/projects/${ref}`
const MODEL = process.env.VOICE_MODEL ?? 'gpt-realtime-2.1-mini'

// Confirm the model exists on this account before deploying something that
// depends on it. §4: model identifiers are configuration, and §13 requires
// re-verifying them against the live API immediately before Gate 1 — the
// deprecated gpt-realtime and gpt-realtime-mini are still listed today while
// being removed on 2027-01-20, so "it was in the docs" is not enough.
const models = await fetch('https://api.openai.com/v1/models', {
  headers: { Authorization: `Bearer ${openaiKey}` },
})
const ids = new Set(
  (((await models.json()) as { data: { id: string }[] }).data ?? []).map((m) => m.id),
)
if (!ids.has(MODEL)) {
  console.error(`${MODEL} is not available on this account. Realtime models present:`)
  for (const id of [...ids].filter((i) => i.includes('realtime')).sort()) {
    console.error(`  ${id}`)
  }
  process.exit(1)
}
console.log(`model verified present on this account: ${MODEL}`)

// The permanent key goes to the function's environment, never into the page.
const secrets = await fetch(`${api}/secrets`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify([
    { name: 'OPENAI_API_KEY', value: openaiKey },
    { name: 'VOICE_MODEL', value: MODEL },
  ]),
})
console.log(`function secrets set: http ${secrets.status}`)

async function deploy(slug: string): Promise<void> {
  const source = await readFile(`supabase/functions/${slug}/index.ts`, 'utf8')
  const form = new FormData()
  form.append(
    'metadata',
    JSON.stringify({ name: slug, entrypoint_path: 'index.ts', verify_jwt: false }),
  )
  form.append('file', new File([source], 'index.ts', { type: 'application/typescript' }))

  const response = await fetch(`${api}/functions/deploy?slug=${slug}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  const result = (await response.json()) as { version?: number; status?: string }
  if (!response.ok) {
    console.error(`deploy ${slug} failed: ${response.status} ${JSON.stringify(result)}`)
    process.exit(1)
  }
  console.log(`deployed ${slug} v${String(result.version)} ${String(result.status)}`)
}

await deploy('voice-token')
await deploy('voice')

const base = `https://${ref}.supabase.co/functions/v1`

// Prove the mint endpoint works end to end, and that it does NOT leak the
// permanent key — the check that actually matters here.
const mint = await fetch(`${base}/voice-token`, { method: 'POST' })
const minted = (await mint.json()) as {
  client_secret?: string
  model?: string
  expires_at?: number
}
const leaked = JSON.stringify(minted).includes(openaiKey)
console.log(
  `\nmint: http ${mint.status} model=${String(minted.model)} ` +
    `secret=${minted.client_secret === undefined ? 'MISSING' : `${minted.client_secret.slice(0, 3)}… (${String(minted.client_secret.length)} chars)`} ` +
    `expires_at=${String(minted.expires_at)}`,
)
console.log(`permanent key present in the response: ${leaked ? 'YES — ABORT' : 'no ✅'}`)
if (leaked) process.exit(1)

const page = await fetch(`${base}/voice`)
const html = await page.text()
console.log(
  `page: http ${page.status} ${String(html.length)} bytes, ` +
    `contains the permanent key: ${html.includes(openaiKey) ? 'YES — ABORT' : 'no ✅'}`,
)
if (html.includes(openaiKey)) process.exit(1)

console.log(`\nGate 1 POC ready:\n  ${base}/voice`)
console.log(
  '\nNote on access: both functions are unauthenticated, because Grant opens the\n' +
    'page in Safari with no Supabase session. That means anyone with the URL can\n' +
    'mint a session and spend money. Acceptable for a POC on an unadvertised URL,\n' +
    'and NOT acceptable beyond it — tracked in docs/parked/phase-2-hardening.md.',
)
