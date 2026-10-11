// biome-ignore-all lint/suspicious/noExplicitAny: SQL results and HTTP bodies are untyped
// biome-ignore-all format: a dense proof script kept readable as written
/**
 * What a person sees of Hermes, on the isolated replica (Hermes, M6; migration 1072 and the voice adapter).
 *
 *   bash scripts/isolated/replica.sh && npx tsx scripts/isolated/engine-ui.ts <replica-db>
 *
 * REAL: the voice edge function (run in Node by voice-door.ts, which refuses every URL that is not the replica), the SQL of
 * 1070/1072, a real turn through a person's own door. NOTHING calls a model or Hermes: the run is opened and finished with the
 * same functions the worker and the bridge call, and every assertion reads canonical rows (inbound_commands, outputs, the history reader).
 *
 *   A. the status the composer asks: nothing for an office that has not been given Hermes, a reason when the host is not there, the
 *      host described by name only (no identifier, no credential), the allowance counted
 *   B. the gateway reaches it only through a service-role wrapper, and only with an office
 *   C. the voice adapter: the person's choice is recorded on their message and only 'hermes' is ever believed; anything else is the team
 *   D. a Hermes message that could not be recorded is refused in its own words and NEVER recorded as a team message
 *   E. the thread: a message says which engine it went to, an answer says which engine wrote it (from the run, not the text), the
 *      notes Hermes left while it worked are not answers, and a team turn is untouched
 *   F. the page's own source: it sends the engine only when Hermes was chosen, and never chooses for the person
 */
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { generateCredentials } from '../../src/engines/hermes/credentials.ts'
import { SETTING } from '../../src/engines/hermes/timing.ts'
import { isolated } from './guard.ts'
import { postTurn, startDoor } from './voice-door.ts'

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
const call = async (sql: string): Promise<any> => json((await one(sql)).r)
const jsonLit = (v: unknown): string => `${lit(JSON.stringify(v))}::jsonb`

const A = String((await one('select app.operator_office()::text o')).o)
const authB = String((await one('select gen_random_uuid()::text a')).a)
await q(`insert into auth.users (id, email) values (${lit(authB)}, ${lit(`engine-ui.${run}@example.invalid`)})`)
await q(`insert into public.offices (auth_user_id, kind, name) values (${lit(authB)}, 'person', ${lit(`engine ui ${run}`)})`)
const B = String((await one(`select office_id::text o from public.offices where auth_user_id = ${lit(authB)}`)).o)

const setSetting = async (key: string, value: unknown): Promise<void> => {
  await q(`insert into public.system_config (key, value, description) values (${lit(key)}, ${lit(JSON.stringify(value))}::jsonb, 'engine ui proof') on conflict (key) do update set value = excluded.value`)
}
const status = async (office: string): Promise<any> => call(`select app.engine_status(${lit(office)}::uuid) r`)

