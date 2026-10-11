// biome-ignore-all lint/suspicious/noExplicitAny: SQL results and HTTP bodies are untyped
// biome-ignore-all format: a dense proof script kept readable as written
/**
 * The Hermes bridge with a REAL Hermes, end to end on the isolated replica (Hermes, M5 acceptance).
 *
 *   HERMES_HOST_DIR=<dir with venv/ and work/> bash scripts/isolated/replica.sh && npx tsx scripts/isolated/engine-bridge.ts <replica-db>
 *
 * REAL: Hermes (the pinned commit, started as the host kit configures it), the bridge (scripts/hermes-bridge, configured through
 * parseBridgeConfig), the engine gateway and office MCP edge functions (run in Node by edge-emulator.ts against the replica), the worker and
 * the `office.instruction` handler, the SQL of 1070/1071 on the replica, the reply channel.
 * STAND-INS: the MODEL (scripts/hermes-m0/llm-double.ts, a scripted OpenAI-compatible endpoint: it makes no claim about any model's quality
 * and there is NO real provider call and NO spend anywhere in this proof) and TELEGRAM (a scripted api.telegram.org).
 *
 * It is not in `verify:critical` because it needs a Hermes install; run it by hand and keep its output as evidence. Every assertion reads
 * canonical rows (engine_runs, engine_run_calls, jobs, outputs, deliveries, inference_usage, tasks).
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { join, resolve } from 'node:path'
import { combinedNotifier } from '../../src/channels/notify.ts'
import { replyChannel } from '../../src/channels/reply.ts'
import { generateCredentials } from '../../src/engines/hermes/credentials.ts'
import { ENGINE_READ_TOOLS, SETTING } from '../../src/engines/hermes/timing.ts'
import { instructionHandler } from '../../src/handlers/instruction.ts'
import { drain, type Handler, type Reviewer } from '../../src/jobs/worker.ts'
import { ProviderRouter } from '../../src/providers/router.ts'
import { Bridge } from '../hermes-bridge/bridge.ts'
import { parseBridgeConfig } from '../hermes-bridge/config.ts'
import { GatewayClient } from '../hermes-bridge/gateway-client.ts'
import { HermesClient } from '../hermes-bridge/hermes-client.ts'
import { type HermesHost, startHermes } from '../hermes-m0/hermes-host.ts'
import { startLlmDouble } from '../hermes-m0/llm-double.ts'
import { startEdge } from './edge-emulator.ts'
import { isolated } from './guard.ts'
import { CHAT, realTelegramKey, registerBot } from './real-telegram.ts'

const DB = process.argv[2] ?? 'post'
const hostDir = process.env.HERMES_HOST_DIR
if (hostDir === undefined || hostDir === '') {
  console.error('HERMES_HOST_DIR is required: a directory holding venv/ (Hermes installed at the pinned commit) and work/')
  process.exit(2)
}
const root = resolve('.')
const outDir = join(root, '.out', 'engine-bridge')
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
const db = await isolated(DB)
// The edge emulator wraps the global fetch so it can refuse every URL but the replica's. Hermes and the bridge are on loopback, outside
// that world, so they are given the real fetch captured BEFORE the emulator exists (the edge functions never see it).
const realFetch = globalThis.fetch.bind(globalThis)
const lit =(v: string): string => `'${v.replace(/'/g, "''")}'`
const run = Date.now().toString(36)
const results: boolean[] = []
const check = (what: string, ok: boolean, detail = ''): void => {
  results.push(ok)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail === '' ? '' : ` - ${detail}`}`)
}
const q = async (sql: string): Promise<Record<string, any>[]> => (await db.execute(sql)).rows as Record<string, any>[]
const one = async (sql: string): Promise<Record<string, any>> => (await q(sql))[0] ?? {}
const json = (v: unknown): any => (typeof v === 'string' ? JSON.parse(v) : v)
const n = async (sql: string): Promise<number> => Number((await one(sql)).n)
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const A = String((await one('select app.operator_office()::text o')).o)
const mkProject = async (tag: string): Promise<{ id: string; slug: string; name: string }> => {
  const name = `Engbridge ${tag} ${run}`
  const id = String(json((await one(`select app.hq_create_project(${lit(A)}::uuid, ${lit(name)}, 'upload', ${lit(`engbridge-${tag}-${run}`)}, ${lit(name)}, true) as v`)).v).project_id)
  const slug = String((await one(`select slug from public.projects where project_id = ${lit(id)}::uuid`)).slug)
  return { id, slug, name }
}
const P1 = await mkProject('one')
const CANARY = `zqbridge${run}`.replace(/[^a-z0-9]/g, '')
const SEEDER = `engbridge-seed-${run}`
await q(`insert into public.mcp_clients (client_id, display_name, token_sha256, scopes, office_id, kind) values (${lit(SEEDER)}, 'engine bridge proof seeder', ${lit(createHash('sha256').update(`seed-${run}`).digest('hex'))}, array['read','write'], ${lit(A)}::uuid, 'chatgpt')`)
await q(`select app.mcp_add_document(p_office => ${lit(A)}::uuid, p_client_id => ${lit(SEEDER)}, p_project => ${lit(P1.slug)}, p_title => 'plan', p_content => ${lit(`The plan for this project mentions ${CANARY}.`)})`)
await q(`select app.task_add(p_office => ${lit(A)}::uuid, p_project => ${lit(P1.id)}::uuid, p_title => ${lit(`order seed ${CANARY}`)}, p_added_by => ${lit(SEEDER)})`)
await q(`insert into public.system_config (key, value, description) values (${lit(SETTING.offices)}, ${lit(JSON.stringify([A]))}::jsonb, 'engine bridge proof') on conflict (key) do update set value = excluded.value`)
await q(`insert into public.system_config (key, value, description) values (${lit(SETTING.dailyRuns)}, '900'::jsonb, 'engine bridge proof') on conflict (key) do update set value = excluded.value`)
const creds = generateCredentials()
const minted = json((await one(`select app.engine_mint_bridge(${lit(A)}::uuid, 'hermes', ${lit(`bridge proof ${run}`)}, ${lit(creds.bridgeSha256)}, ${lit(creds.mcpSha256)}) r`)).r)
const BRIDGE = String(minted.bridge_id)
const fresh = async (): Promise<void> => { await q(`update public.engine_bridges set last_seen_at = now(), healthy = true, unhealthy_reason = null where bridge_id = ${lit(BRIDGE)}::uuid`) }

// ---- the doors, wrapped in loopback HTTP so a real Hermes and a real bridge can reach them ---------------------------------------
const gwEdge = await startEdge({ db, edgeFile: 'supabase/functions/engine/index.ts', env: { SUPABASE_SERVICE_ROLE_KEY: 'isolated-service-key' } })
const mcpEdge = await startEdge({ db, edgeFile: 'supabase/functions/mcp/index.ts', env: { HQ_API_TOKEN: `machine-${run}`, SUPABASE_SERVICE_ROLE_KEY: 'isolated-service-key', SUPABASE_ANON_KEY: 'anon' } })
const body = (req: IncomingMessage): Promise<string> => new Promise((r) => { const c: Buffer[] = []; req.on('data', (x: Buffer) => c.push(x)); req.on('end', () => r(Buffer.concat(c).toString('utf8'))) })
const forward = (edge: { call: (r: Request) => Promise<Response> }): Server => createServer(async (req, res) => {
  const raw = req.method === 'GET' || req.method === 'HEAD' ? undefined : await body(req)
  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string' && !['host', 'connection', 'content-length', 'transfer-encoding'].includes(k)) headers[k] = v
  const r = await edge.call(new Request(`https://door.invalid${req.url}`, { method: req.method ?? 'GET', headers, ...(raw === undefined ? {} : { body: raw }) }))
  const out: Record<string, string> = {}
  r.headers.forEach((v, k) => { if (!['transfer-encoding', 'connection', 'content-length', 'content-encoding'].includes(k)) out[k] = v })
  res.writeHead(r.status, out)
  res.end(await r.text())
})
const listen = (s: Server): Promise<number> => new Promise((r) => s.listen(0, '127.0.0.1', () => r((s.address() as any).port)))
const gwServer = forward(gwEdge)
const mcpServer = forward(mcpEdge)
const gwPort = await listen(gwServer)
const mcpPort = await listen(mcpServer)
const GATEWAY_URL = `http://127.0.0.1:${gwPort}/functions/v1/engine`
const MCP_URL = `http://127.0.0.1:${mcpPort}/functions/v1/mcp`

// ---- the model (a scripted double) and the two Hermes instances --------------------------------------------------------------------
const llmLog = join(outDir, 'llm.jsonl')
const llm = await startLlmDouble(llmLog)
const hermesKey = `hk${createHash('sha256').update(`k-${run}`).digest('hex')}`
const hermesOpts = (label: string, port: number, mcpInclude?: readonly string[]) => ({ hostDir: resolve(hostDir), home: join(outDir, 'homes', label), outDir, port, apiKey: hermesKey, modelBase: llm.url, mcpUrl: MCP_URL, mcpToken: creds.mcpToken, fetcher: (u: string) => realFetch(u), ...(mcpInclude === undefined ? {} : { mcpInclude }), label })
let hermes: HermesHost | null = null
let widened: HermesHost | null = null
const children: { stop: () => void }[] = []

// ---- the worker side ------------------------------------------------------------------------------------------------------------------
const modelCalls: string[] = []
const modelFetch = (async (url: string) => { modelCalls.push(String(url)); return new Response(JSON.stringify({ error: { message: 'no team model in this proof' } }), { status: 500 }) }) as unknown as typeof fetch
const tgSent: string[] = []
const edgeFetch = globalThis.fetch
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input)
  const m = /^https:\/\/api\.telegram\.org\/bot([^/]+)\/(\w+)/.exec(url)
  if (m === null) return edgeFetch(input, init)
  const payload = JSON.parse(String(init?.body ?? '{}')) as { text?: string }
  if (m[2] === 'sendMessage') tgSent.push(String(payload.text ?? ''))
  return new Response(JSON.stringify({ ok: true, result: { message_id: 9000 + tgSent.length } }), { status: 200 })
}) as typeof fetch
const router = new ProviderRouter(db, 'k', modelFetch, 4, { requestTimeoutMs: 2_000 })
const review: Reviewer = async () => ({ status: 'approved', notes: 'engine-bridge proof' })
const handlers: Handler[] = [instructionHandler({ db, router })]
const notify = combinedNotifier([replyChannel(db)], db)
let tickNo = 0
const tick = async (): Promise<void> => { await drain(db, `eb-${run}-${String(++tickNo)}`, handlers, review, 25, { notify, canTranscribe: false, canSubprocess: false }) }
const quiet = async (): Promise<void> => {
  await q(`update public.jobs set state = 'cancelled' where state in ('paused','queued','retrying','running') and office_id = ${lit(A)}::uuid`)
}
const sendTurn = async (text: string): Promise<{ job: string }> => {
  await registerBot(db)
  const k = realTelegramKey()
  const cmd = await one(`set local application_name = 'PostgREST 14.5';
    insert into public.inbound_commands (office_id, project_id, origin_channel, origin_ref, actor, instruction, dedupe_key, subject, engine)
    values (app.operator_office(), ${lit(P1.id)}::uuid, 'telegram', '${CHAT}:${k.split(':').pop() ?? '1'}', '${CHAT}', ${lit(text)}, ${lit(k)}, 'grant', 'hermes')
    returning command_id::text as id`)
  const enq = json((await one(`set local application_name = 'PostgREST 14.5'; select public.enqueue_inbound(${lit(String(cmd.id))}::uuid) as v`)).v)
  return { job: String(enq.job_id) }
}
const jobState = async (job: string): Promise<string> => String((await one(`select state::text s from public.jobs where job_id = ${lit(job)}::uuid`)).s)
const runRow = async (job: string): Promise<Record<string, any>> => one(`select run_id::text id, state, failure, result, hermes_run_id from public.engine_runs where job_id = ${lit(job)}::uuid`)
const outputOf = async (job: string): Promise<Record<string, any>> => one(`select body, evidence, model, sources from public.outputs where job_id = ${lit(job)}::uuid and body <> 'Hermes is working on it.' order by created_at desc limit 1`)
const callsOf = async (runId: string): Promise<Record<string, any>[]> => q(`select tool, verdict, domain, complete, because, result_excerpt from public.engine_run_calls where run_id = ${lit(runId)}::uuid order by at, call_id`)

const bridgeEnv = { ENGINE_GATEWAY_URL: GATEWAY_URL, ENGINE_BRIDGE_TOKEN: creds.bridgeToken, HERMES_URL: '', HERMES_API_KEY: hermesKey, ENGINE_BRIDGE_ALLOW_INSECURE_LOOPBACK: '1' }
const mkBridge = (host: HermesHost, timing: Record<string, number> = {}): Bridge => {
  const parsed = parseBridgeConfig({ ...bridgeEnv, HERMES_URL: host.url })
  if (!parsed.ok) throw new Error(`the proof's own bridge configuration was refused: ${parsed.problems.join('; ')}`)
  const f = (i: string, init?: RequestInit): Promise<Response> => realFetch(i, init)
  return new Bridge({ hermes: new HermesClient(parsed.config.hermesUrl, parsed.config.hermesKey, f), gateway: new GatewayClient(parsed.config.gatewayUrl, parsed.config.bridgeToken, f), config: parsed.config, timing, log: (l) => console.log(`     bridge-log: ${l}`) })
}
let lastClaimAt = 0
// The gateway's claim throttle is five seconds from the moment the PREVIOUS claim reached it, which is later than the moment this proof
// started it (a preflight comes first), so the margin is generous.
const spaced = async (): Promise<void> => { const w = lastClaimAt + 7_000 - Date.now(); if (w > 0) await sleep(w); lastClaimAt = Date.now() }

interface Trial { job: string; ended: Awaited<ReturnType<Bridge['runClaimed']>> | null; state: string; out: Record<string, any>; row: Record<string, any>; calls: Record<string, any>[] }
const trial = async (host: HermesHost, text: string, o: { stopAfterMs?: number; timing?: Record<string, number> } = {}): Promise<Trial> => {
  await fresh()
  const t = await sendTurn(text)
  await tick()
  await spaced()
  const bridge = mkBridge(host, o.timing)
  if (o.stopAfterMs !== undefined) setTimeout(() => { void q(`select app.request_stop(${lit(A)}::uuid, ${lit(t.job)}::uuid, null)`) }, o.stopAfterMs)
  const polled = await bridge.pollOnce()
  await tick()
  const row = await runRow(t.job)
  const st = await jobState(t.job)
  console.log(`     trial "${text.slice(0, 40)}": bridge ${polled.ran === null ? `ran nothing (wait ${String(polled.waitMs)} ms, fatal ${String(polled.fatal)})` : `${polled.ran.outcome}/${polled.ran.reason}`}; job ${st}; run ${String(row.state)} ${String(row.failure ?? row.result?.failure ?? '')}`)
  return { job: t.job, ended: polled.ran, state: st, out: await outputOf(t.job), row, calls: await callsOf(String(row.id)) }
}
const containments: string[] = []
const note = (t: Trial): Trial => { const f = String(t.row.result?.failure ?? t.row.failure ?? ''); if (f.startsWith('containment')) containments.push(f); return t }

try {
  hermes = await startHermes(hermesOpts('restricted', 18_940))
  const version = await realFetch(`${hermes.url}/health`).then((r) => r.json()).catch(() => ({}))
  console.log(`Hermes is up on a loopback port (${JSON.stringify(version)}); the model is the scripted double; no real provider is configured.`)
  await quiet()

  // ---- R1 to R4: completed runs, one with each read tool ------------------------------------------------------------------------------
  const r1 = note(await trial(hermes, 'say hello'))
  check('R1 a plain turn: the real bridge claims through the real gateway, the real Hermes answers, the job is woken and the answer is delivered to the chat as an inference', r1.ended?.outcome === 'completed' && r1.state === 'complete' && String(r1.out.body).length > 0 && r1.out.evidence === 'inferred' && tgSent.some((t) => t.length > 0), `${r1.ended?.outcome} / ${r1.state} / ${String(r1.out.body).slice(0, 40)}`)
  const usage1 = await q(`select provider, cost_usd::text c from public.inference_usage where job_id = ${lit(r1.job)}::uuid`)
  check('R2 the only usage on the job is Hermes\'s, at zero cost, and no team model was asked', usage1.length === 1 && usage1[0]?.provider === 'hermes' && Number(usage1[0]?.c) === 0 && modelCalls.length === 0, JSON.stringify(usage1))
  const r3 = note(await trial(hermes, 'CALL list_tasks {}'))
  const lt = r3.calls.find((c) => c.tool === 'list_tasks')
  check('R3 Hermes called an office tool through the real MCP function: the read is served, recorded against the run as a complete tasks read, and the answer is built from it', r3.state === 'complete' && lt?.verdict === 'served' && lt.domain === 'tasks' && lt.complete === true && String(lt.result_excerpt).includes(CANARY) && String(r3.out.body).startsWith('OK:') && (r3.out.sources as string[]).includes('hermes:list_tasks'), `${r3.calls.map((c) => `${c.tool}:${c.verdict}`).join(',')} / ${(r3.out.sources ?? []).join(',')}`)
  const r4 = note(await trial(hermes, `CALL search_documents {"query":"${CANARY}"}`))
  const sd = r4.calls.find((c) => c.tool === 'search_documents')
  check('R4 a document search through Hermes finds the project\'s document, is recorded as documents and NOT complete, and cites the tool', r4.state === 'complete' && sd?.verdict === 'served' && sd.domain === 'documents' && sd.complete === false && String(sd.result_excerpt).includes(CANARY) && (r4.out.sources as string[]).includes('hermes:search_documents'))
  const r4b = note(await trial(hermes, 'CALL list_projects {}'))
  check('R5 the project list is a complete read of the projects domain', r4b.calls.some((c) => c.tool === 'list_projects' && c.domain === 'projects' && c.complete === true) && r4b.state === 'complete')

  // ---- R6: a provider rate limit fails the run in plain words ------------------------------------------------------------------------
  const r6 = note(await trial(hermes, 'RATELIMIT'))
  check('R6 a provider rate limit (the free model is busy) fails the run; the person is told in plain words and nothing is retried by the team', r6.ended?.outcome === 'failed' && /couldn't finish this \(the free model it uses was busy\)/.test(String(r6.out.body)) && modelCalls.length === 0, String(r6.out.body).slice(0, 100))

  // ---- R7: Hermes retries a provider 500 for ever; the bridge's no-progress limit stops it and frees the slot ----------------------------
  const r7 = note(await trial(hermes, 'ERR500', { timing: { noProgressMs: 7_000 } }))
  check('R7 a provider 500 (which Hermes retries for ever) is stopped by the bridge\'s no-progress limit and told plainly', r7.ended?.outcome === 'failed' && String(r7.row.result?.failure) === 'no_progress' && /stopped making progress/.test(String(r7.out.body)), String(r7.row.result?.failure))
  const r7b = note(await trial(hermes, 'say hello again'))
  check('R8 and the Hermes slot was freed: the very next run is accepted (a stuck run would be refused as too many concurrent runs)', r7b.ended?.outcome === 'completed' && r7b.state === 'complete', `${r7b.ended?.outcome}`)

  // ---- R9: the person presses Stop ----------------------------------------------------------------------------------------------------
  const r9 = await trial(hermes, 'SLOW 30', { stopAfterMs: 3_000 })
  check('R9 the person\'s Stop cancels the job, the next heartbeat reaches the real Hermes, the run is cancelled and nothing is answered or delivered', r9.state === 'cancelled' && String(r9.row.state) === 'cancelled' && r9.out.body === undefined && (await n(`select count(*)::int n from public.deliveries where job_id = ${lit(r9.job)}::uuid`)) === 0, `${r9.state} / ${String(r9.row.state)}`)
  const r9b = note(await trial(hermes, 'say hello once more'))
  check('R10 and the slot is free again after the stop', r9b.ended?.outcome === 'completed', `${r9b.ended?.outcome}`)

  // ---- R11: a tool the model asks for that is not offered ----------------------------------------------------------------------------
  const tasksBefore = await n(`select count(*)::int n from public.tasks where project_id = ${lit(P1.id)}::uuid`)
  const r11 = note(await trial(hermes, 'FORCECALL terminal {"command":"touch /tmp/pwned"}'))
  check('R11 a tool call to something that is not offered (a terminal) executes nothing: the run ends, no containment was needed, and no file appeared', r11.state === 'complete' || r11.state === 'failed' || r11.state === 'cancelled', `${r11.ended?.outcome}: ${String(r11.out.body).slice(0, 80)}`)
  let pwned = false
  try { readFileSync('/tmp/pwned'); pwned = true } catch { /* absent */ }
  check('R12 and nothing was written to the machine', !pwned)

  // ---- R13: Hermes configured WIDER than the office allows. The bridge and the server both refuse. ---------------------------------------
  widened = await startHermes(hermesOpts('widened', 18_941, ['list_projects', 'list_tasks', 'create_task', 'add_to_project', 'ask_team']))
  // The office's MCP function narrows tools/list for an engine client, so a Hermes configured to include write tools is still never OFFERED
  // them: ask the real Hermes what it offered the model (the double's TOOLS verb reports exactly the tool definitions Hermes sent).
  const r13 = note(await trial(widened, 'TOOLS'))
  const offeredText = String(r13.out.body)
  const writeTools = ['create_task', 'add_to_project', 'ask_team', 'update_task', 'start_research']
  check('R13 with Hermes CONFIGURED to include write tools, the real Hermes still offers the model only the office\'s read tools: the server never lists a write tool to an engine client', r13.state === 'complete' && offeredText.includes('TOOLS:') && offeredText.includes('mcp__office__list_tasks') && !writeTools.some((t) => offeredText.includes(t)), offeredText.slice(0, 160))
  const r13b = note(await trial(widened, `FORCECALL mcp__office__create_task {"project":"${P1.slug}","title":"must never exist ${run}"}`))
  const created = await n(`select count(*)::int n from public.tasks where project_id = ${lit(P1.id)}::uuid and title like 'must never exist%'`)
  // OBSERVED: Hermes repairs an unknown tool name to the nearest offered one (create_task became list_tasks), so a hallucinated write call
  // either is refused as unknown or lands on a READ tool the office serves; it can never reach a write tool, because none was ever offered.
  const only = r13b.calls.every((c) => ENGINE_READ_TOOLS.includes(c.tool))
  check('R13b and a model that asks for a write tool anyway (a hallucinated call) cannot reach one: Hermes refuses it as unknown or repairs it onto an offered READ tool, every recorded call is a read tool, and no task is created', created === 0 && only && (String(r13b.out.body).includes('does not exist') || r13b.calls.length > 0), `calls ${r13b.calls.map((c) => c.tool).join(',') || 'none'}: ${String(r13b.out.body).slice(0, 80)}`)
  check('R14 the office\'s task count for the project is unchanged', (await n(`select count(*)::int n from public.tasks where project_id = ${lit(P1.id)}::uuid`)) === tasksBefore)
  await widened.stop()
  widened = null

  // ---- R15: the bridge process is killed while it holds a run; a new one re-attaches to the SAME Hermes run -----------------------------
  await fresh()
  // One agent turn is one model request that offers tools; Hermes's own side calls (a title) offer none and are not a second conversation.
  const agentTurns = (needle: string): number => readFileSync(llmLog, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l) as { command?: string; offered?: string[] }).filter((e) => String(e.command).startsWith(needle) && (e.offered ?? []).length > 0).length
  const slowBefore = agentTurns('SLOW 14')
  const t15 = await sendTurn('SLOW 14')
  await tick()
  const childEnv = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: outDir, ...bridgeEnv, HERMES_URL: hermes.url }
  const tsx = join(root, 'node_modules/.bin/tsx')
  const spawnChild = (label: string) => {
    const proc = spawn(tsx, ['scripts/isolated/engine-bridge-child.ts'], { cwd: root, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] })
    const lines: string[] = []
    proc.stdout?.on('data', (d: Buffer) => lines.push(`${label}: ${d.toString()}`))
    proc.stderr?.on('data', (d: Buffer) => lines.push(`${label}! ${d.toString()}`))
    children.push({ stop: () => { proc.kill('SIGKILL') } })
    return { proc, lines }
  }
  await spaced()
  const a = spawnChild('A')
  // wait until the bridge has told the office which Hermes run it started (the first heartbeat)
  let hermesRunId: string | null = null
  for (let i = 0; i < 120 && hermesRunId === null; i += 1) { await sleep(250); hermesRunId = (await runRow(t15.job)).hermes_run_id ?? null }
  a.proc.kill('SIGKILL')
  check('R15 the first bridge process told the office its Hermes run id (so a restart can attach), and was then killed outright', hermesRunId !== null && /^run_[0-9a-f]{32}$/.test(String(hermesRunId)), String(hermesRunId))
  await sleep(1_500)
  const b = spawnChild('B')
  for (let i = 0; i < 160 && (await runRow(t15.job)).state !== 'completed'; i += 1) await sleep(250)
  await tick()
  b.proc.kill('SIGTERM')
  const finalRow = await runRow(t15.job)
  const slowAfter = agentTurns('SLOW 14')
  check('R16 a restarted bridge re-attached to the SAME live Hermes run (one model conversation, not two) and the run completed with the same Hermes run id', finalRow.state === 'completed' && finalRow.hermes_run_id === hermesRunId && slowAfter - slowBefore === 1, `state ${String(finalRow.state)}, model requests for that turn ${slowAfter - slowBefore}`)
  check('R17 the job was answered from that run and delivered', (await jobState(t15.job)) === 'complete' && String((await outputOf(t15.job)).body).length > 0)

  // ---- the pass mark --------------------------------------------------------------------------------------------------------------------
  check('R18 zero containment events across every run that was not deliberately given a write tool', containments.every((c) => c.includes('create_task')), containments.join(',') || 'none')
  check('R19 zero team-model calls and zero calls of any model other than the scripted double (there is no provider configured on this host)', modelCalls.length === 0)
  const live = await q(`select run_id::text id from public.engine_runs where office_id = ${lit(A)}::uuid and state in ('open','running') and job_id in (select job_id from public.jobs where state <> 'cancelled')`)
  check('R20 no run was left live and unowned', live.length === 0, `${live.length} live`)
} finally {
  for (const c of children) c.stop()
  await hermes?.stop().catch(() => undefined)
  await widened?.stop().catch(() => undefined)
  await llm.stop().catch(() => undefined)
  await quiet()
  await q(`update public.system_config set value = '[]'::jsonb where key = ${lit(SETTING.offices)}`).catch(() => undefined)
  await q(`update public.engine_bridges set enabled = false where bridge_id = ${lit(BRIDGE)}::uuid`).catch(() => undefined)
  gwServer.closeAllConnections()
  mcpServer.closeAllConnections()
  gwServer.close()
  mcpServer.close()
}
const failed = results.filter((r) => !r).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
process.exit(failed === 0 ? 0 : 1)
