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
  insert into public.mcp_clients (client_id, display_name, token_sha256, scopes)
  values (${lit(CLIENT)}, 'Verification client',
          ${lit(createHash('sha256').update(token).digest('hex'))}, array['read'])
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
  listed.status === 200 && tools.length === 10,
)

// --- the handshake a client actually performs ---------------------------------

const init = await call('initialize', { protocolVersion: '2024-11-05', capabilities: {} })
const serverInfo = init.body.result as { serverInfo?: { name?: string }; instructions?: string }
record(
  'initialize returns a server identity and instructions the model will read',
  `name=${String(serverInfo?.serverInfo?.name)} instructions=${String((serverInfo?.instructions ?? '').length)} chars`,
  serverInfo?.serverInfo?.name === 'ai-team-hq' && (serverInfo.instructions ?? '').length > 100,
)
// The instructions must say what a client may and may not do. They said
// "read-only" until writing was added, and this check caught the stale
// sentence — which is the whole reason to assert on the content of a prompt
// rather than only on its length: an instruction that is out of date is worse
// than a short one, because a model believes it.
const instructions = serverInfo?.instructions ?? ''
record(
  'the instructions say what a client may do, and what it may not',
  instructions.slice(0, 90),
  /add/i.test(instructions) && /cannot (edit|delete)|not edit|not delete/i.test(instructions),
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

// --- write is a scope, not a default -------------------------------------------
//
// The verification client is deliberately read-only, so every write tool must
// refuse it. The check that matters is that it refuses BEFORE doing anything —
// a client that can make the attempt and fail is a client that got a turn at
// the database.

for (const [tool, args] of [
  ['add_to_project', { project: 'ai-team-hq-test', title: 'should not exist', content: 'no' }],
  ['notebook_generate', { project: 'ai-team-hq-test', kind: 'audio' }],
  [
    'push_to_notebook',
    { project: 'ai-team-hq-test', document_id: '00000000-0000-4000-8000-000000000000' },
  ],
  ['ask_notebook', { project: 'ai-team-hq-test', question: 'anything' }],
] as const) {
  const r = await call('tools/call', { name: tool, arguments: args })
  const message = (r.body.error as { message?: string } | undefined)?.message ?? ''
  record(
    `${tool} refuses a read-only client`,
    message === '' ? 'NOT REFUSED' : message.slice(0, 60),
    message.includes('write scope'),
  )
}

// And nothing was written by the attempts.
const leftBehind = (
  await db.execute(
    `select count(*)::int as n from public.documents where added_by = ${lit(CLIENT)}`,
  )
).rows[0] as { n: number }
record(
  'and the refused writes wrote nothing',
  `${String(leftBehind.n)} document(s) attributable to this client`,
  leftBehind.n === 0,
)

// The inverse, on a client that DOES have the scope. Without it, every refusal
// above would pass equally against a write path that is simply broken.
const writeToken = `mcp_${randomBytes(24).toString('base64url')}`
const WRITER = `${CLIENT}-w`
await db.execute(`
  insert into public.mcp_clients (client_id, display_name, token_sha256, scopes)
  values (${lit(WRITER)}, 'Verification writer',
          ${lit(createHash('sha256').update(writeToken).digest('hex'))}, array['read','write'])
`)
const written = await call(
  'tools/call',
  {
    name: 'add_to_project',
    arguments: {
      project: 'ai-team-hq-test',
      title: `Verification note ${run}`,
      content: `Written by verify:mcp, run ${run}. Safe to delete.`,
    },
  },
  writeToken,
)
const writtenText = String(
  ((written.body.result as { content?: { text?: string }[] } | undefined)?.content ?? [])[0]
    ?.text ?? '',
)
record(
  'CONTROL: a client WITH the write scope can add a document',
  writtenText.includes('document_id') ? 'added' : writtenText.slice(0, 80),
  writtenText.includes('document_id') && !writtenText.includes('"duplicate": true'),
)

// The same content twice is one document. A model asked to "add the summary"
// twice in one conversation would otherwise add it twice, and no-duplicates is
// the requirement Grant stated first.
const again = await call(
  'tools/call',
  {
    name: 'add_to_project',
    arguments: {
      project: 'ai-team-hq-test',
      title: `Verification note ${run}`,
      content: `Written by verify:mcp, run ${run}. Safe to delete.`,
    },
  },
  writeToken,
)
const againText = String(
  ((again.body.result as { content?: { text?: string }[] } | undefined)?.content ?? [])[0]?.text ??
    '',
)
record(
  'the same content added twice is one document, not two',
  againText.includes('"duplicate": true') ? 'refused as duplicate' : againText.slice(0, 80),
  againText.includes('"duplicate": true'),
)

// A write tool must not accept a project that does not exist, and must say so
// rather than inventing one.
const nowhere = await call(
  'tools/call',
  { name: 'add_to_project', arguments: { project: 'no-such-project', title: 'x', content: 'y' } },
  writeToken,
)
const nowhereText = String(
  ((nowhere.body.result as { content?: { text?: string }[] } | undefined)?.content ?? [])[0]
    ?.text ?? '',
)
record(
  'adding to a project that does not exist is refused, not invented',
  nowhereText.slice(0, 70),
  nowhereText.includes('no active project'),
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
  delete from public.documents where added_by = ${lit(WRITER)};
  delete from public.mcp_calls where client_id in (${lit(CLIENT)}, ${lit(WRITER)});
  delete from public.mcp_clients where client_id in (${lit(CLIENT)}, ${lit(WRITER)});
`)
console.log('verification client removed.')

if (failed.length > 0) process.exit(1)