// ---- A. the status ----------------------------------------------------------------------------------------------------------
await q(`delete from public.system_config where key = ${lit(SETTING.offices)}`)
const off = await status(A)
check('A1 an office that has not been given Hermes is told so: enabled false, so the page draws nothing', off.hermes.enabled === false && off.hermes.available === false, JSON.stringify(off.hermes))
await setSetting(SETTING.offices, [A])
await setSetting(SETTING.dailyRuns, 900)
const noHost = await status(A)
check('A2 given Hermes but with no host: enabled, NOT available, and a sentence says why', noHost.hermes.enabled === true && noHost.hermes.available === false && typeof noHost.hermes.because === 'string' && noHost.hermes.because !== '' && noHost.hermes.host === null, JSON.stringify(noHost.hermes))
const creds = generateCredentials()
const minted = json((await one(`select app.engine_mint_bridge(${lit(A)}::uuid, 'hermes', ${lit(`ui proof ${run}`)}, ${lit(creds.bridgeSha256)}, ${lit(creds.mcpSha256)}) r`)).r)
const BRIDGE = String(minted.bridge_id)
const fresh = async (): Promise<void> => { await q(`update public.engine_bridges set last_seen_at = now(), healthy = true, unhealthy_reason = null where bridge_id = ${lit(BRIDGE)}::uuid`) }
await fresh()
const up = await status(A)
check('A3 a host that has just reported in: available, no reason needed', up.hermes.available === true, JSON.stringify(up.hermes))
const hostKeys = Object.keys(up.hermes.host ?? {}).sort().join(',')
check('A4 the host is described by name, last contact and health ONLY', hostKeys === 'healthy,last_seen_at,name', hostKeys)
const flat = JSON.stringify(up)
check('A5 nothing that identifies or authenticates the host is in the answer', !flat.includes(BRIDGE) && !flat.includes(String(minted.mcp_client_id)) && !flat.includes(creds.bridgeSha256) && !flat.includes(creds.mcpSha256) && !flat.includes(creds.bridgeToken) && !flat.includes(creds.mcpToken))
await q(`update public.engine_bridges set last_seen_at = now() - interval '10 minutes' where bridge_id = ${lit(BRIDGE)}::uuid`)
const stale = await status(A)
check('A6 a host not heard from for ten minutes is not available (the page says so, it does not guess)', stale.hermes.available === false && stale.hermes.because !== '', JSON.stringify(stale.hermes))
await fresh()
const other = await status(B)
check('A7 another office is not given Hermes by this office being given it', other.hermes.enabled === false && other.hermes.host === null, JSON.stringify(other.hermes))
const crossed = await db.execute(`select app.engine_status(null)`).then(() => '', (e) => String((e as Error).message))
check('A8 asking about no office is refused, not answered with somebody\'s', crossed !== '', crossed)
await q(`select app.require_office(${lit(A)}::uuid)`)

// ---- B. the door ------------------------------------------------------------------------------------------------------------
const priv = await one(`select has_function_privilege('service_role', 'public.hq_engine_status(uuid)', 'execute') svc, has_function_privilege('anon', 'public.hq_engine_status(uuid)', 'execute') anon, has_function_privilege('authenticated', 'public.hq_engine_status(uuid)', 'execute') auth, has_function_privilege('service_role', 'app.engine_status(uuid)', 'execute') appsvc`)
check('B1 only the gateway (service role) can ask, and only through the public wrapper', priv.svc === true && priv.anon === false && priv.auth === false && priv.appsvc === false, JSON.stringify(priv))
const gatewaySource = readFileSync('supabase/functions/hq-api/index.ts', 'utf8')
check('B2 the gateway section takes an office (the person\'s, from their login)', /engine_status:\s*\{\s*fn:\s*'hq_engine_status',\s*office:\s*true\s*\}/.test(gatewaySource))

// ---- C. the voice adapter ---------------------------------------------------------------------------------------------------
const mkProject = async (tag: string): Promise<{ id: string; slug: string }> => {
  const name = `Engui ${tag} ${run}`
  const id = String(json((await one(`select app.hq_create_project(${lit(A)}::uuid, ${lit(name)}, 'upload', ${lit(`engui-${tag}-${run}`)}, ${lit(name)}, true) as v`)).v).project_id)
  return { id, slug: String((await one(`select slug from public.projects where project_id = ${lit(id)}::uuid`)).slug) }
}
const P = await mkProject('one')
const door = await startDoor(db)
let visit = 0
const session = (): string => `s${run.slice(-6)}${String(++visit)}`
const message = (): string => `m${run}${String(++visit)}${randomBytes(4).toString('hex')}`
const turn = async (said: string, extra: Record<string, unknown> = {}) => postTurn(door, { said, session: session(), message: message(), project: P.id, ...extra })
const cmd = async (said: string): Promise<any> => one(`select command_id::text id, engine, job_id::text job from public.inbound_commands where instruction = ${lit(said)} and office_id = ${lit(A)}::uuid order by received_at desc limit 1`)
const count = async (said: string): Promise<number> => Number((await one(`select count(*)::int n from public.inbound_commands where instruction = ${lit(said)}`)).n)

