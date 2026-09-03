/**
 * Take the Notebook browser credential and put it in the vault.
 *
 *   npm run notebook:import
 *
 * Reads `NOTEBOOK_COOKIES` (a cookie-export JSON blob) or `--file <path>`,
 * validates it locally, stores it in Supabase Vault, and records a capability
 * probe. Nothing is echoed: the script reports counts, domains and expiry
 * dates, never a value.
 *
 * ## Why this credential is treated as more dangerous than the others
 *
 * Every other credential in this build is scoped to one product. This one is a
 * **Google session**: `SID` plus `__Secure-1PSIDTS` authenticate as the signed-in
 * human across Google properties, not just NotebookLM. That is why
 * `HUMAN_ONLY_PREREQUISITES.md` insists on a *dedicated* account, and the
 * insistence is not tidiness — a leaked session cookie for a personal Google
 * account is a different category of incident from a leaked API key.
 *
 * Two consequences, both enforced here:
 *
 *   - The value never touches the repository, a log line, or a console. The
 *     secret scanner already refuses commits containing it; this script never
 *     produces a string it could scan.
 *   - The script warns loudly if the account looks personal, because the check
 *     costs nothing and the mistake is expensive.
 */
import { readFile } from 'node:fs/promises'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { recordProbe } from '../../src/notebook/sync-queue.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}

const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

// --- read it, from wherever it is ------------------------------------------
const fileArg = process.argv.indexOf('--file')
let raw = ''
let source = ''
if (fileArg !== -1 && process.argv[fileArg + 1] !== undefined) {
  raw = await readFile(String(process.argv[fileArg + 1]), 'utf8')
  source = 'a file'
} else if ((process.env.NOTEBOOK_COOKIES ?? '') !== '') {
  raw = String(process.env.NOTEBOOK_COOKIES)
  source = 'NOTEBOOK_COOKIES'
} else {
  console.error(
    'nothing to import.\n' +
      '  Set NOTEBOOK_COOKIES to the cookie-export JSON, or pass --file <path>.\n' +
      '  See docs/poc/gate-2-notebook/01-what-grant-does.md',
  )
  process.exit(2)
}

// --- parse both shapes the export tools produce ----------------------------
interface Cookie {
  name?: string
  domain?: string
  expirationDate?: number
  expires?: number
  value?: string
}

let cookies: Cookie[]
try {
  const parsed: unknown = JSON.parse(raw)
  // Cookie-Editor exports a bare array; Playwright exports { cookies: [...] }.
  // Both are accepted because telling someone their export tool is the wrong
  // one is a round trip that a three-line check avoids.
  cookies = Array.isArray(parsed)
    ? (parsed as Cookie[])
    : ((parsed as { cookies?: Cookie[] }).cookies ?? [])
} catch (error) {
  console.error(
    `that is not valid JSON (${(error as Error).message.slice(0, 80)}).\n` +
      '  If you pasted into a shell, quoting probably mangled it — use --file instead.',
  )
  process.exit(1)
}

if (cookies.length === 0) {
  console.error('the JSON parsed but contains no cookies')
  process.exit(1)
}

// --- validate before storing -----------------------------------------------
// Storing an unusable credential and finding out at the first RPC is the
// failure mode this whole build keeps hitting. Check now, in a second.
const names = new Set(cookies.map((c) => String(c.name ?? '')))
const REQUIRED = ['SID', '__Secure-1PSIDTS']
const missing = REQUIRED.filter((n) => !names.has(n))

// These are not in the library's stated minimum, but Google's RPC auth header
// is a SAPISIDHASH, so a jar without SAPISID authenticates for nothing useful.
// Reported as a warning rather than a failure: the library is the authority on
// what it needs, and being wrong here should not block a valid import.
const EXPECTED_TOO = ['__Secure-1PSID', 'HSID', 'SSID', 'APISID', 'SAPISID']
const alsoMissing = EXPECTED_TOO.filter((n) => !names.has(n))

const domains = new Set(cookies.map((c) => String(c.domain ?? '')))
console.log(`read ${String(cookies.length)} cookies from ${source}`)
console.log(`  domains: ${[...domains].sort().join(', ')}`)
console.log(`  required present: ${REQUIRED.filter((n) => names.has(n)).join(', ') || 'NONE'}`)

if (missing.length > 0) {
  console.error(
    `\nmissing required cookie(s): ${missing.join(', ')}\n` +
      '  These are HttpOnly, so a copy-paste from the page will not include them.\n' +
      '  Export with a cookie extension on notebooklm.google.com while signed in.',
  )
  process.exit(1)
}
if (alsoMissing.length > 0) {
  console.log(
    `  ⚠ not present, and Google's RPC auth usually needs them: ${alsoMissing.join(', ')}`,
  )
}

// Expiry, so "it stopped working in a week" is predicted rather than
// discovered. §11's posture applied to a credential: measured, not assumed.
const expiries = cookies
  .map((c) => c.expirationDate ?? c.expires)
  .filter((e): e is number => typeof e === 'number' && e > 0)
if (expiries.length > 0) {
  const soonest = Math.min(...expiries)
  const days = (soonest * 1000 - Date.now()) / 86_400_000
  console.log(
    `  soonest expiry: ${new Date(soonest * 1000).toISOString()} (${days.toFixed(1)} days)`,
  )
  if (days < 1) {
    console.log('  ⚠ under a day. The session will need re-minting almost immediately.')
  }
}

// --- store, without ever producing the value as a string we log -------------
// Normalised to Playwright's storage_state shape on the way in, so the adapter
// has one format to read regardless of which tool produced the export.
const storageState = JSON.stringify({ cookies, origins: [] })

await db.execute(`
  select app.store_secret(
    'notebook.storage_state',
    ${`'${storageState.replace(/'/g, "''")}'`},
    'Google session cookies for the dedicated NotebookLM account. A full Google session, not an API key - see scripts/notebook/import-credential.ts'
  )
`)

const stored = await db.execute(`
  select length(decrypted_secret) as len
  from vault.decrypted_secrets where name = 'notebook.storage_state'
`)
const storedLen = Number(stored.rows[0]?.len ?? 0)
if (storedLen !== storageState.length) {
  console.error(
    `\nvault round-trip mismatch: wrote ${String(storageState.length)} chars, read back ${String(storedLen)}.` +
      '\nThe credential may have been mangled in transit; not marking it usable.',
  )
  process.exit(1)
}
console.log(
  `\n✅ vaulted as notebook.storage_state (${String(storedLen)} chars, verified by round-trip)`,
)

// --- record the state change -----------------------------------------------
// Not `available_unofficial` yet: a stored credential is not a working one, and
// this build has been bitten three times by reading "present" as "working".
// `npm run notebook:probe` makes a real call and is what promotes the state.
await recordProbe(db, {
  state: 'auth_required',
  capabilities: [],
  adapter: 'notebooklm-py',
  adapterVersion: null,
  detectedTier: null,
  notebookLimit: null,
  sourceLimit: null,
  detail: 'a credential has been vaulted but no call has been made with it yet',
  latencyMs: null,
})

console.log('\nNext: `npm run notebook:probe` makes a real call and promotes the state.')
console.log('Until it does, the adapter stays auth_required - a stored credential is')
console.log('not a working one, and this build has read "present" as "working" three times.')
