/**
 * Withdraw an MCP client's access.
 *
 *   npm run mcp:revoke -- --list
 *   npm run mcp:revoke -- --client=chatgpt "no longer needed"
 *
 * The reason one token per client exists (ADR-0014, 0064): this must be able to
 * lock out ChatGPT without touching Claude. §17's rule applies — an integration
 * can be turned off, with a reason, and the reason is stored rather than
 * remembered.
 *
 * Disabled, not deleted. A deleted client takes its call history with it, and
 * "what did that client read before we cut it off" is the question you ask
 * precisely when you have just cut something off.
 */

import '../../src/safety/require-production-writes.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const supabase = process.env.SUPABASE_ACCESS_TOKEN
if (supabase === undefined || supabase === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  supabase,
)
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

const rows = (
  await db.execute(`
    select client_id, display_name, enabled, disabled_reason, calls,
           last_seen_at::text as last_seen_at
      from public.mcp_clients order by client_id
  `)
).rows as {
  client_id: string
  display_name: string
  enabled: boolean
  disabled_reason: string | null
  calls: number
  last_seen_at: string | null
}[]

const arg = process.argv.find((a) => a.startsWith('--client='))
if (arg === undefined) {
  console.log('| | client | name | calls | last seen |')
  console.log('|---|---|---|---|---|')
  for (const r of rows) {
    console.log(
      `| ${r.enabled ? '✅' : '⛔'} | ${r.client_id} | ${r.display_name} | ${String(r.calls)} | ` +
        `${r.last_seen_at ?? 'never'}${r.enabled ? '' : ` — ${String(r.disabled_reason)}`} |`,
    )
  }
  console.log('\nRevoke with: npm run mcp:revoke -- --client=<id> "why"')
  process.exit(0)
}

const clientId = arg.slice('--client='.length)
const reason = process.argv
  .filter((a) => !a.startsWith('--'))
  .slice(2)
  .join(' ')
if (reason === '') {
  // §17: off, with a reason. A kill switch whose reason is optional is a kill
  // switch whose reason is usually absent, and six months later nobody knows
  // whether it was a decision or an accident.
  console.error('a reason is required: npm run mcp:revoke -- --client=<id> "why"')
  process.exit(2)
}

if (!rows.some((r) => r.client_id === clientId)) {
  console.error(`no such client: ${clientId}. Run with --list to see them.`)
  process.exit(1)
}

await db.execute(`
  update public.mcp_clients
     set enabled = false, disabled_reason = ${lit(reason)}
   where client_id = ${lit(clientId)}
`)

// Verified by asking, not by assuming the update did what it said.
const after = (
  await db.execute(
    `select client_id from app.mcp_client_for(
       (select token_sha256 from public.mcp_clients where client_id = ${lit(clientId)}))`,
  )
).rows
console.log(
  after.length === 0
    ? `✅ ${clientId} revoked — its token no longer resolves. History kept.`
    : `❌ ${clientId} still resolves; the revocation did not take`,
)
if (after.length > 0) process.exit(1)
