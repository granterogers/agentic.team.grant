// biome-ignore-all lint/suspicious/noExplicitAny: SQL results and JSON-RPC bodies are untyped
// biome-ignore-all format: a dense proof script kept readable as written
/**
 * The engine MCP client (supabase/functions/mcp), the REAL function, run in Node against the isolated replica (Hermes, M3).
 *
 *   bash scripts/isolated/replica.sh && npx tsx scripts/isolated/engine-mcp.ts <replica-db>
 *
 * Two projects of one office each hold a document and a task with a canary word. An outside agent's credential (an MCP client of kind
 * `engine`) is driven through tools/list and tools/call:
 *   - before any run it can LIST its tools (Hermes connects at start-up) but cannot CALL one;
 *   - during a live run it may call the v1 read tools, and the run's project is forced into every tool that takes one, so it can read
 *     that project and no other (an ordinary client with the same call sees both: the control that the forcing is what narrows);
 *   - a write tool is refused by the gate even when the client is (wrongly) given the write scope, and the refusal is recorded;
 *   - every served read is recorded against the run (domain, completeness, a redacted excerpt, a hash of the final arguments);
 *   - ChatGPT and Claude clients are unaffected: same tool list, writes still work, and the gate answer for them is remembered so they
 *     do not pay a round trip per call;
 *   - a gate that cannot answer fails CLOSED for a client it cannot classify, and a database that predates the engine (no such
 *     function) leaves ordinary clients alone.
 * Then the function is put back wrong in scratch copies (never committed): each defect must turn its probe red.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { generateCredentials } from '../../src/engines/hermes/credentials.ts'
import { SETTING } from '../../src/engines/hermes/timing.ts'
import { canonicalJson, ENGINE_READ_TOOLS } from '../../supabase/functions/mcp/tools.ts'
import { startEdge } from './edge-emulator.ts'
import { isolated } from './guard.ts'
import { BOT, CHAT, realTelegramKey, registerBot } from './real-telegram.ts'

const DB = process.argv[2] ?? 'post'
const db = await isolated(DB)
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const run = Date.now().toString(36)
const results: boolean[] = []
const check = (what: string, ok: boolean, detail = ''): void => {
  results.push(ok)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail === '' ? '' : ` - ${detail}`}`)
}
const q = async (sql: string): Promise<Record<string, any>[]> => (await db.execute(sql)).rows as Record<string, any>[]
const one = async (sql: string): Promise<Record<string, any>> => (await q(sql))[0] ?? {}
const json = (v: unknown): any => (typeof v === 'string' ? JSON.parse(v) : v)
const sha = (s: string): string => createHash('sha256').update(s).digest('hex')

const A = String((await one('select app.operator_office()::text o')).o)
const key = `engmcp-${run}`
const mkProject = async (tag: string): Promise<{ id: string; slug: string }> => {
  const name = `Engmcp ${tag} ${run}`
  const id = String(json((await one(`select app.hq_create_project(${lit(A)}::uuid, ${lit(name)}, 'upload', ${lit(`engmcp-${tag}-${run}`)}, ${lit(name)}, true) as v`)).v).project_id)
  const slug = String((await one(`select slug from public.projects where project_id = ${lit(id)}::uuid`)).slug)
  return { id, slug }
}
const P1 = await mkProject('one')
const P2 = await mkProject('two')
const C1 = `zqone${run}`.replace(/[^a-z0-9]/g, '')
const C2 = `zqtwo${run}`.replace(/[^a-z0-9]/g, '')

// An ordinary (ChatGPT-like) writing client, which also seeds the documents.
const plainToken = `plain-${run}-${'p'.repeat(24)}`
const PLAIN = `engmcp-plain-${run}`
await q(`insert into public.mcp_clients (client_id, display_name, token_sha256, scopes, office_id, kind) values (${lit(PLAIN)}, 'engine proof ordinary client', ${lit(sha(plainToken))}, array['read','write'], ${lit(A)}::uuid, 'chatgpt')`)
const secretShape = `${'sk'}-${'r'.repeat(30)}`
await q(`select app.mcp_add_document(p_office => ${lit(A)}::uuid, p_client_id => ${lit(PLAIN)}, p_project => ${lit(P1.slug)}, p_title => 'plan one', p_content => ${lit(`The first project plan mentions ${C1}. Its deploy key is ${secretShape}.`)})`)
await q(`select app.mcp_add_document(p_office => ${lit(A)}::uuid, p_client_id => ${lit(PLAIN)}, p_project => ${lit(P2.slug)}, p_title => 'plan two', p_content => ${lit(`The second project plan mentions ${C2}.`)})`)
await q(`select app.task_add(p_office => ${lit(A)}::uuid, p_project => ${lit(P1.id)}::uuid, p_title => ${lit(`task one ${C1}`)}, p_added_by => ${lit(key)})`)
await q(`select app.task_add(p_office => ${lit(A)}::uuid, p_project => ${lit(P2.id)}::uuid, p_title => ${lit(`task two ${C2}`)}, p_added_by => ${lit(key)})`)

// The engine credential: a bridge and its MCP client, minted as the operator command does.
await q(`insert into public.system_config (key, value, description) values (${lit(SETTING.offices)}, ${lit(JSON.stringify([A]))}::jsonb, 'engine mcp proof') on conflict (key) do update set value = excluded.value`)
await q(`insert into public.system_config (key, value, description) values (${lit(SETTING.dailyRuns)}, '900'::jsonb, 'engine mcp proof') on conflict (key) do update set value = excluded.value`)
const creds = generateCredentials()
const minted = json((await one(`select app.engine_mint_bridge(${lit(A)}::uuid, 'hermes', ${lit(`mcp proof ${run}`)}, ${lit(creds.bridgeSha256)}, ${lit(creds.mcpSha256)}) r`)).r)
const BRIDGE = minted.bridge_id as string
const ENGINE_CLIENT = minted.mcp_client_id as string
const ENGINE_TOKEN = creds.mcpToken
const touch = async (): Promise<void> => { await q(`update public.engine_bridges set last_seen_at = now(), healthy = true where bridge_id = ${lit(BRIDGE)}::uuid`) }

const realJobIn = async (projectId: string): Promise<string> => {
  await registerBot(db)
  const k = realTelegramKey()
  const cmd = await one(`set local application_name = 'PostgREST 14.5';
    insert into public.inbound_commands (office_id, project_id, origin_channel, origin_ref, actor, instruction, dedupe_key, subject)
    values (app.operator_office(), ${lit(projectId)}::uuid, 'telegram', '${CHAT}:${k.split(':').pop() ?? '1'}', '${CHAT}', 'A real turn for the engine proof', ${lit(k)}, 'grant')
    returning command_id::text as id`)
  const enq = json((await one(`set local application_name = 'PostgREST 14.5'; select public.enqueue_inbound(${lit(String(cmd.id))}::uuid) as v`)).v)
  void BOT
  return String(enq.job_id)
}
const GOOD = { input: 'What is in this project?', instructions: 'You answer for the office.', conversation_history: [] as unknown[] }
/** A run in the `running` state, bound to a project, held by the engine bridge. Any earlier run of the bridge is cleared first. */
const liveRun = async (project: { id: string }): Promise<{ job: string; runId: string }> => {
  await q(`update public.engine_runs set state = 'cancelled', finished_at = now(), lease_until = null where bridge_id = ${lit(BRIDGE)}::uuid and state = 'running'`)
  await q(`update public.engine_runs set state = 'cancelled', finished_at = now() where office_id = ${lit(A)}::uuid and state = 'open'`)
  await touch()
  const job = await realJobIn(project.id)
  await q(`select app.pause_job(${lit(job)}::uuid, 'dependency_wait', 'Hermes is working on it.', 'Waiting for Hermes to finish.', true, null, null)`)
  const o = json((await one(`select app.engine_run_open(${lit(A)}::uuid, ${lit(job)}::uuid, 'hermes', ${lit(JSON.stringify(GOOD))}::jsonb) r`)).r)
  if (typeof o.run_id !== 'string') throw new Error(`could not open: ${JSON.stringify(o)}`)
  const c = json((await one(`select app.engine_run_claim(${lit(A)}::uuid, ${lit(BRIDGE)}::uuid) r`)).r)
  if (c.run?.run_id !== o.run_id) throw new Error(`the claim did not return the run: ${JSON.stringify(c)}`)
  return { job, runId: o.run_id }
}
const calls = async (runId: string): Promise<Record<string, any>[]> => q(`select tool, verdict, because, domain, complete, result_chars, result_excerpt, args_sha256 from public.engine_run_calls where run_id = ${lit(runId)}::uuid order by at, call_id`)

