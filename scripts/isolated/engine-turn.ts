// biome-ignore-all lint/suspicious/noExplicitAny: SQL results and HTTP bodies are untyped
// biome-ignore-all format: a dense proof script kept readable as written
/**
 * The Hermes handler seam, end to end, on the isolated replica (Hermes, M4).
 *
 *   bash scripts/isolated/replica.sh && npx tsx scripts/isolated/engine-turn.ts <replica-db>
 *
 * REAL: the worker (`drain`), the `office.instruction` handler with the two engine calls in it, the SQL of 1070/1071, the engine
 * gateway edge function and the office MCP edge function (both run in Node by edge-emulator.ts, which refuses and records every URL
 * that is not the replica), the reply channel and the delivery service.
 * STAND-INS, each deterministic and sending nothing: the MODEL (a provider fetch that records every call and answers 500, so any
 * team model call is an observation, and Hermes turns must make none), TELEGRAM (a scripted api.telegram.org), and HERMES itself,
 * which is this file acting as the bridge: it claims, heartbeats, reads the office through the MCP function and finishes through the
 * gateway exactly as the bridge in M5 will. Nothing here says anything about what a real Hermes would answer.
 *
 * Every assertion reads canonical rows (engine_runs, engine_run_calls, jobs, outputs, deliveries, inference_usage, routing_decisions),
 * not a return value.
 */
import { createHash } from 'node:crypto'
import { DeliveryService } from '../../src/channels/delivery.ts'
import { combinedNotifier } from '../../src/channels/notify.ts'
import { replyChannel } from '../../src/channels/reply.ts'
import { generateCredentials } from '../../src/engines/hermes/credentials.ts'
import { drainEngineRuns } from '../../src/engines/hermes/drain.ts'
import { SETTING } from '../../src/engines/hermes/timing.ts'
import { instructionHandler } from '../../src/handlers/instruction.ts'
import { drain, type Handler, type Reviewer } from '../../src/jobs/worker.ts'
import { ProviderRouter } from '../../src/providers/router.ts'
import { startEdge } from './edge-emulator.ts'
import { isolated } from './guard.ts'
import { BOT, CHAT, realTelegramKey, registerBot } from './real-telegram.ts'

void DeliveryService
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
const n = async (sql: string): Promise<number> => Number((await one(sql)).n)

const A = String((await one('select app.operator_office()::text o')).o)
const personName = String((await one(`select name from public.offices where office_id = ${lit(A)}::uuid`)).name)
const mkProject = async (tag: string): Promise<{ id: string; slug: string; name: string }> => {
  const name = `Engturn ${tag} ${run}`
  const id = String(json((await one(`select app.hq_create_project(${lit(A)}::uuid, ${lit(name)}, 'upload', ${lit(`engturn-${tag}-${run}`)}, ${lit(name)}, true) as v`)).v).project_id)
  const slug = String((await one(`select slug from public.projects where project_id = ${lit(id)}::uuid`)).slug)
  return { id, slug, name }
}
const P1 = await mkProject('one')
const CANARY = `zqturn${run}`.replace(/[^a-z0-9]/g, '')
const SEEDER = `engturn-seed-${run}`
await q(`insert into public.mcp_clients (client_id, display_name, token_sha256, scopes, office_id, kind) values (${lit(SEEDER)}, 'engine turn proof seeder', ${lit(createHash('sha256').update(`seed-${run}`).digest('hex'))}, array['read','write'], ${lit(A)}::uuid, 'chatgpt')`)
await q(`select app.mcp_add_document(p_office => ${lit(A)}::uuid, p_client_id => ${lit(SEEDER)}, p_project => ${lit(P1.slug)}, p_title => 'plan', p_content => ${lit(`The plan for this project mentions ${CANARY}.`)})`)
await q(`select app.task_add(p_office => ${lit(A)}::uuid, p_project => ${lit(P1.id)}::uuid, p_title => ${lit(`order seed ${CANARY}`)}, p_added_by => ${lit(SEEDER)})`)

