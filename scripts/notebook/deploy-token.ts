/**
 * Deploy a durable `master_token.json` and mint a cookie jar from it.
 *
 *   npm run notebook:deploy
 *
 * Reads `NOTEBOOK_MASTER_TOKEN_JSON` — the exact contents of the
 * `master_token.json` that `notebooklm login --master-token` produced on
 * Grant's workstation — writes it to the profile at mode 0600, mints
 * `storage_state.json` from it, verifies with the library's own check, and
 * vaults both.
 *
 * ## Why this replaces the oauth_token relay
 *
 * The relay worked, twice, and I destroyed the result both times: once by
 * deleting the minted files on an error path, once by discarding them on the
 * verdict of a liveness check I had written badly. Each mistake cost Grant a
 * fresh sign-in, because an EmbeddedSetup `oauth_token` is single-use.
 *
 * Grant then asked whether the upstream repository documented a way to do
 * this. It does, and it is this one — `notebooklm-py`'s bundled `SKILL.md`:
 *
 *   > For unattended or headless work, prefer durable profile-backed
 *   > master-token auth over a copied cookie snapshot. On a trusted
 *   > workstation run `notebooklm login --master-token --account <email>`,
 *   > then deploy `master_token.json`, not `storage_state.json`.
 *   >
 *   > In CI, `NOTEBOOKLM_MASTER_TOKEN_JSON` is a secret-transport convention.
 *   > Write its exact value to the selected profile's `master_token.json` with
 *   > mode `0600`, unset it, then run `notebooklm auth refresh` to mint
 *   > `storage_state.json`.
 *
 * The decisive property is not that it is documented. It is that
 * **`master_token.json` is durable**, so a mistake on this side costs a
 * re-paste of a file Grant already has, not another interactive sign-in. The
 * relay made every bug of mine expensive for him; this makes them cheap.
 *
 * That is the useful lesson from two burned tokens: when a step is expensive
 * to repeat, the fix is not to be more careful with it — it is to find the
 * version of the step that is cheap to repeat.
 */
import '../../src/safety/require-production-writes.ts'
import { execFile } from 'node:child_process'
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { operatorOffice } from '../../src/db/office.ts'
import { recordProbe } from '../../src/notebook/sync-queue.ts'

const run = promisify(execFile)

const supabase = process.env.SUPABASE_ACCESS_TOKEN
if (supabase === undefined || supabase === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}

const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  supabase,
)

// The token JSON, from the environment or from the vault on a re-run. Reading
// the vault as a fallback means a redeploy after a container restart needs
// nothing from Grant at all.
let tokenJson = (process.env.NOTEBOOK_MASTER_TOKEN_JSON ?? '').trim()
let source = 'NOTEBOOK_MASTER_TOKEN_JSON'
if (tokenJson === '') {
  const vaulted = await db.execute(
    `select decrypted_secret as v from vault.decrypted_secrets where name = 'notebook.master_token_json'`,
  )
  tokenJson = vaulted.rows[0]?.v === undefined ? '' : String(vaulted.rows[0].v)
  source = 'the vault'
}
if (tokenJson === '') {
  console.error(
    'nothing to deploy.\n' +
      '  Set NOTEBOOK_MASTER_TOKEN_JSON to the contents of the master_token.json\n' +
      '  that `notebooklm login --master-token --account <email>` produced.\n' +
      '  See docs/poc/gate-2-notebook/01-what-grant-does.md',
  )
  process.exit(2)
}

// Validate the shape before writing it anywhere. A wrong paste caught here is
// a one-line message; caught later it is a confusing library error.
interface TokenRecord {
  master_token?: unknown
  android_id?: unknown
  email?: unknown
  account?: unknown
  version?: unknown
}
let record: TokenRecord
try {
  record = JSON.parse(tokenJson) as TokenRecord
} catch (error) {
  console.error(
    `that is not valid JSON (${(error as Error).message.slice(0, 100)}).\n` +
      '  Paste the whole file, including the outer braces.',
  )
  process.exit(1)
}
const masterToken = typeof record.master_token === 'string' ? record.master_token : ''
if (!masterToken.startsWith('aas_et/')) {
  console.error(
    'this JSON has no `master_token` starting with `aas_et/`.\n' +
      '  It may be a storage_state.json (the cookie jar) rather than the\n' +
      '  master_token.json. SKILL.md is explicit that it is the latter that\n' +
      '  gets deployed.',
  )
  process.exit(1)
}
const account =
  typeof record.email === 'string'
    ? record.email
    : typeof record.account === 'string'
      ? record.account
      : 'unknown'
console.log(`read a master token from ${source} for ${account}`)
console.log(
  `  token ${String(masterToken.length)} chars, android_id ${record.android_id === undefined ? 'absent' : 'present'}`,
)

// --- write it to the profile the library reads ----------------------------
// NOTEBOOKLM_HOME is set explicitly rather than relying on the default under
// $HOME: this process should not depend on which user it runs as, and the
// path is needed again below for the vault read-back.
const home = process.env.NOTEBOOKLM_HOME ?? join(homedir(), '.notebooklm')
const profile = process.env.NOTEBOOKLM_PROFILE ?? 'default'
const profileDir = join(home, 'profiles', profile)
const tokenPath = join(profileDir, 'master_token.json')
const storagePath = join(profileDir, 'storage_state.json')

await mkdir(profileDir, { recursive: true })
await writeFile(tokenPath, tokenJson, { mode: 0o600 })
await chmod(tokenPath, 0o600)
console.log(`  wrote ${tokenPath} (0600)`)