// ---- the door -------------------------------------------------------------------------------------------------------------------
const rpcLog: { fn: string; client?: string }[] = []
const wrapRecorder = (): void => {
  const inner = globalThis.fetch
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input instanceof Request ? input.url : input)
    const m = /\/rest\/v1\/rpc\/([a-z_]+)$/.exec(url)
    if (m?.[1] !== undefined) rpcLog.push({ fn: m[1], client: (JSON.parse(String(init?.body ?? '{}')) as any).p_mcp_client })
    return inner(input, init)
  }) as typeof fetch
}
let nextId = 1
interface Reply { status: number; body: any }
const driver = (edge: { call: (r: Request) => Promise<Response> }) => {
  const rpc = async (bearer: string | null, method: string, params?: Record<string, unknown>): Promise<Reply> => {
    const r = await edge.call(new Request('https://door.invalid/functions/v1/mcp', { method: 'POST', headers: { 'content-type': 'application/json', ...(bearer === null ? {} : { authorization: `Bearer ${bearer}` }) }, body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }) }))
    const text = await r.text()
    let body: any = {}
    try { body = JSON.parse(text) } catch { /* not JSON */ }
    return { status: r.status, body }
  }
  const call = (bearer: string, name: string, args: Record<string, unknown> = {}): Promise<Reply> => rpc(bearer, 'tools/call', { name, arguments: args })
  const list = async (bearer: string): Promise<string[]> => ((await rpc(bearer, 'tools/list')).body.result?.tools ?? []).map((t: any) => String(t.name)).sort()
  return { rpc, call, list }
}
const textOf = (r: Reply): string => String(r.body.result?.content?.[0]?.text ?? '')
const isErrorResult = (r: Reply): boolean => r.body.result?.isError === true
const refusedAny = (r: Reply): boolean => isErrorResult(r) || r.body.error !== undefined