await q(`insert into public.system_config (key, value, description) values (${lit(SETTING.offices)}, ${lit(JSON.stringify([A]))}::jsonb, 'engine turn proof') on conflict (key) do update set value = excluded.value`)
await q(`insert into public.system_config (key, value, description) values (${lit(SETTING.dailyRuns)}, '900'::jsonb, 'engine turn proof') on conflict (key) do update set value = excluded.value`)
const creds = generateCredentials()
const minted = json((await one(`select app.engine_mint_bridge(${lit(A)}::uuid, 'hermes', ${lit(`turn proof ${run}`)}, ${lit(creds.bridgeSha256)}, ${lit(creds.mcpSha256)}) r`)).r)
const BRIDGE = String(minted.bridge_id)
const fresh = async (): Promise<void> => { await q(`update public.engine_bridges set last_seen_at = now(), healthy = true, unhealthy_reason = null where bridge_id = ${lit(BRIDGE)}::uuid`) }
const stale = async (): Promise<void> => { await q(`update public.engine_bridges set last_seen_at = now() - interval '10 minutes' where bridge_id = ${lit(BRIDGE)}::uuid`) }
await fresh()

// ---- the doors: the real gateway and the real MCP function --------------------------------------------------------------------
const gwEdge = await startEdge({ db, edgeFile: 'supabase/functions/engine/index.ts', env: { SUPABASE_SERVICE_ROLE_KEY: 'isolated-service-key' } })
const mcpEdge = await startEdge({ db, edgeFile: 'supabase/functions/mcp/index.ts', env: { HQ_API_TOKEN: `machine-${run}`, SUPABASE_SERVICE_ROLE_KEY: 'isolated-service-key', SUPABASE_ANON_KEY: 'anon' } })
const gw = async (path: string, body: unknown): Promise<{ status: number; body: any }> => {
  const r = await gwEdge.call(new Request(`https://door.invalid/functions/v1/engine${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${creds.bridgeToken}` }, body: JSON.stringify(body) }))
  const t = await r.text()
  let parsed: any = {}
  try { parsed = JSON.parse(t) } catch { /* not JSON */ }
  return { status: r.status, body: parsed }
}
let rpcId = 1
const tool = async (name: string, args: Record<string, unknown> = {}): Promise<string> => {
  const r = await mcpEdge.call(new Request('https://door.invalid/functions/v1/mcp', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${creds.mcpToken}` }, body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params: { name, arguments: args } }) }))
  const b: any = JSON.parse(await r.text())
  return String(b.result?.content?.[0]?.text ?? '')
}

// ---- the stand-ins, installed AFTER the edges (each edge wraps fetch and refuses anything but the replica) -----------------------
const modelCalls: string[] = []
const modelFetch = (async (url: string) => { modelCalls.push(String(url)); return new Response(JSON.stringify({ error: { message: 'no model in this proof' } }), { status: 500 }) }) as unknown as typeof fetch
const tg: { chat: string; text: string }[] = []
const edgeFetch = globalThis.fetch
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input)
  const m = /^https:\/\/api\.telegram\.org\/bot([^/]+)\/(\w+)/.exec(url)
  if (m === null) return edgeFetch(input, init)
  const payload = JSON.parse(String(init?.body ?? '{}')) as { chat_id?: string | number; text?: string }
  if (m[2] === 'sendMessage') tg.push({ chat: String(payload.chat_id ?? ''), text: String(payload.text ?? '') })
  return new Response(JSON.stringify({ ok: true, result: { message_id: 9000 + tg.length } }), { status: 200 })
}) as typeof fetch

const router = new ProviderRouter(db, 'k', modelFetch, 4, { requestTimeoutMs: 2_000 })
const review: Reviewer = async () => ({ status: 'approved', notes: 'engine-turn proof' })
const handlers: Handler[] = [instructionHandler({ db, router })]
const notify = combinedNotifier([replyChannel(db)], db)
let tickNo = 0
const tick = async (): Promise<void> => { await drain(db, `et-${run}-${String(++tickNo)}`, handlers, review, 25, { notify, canTranscribe: false, canSubprocess: false }) }

const sendTurn = async (text: string, engine: 'team' | 'hermes' | null, project = P1): Promise<{ job: string; command: string }> => {
  await registerBot(db)
  const k = realTelegramKey()
  const cmd = await one(`set local application_name = 'PostgREST 14.5';
    insert into public.inbound_commands (office_id, project_id, origin_channel, origin_ref, actor, instruction, dedupe_key, subject${engine === null ? '' : ', engine'})
    values (app.operator_office(), ${lit(project.id)}::uuid, 'telegram', '${CHAT}:${k.split(':').pop() ?? '1'}', '${CHAT}', ${lit(text)}, ${lit(k)}, 'grant'${engine === null ? '' : `, ${lit(engine)}`})
    returning command_id::text as id`)
  const enq = json((await one(`set local application_name = 'PostgREST 14.5'; select public.enqueue_inbound(${lit(String(cmd.id))}::uuid) as v`)).v)
  void BOT
  return { job: String(enq.job_id), command: String(cmd.id) }
}
const jobRow = async (job: string): Promise<Record<string, any>> => one(`select state::text s, state_reason, waiting_on, announce from public.jobs where job_id = ${lit(job)}::uuid`)
const runOf = async (job: string): Promise<Record<string, any>> => one(`select run_id::text id, state, failure, claim_gen, request from public.engine_runs where job_id = ${lit(job)}::uuid`)
const outputOf = async (job: string): Promise<Record<string, any>> => one(`select body, evidence, confidence, model, sources, deterministic from public.outputs where job_id = ${lit(job)}::uuid order by created_at desc limit 1`)
const quiet = async (): Promise<void> => {
  await q(`update public.jobs set state = 'cancelled' where state in ('paused','queued','retrying','running') and office_id = ${lit(A)}::uuid`)
  await q(`update public.engine_runs set state = 'cancelled', finished_at = now(), lease_until = null where office_id = ${lit(A)}::uuid and state in ('open','running')`).catch(() => undefined)
}
await quiet()
const CLAIM = { bridge_version: '0.1.0', hermes_ok: true, toolsets_ok: true }
const ANSWER_TEXT = `The plan for this project mentions ${CANARY}, and there is one task to order seed.`
let lastClaimAt = 0
const claim = async (): Promise<any> => {
  // The gateway throttles a bridge's claims (one every five seconds); a real bridge polls far more slowly than that.
  const wait = lastClaimAt + 5_300 - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastClaimAt = Date.now()
  const r = await gw('/claim', CLAIM)
  if (r.body.run === undefined || r.body.run === null) throw new Error(`the claim returned no run: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`)
  return r.body.run
}

try {
  // ==========================================================================================================================
  // T-A: the whole journey, Hermes chosen
  // ==========================================================================================================================
  await fresh()
  const a = await sendTurn('What is in this project?', 'hermes')
  const cmdEngine = String((await one(`select engine from public.inbound_commands where command_id = ${lit(a.command)}::uuid`)).engine)
  await tick()
  const aJob = await jobRow(a.job)
  const aRun = await runOf(a.job)
  check('E1 the command carries the person\'s choice, and the first pass opens ONE run and parks the job as a dependency wait: nothing is answered, nothing is delivered', cmdEngine === 'hermes' && aRun.state === 'open' && aJob.s === 'paused' && String(aJob.waiting_on).includes('Hermes') && (await n(`select count(*)::int n from public.engine_runs where job_id = ${lit(a.job)}::uuid`)) === 1 && (await n(`select count(*)::int n from public.deliveries where job_id = ${lit(a.job)}::uuid`)) === 0, `${cmdEngine} / ${aRun.state} / ${aJob.s}`)
  check('E2 the team was not involved: no model call, no routing decision, no child job, no usage row', modelCalls.length === 0 && (await n(`select count(*)::int n from public.routing_decisions where job_id = ${lit(a.job)}::uuid`)) === 0 && (await n(`select count(*)::int n from public.jobs where parent_job_id = ${lit(a.job)}::uuid`)) === 0 && (await n(`select count(*)::int n from public.inference_usage where job_id = ${lit(a.job)}::uuid`)) === 0, `model calls ${modelCalls.length}`)
  const reqSent = aRun.request as any
  check('E3 the request stored for Hermes is the person\'s own words, a brief that names the person, the project in focus and the limits, and an empty history for a first turn', reqSent.input === 'What is in this project?' && String(reqSent.instructions).includes(personName) && String(reqSent.instructions).includes(P1.name) && /cannot do/.test(String(reqSent.instructions)) && Array.isArray(reqSent.conversation_history) && reqSent.conversation_history.length === 0 && Object.keys(reqSent).sort().join() === 'conversation_history,input,instructions', `${String(reqSent.instructions).length} chars`)

  // ticking again while the run is open changes nothing: it does not open a second run and it does not answer
  await q(`update public.jobs set not_before = null where job_id = ${lit(a.job)}::uuid`)
  await tick()
  const parkedOnly = await q(`select body from public.outputs where job_id = ${lit(a.job)}::uuid`)
  check('E4 a second pass over a parked job opens no second run, answers nothing (the only output rows are the parked "working on it" notes, which are reviewed and never delivered) and calls no model', (await n(`select count(*)::int n from public.engine_runs where job_id = ${lit(a.job)}::uuid`)) === 1 && modelCalls.length === 0 && parkedOnly.every((o) => o.body === 'Hermes is working on it.') && (await n(`select count(*)::int n from public.deliveries where job_id = ${lit(a.job)}::uuid`)) === 0, `${parkedOnly.length} parked notes`)

  // the bridge, played by this file
  const claimed = await claim()
  check('E5 the bridge claims the run through the real gateway and receives exactly what was stored', claimed?.run_id === aRun.id && claimed.request.input === 'What is in this project?' && claimed.claim_gen === 1)
  const hb = await gw('/heartbeat', { run_id: claimed.run_id, claim_gen: claimed.claim_gen })
  check('E6 a heartbeat on a live run says go on', hb.status === 200 && hb.body.stop === false, JSON.stringify(hb.body))
  const listed = await tool('list_projects')
  const searched = await tool('search_documents', { query: CANARY })
  const tasks = await tool('list_tasks', {})
  const served = await q(`select tool, verdict, domain, complete from public.engine_run_calls where run_id = ${lit(aRun.id)}::uuid order by at, call_id`)
  check('E7 Hermes reads the office through the real MCP function while the run is live, and each read is recorded against the run', listed.includes(P1.slug) && searched.includes(CANARY) && tasks.includes(CANARY) && served.length === 3 && served.every((s) => s.verdict === 'served'), served.map((s) => `${s.tool}:${s.domain}${s.complete ? '*' : ''}`).join(' '))
  const fin = await gw('/finish', { run_id: claimed.run_id, claim_gen: claimed.claim_gen, outcome: 'completed', result: { answer: ANSWER_TEXT, model: 'nvidia/nemotron-3-super-120b-a12b:free', usage: { input_tokens: 1200, output_tokens: 80 }, tools_started: 3, approvals_denied: 0 } })
  check('E8 finishing the run through the gateway wakes the parked job so its answer is built now, not at the next look', fin.status === 200 && fin.body.ok === true && fin.body.resumed === true && String((await jobRow(a.job)).s) !== 'paused', JSON.stringify(fin.body))
  await tick()
  const aOut = await outputOf(a.job)
  const aDone = await jobRow(a.job)
  check('E9 the next pass writes the answer: Hermes\'s words, labelled an inference (never verified), medium confidence, the served model, one source per tool actually read', aDone.s === 'complete' && aOut.body === ANSWER_TEXT && aOut.evidence === 'inferred' && aOut.confidence === 'medium' && aOut.model === 'nvidia/nemotron-3-super-120b-a12b:free' && ['hermes:list_projects', 'hermes:list_tasks', 'hermes:search_documents'].every((s) => (aOut.sources as string[]).includes(s)), `${aDone.s} ${aOut.evidence} ${JSON.stringify(aOut.sources)}`)
  const attributed = await one(`select s.slug from public.outputs o join public.staff s on s.staff_id = o.staff_id where o.job_id = ${lit(a.job)}::uuid and o.body = ${lit(ANSWER_TEXT)}`)
  check('E9b the answer is relayed by the Chief of Staff, as every message the person sends is, so it reaches them from her bot', attributed.slug === 'chief-of-staff', String(attributed.slug))
  const usage = await q(`select provider, model_id, cost_usd::text c, provenance from public.inference_usage where job_id = ${lit(a.job)}::uuid`)
  check('E10 the only usage recorded for the job is Hermes\'s, at no cost, estimated and never presented as a provider figure; no team model was called at any point', usage.length === 1 && usage[0]?.provider === 'hermes' && Number(usage[0]?.c) === 0 && modelCalls.length === 0, JSON.stringify(usage))
  const delivered = await q(`select state, channel, target_ref from public.deliveries where job_id = ${lit(a.job)}::uuid`)
  check('E11 the answer reached the person once, on the channel they asked on, and the working notice never went out', delivered.length === 1 && delivered[0]?.state === 'sent' && delivered[0]?.channel === 'telegram' && tg.some((m) => m.text.includes(CANARY)) && !tg.some((m) => m.text.includes('is working on it')), `${delivered.map((d) => `${d.channel}/${d.state}`).join(',')}; ${tg.length} sent`)
  const ran = await n(`select count(*)::int n from public.engine_runs where job_id = ${lit(a.job)}::uuid and state = 'completed'`)
  check('E12 the run is completed exactly once, and the job holds exactly one real answer', ran === 1 && (await n(`select count(*)::int n from public.outputs where job_id = ${lit(a.job)}::uuid and body <> 'Hermes is working on it.'`)) === 1)

  // ==========================================================================================================================
  // T-B: unavailable. The honest sentence, and NOTHING else.
  // ==========================================================================================================================
  await quiet()
  await stale()
  const modelBefore = modelCalls.length
  const b = await sendTurn('Please look at the plan', 'hermes')
  await tick()
  const bOut = await outputOf(b.job)
  const bJob = await jobRow(b.job)
  check('E13 a Hermes host that has not checked in gives ONE honest sentence naming why, saying nothing else was done and offering the team without doing it', bJob.s === 'complete' && /checked in/.test(String(bOut.body)) && /Nothing else was done/.test(String(bOut.body)) && /without Hermes selected/.test(String(bOut.body)), String(bOut.body).slice(0, 140))
  check('E14 and nothing was started anywhere: no run, no child job, no routing decision, no model call, no usage row', (await n(`select count(*)::int n from public.engine_runs where job_id = ${lit(b.job)}::uuid`)) === 0 && (await n(`select count(*)::int n from public.jobs where parent_job_id = ${lit(b.job)}::uuid`)) === 0 && (await n(`select count(*)::int n from public.routing_decisions where job_id = ${lit(b.job)}::uuid`)) === 0 && modelCalls.length === modelBefore && (await n(`select count(*)::int n from public.inference_usage where job_id = ${lit(b.job)}::uuid`)) === 0 && bOut.deterministic === true, `model calls ${modelCalls.length - modelBefore}`)
  await fresh()
  await q(`update public.system_config set value = '[]'::jsonb where key = ${lit(SETTING.offices)}`)
  const b2 = await sendTurn('And again with Hermes off', 'hermes')
  await tick()
  const b2Out = await outputOf(b2.job)
  await q(`update public.system_config set value = ${lit(JSON.stringify([A]))}::jsonb where key = ${lit(SETTING.offices)}`)
  check('E15 with Hermes switched off for the office the same honest sentence is given (the off switch is the rollback), and again no team model is used', /switched on/.test(String(b2Out.body)) && modelCalls.length === modelBefore && (await n(`select count(*)::int n from public.engine_runs where job_id = ${lit(b2.job)}::uuid`)) === 0, String(b2Out.body).slice(0, 100))

  // ==========================================================================================================================
  // T-C: a run nobody claims. It expires honestly, and the team never picks it up.
  // ==========================================================================================================================
  await quiet()
  await fresh()
  const c = await sendTurn('Take your time', 'hermes')
  await tick()
  const cRun = await runOf(c.job)
  // The deadline is fixed when a run opens (a trigger refuses to move it), so the proof moves it the way engine-runs.ts does: with the guard off for one statement.
  await q('alter table public.engine_runs disable trigger b1_engine_run_guard')
  await q(`update public.engine_runs set created_at = now() - interval '16 minutes', deadline_at = now() - interval '1 minute' where run_id = ${lit(cRun.id)}::uuid`)
  await q('alter table public.engine_runs enable trigger b1_engine_run_guard')
  await q(`select app.engine_run_for_job(${lit(A)}::uuid, ${lit(c.job)}::uuid)`)
  await tick()
  const cOut = await outputOf(c.job)
  check('E16 a run that is never claimed expires; the person is told Hermes took too long and that nothing was changed, and the job ends complete with that sentence', (await runOf(c.job)).state === 'expired' && /longer than \d+ minutes/.test(String(cOut.body)) && /Nothing was changed/.test(String(cOut.body)), String(cOut.body).slice(0, 100))
  check('E17 an expired Hermes turn is not handed to the team: no child job, no routing decision, no team model call', (await n(`select count(*)::int n from public.jobs where parent_job_id = ${lit(c.job)}::uuid`)) === 0 && (await n(`select count(*)::int n from public.routing_decisions where job_id = ${lit(c.job)}::uuid`)) === 0 && modelCalls.length === modelBefore)

  // ==========================================================================================================================
  // T-D: Stop while Hermes is working. The run is stopped, the job stays cancelled, nothing resumes it.
  // ==========================================================================================================================
  await quiet()
  await fresh()
  const d = await sendTurn('A long job', 'hermes')
  await tick()
  const dClaim = await claim()
  const stopped = json((await one(`select app.request_stop(${lit(A)}::uuid, ${lit(d.job)}::uuid, null) r`)).r)
  const dHb = await gw('/heartbeat', { run_id: dClaim.run_id, claim_gen: dClaim.claim_gen })
  const dFin = await gw('/finish', { run_id: dClaim.run_id, claim_gen: dClaim.claim_gen, outcome: 'cancelled', result: { tools_started: 0, approvals_denied: 0 } })
  await tick()
  check('E18 the person\'s Stop cancels the parked job, the next heartbeat tells Hermes to stop, and the cancelled finish is accepted without waking anything', stopped.ok === true && dHb.body.stop === true && dFin.status === 200 && dFin.body.ok === true && dFin.body.resumed !== true && (await jobRow(d.job)).s === 'cancelled' && (await runOf(d.job)).state === 'cancelled')
  check('E19 a stopped Hermes turn produces no answer (only parked notes), no delivery and no team work', (await n(`select count(*)::int n from public.outputs where job_id = ${lit(d.job)}::uuid and body <> 'Hermes is working on it.'`)) === 0 && (await n(`select count(*)::int n from public.deliveries where job_id = ${lit(d.job)}::uuid`)) === 0 && modelCalls.length === modelBefore && (await n(`select count(*)::int n from public.jobs where parent_job_id = ${lit(d.job)}::uuid`)) === 0)

  // ==========================================================================================================================
  // T-E: Hermes fails. The person is told in code, in plain words, and nothing is retried silently.
  // ==========================================================================================================================
  await quiet()
  await fresh()
  const e = await sendTurn('Another one', 'hermes')
  await tick()
  const eClaim = await claim()
  const eFin = await gw('/finish', { run_id: eClaim.run_id, claim_gen: eClaim.claim_gen, outcome: 'failed', result: { failure: 'no_progress', tools_started: 0, approvals_denied: 0 } })
  await tick()
  const eOut = await outputOf(e.job)
  check('E20 a failed run is told in plain words without repeating the engine\'s own text, says nothing was changed, and is composed in code (verified, no model)', eFin.body.ok === true && (await jobRow(e.job)).s === 'complete' && /couldn't finish this \(it stopped making progress\)/.test(String(eOut.body)) && /Nothing was changed/.test(String(eOut.body)) && eOut.evidence === 'verified' && modelCalls.length === modelBefore, String(eOut.body).slice(0, 120))
  check('E21 the failed turn is not retried by the team: still one run, no child job, no routing decision', (await n(`select count(*)::int n from public.engine_runs where job_id = ${lit(e.job)}::uuid`)) === 1 && (await n(`select count(*)::int n from public.jobs where parent_job_id = ${lit(e.job)}::uuid`)) === 0 && (await n(`select count(*)::int n from public.routing_decisions where job_id = ${lit(e.job)}::uuid`)) === 0)

  // ==========================================================================================================================
  // T-F: the control. An ordinary message is not captured by the seam, and the choice is the person's, per message.
  // ==========================================================================================================================
  await quiet()
  await fresh()
  const f = await sendTurn('What projects do we have?', null)
  await tick()
  check('E22 a message with no choice (and one choosing the team) opens no Hermes run and goes to the team\'s own path (the control: the seam does not capture ordinary turns)', (await n(`select count(*)::int n from public.engine_runs where job_id = ${lit(f.job)}::uuid`)) === 0 && modelCalls.length > modelBefore, `team path asked the model ${modelCalls.length - modelBefore}x`)
  const f2 = await sendTurn('And this one is explicitly for the team', 'team')
  await tick()
  check('E23 an explicit team choice behaves the same way', (await n(`select count(*)::int n from public.engine_runs where job_id = ${lit(f2.job)}::uuid`)) === 0)
  const sameConversation = await sendTurn('Hermes again, in the same chat', 'hermes')
  check('E24 the next message in the same chat is a new choice: nothing about the earlier Hermes turns made this one Hermes (it was sent as Hermes here, and the earlier team turns stayed team)', String((await one(`select engine from public.inbound_commands where command_id = ${lit(sameConversation.command)}::uuid`)).engine) === 'hermes' && String((await one(`select engine from public.inbound_commands where command_id = ${lit(f.command)}::uuid`)).engine) === 'team')

  // ==========================================================================================================================
  // T-G: rollback. The drain stops live runs, and only after Hermes is off.
  // ==========================================================================================================================
  await quiet()
  await fresh()
  const g1 = await sendTurn('One to drain', 'hermes')
  await tick()
  const g2 = await sendTurn('Another to drain', 'hermes')
  await tick()
  const refused = await drainEngineRuns(db, A)
  check('E25 the drain REFUSES while Hermes is still switched on for the office, and stops nothing (a run opened after the list was read would be missed)', refused.ok === false && /still switched on/.test(String(refused.refused)) && refused.stopped.length === 0 && (await jobRow(g1.job)).s === 'paused' && (await jobRow(g2.job)).s === 'paused', String(refused.refused).slice(0, 80))
  await q(`update public.system_config set value = '[]'::jsonb where key = ${lit(SETTING.offices)}`)
  const drained = await drainEngineRuns(db, A)
  check('E26 once Hermes is off the drain stops every job that holds a live run, with the office\'s own stop, and reports each', drained.ok === true && drained.stopped.length === 2 && (await jobRow(g1.job)).s === 'cancelled' && (await jobRow(g2.job)).s === 'cancelled' && /stopped by the office/.test(String((await jobRow(g1.job)).state_reason)), JSON.stringify(drained.stopped.map((s) => s.note)))
  const again = await drainEngineRuns(db, A)
  check('E27 drained again, it is harmless: nothing fails and every job is reported as already finished (the runs stay open until their deadline, which the drain does not edit)', again.ok === true && again.failed.length === 0 && again.stopped.length === again.live.length && again.stopped.every((s) => /already finished/.test(s.note)) && refused.live.length === 2, `${again.live.length} live, notes: ${again.stopped.map((s) => s.note).join('|')}`)
  await q(`update public.system_config set value = ${lit(JSON.stringify([A]))}::jsonb where key = ${lit(SETTING.offices)}`)
  await fresh()
  await new Promise((r) => setTimeout(r, Math.max(0, lastClaimAt + 5_300 - Date.now())))
  const afterDrain = await gw('/claim', CLAIM)
  check('E28 and a drained run can never be picked up afterwards: with Hermes back on and the host fresh, the bridge is handed no run for a stopped job', afterDrain.status === 200 && (afterDrain.body.run === null || afterDrain.body.run === undefined), JSON.stringify(afterDrain.body).slice(0, 120))
} finally {
  await quiet()
  await q(`update public.system_config set value = '[]'::jsonb where key = ${lit(SETTING.offices)}`).catch(() => undefined)
  await q(`update public.engine_bridges set enabled = false where bridge_id = ${lit(BRIDGE)}::uuid`).catch(() => undefined)
}

const failed = results.filter((r) => !r).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
process.exit(failed === 0 ? 0 : 1)
