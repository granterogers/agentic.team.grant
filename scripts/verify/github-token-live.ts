/**
 * Is a stored GitHub token still live?
 *
 *   npx tsx scripts/verify/github-token-live.ts
 *
 * Issue #18 asked Grant to rotate a PAT that was pasted into a chat
 * transcript. He checked https://github.com/settings/tokens, found the list
 * empty, and reasonably concluded there was nothing to rotate. That page is
 * **Tokens (classic)**; both of this repository's tokens are FINE-GRAINED and
 * live at https://github.com/settings/personal-access-tokens — a different
 * list. Neither of us can settle it by looking at the wrong page, and asking
 * him to go and look at the right one is the manual step §31A calls a design
 * failure.
 *
 * So ask GitHub instead. This resolves each stored token from the vault, calls
 * `GET /user`, and reports live or dead.
 *
 * It NEVER prints a token, a fragment of one, or its length. The only output
 * is the credential's name and whether GitHub still accepts it.
 */

import type { SqlExecutor } from '../../src/db/executor.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const accessToken = process.env.SUPABASE_ACCESS_TOKEN
if (accessToken === undefined || accessToken === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(2)
}
const db: SqlExecutor = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  accessToken,
)

const NAMES = ['github.read_token', 'github.token', 'github.dispatch_token'] as const

const { rows } = await db.execute(`
  select name, decrypted_secret as t
    from vault.decrypted_secrets
   where name in (${NAMES.map((n) => `'${n}'`).join(', ')})
`)

const held = new Map(
  (rows as { name: string; t: string }[]).map((r) => [String(r.name), String(r.t)]),
)

let anyLive = false

for (const name of NAMES) {
  const token = held.get(name)
  if (token === undefined || token === '') {
    console.log(`  ${name.padEnd(24)} not stored`)
    continue
  }
  let verdict: string
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'user-agent': 'agentic-team-hq-token-check',
      },
    })
    if (res.status === 401) {
      verdict = 'DEAD — GitHub returns 401. Revoked or expired.'
    } else if (res.ok) {
      anyLive = true
      // The login is Grant's own username, not a secret, and naming it is how
      // he knows which account to go and revoke on.
      const who = ((await res.json()) as { login?: string }).login ?? 'unknown'
      verdict = `LIVE — authenticates as ${who}`
    } else {
      verdict = `inconclusive — HTTP ${String(res.status)}`
    }
  } catch (e) {
    verdict = `could not reach GitHub: ${e instanceof Error ? e.message : String(e)}`
  }
  console.log(`  ${name.padEnd(24)} ${verdict}`)
}

console.log(
  anyLive
    ? '\nAt least one stored token still authenticates.'
    : '\nNo stored token authenticates. Nothing to rotate.',
)