const sHermes = `What did we decide about the venue? ${run} hermes`
const rH = await turn(sHermes, { engine: 'hermes' })
const cH = await cmd(sHermes)
check('C1 a message sent to Hermes records engine hermes on the person\'s own message', rH.status === 200 && cH.engine === 'hermes', `${rH.status} ${JSON.stringify(rH.body).slice(0, 160)} ${JSON.stringify(cH)}`)
check('C2 it became a job (the worker, not this adapter, decides what happens next) and was never answered by the office\'s quick path', typeof cH.job === 'string' && cH.job !== '' && rH.body.did !== 'answered', JSON.stringify(rH.body).slice(0, 200))
check('C3 the acknowledgement says Hermes, because the person chose it', String(rH.body.speak ?? '').includes('Hermes') && rH.body.engine === 'hermes')
const sTeam = `Please write a short plan for moving the venue and list the risks. ${run} team`
const rT = await turn(sTeam)
const cT = await cmd(sTeam)
check('C4 a message with no engine is the team\'s, exactly as before', rT.status === 200 && cT.engine === 'team' && rT.body.engine === undefined, `${rT.status} ${JSON.stringify(cT)}`)
for (const [label, value] of [['an unknown engine', 'claude'], ['a number', 7], ['an object', { engine: 'hermes' }], ['upper case', 'HERMES'], ['null', null], ['the word team', 'team']] as const) {
  const s = `Venue question ${run} ${label}`
  const r = await turn(s, { engine: value })
  const c = await cmd(s)
  check(`C5 ${label} is believed as nothing: the message is the team's`, r.status === 200 && c.engine === 'team', `${r.status} engine=${String(c.engine)}`)
}

// ---- D. a Hermes message that cannot be recorded ----------------------------------------------------------------------------
await q(`alter table public.inbound_commands add constraint zz_engine_ui_refuse check (engine <> 'hermes') not valid`)
const sRefused = `Venue question ${run} refused`
const rR = await turn(sRefused, { engine: 'hermes' })
const rows1 = await count(sRefused)
check('D1 a Hermes message that could not be recorded is refused 503 in its own words', rR.status === 503 && rR.body.error === 'hermes_not_sent' && String(rR.body.message ?? '').includes('Hermes'), `${rR.status} ${JSON.stringify(rR.body)}`)
check('D2 and it was NOT recorded as a team message instead (no automatic switch)', rows1 === 0, `${rows1} row(s)`)
const sStill = `Venue question ${run} still team`
const rS = await turn(sStill)
check('D3 the same refusal does not touch a team message (positive control: the constraint refuses only Hermes)', rS.status === 200 && (await count(sStill)) === 1)
await q(`alter table public.inbound_commands drop constraint zz_engine_ui_refuse`)

// ---- E. the thread ----------------------------------------------------------------------------------------------------------
const history = async (): Promise<any[]> => json((await one(`select app.conversation_history(${lit(A)}::uuid, ${lit(P.id)}::uuid, 200, null) r`)).r) ?? []
const said = (h: any[], text: string): any => h.find((m) => m.kind === 'said' && m.body === text)
const h0 = await history()
check('E1 a message says which engine it went to, as the person chose it', said(h0, sHermes)?.engine === 'hermes' && said(h0, sTeam)?.engine === 'team', JSON.stringify(h0.filter((m) => m.kind === 'said').map((m) => m.engine)))

