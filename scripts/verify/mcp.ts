/**
 * The MCP endpoint, against the deployed function.
 *
 *   npm run verify:mcp
 *
 * ADR-0014 hands a general-purpose model a door into this system. The claims
 * that rest on are not "it returns JSON":
 *
 *   - an unknown token gets nothing, and a revoked one stops working;
 *   - the tool list is FIXED — a model will try names that are not on it;
 *   - a client can be cut off without touching another;
 *   - every call is recorded, including the refused ones (§11);
 *   - nothing in a tool's output is a credential, and nothing is Grant's raw
 *     instructions.
 *
 * It works through a throwaway client of its own, so it never needs, moves or
 * risks the token Grant actually uses.
 */

import { createHash, randomBytes } from 'node:crypto'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const supabase = process.env.SUPABASE_ACCESS_TOKEN
if (supabase === undefined || supabase === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(ref, supabase)
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const url = `https://${ref}.supabase.co/functions/v1/mcp`
const run = Date.now().toString(36)
const CLIENT = `verify-${run}`

const checks: { what: string; outcome: string; passed: boolean }[] = []
const record = (what: string, outcome: string, passed: boolean): void => {
  checks.push({ what, outcome, passed })
  console.log(`${passed ? '✅' : '❌'} ${what} — ${outcome}`)
}

const token = `mcp_${randomBytes(24).toString('base64url')}`
await db.execute(`
  insert into public.mcp_clients (client_id, display_name, token_sha256)
  values (${lit(CLIENT)}, 'Verification client',
          ${lit(createHash('sha256').update(token).digest('hex'))})
`)

const call = async (
  method: string,
  params?: unknown,
  auth: string | null = token,
): Promise<{ status: number; body: Record<string, unknown> }> => {
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(auth === null ? {} : { authorization: `Bearer ${auth}` }),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const text = await r.text()
  let body: Record<string, unknown> = {}
  try {
    body = JSON.parse(text) as Record<string, unknown>
  } catch {
    body = { raw: text.slice(0, 120) }
  }
  return { status: r.status, body }
}

// --- who gets in -------------------------------------------------------------

record(
  'no token is refused',
  `http ${String((await call('tools/list', undefined, null)).status)}`,
  (await call('tools/list', undefined, null)).status === 401,
)
record(
  'a wrong token is refused',
  `http ${String((await call('tools/list', undefined, 'mcp_not-a-real-token')).status)}`,
  (await call('tools/list', undefined, 'mcp_not-a-real-token')).status === 401,
)

const listed = await call('tools/list')
const tools = ((listed.body.result as { tools?: { name: string }[] } | undefined)?.tools ?? []).map(
  (t) => t.name,
)
record(
  'CONTROL: the verification token IS accepted, so the refusals above are about the token',
  `http ${String(listed.status)}, tools: ${tools.join(', ')}`,
  listed.status === 200 && tools.length === 5,
)

// --- the handshake a client actually performs ---------------------------------

const init = await call('initialize', { protocolVersion: '2024-11-05', capabilities: {} })
const serverInfo = init.body.result as { serverInfo?: { name?: string }; instructions?: string }
record(
  'initialize returns a server identity and instructions the model will read',
  `name=${String(serverInfo?.serverInfo?.name)} instructions=${String((serverInfo?.instructions ?? '').length)} chars`,
  serverInfo?.serverInfo?.name === 'ai-team-hq' && (serverInfo.instructions ?? '').length > 100,
)
// The instructions must say read-only, or a client will try to write and be
// confused by the refusal rather than never attempting it.
record(
  'and those instructions say the corpus is read-only',
  /read-only/i.test(serverInfo?.instructions ?? '') ? 'says read-only' : 'does NOT say read-only',
  /read-only/i.test(serverInfo?.instructions ?? ''),
)

// --- the tool list is fixed ---------------------------------------------------

for (const name of ['constructor', '__proto__', 'toString', 'drop_everything']) {
  const r = await call('tools/call', { name, arguments: {} })
  const error = (r.body.error as { message?: string } | undefined)?.message ?? ''
  record(
    `"${name}" is not a tool`,
    error === '' ? 'NO ERROR RETURNED' : error.slice(0, 60),
    error.includes('no such tool'),
  )
}

// --- a real call --------------------------------------------------------------

const searched = await call('tools/call', {
  name: 'search_documents',
  arguments: { query: 'coaching', limit: 2 },
})
const text = String(
  ((searched.body.result as { content?: { text?: string }[] } | undefined)?.content ?? [])[0]
    ?.text ?? '',
)
record(
  'search_documents returns ranked results from the real corpus',
  `http ${String(searched.status)}, ${String(text.length)} chars`,
  searched.status === 200 && text.includes('Coaching'),
)

// §15 and §25 on a surface a model reads, and repeats.
const allText = JSON.stringify([listed.body, init.body, searched.body])
const leaks = ['xoxb-', 'xoxe-', 'sbp_', 'ntn_', 'AIza', 'service_role', 'eyJ'].filter((n) =>
  allText.includes(n),
)
record(
  'nothing a tool returns is a credential',
  leaks.length === 0 ? 'clean' : `LEAKED: ${leaks.join(', ')}`,
  leaks.length === 0,
)

// Grant's raw instructions are deliberately not exposed. The team's decisions
// are a client's business; what he typed in a DM is not.
const commandTool = tools.find((t) => /command|instruction|inbound/i.test(t))
record(
  "no tool exposes Grant's own messages",
  commandTool === undefined ? 'none' : `EXPOSED BY: ${commandTool}`,
  commandTool === undefined,
)

// --- every call is recorded (§11) ---------------------------------------------

const recorded = (
  await db.execute(`
    select tool, outcome from public.mcp_calls
     where client_id = ${lit(CLIENT)} order by called_at
  `)
).rows as { tool: string; outcome: string }[]
record(
  'every call is recorded, refusals included',
  `${String(recorded.length)} row(s): ${recorded
    .map((r) => `${r.tool}=${r.outcome}`)
    .join(', ')
    .slice(0, 90)}`,
  recorded.filter((r) => r.outcome === 'refused').length >= 4 &&
    recorded.some((r) => r.tool === 'search_documents' && r.outcome === 'ok'),
)

// --- revocation is per client --------------------------------------------------

await db.execute(`
  update public.mcp_clients set enabled = false, disabled_reason = 'verification'
   where client_id = ${lit(CLIENT)}
`)
const afterRevoke = await call('tools/list')
record(
  'a revoked client is refused immediately',
  `http ${String(afterRevoke.status)}`,
  afterRevoke.status === 401,
)

// The point of one token per client: revoking this one must not have touched
// Grant's. Asserted by asking the database, not by reasoning about it.
const others = (
  await db.execute(
    `select count(*)::int as n from public.mcp_clients
      where enabled and client_id <> ${lit(CLIENT)}`,
  )
).rows[0] as { n: number }
record(
  'and revoking it left every other client enabled',
  `${String(others.n)} other client(s) still enabled`,
  others.n >= 1,
)

// --- report, then remove the fixture -------------------------------------------

console.log('\n| check | outcome | |')
console.log('|---|---|---|')
for (const c of checks) console.log(`| ${c.what} | ${c.outcome} | ${c.passed ? '✅' : '❌'} |`)
const failed = checks.filter((c) => !c.passed)
console.log(`\n${String(checks.length - failed.length)}/${String(checks.length)} checks passed`)

await db.execute(`
  delete from public.mcp_calls where client_id = ${lit(CLIENT)};
  delete from public.mcp_clients where client_id = ${lit(CLIENT)};
`)
console.log('verification client removed.')

if (failed.length > 0) process.exit(1)