// --- vault it BEFORE doing anything that can fail -------------------------
// The order is the whole point. Two credentials have already been lost by
// minting first and storing only after something else approved of them.
// Storing first costs nothing and makes every later failure recoverable.
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
await db.execute(`
  select app.store_secret('notebook.master_token_json', ${lit(tokenJson)},
    'Durable master_token.json for the dedicated NotebookLM account, as produced by: notebooklm login --master-token. Full-account and long-lived - dedicated account only. Re-mints the cookie jar without a browser.')
`)
console.log('  vaulted as notebook.master_token_json')

// --- mint the cookie jar --------------------------------------------------
// `auth refresh` is what SKILL.md prescribes: it exercises the auth path once
// and persists the rotated jar. The env var is deliberately NOT passed to the
// child - SKILL.md says to unset it after writing the file, because the
// inline fast path bypasses the master-token recovery this whole design
// depends on.
const childEnv: Record<string, string | undefined> = {
  ...process.env,
  NOTEBOOKLM_HOME: home,
  NOTEBOOKLM_PROFILE: profile,
}
for (const name of [
  'NOTEBOOK_MASTER_TOKEN_JSON',
  'NOTEBOOKLM_MASTER_TOKEN_JSON',
  'NOTEBOOKLM_AUTH_JSON',
]) {
  delete childEnv[name]
}

const cli = async (args: string[]): Promise<{ code: number; out: string }> => {
  try {
    const { stdout, stderr } = await run('python3', ['-m', 'notebooklm', ...args], {
      env: childEnv,
      maxBuffer: 8 * 1024 * 1024,
      timeout: 180_000,
    })
    return { code: 0, out: `${stdout}${stderr}` }
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string; message?: string }
    return {
      code: typeof e.code === 'number' ? e.code : 1,
      out: `${e.stdout ?? ''}${e.stderr ?? ''}${e.message ?? ''}`,
    }
  }
}

const refresh = await cli(['auth', 'refresh'])
console.log(`\nauth refresh: exit ${String(refresh.code)}`)
if (refresh.out.trim() !== '') {
  console.log(
    refresh.out
      .trim()
      .split('\n')
      .slice(-6)
      .map((l) => `  ${l}`)
      .join('\n'),
  )
}

// --- verify, with the library's own check and its documented criteria -----
// SKILL.md: "Before a workflow, verify real authentication rather than merely
// parsing the cookie file: notebooklm auth check --test --json. Require
// .status == 'ok' and .checks.token_fetch == true."
//
// Using the library's check rather than a hand-rolled request is the other
// correction from this episode. My own version rejected a jar the library had
// already verified, and the bootstrap threw a good credential away on it.
// When a dependency ships a way to answer a question about itself, an
// approximation alongside it is not a second opinion but a worse first one.
const check = await cli(['auth', 'check', '--test', '--json'])
let status = ''
let tokenFetch: boolean | null = null
let email = ''
try {
  // The whole object, not "the last line starting with {". `auth check --json`
  // pretty-prints, so its last line is `}` and its first is `{` - a line-based
  // heuristic finds the opening brace and tries to parse one character. That
  // is what "unparseable" meant on the first run, while the output it had just
  // discarded said notebook_count: 3.
  const text = check.out
  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  const jsonText = first !== -1 && last > first ? text.slice(first, last + 1) : ''
  const parsed = JSON.parse(jsonText) as {
    status?: string
    checks?: { token_fetch?: boolean }
    account?: { email?: string }
    email?: string
  }
  status = String(parsed.status ?? '')
  tokenFetch = parsed.checks?.token_fetch ?? null
  email = String(parsed.account?.email ?? parsed.email ?? '')
} catch {
  status = `unparseable (exit ${String(check.code)})`
}

console.log(`\nauth check: status=${status || 'unknown'} token_fetch=${String(tokenFetch)}`)
if (email !== '') console.log(`  account: ${email}`)
if (status !== 'ok' || tokenFetch !== true) {
  console.log(
    check.out
      .trim()
      .split('\n')
      .slice(-10)
      .map((l) => `  ${l}`)
      .join('\n'),
  )
}

// --- vault the minted jar, if there is one --------------------------------
let jarStored = false
try {
  const jar = await readFile(storagePath, 'utf8')
  await db.execute(`
    select app.store_secret('notebook.storage_state', ${lit(jar)},
      'NotebookLM cookie jar minted from the master token. Re-mintable without a browser via: notebooklm auth refresh')
  `)
  console.log(`\nvaulted the minted cookie jar (${String(jar.length)} chars)`)
  jarStored = true
} catch {
  console.log('\nno storage_state.json was minted, so no cookie jar was vaulted.')
}

// The local copies are removed now that both are in the vault. This is safe in
// a way the earlier cleanup was not: nothing here is single-use, and the
// master token is already stored.
await rm(tokenPath, { force: true })
await rm(storagePath, { force: true })

const ok = status === 'ok' && tokenFetch === true && jarStored
await recordProbe(
  db,
  {
    state: ok ? 'available_unofficial' : 'auth_required',
    capabilities: ok ? ['auth_check'] : [],
    adapter: 'notebooklm-py',
    adapterVersion: null,
    detectedTier: null,
    notebookLimit: null,
    sourceLimit: null,
    detail: ok
      ? `notebooklm auth check --test reported status=ok, token_fetch=true for ${email || account}`
      : `auth check did not pass: status=${status || 'unknown'}, token_fetch=${String(tokenFetch)}`,
    latencyMs: null,
  },
  await operatorOffice(db, process.env.OFFICE_ID),
)

if (!ok) {
  console.error('\n⛔ the credential is vaulted but did not verify. Nothing has been enabled.')
  console.error('   The master token is stored, so retrying needs nothing from Grant.')
  process.exit(1)
}

console.log('\n✅ authenticated. Next: `npm run notebook:probe`, then `npm run poc:gate-2`.')
