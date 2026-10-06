/**
 * Deploy hq-api from a STAGED folder instead of the working tree, and probe it.
 *
 *   npx tsx scripts/deploy/hq-function-staged.ts .out/stage/hq-api          # dry run: what would go up, and how it differs from live
 *   npx tsx scripts/deploy/hq-function-staged.ts .out/stage/hq-api --go     # upload, then probe
 *
 * Why this exists: `deploy:hq-api` ships the working tree's `index.ts`, `file-text.ts` and `oauth.ts`, and on 5 October the
 * working tree held the Slack self-service gateway changes that are deliberately NOT deployed. A deploy of the tree would
 * have shipped them. The staged folder is the LIVE source (recovered from the function's own source map) plus only the change
 * being shipped, so the diff against live is the change and nothing else.
 *
 * The dry run recovers the live source the same way and prints the differences by line count; it refuses to continue when
 * the staged folder has a file the live bundle does not (an extra import would be new code nobody reviewed).
 */
import '../../src/safety/require-production-checks.ts'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const dir = process.argv[2] ?? ''
const go = process.argv.includes('--go')
if (dir === '') {
  console.error('usage: hq-function-staged.ts <staged folder> [--go]')
  process.exit(2)
}
const supabaseToken = process.env.SUPABASE_ACCESS_TOKEN ?? ''
if (supabaseToken === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const api = `https://api.supabase.com/v1/projects/${ref}`
const db = new ManagementApiExecutor(ref, supabaseToken)
const auth = { Authorization: `Bearer ${supabaseToken}` }

const files = ['index.ts', 'file-text.ts']
const staged = Object.fromEntries(
  await Promise.all(files.map(async (f) => [f, await readFile(`${dir}/${f}`, 'utf8')])),
)

// The live sources, from the source map the bundle carries (the bundle holds transpiled code; the map holds the original).
const meta = (await (await fetch(`${api}/functions/hq-api`, { headers: auth })).json()) as {
  version?: number
}
const body = Buffer.from(
  await (await fetch(`${api}/functions/hq-api/body`, { headers: auth })).arrayBuffer(),
).toString('utf8')
const live: Record<string, string> = {}
for (const m of body.matchAll(/"sources":(\[[^\]]*\]),"sourcesContent":\[/g)) {
  const names = JSON.parse(m[1] as string) as string[]
  const open = (m.index ?? 0) + m[0].length - 1
  let depth = 0
  let inStr = false
  let esc = false
  let j = open
  for (; j < body.length; j += 1) {
    const c = body[j]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === '[') depth += 1
    else if (c === ']') {
      depth -= 1
      if (depth === 0) break
    }
  }
  const contents = JSON.parse(body.slice(open, j + 1)) as string[]
  names.forEach((n, i) => {
    live[String(n).split('/').pop() ?? n] = contents[i] ?? ''
  })
}
console.log(
  `live hq-api v${String(meta.version)}: ${Object.keys(live).join(', ') || '(no sources recovered)'}`,
)
if (Object.keys(live).length === 0) {
  console.error('could not recover the live source, so the difference cannot be shown: refusing')
  process.exit(1)
}
for (const f of Object.keys(staged)) {
  if (live[f] === undefined) {
    console.error(
      `${f} is in the staged folder and not in the live bundle: refusing (new code nobody reviewed)`,
    )
    process.exit(1)
  }
  const a = (live[f] as string).split('\n')
  const b = (staged[f] as string).split('\n')
  const set = new Set(a)
  const added = b.filter((l) => !set.has(l)).length
  const removed = a.filter((l) => !new Set(b).has(l)).length
  console.log(
    `  ${f}: live ${String(a.length)} lines, staged ${String(b.length)}; ${String(added)} line(s) new, ${String(removed)} line(s) gone`,
  )
}
// --save-live=<dir> writes the recovered LIVE source there (outside git): those bytes are the rollback, deployed back with this same tool.
const saveLive = process.argv
  .find((a) => a.startsWith('--save-live='))
  ?.slice('--save-live='.length)
if (saveLive !== undefined) {
  await mkdir(saveLive, { recursive: true })
  for (const f of files) await writeFile(`${saveLive}/${f}`, live[f] as string)
  console.log(`live source of v${String(meta.version)} saved to ${saveLive} (the rollback)`)
}
if (!go) {
  console.log('dry run: nothing uploaded. Pass --go to deploy.')
  process.exit(0)
}
// A deploy is a production WRITE: the writes guard, and a healthy canary, come before anything is uploaded.
await import('../../src/safety/require-production-writes.ts')
{
  const { canaryPrecondition, fetchProviderHealth } = await import('../../src/safety/canary.ts')
  const verdict = await canaryPrecondition({
    readHealth: () => fetchProviderHealth(ref, supabaseToken),
    readRows: async (sql: string) => (await db.execute(sql)).rows as Record<string, unknown>[],
    sleep: (ms: number) => new Promise((r) => setTimeout(r, ms)),
  })
  for (const c of verdict.checks) console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}: ${c.detail}`)
  if (!verdict.go) {
    console.error(`NO-GO: ${verdict.reasons.join('; ')} Nothing was uploaded.`)
    process.exit(1)
  }
}

const form = new FormData()
form.append(
  'metadata',
  JSON.stringify({ name: 'hq-api', entrypoint_path: 'index.ts', verify_jwt: false }),
)
for (const f of files)
  form.append('file', new File([staged[f] as string], f, { type: 'application/typescript' }))
const deployed = await fetch(`${api}/functions/deploy?slug=hq-api`, {
  method: 'POST',
  headers: auth,
  body: form,
})
const result = (await deployed.json()) as { version?: number; status?: string }
if (!deployed.ok) {
  console.error(`deploy failed: http ${String(deployed.status)} ${JSON.stringify(result)}`)
  process.exit(1)
}
console.log(
  `hq-api v${String(result.version)} ${String(result.status)} (previous v${String(meta.version)})`,
)

const token = String(
  (
    await db.execute(
      `select decrypted_secret as v from vault.decrypted_secrets where name = 'hq.api_token'`,
    )
  ).rows[0]?.v ?? '',
)
const endpoint = `https://${ref}.supabase.co/functions/v1/hq-api`
let unauth = 0
let authed = 0
for (let n = 0; n < 3; n += 1) {
  unauth = (await fetch(`${endpoint}?section=overview`)).status
  authed = (
    await fetch(`${endpoint}?section=overview`, { headers: { Authorization: `Bearer ${token}` } })
  ).status
  if (unauth === 401 && authed === 200) break
  await new Promise((res) => setTimeout(res, 1500))
}
console.log(
  `  unauthenticated http ${String(unauth)} (must be 401); authenticated http ${String(authed)} (must be 200)`,
)
if (unauth !== 401 || authed !== 200) process.exit(1)

// The `thinking` section answers with the `cannot_think` key under BOTH gateways (the old one serves the whole health reading, which
// carries that key; the new one serves only it), so this probe is valid before and after the change and after a rollback.
if (process.argv.includes('--probe-thinking')) {
  const r = await fetch(`${endpoint}?section=thinking`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const j = (await r.json().catch(() => ({}))) as { data?: Record<string, unknown> }
  const has = Array.isArray(j.data?.cannot_think)
  console.log(
    `  thinking section: http ${String(r.status)}, cannot_think list present: ${String(has)} (must be 200 and true)`,
  )
  if (r.status !== 200 || !has) process.exit(1)
}