// The Hermes job is parked as the handler leaves it, a run is opened for it, and Hermes leaves a note while it works.
const J = String(cH.job)
await q(`select app.pause_job(${lit(J)}::uuid, 'dependency_wait', 'Hermes is working on it.', 'Waiting for Hermes to finish.', true, null, null)`)
const opened = await call(`select app.engine_run_open(${lit(A)}::uuid, ${lit(J)}::uuid, 'hermes', ${jsonLit({ input: sHermes, instructions: 'You answer for the office.', conversation_history: [] })}) r`)
check('E2 (setup) a run opens for the person\'s own turn', typeof opened.run_id === 'string', JSON.stringify(opened))
const NOTE = `Hermes is working on it. ${run}`
await q(`insert into public.outputs (job_id, body, confidence, evidence, sources, deterministic) values (${lit(J)}::uuid, ${lit(NOTE)}, 'medium', 'inferred', '["job:${J}"]'::jsonb, true)`)
const hNote = await history()
check('E3 a note left while the run is still going is NOT shown as an answer', !hNote.some((m) => m.body === NOTE), JSON.stringify(hNote.filter((m) => m.kind === 'answered').map((m) => m.body)))
const claim = await call(`select app.engine_run_claim(${lit(A)}::uuid, ${lit(BRIDGE)}::uuid) r`)
await fresh()
const finished = await call(`select app.engine_run_finish(${lit(A)}::uuid, ${lit(BRIDGE)}::uuid, ${lit(String(opened.run_id))}::uuid, ${String(claim.run?.claim_gen)}, 'completed', ${jsonLit({ tools_started: 0, approvals_denied: 0, answer: 'The venue is unchanged.', model: 'proof', usage: { input_tokens: 10, output_tokens: 5 } })}) r`)
check('E4 (setup) the run finishes through the bridge\'s own function', finished?.ok !== false && finished?.error === undefined, JSON.stringify(finished))
const ANSWER = `The venue is unchanged. ${run}`
await q(`insert into public.outputs (job_id, body, confidence, evidence, sources, deterministic) values (${lit(J)}::uuid, ${lit(ANSWER)}, 'medium', 'inferred', '["job:${J}"]'::jsonb, false)`)
const hDone = await history()
const ans = hDone.find((m) => m.body === ANSWER)
check('E5 an answer written after the run finished is shown, and says it was written by Hermes', ans?.engine === 'hermes', JSON.stringify(ans))
check('E6 the note is STILL not shown once the answer exists', !hDone.some((m) => m.body === NOTE))

// A team turn: its job, its output, no run.
const JT = String(cT.job)
const TEAMANS = `The team says the venue is unchanged. ${run}`
await q(`insert into public.outputs (job_id, body, confidence, evidence, deterministic) values (${lit(JT)}::uuid, ${lit(TEAMANS)}, 'high', 'verified', true)`)
const hTeam = (await history()).find((m) => m.body === TEAMANS)
check('E7 a team answer is shown, labelled team, and is untouched by the filter (control: the filter does not hide what has no run)', hTeam?.engine === 'team', JSON.stringify(hTeam))
// The office speaking about a Hermes message it did NOT send (no run was opened) stays visible.
const sNo = `Venue question ${run} nosend`
const rN = await turn(sNo, { engine: 'hermes' })
const cN = await cmd(sNo)
const SAY = `I haven't sent this to Hermes: it is not available. ${run}`
await q(`insert into public.outputs (job_id, body, confidence, evidence, sources, deterministic) values (${lit(String(cN.job))}::uuid, ${lit(SAY)}, 'high', 'verified', '["job:${String(cN.job)}"]'::jsonb, true)`)
const hSay = (await history()).find((m) => m.body === SAY)
check('E8 the office saying it did not send to Hermes is shown (no run, so no filter) and is labelled team, because Hermes did not write it', rN.status === 200 && hSay !== undefined && hSay.engine === 'team', JSON.stringify(hSay))

