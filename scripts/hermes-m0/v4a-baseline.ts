/**
 * V4, layer A: how the REAL office MCP function behaves for an ordinary JSON-RPC client.
 *
 *   npx tsx scripts/hermes-m0/v4a-baseline.ts <out-dir> <deno-binary>
 *
 * This is the behaviour Claude and ChatGPT connect to today. Anything the Hermes work later changes in `supabase/functions/mcp`
 * must leave every check here unchanged (the golden file written to <out-dir>/v4a-golden.json is what "unchanged" is compared to).
 * Environment: MOCK database (fake PostgREST), REAL function code.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { type Check, matrix, scrub } from './lib.ts'
import { rpc, startRig } from './mcp-rig.ts'

const [outArg, denoArg, rootArg] = process.argv.slice(2)
if (outArg === undefined || denoArg === undefined) {
  console.error('usage: v4a-baseline.ts <out-dir> <deno-binary> [function-root]')
  process.exit(2)
}
// The optional root is for the sabotage runs: a scratch copy of the function with a deliberate defect.
const functionRoot = resolve(rootArg ?? '.')
const outDir = resolve(outArg)
mkdirSync(outDir, { recursive: true })

const checks: Check[] = []
const check = (id: string, name: string, ok: boolean, evidence: string): void => {
  checks.push({ id, name, verdict: ok ? 'PASS' : 'FAIL', environment: 'mock', evidence })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${name}  ${scrub(evidence)}`)
}

const rig = await startRig({ root: functionRoot, deno: denoArg, outDir, port: 18_081 })
const golden: Record<string, unknown> = {}
try {
  const asObj = (v: unknown): Record<string, unknown> => (v ?? {}) as Record<string, unknown>
  const textOf = (v: unknown): string => {
    const content = (asObj(asObj(v).result).content ?? []) as { text?: string }[]
    return content[0]?.text ?? ''
  }

  // a1 initialize
  const init = await rpc(rig, rig.tokens.ro, 'initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'probe', version: '0' },
  })
  const initResult = asObj(asObj(init.body).result)
  golden.initialize = {
    protocolVersion: initResult.protocolVersion,
    serverInfo: initResult.serverInfo,
  }
  check(
    'V4a-1',
    'initialize answers with the fixed protocol version whatever the client asked for',
    init.status === 200 && initResult.protocolVersion === '2024-11-05',
    `asked 2025-06-18, got ${String(initResult.protocolVersion)}`,
  )

  // a2 tools/list
  const list = await rpc(rig, rig.tokens.ro, 'tools/list')
  const tools = ((asObj(asObj(list.body).result).tools ?? []) as { name: string }[]).map(
    (t) => t.name,
  )
  golden.toolNames = tools
  check(
    'V4a-2',
    'tools/list returns the catalogue (the calendar tools only where the database offers them)',
    list.status === 200 &&
      tools.length >= 15 &&
      tools.includes('list_projects') &&
      tools.includes('create_task'),
    `${String(tools.length)} tools: ${tools.join(',')}`,
  )

  // a3 / a4 authentication
  const none = await rpc(rig, null, 'tools/list')
  check(
    'V4a-3',
    'no credential is refused with 401 and a resource_metadata challenge',
    none.status === 401 &&
      (none.headers.get('www-authenticate') ?? '').includes('resource_metadata='),
    `status ${String(none.status)}`,
  )
  const bad = await rpc(rig, 'mcp_not_a_real_token_000000000000', 'tools/list')
  check(
    'V4a-4',
    'an unknown credential is refused with 401',
    bad.status === 401,
    `status ${String(bad.status)}`,
  )

  // a5 isolation by credential
  rig.pg.reset()
  const mine = await rpc(rig, rig.tokens.ro, 'tools/call', { name: 'list_projects', arguments: {} })
  const mineSlugs = (JSON.parse(textOf(mine.body) || '[]') as { slug: string }[]).map((p) => p.slug)
  check(
    'V4a-5',
    "the office is the credential's own: office A's client sees only office A's projects",
    mineSlugs.includes('harvest-lane') && !mineSlugs.includes('other-office-secret'),
    `slugs ${mineSlugs.join(',')}`,
  )
  const theirs = await rpc(rig, rig.tokens.other, 'tools/call', {
    name: 'list_projects',
    arguments: {},
  })
  const theirSlugs = (JSON.parse(textOf(theirs.body) || '[]') as { slug: string }[]).map(
    (p) => p.slug,
  )
  check(
    'V4a-6',
    "office B's client sees only office B's projects",
    theirSlugs.length === 1 && theirSlugs[0] === 'other-office-secret',
    `slugs ${theirSlugs.join(',')}`,
  )

  // a7 a model cannot name its own office
  rig.pg.reset()
  await rpc(rig, rig.tokens.ro, 'tools/call', {
    name: 'list_projects',
    arguments: { p_office: rig.officeB, office_id: rig.officeB, office: rig.officeB },
  })
  const sent = rig.pg.callsTo('mcp_projects')[0]
  check(
    'V4a-7',
    "an office named in the arguments is overwritten with the credential's office",
    sent !== undefined && sent.args.p_office === rig.officeA,
    `database received p_office=${String(sent?.args.p_office)} (A is ${rig.officeA})`,
  )

  // a8 read-only enforcement at the edge
  rig.pg.reset()
  const refusedWrite = await rpc(rig, rig.tokens.ro, 'tools/call', {
    name: 'create_task',
    arguments: { project: 'harvest-lane', title: 'should never exist' },
  })
  const err = asObj(asObj(refusedWrite.body).error)
  const reached = rig.pg.callsTo('mcp_task_add').length
  const recorded = rig.pg.callsTo('mcp_record_call').map((c) => String(c.args.p_outcome))
  check(
    'V4a-8',
    'a read-only client cannot make a write call: refused at the edge, the database function is never reached, the refusal is recorded',
    err.code === -32_602 && reached === 0 && recorded.includes('refused'),
    `code ${String(err.code)}, mcp_task_add calls ${String(reached)}, record outcomes ${recorded.join(',')}`,
  )

  // a9 an existing writing client still works (regression for Claude / ChatGPT)
  rig.pg.reset()
  const wrote = await rpc(rig, rig.tokens.rw, 'tools/call', {
    name: 'create_task',
    arguments: { project: 'harvest-lane', title: 'a task' },
  })
  const taskCall = rig.pg.callsTo('mcp_task_add')[0]
  check(
    'V4a-9',
    'a read+write client still reaches the write function, attributed to its own client id',
    wrote.status === 200 &&
      taskCall !== undefined &&
      taskCall.args.p_client_id === 'chatgpt-rw' &&
      taskCall.args.p_office === rig.officeA,
    `reached=${String(taskCall !== undefined)} client=${String(taskCall?.args.p_client_id)}`,
  )

  // a10 unknown and prototype-chain tool names
  const unknown = await rpc(rig, rig.tokens.ro, 'tools/call', {
    name: 'drop_everything',
    arguments: {},
  })
  const proto = await rpc(rig, rig.tokens.ro, 'tools/call', { name: 'constructor', arguments: {} })
  check(
    'V4a-10',
    'an unknown tool and a prototype-chain name are both "no such tool"',
    asObj(asObj(unknown.body).error).code === -32_601 &&
      asObj(asObj(proto.body).error).code === -32_601,
    `codes ${String(asObj(asObj(unknown.body).error).code)}, ${String(asObj(asObj(proto.body).error).code)}`,
  )

  // a11 database errors do not reach the model
  rig.pg.failNext('mcp_projects')
  const broken = await rpc(rig, rig.tokens.ro, 'tools/call', {
    name: 'list_projects',
    arguments: {},
  })
  const brokenText = JSON.stringify(broken.body)
  check(
    'V4a-11',
    'a database error is reported as "the tool failed" and never repeats the schema detail',
    asObj(asObj(broken.body).error).code === -32_603 && !brokenText.includes('secret_table'),
    `code ${String(asObj(asObj(broken.body).error).code)}; response ${brokenText.slice(0, 120)}`,
  )

  // a12 GET and notification shapes (what a streamable-HTTP client probes)
  const get = await fetch(rig.url)
  const getType = get.headers.get('content-type') ?? ''
  golden.get = { status: get.status, contentType: getType }
  check(
    'V4a-12',
    'GET answers a JSON liveness reply (not an event stream and not 405): recorded, because a modern client may open a GET stream',
    get.status === 200 && getType.includes('application/json'),
    `status ${String(get.status)} content-type ${getType}`,
  )
  const note = await rpc(rig, rig.tokens.ro, 'notifications/initialized', undefined, null)
  check(
    'V4a-13',
    'notifications/initialized is acknowledged with 202',
    note.status === 202,
    `status ${String(note.status)}`,
  )

  // a14 delete (session termination) is not a method the function offers
  const del = await fetch(rig.url, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${rig.tokens.ro}` },
  })
  golden.delete = { status: del.status }
  check(
    'V4a-14',
    'DELETE (streamable-HTTP session end) is answered 405',
    del.status === 405,
    `status ${String(del.status)}`,
  )
} finally {
  await rig.stop()
}

writeFileSync(join(outDir, 'v4a-golden.json'), `${JSON.stringify(golden, null, 2)}\n`)
writeFileSync(join(outDir, 'v4a-matrix.md'), `${matrix(checks)}\n`)
const failed = checks.filter((c) => c.verdict !== 'PASS')
console.log(`\nV4a: ${String(checks.length - failed.length)}/${String(checks.length)} passed`)
process.exit(failed.length === 0 ? 0 : 1)
