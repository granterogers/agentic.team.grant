/**
 * Deploy ONLY the hq-api function (no page, no token rotation), with the files it imports, and probe it.
 *
 *   npm run deploy:hq-api
 *
 * `deploy:hq` does the same upload and then redeploys the page; a gateway change needs the first and not the second. The
 * entrypoint imports ./file-text.ts (#419), so both files go up together, as the Telegram deploy does with its adapter.
 */
import { readFile } from 'node:fs/promises'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const supabaseToken = process.env.SUPABASE_ACCESS_TOKEN ?? ''
if (supabaseToken === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const db = new ManagementApiExecutor(ref, supabaseToken)

const form = new FormData()
form.append(
  'metadata',
  JSON.stringify({ name: 'hq-api', entrypoint_path: 'index.ts', verify_jwt: false }),
)
form.append(
  'file',
  new File([await readFile('supabase/functions/hq-api/index.ts', 'utf8')], 'index.ts', {
    type: 'application/typescript',
  }),
)
form.append(
  'file',
  new File([await readFile('src/text/file-text.ts', 'utf8')], 'file-text.ts', {
    type: 'application/typescript',
  }),
)
const deployed = await fetch(
  `https://api.supabase.com/v1/projects/${ref}/functions/deploy?slug=hq-api`,
  { method: 'POST', headers: { Authorization: `Bearer ${supabaseToken}` }, body: form },
)
const result = (await deployed.json()) as { version?: number; status?: string }
if (!deployed.ok) {
  console.error(`deploy failed: http ${String(deployed.status)} ${JSON.stringify(result)}`)
  process.exit(1)
}
console.log(`hq-api v${String(result.version)} ${String(result.status)}`)

// Probe: unauthenticated is refused, authenticated answers. Cold start is forgiven twice, as in deploy:hq.
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
for (let go = 0; go < 3; go += 1) {
  unauth = (await fetch(`${endpoint}?section=overview`)).status
  const r = await fetch(`${endpoint}?section=overview`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  authed = r.status
  if (unauth === 401 && authed === 200) break
  await new Promise((res) => setTimeout(res, 1500))
}
console.log(
  `  unauthenticated http ${String(unauth)} (must be 401); authenticated http ${String(authed)} (must be 200)`,
)
if (unauth !== 401 || authed !== 200) process.exit(1)
