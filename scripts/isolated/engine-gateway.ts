// biome-ignore-all lint/suspicious/noExplicitAny: SQL results and HTTP bodies are untyped
// biome-ignore-all format: a dense proof script kept readable as written
/**
 * The engine gateway (supabase/functions/engine), the REAL function, run in Node against the isolated replica (Hermes, M2).
 *
 *   bash scripts/isolated/replica.sh && npx tsx scripts/isolated/engine-gateway.ts <replica-db>
 *
 * A fake bridge drives the whole door: health, authentication, methods, sizes, bad bodies, the preflight, claim, heartbeat, finish,
 * the lost claim, a retired bridge, a database outage and the throttle. The emulator (edge-emulator.ts) answers PostgREST for the
 * replica only and REFUSES and records every other URL, so "nothing left the machine" is an observation. Every RPC the function made
 * is recorded, so "the office always comes from the credential" is asserted over the calls themselves, not over the source.
 *
 * Then the function's own file is put back wrong in scratch copies (never committed): each defect must turn its probe red, and the
 * real function must be green again.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { generateCredentials, retireStatement } from '../../src/engines/hermes/credentials.ts'
import { startEdge } from './edge-emulator.ts'
import { isolated } from './guard.ts'
import { realParent } from './real-telegram.ts'

const DB = process.argv[2] ?? 'post'
const db = await isolated(DB)
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const run = Date.now().toString(36)
const results: boolean[] = []
const lines: string[] = []
const check = (what: string, ok: boolean, detail = ''): void => {
  results.push(ok)
  const line = `${ok ? 'ok  ' : 'FAIL'} ${what}${detail === '' ? '' : ` - ${detail}`}`
  lines.push(line)
  console.log(line)
}
const q = async (sql: string): Promise<Record<string, any>[]> => (await db.execute(sql)).rows as Record<string, any>[]
const one = async (sql: string): Promise<Record<string, any>> => (await q(sql))[0] ?? {}
const json = (v: unknown): any => (typeof v === 'string' ? JSON.parse(v) : v)

// A clock the throttle can be moved along. Installed BEFORE the function loads, because the throttle captures Date.now at construction.
const realNow = Date.now.bind(Date)
let skew = 0
Date.now = () => realNow() + skew
const advance = (ms: number): void => { skew += ms }

const A = String((await one('select app.operator_office()::text o')).o)
const mkOffice = async (name: string): Promise<string> => {
  const auth = String((await one('select gen_random_uuid()::text a')).a)
  await q(`insert into auth.users (id, email) values (${lit(auth)}, ${lit(`${name}.${run}@example.invalid`)})`)
  await q(`insert into public.offices (auth_user_id, kind, name) values (${lit(auth)}, 'person', ${lit(`${name} ${run}`)})`)
  return String((await one(`select office_id::text o from public.offices where auth_user_id = ${lit(auth)}`)).o)
}
const B = await mkOffice('gw-b')
await q(`insert into public.system_config (key, value, description) values ('engine.hermes.offices', ${lit(JSON.stringify([A, B]))}::jsonb, 'gateway proof') on conflict (key) do update set value = excluded.value`)
await q(`insert into public.system_config (key, value, description) values ('engine.hermes.daily_runs', '900'::jsonb, 'gateway proof') on conflict (key) do update set value = excluded.value`)

interface Host { office: string; bridge: string; client: string; token: string; mcpToken: string }
const mint = async (office: string, name: string): Promise<Host> => {
  const c = generateCredentials()
  const r = json((await one(`select app.engine_mint_bridge(${lit(office)}::uuid, 'hermes', ${lit(name)}, ${lit(c.bridgeSha256)}, ${lit(c.mcpSha256)}) r`)).r)
  return { office, bridge: r.bridge_id, client: r.mcp_client_id, token: c.bridgeToken, mcpToken: c.mcpToken }
}
const hA = await mint(A, `gateway proof ${run}`)
const hB = await mint(B, `gateway proof ${run}`)
const pausedJob = async (): Promise<string> => {
  const job = await realParent(db)
  await q(`select app.pause_job(${lit(job)}::uuid, 'dependency_wait', 'Hermes is working on it.', 'Waiting for Hermes to finish.', true, null, null)`)
  return job
}
const GOOD = { input: 'What did we decide about the venue?', instructions: 'You answer for the office.', conversation_history: [{ role: 'user', content: 'Hello' }] }
const openRun = async (office = A): Promise<{ job: string; runId: string }> => {
  // A run can only be opened while the office's bridge is fresh and ready: what the person's turn would have seen.
  await q(`update public.engine_bridges set last_seen_at = now(), healthy = true, unhealthy_reason = null where office_id = ${lit(office)}::uuid and enabled`)
  const job = await pausedJob()
  const r = json((await one(`select app.engine_run_open(${lit(office)}::uuid, ${lit(job)}::uuid, 'hermes', ${lit(JSON.stringify(GOOD))}::jsonb) r`)).r)
  if (typeof r.run_id !== 'string') throw new Error(`could not open: ${JSON.stringify(r)}`)
  return { job, runId: r.run_id }
}
const jobState = async (job: string): Promise<string> => String((await one(`select state::text s from public.jobs where job_id = ${lit(job)}::uuid`)).s)
const runState = async (runId: string): Promise<string> => String((await one(`select state from public.engine_runs where run_id = ${lit(runId)}::uuid`)).state)
const touchBridge = async (h: Host): Promise<void> => { await q(`update public.engine_bridges set last_seen_at = now(), healthy = true where bridge_id = ${lit(h.bridge)}::uuid`) }
const retireRun = async (runId: string): Promise<void> => { await q(`update public.engine_runs set state = 'cancelled', finished_at = now(), lease_until = null where run_id = ${lit(runId)}::uuid and state in ('open','running')`).catch(() => undefined) }

interface Reply { status: number; body: any; headers: Headers; raw: string }
type Door = { call: (request: Request) => Promise<Response>; refusedUrls: string[]; outage: (on: boolean, only?: string) => void }
const driver = (edge: Door) => async (path: string, o: { method?: string; token?: string | null; body?: unknown; rawBody?: string; headers?: Record<string, string> } = {}): Promise<Reply> => {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...(o.headers ?? {}) }
  if (o.token !== null && o.token !== undefined) headers.authorization = `Bearer ${o.token}`
  const method = o.method ?? 'POST'
  const body = method === 'GET' ? undefined : (o.rawBody ?? JSON.stringify(o.body ?? {}))
  const r = await edge.call(new Request(`https://door.invalid/functions/v1/engine${path}`, { method, headers, ...(body === undefined ? {} : { body }) }))
  const raw = await r.text()
  let parsed: any = null
  try { parsed = JSON.parse(raw) } catch { parsed = { raw } }
  return { status: r.status, body: parsed, headers: r.headers, raw }
}

// Record every RPC the function makes (the emulator's fetch is already in place; this wraps it).
const rpcCalls: { fn: string; args: Record<string, unknown> }[] = []
const wrapRpcRecorder = (): void => {
  const inner = globalThis.fetch
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input instanceof Request ? input.url : input)
    const m = /\/rest\/v1\/rpc\/([a-z_]+)$/.exec(url)
    if (m?.[1] !== undefined) rpcCalls.push({ fn: m[1], args: JSON.parse(String(init?.body ?? '{}')) })
    return inner(input, init)
  }) as typeof fetch
}

const everyReply: Reply[] = []
const seen = (d: ReturnType<typeof driver>) => async (...a: Parameters<ReturnType<typeof driver>>): Promise<Reply> => {
  const r = await d(...a)
  everyReply.push(r)
  return r
}

const CLAIM = { bridge_version: '0.1.0', hermes_ok: true, toolsets_ok: true }
const ANSWER = { tools_started: 1, approvals_denied: 0, answer: 'The venue is unchanged.', model: 'nvidia/nemotron-3-super-120b-a12b:free', usage: { input_tokens: 900, output_tokens: 40 } }

try {
  const edge = await startEdge({ db, edgeFile: 'supabase/functions/engine/index.ts', env: { SUPABASE_SERVICE_ROLE_KEY: 'isolated-service-key' } })
  wrapRpcRecorder()
  const gw = seen(driver(edge))

  // ---- the open door --------------------------------------------------------------------------------------------------
  const health = await gw('/health', { method: 'GET' })
  check('G1 liveness answers 200 {ok: true}, with no authentication, and names nothing else', health.status === 200 && JSON.stringify(health.body) === '{"ok":true}', health.raw)
  check('G2 every response is no-store and carries no CORS header (nothing in a browser may call this)', health.headers.get('cache-control') === 'no-store' && health.headers.get('access-control-allow-origin') === null)
  const notFound = await Promise.all(['/', '/engine', '/claims', '/claim/extra', '/proposals', '/skill'].map((p) => gw(p, { token: hA.token })))
  check('G3 an unknown path is 404 for everyone, with a valid credential or without', notFound.every((r) => r.status === 404) && (await gw('/proposals', {})).status === 404, notFound.map((r) => r.status).join(','))
  check('G4 the health route answers only GET', (await gw('/health', { method: 'POST' })).status === 405)

  // ---- authentication -------------------------------------------------------------------------------------------------
  const noToken = await gw('/claim', { body: CLAIM })
  const unknown = await gw('/claim', { token: generateCredentials().bridgeToken, body: CLAIM })
  const tooLong = await gw('/claim', { token: 'x'.repeat(300), body: CLAIM })
  const mcpAsBridge = await gw('/claim', { token: hA.mcpToken, body: CLAIM })
  check('G5 no credential, an unknown one, an over-long one and the MCP token presented as a bridge token are each 401 {error: unauthorized}', [noToken, unknown, tooLong, mcpAsBridge].every((r) => r.status === 401 && r.body.error === 'unauthorized'), [noToken, unknown, tooLong, mcpAsBridge].map((r) => r.status).join(','))
  const wrongMethod = await gw('/claim', { method: 'GET', token: hA.token })
  check('G6 a valid credential on the wrong method is 405 (and an invalid one is 401 first: authentication comes before anything else is read)', wrongMethod.status === 405 && (await gw('/claim', { method: 'GET', token: null })).status === 401)

  // ---- sizes and shapes -----------------------------------------------------------------------------------------------
  const big = await gw('/claim', { token: hA.token, rawBody: JSON.stringify({ ...CLAIM, bridge_version: 'x'.repeat(70_000) }) })
  const declaredBig = await gw('/claim', { token: hA.token, body: CLAIM, headers: { 'content-length': '70000' } })
  const justUnder = await gw('/finish', { token: hA.token, rawBody: JSON.stringify({ run_id: '3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f', claim_gen: 1, outcome: 'failed', result: { pad: 'x'.repeat(60_000) } }) })
  check('G7 a body over 64 KB is refused 413, streamed or declared; one just under is read (and refused for what it says, not its size)', big.status === 413 && declaredBig.status === 413 && justUnder.status !== 413, `${big.status} ${declaredBig.status} ${justUnder.status}`)
  const badJson = await gw('/claim', { token: hA.token, rawBody: '{not json' })
  const namesOffice = await gw('/claim', { token: hA.token, body: { ...CLAIM, office_id: B } })
  const badUuid = await gw('/heartbeat', { token: hA.token, body: { run_id: 'x', claim_gen: 1 } })
  const badGen = await gw('/heartbeat', { token: hA.token, body: { run_id: '3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f', claim_gen: 7 } })
  const badOutcome = await gw('/finish', { token: hA.token, body: { run_id: '3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f', claim_gen: 1, outcome: 'win', result: {} } })
  check('G8 a malformed body is 400 naming the field, and a body that tries to name an office is refused as such', badJson.status === 400 && badJson.body.field === 'body' && namesOffice.status === 400 && namesOffice.body.field === 'office_id' && badUuid.body.field === 'run_id' && badGen.body.field === 'claim_gen' && badOutcome.body.field === 'outcome', [badJson, namesOffice, badUuid, badGen, badOutcome].map((r) => r.body.field).join(','))

  // ---- the preflight --------------------------------------------------------------------------------------------------
  await touchBridge(hA)
  const sick = await gw('/claim', { token: hA.token, body: { ...CLAIM, hermes_ok: false } })
  const availSick = json((await one(`select app.engine_available(${lit(A)}::uuid, 'hermes') r`)).r)
  check('G9 a bridge that reports Hermes is not answering is told so, handed nothing, asked to wait longer, and the office then says Hermes is not ready', sick.status === 200 && sick.body.run === null && sick.body.poll_after_s === 60 && String(sick.body.refused).includes('not answering') && availSick.available === false && String(availSick.because).includes("isn't ready"), JSON.stringify([sick.body, availSick.because]))
  advance(6_000)
  const sick2 = await gw('/claim', { token: hA.token, body: { ...CLAIM, toolsets_ok: false } })
  check('G10 a bridge that reports an extra toolset is refused too, with its own reason', sick2.body.run === null && String(sick2.body.refused).includes('toolset other than the office'), sick2.raw.slice(0, 160))

  // ---- the journey: open, claim, heartbeat, finish ---------------------------------------------------------------------
  const r1 = await openRun()
  advance(6_000)
  const idle = await gw('/claim', { token: hB.token, body: CLAIM })
  check("G11 office B's bridge, healthy, is handed nothing while the only run waiting is office A's, and is told to poll again in 15 s", idle.status === 200 && idle.body.run === null && idle.body.poll_after_s === 15, idle.raw.slice(0, 120))
  advance(6_000)
  const claimed = await gw('/claim', { token: hA.token, body: CLAIM })
  check('G12 a healthy bridge is handed the waiting run: id, claim number 1, job, deadline, the request exactly as the office stored it, nothing to attach to; poll_after_s 0', claimed.status === 200 && claimed.body.run?.run_id === r1.runId && claimed.body.run.claim_gen === 1 && claimed.body.run.job_id === r1.job && JSON.stringify(claimed.body.run.request) === JSON.stringify(GOOD) && claimed.body.run.hermes_run_id === null && claimed.body.poll_after_s === 0, claimed.raw.slice(0, 160))
  const hid = `run_${'b'.repeat(32)}`
  const beat1 = await gw('/heartbeat', { token: hA.token, body: { run_id: r1.runId, claim_gen: 1, hermes_run_id: hid, progress: { events: 2, tools: 1, last_event: 'tool.started' } } })
  check('G13 a heartbeat keeps the lease, records the Hermes run id, and says not to stop', beat1.status === 200 && beat1.body.stop === false && typeof beat1.body.lease_until === 'string' && (await one(`select hermes_run_id from public.engine_runs where run_id = ${lit(r1.runId)}::uuid`)).hermes_run_id === hid, beat1.raw)
  const stale = await gw('/heartbeat', { token: hA.token, body: { run_id: r1.runId, claim_gen: 2 } })
  const otherBridge = await gw('/heartbeat', { token: hB.token, body: { run_id: r1.runId, claim_gen: 1 } })
  check('G14 a heartbeat for a stale claim, or from another bridge, is 409 not_yours (a lost claim, never a stop instruction the bridge might misread)', stale.status === 409 && stale.body.error === 'not_yours' && otherBridge.status === 409, `${stale.status} ${otherBridge.status}`)
  const staleFinish = await gw('/finish', { token: hA.token, body: { run_id: r1.runId, claim_gen: 2, outcome: 'completed', result: ANSWER } })
  const foreignFinish = await gw('/finish', { token: hB.token, body: { run_id: r1.runId, claim_gen: 1, outcome: 'completed', result: ANSWER } })
  const badResult = await gw('/finish', { token: hA.token, body: { run_id: r1.runId, claim_gen: 1, outcome: 'completed', result: { tools_started: 1, approvals_denied: 0 } } })
  const extraKey = await gw('/finish', { token: hA.token, body: { run_id: r1.runId, claim_gen: 1, outcome: 'completed', result: { ...ANSWER, tool_calls: [] } } })
  check('G15 a finish with a stale claim or from another bridge is 409; one with no answer, or an extra key, is 400 with the reason, and the run is still running', staleFinish.status === 409 && foreignFinish.status === 409 && badResult.status === 400 && String(badResult.body.because).includes('non-empty answer') && extraKey.status === 400 && (await runState(r1.runId)) === 'running', [staleFinish, foreignFinish, badResult, extraKey].map((r) => r.status).join(','))
  const done = await gw('/finish', { token: hA.token, body: { run_id: r1.runId, claim_gen: 1, outcome: 'completed', result: ANSWER } })
  check('G16 a correct finish is 200, resumes the waiting job, ends the run completed, and writes one inference row for the job', done.status === 200 && done.body.ok === true && done.body.resumed === true && done.body.state === 'completed' && (await jobState(r1.job)) === 'queued' && (await runState(r1.runId)) === 'completed' && Number((await one(`select count(*)::int n from public.inference_usage where job_id = ${lit(r1.job)}::uuid and provider = 'hermes'`)).n) === 1, done.raw)
  const again = await gw('/finish', { token: hA.token, body: { run_id: r1.runId, claim_gen: 1, outcome: 'completed', result: ANSWER } })
  check('G17 finishing again is 200 with resumed false and changes nothing (idempotent)', again.status === 200 && again.body.resumed === false && again.body.state === 'completed' && Number((await one(`select count(*)::int n from public.inference_usage where job_id = ${lit(r1.job)}::uuid`)).n) === 1, again.raw)

  // ---- a Stop, and the throttle ----------------------------------------------------------------------------------------
  const r2 = await openRun()
  advance(6_000)
  const c2 = await gw('/claim', { token: hA.token, body: CLAIM })
  const tooSoon = await gw('/claim', { token: hA.token, body: CLAIM })
  advance(5_100)
  const later = await gw('/claim', { token: hA.token, body: CLAIM })
  check('G18 a second claim inside five seconds is 429 with a retry-after, and goes through once the gap has passed (and the first claim of a bridge is never refused)', c2.body.run?.run_id === r2.runId && tooSoon.status === 429 && Number(tooSoon.headers.get('retry-after')) >= 1 && tooSoon.body.error === 'too_fast' && later.status === 200 && later.body.run?.run_id === r2.runId, `${tooSoon.status} ${tooSoon.headers.get('retry-after')} ${later.status}`)
  await q(`select app.request_stop(${lit(A)}::uuid, ${lit(r2.job)}::uuid, null)`)
  const stopBeat = await gw('/heartbeat', { token: hA.token, body: { run_id: r2.runId, claim_gen: 1 } })
  check("G19 a person's Stop reaches the bridge through its next heartbeat: stop true, with the reason", stopBeat.status === 200 && stopBeat.body.stop === true && String(stopBeat.body.because).includes('ended'), stopBeat.raw)
  const cancel = await gw('/finish', { token: hA.token, body: { run_id: r2.runId, claim_gen: 1, outcome: 'cancelled', result: { tools_started: 0, approvals_denied: 0 } } })
  check('G20 the bridge reports the stop as cancelled: 200, the run is cancelled, and no inference row was written for a run that spent nothing', cancel.status === 200 && (await runState(r2.runId)) === 'cancelled' && Number((await one(`select count(*)::int n from public.inference_usage where job_id = ${lit(r2.job)}::uuid`)).n) === 0, cancel.raw)

  // ---- the database is down ----------------------------------------------------------------------------------------------
  edge.outage(true)
  const down = await gw('/claim', { token: hA.token, body: CLAIM })
  edge.outage(false)
  check('G21 with the database unavailable every authenticated call is 503 with a retry-after and says nothing about why (a bridge backs off, it never retries in a tight loop)', down.status === 503 && down.body.error === 'unavailable' && Number(down.headers.get('retry-after')) > 0 && Object.keys(down.body).length === 1, down.raw)
  advance(6_000)
  const r3 = await openRun()
  edge.outage(true, 'engine_run_claim')
  const downClaim = await gw('/claim', { token: hA.token, body: CLAIM })
  edge.outage(false)
  advance(6_000)
  const afterOutage = await gw('/claim', { token: hA.token, body: CLAIM })
  check('G22 an outage of the claim function alone is 503 as well, and the same claim succeeds once it is back (nothing was lost by backing off)', downClaim.status === 503 && afterOutage.body.run?.run_id === r3.runId, `${downClaim.status} ${afterOutage.status}`)
  await retireRun(r3.runId)

  // ---- retiring a bridge ----------------------------------------------------------------------------------------------
  const r4 = await openRun()
  advance(6_000)
  const c4 = await gw('/claim', { token: hA.token, body: CLAIM })
  await q(retireStatement(A, hA.bridge, 'proof: the host was decommissioned').replace(' as r', ' as r'))
  const deadBeat = await gw('/heartbeat', { token: hA.token, body: { run_id: r4.runId, claim_gen: 1 } })
  const deadClaim = await gw('/claim', { token: hA.token, body: CLAIM })
  check('G23 once a bridge is retired its token is dead at the door: a heartbeat and a claim are both 401, the run it held failed, and its job was woken', c4.body.run?.run_id === r4.runId && deadBeat.status === 401 && deadClaim.status === 401 && (await runState(r4.runId)) === 'failed' && (await jobState(r4.job)) === 'queued')

  // ---- over every call the function made ----------------------------------------------------------------------------------
  const names = [...new Set(rpcCalls.map((c) => c.fn))].sort()
  check('G24 the gateway called only its five functions, and no other: it can read no table and reach nothing else', names.every((n) => ['engine_bridge_for', 'engine_bridge_report', 'engine_run_claim', 'engine_run_heartbeat', 'engine_run_finish'].includes(n)) && names.length === 5, names.join(','))
  const withOffice = rpcCalls.filter((c) => 'p_office' in c.args)
  check('G25 the office in every call came from the credential: for each call, p_office is the office of the bridge whose token was presented (never one the body named)', withOffice.length > 10 && withOffice.every((c) => [A, B].includes(String(c.args.p_office))) && rpcCalls.filter((c) => c.fn === 'engine_bridge_for').every((c) => !('p_office' in c.args)), `${withOffice.length} calls`)
  const ownCalls = rpcCalls.filter((c) => c.fn !== 'engine_bridge_for' && c.args.p_bridge === hB.bridge)
  check('G26 office B\'s bridge was only ever asked about office B', ownCalls.length > 0 && ownCalls.every((c) => c.args.p_office === B), `${ownCalls.length} calls`)
  const allText = JSON.stringify(everyReply.map((r) => [r.raw, [...r.headers.entries()]]))
  check('G27 no bridge token and no MCP token appears in any response body or header, and nothing left the machine (the emulator refused and recorded none)', [hA.token, hA.mcpToken, hB.token, hB.mcpToken].every((t) => !allText.includes(t)) && edge.refusedUrls.length === 0, `refused ${edge.refusedUrls.length}`)

  // ============================================================================================================================
  // The function put back wrong, in scratch copies. Each defect must turn its probe red; the real function is green (above).
  // ============================================================================================================================
  const REAL = await readFile('supabase/functions/engine/index.ts', 'utf8')
  const REAL_ROUTES = await readFile('supabase/functions/engine/routes.ts', 'utf8')
  let n = 0
  const probeAgainst = async (what: string, edit: { index?: (s: string) => string; routes?: (s: string) => string }, probe: (g: ReturnType<typeof seen>) => Promise<boolean>): Promise<void> => {
    n += 1
    const folder = `.out/engine-sabotage/s${String(n)}_${run}/engine_s${String(n)}`
    await mkdir(folder, { recursive: true })
    const index = (edit.index ?? ((s) => s))(REAL)
    const routes = (edit.routes ?? ((s) => s))(REAL_ROUTES)
    const landed = index !== REAL || routes !== REAL_ROUTES
    await writeFile(`${folder}/index.ts`, index)
    await writeFile(`${folder}/routes.ts`, routes)
    const bad = await startEdge({ db, edgeFile: `${folder}/index.ts`, env: { SUPABASE_SERVICE_ROLE_KEY: 'isolated-service-key' } })
    wrapRpcRecorder()
    const during = await probe(seen(driver(bad)))
    // the real function, loaded afresh, must pass the same probe
    const good = await startEdge({ db, edgeFile: 'supabase/functions/engine/index.ts', env: { SUPABASE_SERVICE_ROLE_KEY: 'isolated-service-key' } })
    wrapRpcRecorder()
    const after = await probe(seen(driver(good)))
    check(`sabotage - ${what}`, landed && !during && after, `defect landed ${String(landed)}, probe with the defect ${String(during)} (must be false), real function ${String(after)}`)
  }
  // Office A's first bridge was retired in G23, so a new host for A serves every probe (a run needs a job that came through A's own door).
  const baseline = await mint(A, `sabotage host ${run}`)

  await probeAgainst('the body-size ceiling is removed', { index: (s) => s.replace('if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null', '').replace('if (total > MAX_BODY_BYTES) {', 'if (false) {') }, async (g) => {
    const big2 = await g('/claim', { token: baseline.token, rawBody: JSON.stringify({ ...CLAIM, bridge_version: 'x'.repeat(70_000) }) })
    return big2.status === 413
  })
  await probeAgainst('the claim throttle is removed', { index: (s) => s.replace('const wait = throttle.check(bridgeId)', 'const wait = null as number | null') }, async (g) => {
    advance(6_000)
    await g('/claim', { token: baseline.token, body: CLAIM })
    const second = await g('/claim', { token: baseline.token, body: CLAIM })
    return second.status === 429
  })
  await probeAgainst('a lost claim on a heartbeat is answered 200 instead of 409', { routes: (s) => s.replace(/if \(r\.stop === true && r\.because === 'not yours'\)\s+return \{ status: 409, body: \{ error: 'not_yours' \} \}/, '') }, async (g) => {
    const x = await openRun(baseline.office)
    await touchBridge(baseline)
    advance(6_000)
    const c = await g('/claim', { token: baseline.token, body: CLAIM })
    const lost = await g('/heartbeat', { token: baseline.token, body: { run_id: x.runId, claim_gen: 2 } })
    await retireRun(x.runId)
    return c.body.run?.run_id === x.runId && lost.status === 409
  })
  await probeAgainst('an unknown credential is no longer refused at the door', { index: (s) => s.replace(/if \(\s*bridge === null \|\|[\s\S]*?\)\s+return reply\(UNAUTHORIZED\)/, '') }, async (g) => {
    const r = await g('/claim', { token: generateCredentials().bridgeToken, body: CLAIM })
    return r.status === 401
  })
  await probeAgainst('responses lose their no-store header', { index: (s) => s.replace("'cache-control': 'no-store',", '') }, async (g) => (await g('/health', { method: 'GET' })).headers.get('cache-control') === 'no-store')
  await probeAgainst('a body may name the office (the unknown-key refusal is removed from the claim parser)', { routes: (s) => s.replace(/for \(const k of Object\.keys\(b\)\)\s+if \(!\['bridge_version', 'hermes_ok', 'toolsets_ok'\]\.includes\(k\)\) return bad\(k\)/, '') }, async (g) => (await g('/claim', { token: baseline.token, body: { ...CLAIM, office_id: A } })).status === 400)
} finally {
  Date.now = realNow
  await db.end().catch(() => undefined)
}
const bad = results.filter((r) => !r).length
console.log(`\n${String(results.length - bad)}/${String(results.length)} passed`)
process.exit(bad === 0 ? 0 : 1)