const edgeOpts = { db, edgeFile: 'supabase/functions/mcp/index.ts', env: { HQ_API_TOKEN: `machine-${run}`, SUPABASE_SERVICE_ROLE_KEY: 'isolated-service-key', SUPABASE_ANON_KEY: 'anon' } }
const edge = await startEdge(edgeOpts)
wrapRecorder()
const g = driver(edge)

try {
  // ============================================================================================================================
  // the catalogue each client is shown
  // ============================================================================================================================
  const plainList = await g.list(plainToken)
  const engineList = await g.list(ENGINE_TOKEN)
  check('M1 an engine client, before any run exists, is shown exactly the v1 read tools (and the calendar one only where this database serves it): Hermes connects at start-up and lists its tools then', engineList.length >= 9 && engineList.every((n) => ENGINE_READ_TOOLS.includes(n)) && ENGINE_READ_TOOLS.filter((t) => t !== 'list_events').every((t) => engineList.includes(t)), engineList.join(','))
  check('M2 it is shown no write tool, and an ordinary client is shown them (the control that the engine list is a narrowing, not an empty server)', !engineList.some((n) => ['create_task', 'update_task', 'add_to_project', 'ask_team', 'start_research', 'generate_artifact', 'notebook_generate', 'push_to_notebook', 'ask_notebook', 'create_event', 'update_event'].includes(n)) && ['create_task', 'add_to_project', 'ask_team'].every((n) => plainList.includes(n)) && plainList.length > engineList.length, `ordinary ${plainList.length}, engine ${engineList.length}`)

  // ============================================================================================================================
  // before a run: nothing can be called
  // ============================================================================================================================
  await q(`update public.engine_runs set state = 'cancelled', finished_at = now(), lease_until = null where bridge_id = ${lit(BRIDGE)}::uuid and state = 'running'`)
  const noRun = await g.call(ENGINE_TOKEN, 'list_projects')
  const noRunAudit = await one(`select outcome from public.mcp_calls where client_id = ${lit(ENGINE_CLIENT)} order by called_at desc, call_id desc limit 1`)
  check('M3 with no run in progress a call is refused with the reason, as a result the model can read (not a transport error), nothing is read, and the refusal is in the MCP call log', noRun.status === 200 && isErrorResult(noRun) && textOf(noRun).includes('no run in progress') && !textOf(noRun).includes('harvest') && noRunAudit.outcome === 'refused', textOf(noRun))

  // ============================================================================================================================
  // during a run: the v1 reads, bound to the run's project
  // ============================================================================================================================
  const r1 = await liveRun(P1)
  const projects = await g.call(ENGINE_TOKEN, 'list_projects')
  check('M4 during a live run an allowed read is served: list_projects returns the office\'s projects (office-wide, as the contract says), as ordinary text', !refusedAny(projects) && textOf(projects).includes(P1.slug) && textOf(projects).includes(P2.slug), textOf(projects).slice(0, 80))
  const tasksNoProject = await g.call(ENGINE_TOKEN, 'list_tasks', {})
  const tasksNamingOther = await g.call(ENGINE_TOKEN, 'list_tasks', { project: P2.slug })
  const plainTasks = await g.call(plainToken, 'list_tasks', {})
  check("M5 the run's project is FORCED: list_tasks with no project returns only this run's project, and naming another project still returns only this run's (an ordinary client with the same call sees both: the control that the forcing is what narrows)", textOf(tasksNoProject).includes(C1) && !textOf(tasksNoProject).includes(C2) && textOf(tasksNamingOther).includes(C1) && !textOf(tasksNamingOther).includes(C2) && textOf(plainTasks).includes(C1) && textOf(plainTasks).includes(C2), `forced ${textOf(tasksNoProject).includes(C2) ? 'LEAKED' : 'one'} / named ${textOf(tasksNamingOther).includes(C2) ? 'LEAKED' : 'one'} / ordinary ${textOf(plainTasks).includes(C2) ? 'both' : 'one'}`)
  const docsMine = await g.call(ENGINE_TOKEN, 'search_documents', { query: C1 })
  const docsOther = await g.call(ENGINE_TOKEN, 'search_documents', { query: C2 })
  const docsOtherNamed = await g.call(ENGINE_TOKEN, 'search_documents', { query: C2, project: P2.slug })
  const plainDocsOther = await g.call(plainToken, 'search_documents', { query: C2 })
  check("M6 a search can reach this run's project's documents and no other's, even when the model names the other project; an ordinary client finds the other project's document (control)", textOf(docsMine).includes(C1) && !textOf(docsOther).includes(C2) && !textOf(docsOtherNamed).includes(C2) && textOf(plainDocsOther).includes(C2), `mine ${textOf(docsMine).includes(C1)}, other ${textOf(docsOther).includes(C2)}, ordinary ${textOf(plainDocsOther).includes(C2)}`)
  const searchProject = await g.call(ENGINE_TOKEN, 'search_project', { query: C2 })
  const activity = await g.call(ENGINE_TOKEN, 'inspect_activity', { project: P2.slug })
  check('M7 the other project-taking reads (search_project, inspect_activity) are forced to the run\'s project as well', !textOf(searchProject).includes(C2) && !refusedAny(activity) && !textOf(activity).includes(C2), 'no canary of the other project in either')

  // every served read is recorded against the run
  const rows = await calls(r1.runId)
  const served = rows.filter((r) => r.verdict === 'served')
  const boundTasks = sha(canonicalJson({ project: P1.slug }))
  const taskRows = served.filter((r) => r.tool === 'list_tasks')
  check('M8 every served read is recorded against the run: tool, domain, whether it was a whole list, size, and a hash of the FINAL arguments (the forced project, not what the model sent: both list_tasks calls hash alike)', served.length >= 8 && taskRows.length === 2 && taskRows.every((r) => r.args_sha256 === boundTasks && r.domain === 'tasks') && taskRows[0]?.args_sha256 === taskRows[1]?.args_sha256, `${served.length} served, task hashes ${taskRows.map((r) => String(r.args_sha256).slice(0, 8)).join(',')}`)
  const proj = served.find((r) => r.tool === 'list_projects')
  const doc = served.find((r) => r.tool === 'search_documents')
  check('M9 list_projects is recorded as a complete read of the projects domain; a search is recorded as documents and NOT complete (a search is not a census)', proj?.domain === 'projects' && proj.complete === true && doc?.domain === 'documents' && doc.complete === false && taskRows.every((r) => r.complete === true), JSON.stringify([proj?.domain, proj?.complete, doc?.complete]))
  const keyDoc = await g.call(ENGINE_TOKEN, 'search_documents', { query: 'deploy key' })
  const afterKey = (await calls(r1.runId)).filter((r) => r.tool === 'search_documents').at(-1)
  check('M10 what the model was shown is untouched, but the STORED excerpt has the credential-shaped text redacted again in SQL', textOf(keyDoc).includes('r'.repeat(30)) && !String(afterKey?.result_excerpt).includes('r'.repeat(30)) && String(afterKey?.result_excerpt).includes('[redacted]'), String(afterKey?.result_excerpt).slice(0, 80))
  const grounding = json((await one(`select app.engine_run_grounding(${lit(A)}::uuid, ${lit(r1.runId)}::uuid) r`)).r)
  check('M11 the grounding the coherence gates will read names the domains actually read and the complete ones (the projects list and the unfiltered task list), from the SERVED calls only', JSON.stringify(grounding.domains) === '["documents","projects","tasks"]' && JSON.stringify(grounding.complete_domains) === '["projects","tasks"]', JSON.stringify([grounding.domains, grounding.complete_domains]))

  // ============================================================================================================================
  // refusals inside a run
  // ============================================================================================================================
  await q(`update public.mcp_clients set scopes = array['read','write'] where client_id = ${lit(ENGINE_CLIENT)}`)
  const tasksBefore = Number((await one(`select count(*)::int n from public.tasks where project_id in (${lit(P1.id)}::uuid, ${lit(P2.id)}::uuid)`)).n)
  const writeTool = await g.call(ENGINE_TOKEN, 'create_task', { project: P1.slug, title: `should never exist ${run}` })
  const addDoc = await g.call(ENGINE_TOKEN, 'add_to_project', { project: P1.slug, title: 'x', content: 'x' })
  const askTeam = await g.call(ENGINE_TOKEN, 'ask_team', { project: P1.slug, question: 'do it' })
  const tasksAfter = Number((await one(`select count(*)::int n from public.tasks where project_id in (${lit(P1.id)}::uuid, ${lit(P2.id)}::uuid)`)).n)
  const refusals = (await calls(r1.runId)).filter((r) => r.verdict === 'refused')
  check('M12 a write tool is refused by the GATE even when the client is wrongly given the write scope (so the allowlist, not the scope, is the barrier): nothing is created, the model is told why, and each refusal is recorded against the run', [writeTool, addDoc, askTeam].every((r) => isErrorResult(r) && textOf(r).includes('not one Hermes may use')) && tasksAfter === tasksBefore && ['create_task', 'add_to_project', 'ask_team'].every((t) => refusals.some((r) => r.tool === t && String(r.because).includes('not one Hermes may use'))), refusals.map((r) => r.tool).join(','))
  await q(`update public.mcp_clients set scopes = array['read'] where client_id = ${lit(ENGINE_CLIENT)}`)
  const scopeOnly = await g.call(ENGINE_TOKEN, 'create_task', { project: P1.slug, title: 'x' })
  check('M13 with the correct read scope the same call is refused at the scope check, before the gate (two barriers, each shown separately)', scopeOnly.body.error?.code === -32602 || isErrorResult(scopeOnly), JSON.stringify(scopeOnly.body).slice(0, 100))
  const unknownTool = await g.call(ENGINE_TOKEN, 'terminal', { command: 'rm -rf /' })
  check('M14 a tool that exists nowhere is "no such tool", as for every client, and reaches nothing', unknownTool.body.error?.code === -32601)

  // the credential dies with the run
  await q(`update public.engine_runs set lease_until = now() - interval '1 second' where run_id = ${lit(r1.runId)}::uuid`)
  const lapsed = await g.call(ENGINE_TOKEN, 'list_tasks', {})
  await q(`update public.engine_runs set lease_until = now() + interval '90 seconds' where run_id = ${lit(r1.runId)}::uuid`)
  const revived = await g.call(ENGINE_TOKEN, 'list_tasks', {})
  check('M15 a run whose lease has lapsed gets nothing (the credential is dead the moment the bridge is); restored, it works again (the control)', isErrorResult(lapsed) && textOf(lapsed).includes('out of time') && !refusedAny(revived))
  await q(`update public.system_config set value = '[]'::jsonb where key = ${lit(SETTING.offices)}`)
  const switchedOff = await g.call(ENGINE_TOKEN, 'list_tasks', {})
  await q(`update public.system_config set value = ${lit(JSON.stringify([A]))}::jsonb where key = ${lit(SETTING.offices)}`)
  check('M16 switching Hermes off for the office stops reads mid-run', isErrorResult(switchedOff) && textOf(switchedOff).includes('switched off'), textOf(switchedOff))
  await q(`update public.engine_runs set state = 'cancelled', finished_at = now(), lease_until = null where run_id = ${lit(r1.runId)}::uuid`)
  const afterEnd = await g.call(ENGINE_TOKEN, 'list_tasks', {})
  check('M17 once the run has ended the credential reads nothing', isErrorResult(afterEnd) && textOf(afterEnd).includes('no run in progress'))

  // recording is best effort and must not fail a read
  const r2 = await liveRun(P1)
  edge.outage(true, 'engine_record_call')
  const unrecorded = await g.call(ENGINE_TOKEN, 'list_tasks', {})
  edge.outage(false)
  check('M18 when the record cannot be written the read still returns (the answer is then ungrounded, which the coherence gates refuse: the safe direction), and the run holds no row for it', !refusedAny(unrecorded) && textOf(unrecorded).includes(C1) && (await calls(r2.runId)).filter((r) => r.tool === 'list_tasks').length === 0)

  // ============================================================================================================================
  // ordinary clients are untouched
  // ============================================================================================================================
  const made = await g.call(plainToken, 'create_task', { project: P1.slug, title: `ordinary writer still works ${run}` })
  check('M19 an ordinary ChatGPT-or-Claude client still writes: create_task works exactly as before', !refusedAny(made) && Number((await one(`select count(*)::int n from public.tasks where title = ${lit(`ordinary writer still works ${run}`)}`)).n) === 1, textOf(made).slice(0, 80))
  const before = rpcLog.filter((c) => c.fn === 'engine_tool_gate' && c.client === PLAIN).length
  for (let i = 0; i < 5; i += 1) await g.call(plainToken, 'list_projects')
  const gateCalls = rpcLog.filter((c) => c.fn === 'engine_tool_gate' && c.client === PLAIN).length - before
  check('M20 the gate answer for an ordinary client is remembered: five more calls cost no further gate round trip, while the engine client is asked on every call', gateCalls === 0 && rpcLog.filter((c) => c.fn === 'engine_tool_gate' && c.client === ENGINE_CLIENT).length >= 10, `${gateCalls} extra gate calls`)
  const fresh = async (tag: string): Promise<{ client: string; token: string }> => {
    const token = `fresh-${tag}-${run}-${'f'.repeat(24)}`
    const client = `engmcp-${tag}-${run}`
    await q(`insert into public.mcp_clients (client_id, display_name, token_sha256, scopes, office_id, kind) values (${lit(client)}, 'engine proof ${tag}', ${lit(sha(token))}, array['read'], ${lit(A)}::uuid, 'claude')`)
    return { client, token }
  }
  const outageClient = await fresh('outage')
  edge.outage(true, 'engine_tool_gate')
  const gateDown = await g.call(outageClient.token, 'list_projects')
  const listDown = await g.rpc(outageClient.token, 'tools/list')
  edge.outage(false)
  const gateUp = await g.call(outageClient.token, 'list_projects')
  check('M21 when the gate cannot answer, a client that cannot be classified is refused (fail CLOSED), both for a call and for the tool list, and the same client works the moment the gate is back', gateDown.body.error?.code === -32603 && listDown.body.error?.code === -32603 && !refusedAny(gateUp))
  const oldDb = await fresh('olddb')
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (input: any, init?: any) => String(input instanceof Request ? input.url : input).endsWith('/rpc/engine_tool_gate') ? new Response(JSON.stringify({ code: 'PGRST202', message: 'Could not find the function' }), { status: 404, headers: { 'content-type': 'application/json' } }) : realFetch(input, init)) as typeof fetch
  const onOldDb = await g.call(oldDb.token, 'list_projects')
  const listOld = await g.list(oldDb.token)
  globalThis.fetch = realFetch
  check('M22 against a database that predates the engine (PostgREST answers 404 for the missing function: SIMULATED, the emulator cannot produce it) an ordinary client is left completely alone: its call is served and its list is the full one', !refusedAny(onOldDb) && listOld.length === plainList.length, `${listOld.length} tools`)

  // ============================================================================================================================
  // the function put back wrong, in scratch copies
  // ============================================================================================================================
  const REAL_INDEX = await readFile('supabase/functions/mcp/index.ts', 'utf8')
  let n = 0
  type Edge = Awaited<ReturnType<typeof startEdge>>
  const probeAgainst = async (what: string, edit: (s: string) => string, probe: (d: ReturnType<typeof driver>, e: Edge) => Promise<boolean>): Promise<void> => {
    n += 1
    const folder = `.out/sab_engine_${run}_${String(n)}/mcp`
    await mkdir(folder, { recursive: true })
    const index = edit(REAL_INDEX)
    const landed = index !== REAL_INDEX
    await writeFile(`${folder}/index.ts`, index)
    await writeFile(`${folder}/tools.ts`, await readFile('supabase/functions/mcp/tools.ts', 'utf8'))
    const bad = await startEdge({ ...edgeOpts, edgeFile: `${folder}/index.ts` })
    wrapRecorder()
    const during = await probe(driver(bad), bad)
    const good = await startEdge(edgeOpts)
    wrapRecorder()
    const after = await probe(driver(good), good)
    check(`sabotage - ${what}`, landed && !during && after, `defect landed ${String(landed)}, probe with the defect ${String(during)} (must be false), real function ${String(after)}`)
  }
  await probeAgainst('the gate is skipped, so an engine client holding the write scope reaches a write tool', (s) => s.replace('const gate = await engineGate(clientOffice, client.client_id, name)', 'const gate: Gate = { allow: true, is_engine: false }'), async (d) => {
    await liveRun(P1)
    await q(`update public.mcp_clients set scopes = array['read','write'] where client_id = ${lit(ENGINE_CLIENT)}`)
    const title = `sabotage task ${randomTag()}`
    const r = await d.call(ENGINE_TOKEN, 'create_task', { project: P1.slug, title })
    await q(`update public.mcp_clients set scopes = array['read'] where client_id = ${lit(ENGINE_CLIENT)}`)
    const made2 = Number((await one(`select count(*)::int n from public.tasks where title = ${lit(title)}`)).n)
    await q(`delete from public.tasks where title = ${lit(title)}`)
    return refusedAny(r) && made2 === 0
  })
  await probeAgainst("the run's project is no longer forced into a tool that takes one", (s) => s.replace(/const callInput =\s+gate\.is_engine \? bindProject\(spec, input, gate\.project_slug \?\? null\) : input/, 'const callInput = input'), async (d) => {
    await liveRun(P1)
    const r = await d.call(ENGINE_TOKEN, 'list_tasks', {})
    return textOf(r).includes(C1) && !textOf(r).includes(C2)
  })
  await probeAgainst('an engine client is shown the whole tool list instead of the engine list', (s) => s.replace('shown = gate.is_engine ? engineVisibleTools(available) : visibleTools(available)', 'shown = visibleTools(available)'), async (d) => !(await d.list(ENGINE_TOKEN)).includes('create_task'))
  await probeAgainst('a served read is no longer recorded against the run', (s) => s.replace(/if \(gate\.is_engine && typeof gate\.run_id === 'string'\)\s+engineRun = \{ runId: gate\.run_id, args: callInput \}/, ''), async (d) => {
    const x = await liveRun(P1)
    await d.call(ENGINE_TOKEN, 'list_tasks', {})
    return (await calls(x.runId)).some((r) => r.verdict === 'served')
  })
  await probeAgainst('a gate that cannot answer lets the client through (fail open)', (s) => s.replace('    throw error\n  }\n  if (answer.is_engine === false', '    return { allow: true, is_engine: false }\n  }\n  if (answer.is_engine === false'), async (d, e) => {
    await liveRun(P1)
    // An engine client is never cached as "not an engine client", so the gate is asked on this call; make it unable to answer.
    e.outage(true, 'engine_tool_gate')
    const r = await d.call(ENGINE_TOKEN, 'list_tasks', {})
    e.outage(false)
    return refusedAny(r) && !textOf(r).includes(C1)
  })
} finally {
  await db.end().catch(() => undefined)
}
function randomTag(): string { return Math.random().toString(36).slice(2, 8) }
const bad = results.filter((r) => !r).length
console.log(`\n${String(results.length - bad)}/${String(results.length)} passed`)
process.exit(bad === 0 ? 0 : 1)
