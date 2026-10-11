/**
 * Deploy the engine gateway (Hermes, M2).
 *
 *   npm run deploy:engine
 *
 * It uploads supabase/functions/engine with its import graph (the bundle is built and checked FIRST, locally, before anything is
 * sent anywhere), then verifies the deployed function by what it ANSWERS, not by a status code: liveness open and naming nothing, an
 * absent credential and an unknown credential both refused 401, and an unknown path 404. It creates no credential, changes no
 * setting and switches nothing on; a bridge is minted by `npm run engine:bridge-credential`, and Hermes stays off for every office
 * until engine.hermes.offices names it.
 *
 * Migration 1070 must already be applied for a bridge to authenticate; with it absent every authenticated call answers 503, which is
 * the correct and visible state, and the probe below only asserts what holds either way.
 */
import '../../src/safety/require-production-writes.ts'
import { prepareBundle } from './lib/bundle.ts'

const supabaseToken = process.env.SUPABASE_ACCESS_TOKEN
if (supabaseToken === undefined || supabaseToken === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const api = `https://api.supabase.com/v1/projects/${ref}`

// Everything that can be known locally is known before a single production write.
const bundle = await prepareBundle('engine', 'supabase/functions/engine/index.ts')
console.log(`engine: bundled ${String(bundle.files.size)} file(s) from the import graph`)

const deployed = await fetch(`${api}/functions/deploy?slug=engine`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${supabaseToken}` },
  body: bundle.form,
})
const result = (await deployed.json()) as { version?: number; status?: string }
if (!deployed.ok) {
  console.error(`deploy failed: http ${String(deployed.status)} ${JSON.stringify(result)}`)
  process.exit(1)
}
const endpoint = `https://${ref}.supabase.co/functions/v1/engine`
console.log(`engine v${String(result.version)} ${String(result.status)} - ${endpoint}`)

// --- verify, by its answers ---------------------------------------------------
const probe = async (
  label: string,
  url: string,
  init: RequestInit,
  want: number,
): Promise<boolean> => {
  const r = await fetch(url, init)
  const text = await r.text()
  const ok = r.status === want
  console.log(
    `  ${label}: http ${String(r.status)} (must be ${String(want)})${ok ? '' : ` ${text.slice(0, 120)}`}`,
  )
  return ok
}
const json = { 'content-type': 'application/json' }
const checks = [
  await probe('liveness', `${endpoint}/health`, {}, 200),
  await probe(
    'no credential',
    `${endpoint}/claim`,
    { method: 'POST', headers: json, body: '{}' },
    401,
  ),
  await probe(
    'unknown credential',
    `${endpoint}/claim`,
    // Assembled from pieces so no credential-shaped literal sits in the repository.
    {
      method: 'POST',
      headers: { ...json, authorization: `Bearer ${'ebt'}_${'0'.repeat(64)}` },
      body: '{}',
    },
    401,
  ),
  await probe(
    'unknown path',
    `${endpoint}/proposal`,
    { method: 'POST', headers: json, body: '{}' },
    404,
  ),
]
const health = (await (await fetch(`${endpoint}/health`)).json()) as Record<string, unknown>
const leaks = Object.keys(health).filter((k) => k !== 'ok')
console.log(
  `  liveness names nothing: ${leaks.length === 0 ? 'yes' : `NO - it also says ${leaks.join(', ')}`}`,
)
if (checks.includes(false) || leaks.length > 0) {
  console.error('the engine gateway did not behave as required')
  process.exit(1)
}
console.log(
  'engine gateway verified. Hermes is still OFF for every office until engine.hermes.offices names one.',
)