// ---- sabotage: each defect is put back into the live definition, the probe must go red, the original restored, green again ----
const defOf = async (sig: string): Promise<string> => String((await one(`select pg_get_functiondef(${lit(sig)}::regprocedure) d`)).d)
const sabotage = async (name: string, sig: string, edit: (def: string) => string, probe: () => Promise<boolean>): Promise<void> => {
  const before = await probe()
  const def = await defOf(sig)
  const bad = edit(def)
  const landed = bad !== def
  if (landed) await db.execute(bad)
  const during = await probe()
  await db.execute(def)
  const after = await probe()
  check(`sabotage - ${name}`, before && landed && !during && after, `clean ${String(before)}, defect landed ${String(landed)}, probe with the defect ${String(during)} (must be false), restored ${String(after)}`)
}
const HISTORY = 'app.conversation_history(uuid,uuid,integer,timestamp with time zone)'
await sabotage('the thread shows the notes Hermes left while it worked', HISTORY, (d) => d.replace('and (er.run_id is null or (er.finished_at is not null and o.created_at >= er.finished_at))', 'and true'), async () => !(await history()).some((m) => m.body === NOTE))
await sabotage('an answer is labelled team whatever wrote it', HISTORY, (d) => d.replace("case when er.run_id is null then 'team' else er.engine end", "'team'"), async () => (await history()).find((m) => m.body === ANSWER)?.engine === 'hermes')
await sabotage('a message is no longer labelled with its engine', HISTORY, (d) => d.replace("'engine',       c.engine", "'engine',       'team'"), async () => said(await history(), sHermes)?.engine === 'hermes')
await sabotage('the filter hides every answer of a job that has a run, not only the early ones', HISTORY, (d) => d.replace('(er.run_id is null or (er.finished_at is not null and o.created_at >= er.finished_at))', 'er.run_id is null'), async () => (await history()).some((m) => m.body === ANSWER))
await sabotage('the status says enabled for every office', 'app.engine_status(uuid)', (d) => d.replace('v_enabled := app.engine_enabled(p_office, \'hermes\');', 'v_enabled := true;'), async () => (await status(B)).hermes.enabled === false)
await sabotage('the status reports available whatever the host is doing', 'app.engine_status(uuid)', (d) => d.replace("coalesce((v_avail ->> 'available')::boolean, false)", 'true'), async () => {
  await q(`update public.engine_bridges set last_seen_at = now() - interval '10 minutes' where bridge_id = ${lit(BRIDGE)}::uuid`)
  const ok = (await status(A)).hermes.available === false
  await fresh()
  return ok
})
await sabotage('the status leaks the host identifier', 'app.engine_status(uuid)', (d) => d.replace("jsonb_build_object('name', v_host.display_name,", "jsonb_build_object('bridge', v_host.bridge_id::text,'name', v_host.display_name,").replace('select b.last_seen_at, b.healthy, k.display_name into v_host', 'select b.last_seen_at, b.healthy, k.display_name, b.bridge_id into v_host'), async () => !JSON.stringify(await status(A)).includes(BRIDGE))

// ---- F. the page's own source ---------------------------------------------------------------------------------------------------
const chatSrc = readFileSync('web/studio/chat.js', 'utf8')
const engineSrc = readFileSync('web/studio/engine.js', 'utf8')
const appSrc = readFileSync('web/studio/app.js', 'utf8')
check('F1 the page sends the engine field ONLY when Hermes was chosen (the team is the absence of the field)', /\.\.\.\(engine === 'hermes' \? \{ engine: 'hermes' \} : \{\}\)/.test(chatSrc))
check('F2 the default is the team, and only a stored word "hermes" is ever believed', /stored\(\)\[slug\] === 'hermes' \? 'hermes' : 'team'/.test(engineSrc))
check('F3 nothing in the page switches engines by itself: no write to the stored choice outside the control\'s own change handler', (engineSrc.match(/\bchoose\(/g) ?? []).length === 1 && /sel\.addEventListener\('change', \(\) => \{\s*choose\(/.test(engineSrc) && !/choose\(/.test(chatSrc) && !/engine\.choose\(/.test(appSrc))
check('F4 the control is drawn only when the office says Hermes is enabled for it', /if \(!offered\(\)\) return ''/.test(engineSrc) && /status\.enabled === true/.test(engineSrc))
check('F5 both composers send the person\'s choice, and only while the control is offered', (appSrc.match(/engine\.offered\(\) \? engine\.chosen\(/g) ?? []).length === 2)

const failed = results.filter((r) => !r).length
console.log(`\n${results.length - failed}/${results.length} checks passed`)
void createHash
process.exit(failed === 0 ? 0 : 1)
