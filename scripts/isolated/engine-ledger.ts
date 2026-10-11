// biome-ignore-all lint/suspicious/noExplicitAny: SQL results are untyped rows
// biome-ignore-all format: a dense proof script kept readable as written
/**
 * What the Hermes integration reports to the Unified Activity Ledger, against the ledger's REAL door (Hermes, M7; migration 1076),
 * on the isolated replica only.
 *
 *   npx tsx scripts/isolated/engine-ledger.ts <replica-db>
 *
 * The ledger is on its own branch (feature/unified-activity-ledger) and is not in this tree. This proof applies that branch's migrations
 * 1060 to 1062, read from the pinned commit below with `git show`, onto the database it is given (the gate gives each proof a fresh clone),
 * so the integration is proved against the ledger's own app.record_external_activity and not a stub (engine-runs H1-H5 use a stub). It
 * never merges, never edits and never writes to that branch. If the commit cannot be read the proof FAILS and says why: a skipped
 * compatibility proof reads as a passing one.
 *
 *   A. off means off: the door present, the ledger off, or on for another office: nothing is reported, nothing is noted, the run is whole
 *   B. covered: a completed run reports ONE started and ONE completed, as external:hermes, from the run's own office, job and project
 *   C. once, not twice: a repeated finish, a repeated report and a re-sent key add nothing
 *   D. the other endings: failed, stopped, bridge retired, each ONE worker_error; a refusal by the ledger is written on the run, not swallowed
 *   E. a proposed skill reports its NAME only, once (the procedure is never sent)
 *   F. no second ledger: the only activity tables are the ledger's own three
 * Then each guard is SABOTAGED: put back into the live definition, the probe must go red, restored, green.
 */
import { execFileSync } from 'node:child_process'
import { generateCredentials } from '../../src/engines/hermes/credentials.ts'
import { SETTING } from '../../src/engines/hermes/timing.ts'
import { isolated } from './guard.ts'
import { postTurn, startDoor } from './voice-door.ts'

/** The ledger branch at the commit this proof was written against (phase 5, the fail-closed model). */
const LEDGER_SHA = '96a7dec436133ba98b8744dc9fdabdd37b81e773'
const LEDGER_FILES = [
  'migrations/1060_one_ledger_of_activity_records_what_no_other_table_holds.sql',
  'migrations/1061_the_activity_read_model_reads_each_table_that_owns_the_state.sql',
  'migrations/1062_a_held_back_over_budget_agent_is_recorded_in_the_activity_ledger.sql',
]
const DOOR = 'app.record_external_activity(uuid,text,text,text,text,text,text,uuid,uuid,uuid,jsonb,jsonb)'

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
const setConfig = async (key: string, value: unknown): Promise<void> => { await q(`insert into public.system_config (key, value, description) values (${lit(key)}, ${jsonLit(value)}, 'engine ledger proof') on conflict (key) do update set value = excluded.value`) }
const delConfig = async (key: string): Promise<void> => { await q(`delete from public.system_config where key = ${lit(key)}`) }

// ---- the ledger, from the pinned commit -------------------------------------------------------------------------------------------------------
const gitShow = (path: string): string => {
  const read = (): string => execFileSync('git', ['show', `${LEDGER_SHA}:${path}`], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
  try { return read() } catch {
    execFileSync('git', ['fetch', '--quiet', 'origin', 'feature/unified-activity-ledger'], { stdio: 'ignore', timeout: 90_000 })
    return read()
  }
}
if ((await one(`select to_regprocedure('${DOOR}') d`)).d === null) {
  for (const f of LEDGER_FILES) {
    let sql: string
    try { sql = gitShow(f) } catch (e) { console.log(`FAIL the ledger commit ${LEDGER_SHA.slice(0, 8)} could not be read (${String((e as Error).message).slice(0, 120)}); this proof cannot say anything without it`); process.exit(1) }
    await db.execute(sql)
  }
}
check('0 (setup) the ledger\'s own door exists on the replica, with the signature the contract names', (await one(`select to_regprocedure('${DOOR}') d`)).d !== null)

const A = String((await one('select app.operator_office()::text o')).o)
const authB = String((await one('select gen_random_uuid()::text a')).a)
await q(`insert into auth.users (id, email) values (${lit(authB)}, ${lit(`engine-ledger.${run}@example.invalid`)})`)
await q(`insert into public.offices (auth_user_id, kind, name) values (${lit(authB)}, 'person', ${lit(`engine ledger ${run}`)})`)
const B = String((await one(`select office_id::text o from public.offices where auth_user_id = ${lit(authB)}`)).o)
const mkProject = async (tag: string): Promise<{ id: string }> => {
  const name = `Engledger ${tag} ${run}`
  return { id: String(json((await one(`select app.hq_create_project(${lit(A)}::uuid, ${lit(name)}, 'upload', ${lit(`engledger-${tag}-${run}`)}, ${lit(name)}, true) as v`)).v).project_id) }
}
const P1 = await mkProject('one')

await setConfig(SETTING.offices, [A])
await setConfig(SETTING.dailyRuns, 900)
await setConfig('engine.hermes.skill_proposals_per_day', 10)
await setConfig('engine.hermes.learning_offices', [A])
type Bridge = { id: string; token: string }
const mintBridge = async (office: string, tag: string): Promise<Bridge> => {
  const c = generateCredentials()
  const m = json((await one(`select app.engine_mint_bridge(${lit(office)}::uuid, 'hermes', ${lit(`ledger ${tag} ${run}`)}, ${lit(c.bridgeSha256)}, ${lit(c.mcpSha256)}) r`)).r)
  return { id: String(m.bridge_id), token: c.bridgeToken }
}
const touch = async (b: Bridge): Promise<void> => { await q(`update public.engine_bridges set last_seen_at = now(), healthy = true, unhealthy_reason = null where bridge_id = ${lit(b.id)}::uuid`) }
let BR = await mintBridge(A, 'main')
await touch(BR)
const door = await startDoor(db)
let n = 0
/** A Hermes run on P1 (a learning run: the office has the flag on), claimed and left running, or finished. */
const makeRun = async (opts: { finish?: 'completed' | 'failed' | 'cancelled' | null } = {}): Promise<{ job: string; runId: string; gen: number }> => {
  const said = `Ledger proof question ${run} ${String(++n)}`
  const r = await postTurn(door, { said, session: `s${run.slice(-6)}${String(n)}`, message: `m${run}${String(n)}z`, project: P1.id, engine: 'hermes' })
  const job = String((await one(`select job_id::text j from public.inbound_commands where instruction = ${lit(said)} and office_id = ${lit(A)}::uuid`)).j)
  if (r.status !== 200 || job === 'undefined') throw new Error(`no job: ${JSON.stringify(r.body)}`)
  await q(`select app.pause_job(${lit(job)}::uuid, 'dependency_wait', 'Hermes is working on it.', 'Waiting for Hermes to finish.', true, null, null)`)
  const opened = await call(`select app.engine_run_open(${lit(A)}::uuid, ${lit(job)}::uuid, 'hermes', ${jsonLit({ input: said, instructions: 'You answer for the office.', conversation_history: [] })}) r`)
  if (typeof opened.run_id !== 'string') throw new Error(`no run: ${JSON.stringify(opened)}`)
  await touch(BR)
  const claim = await call(`select app.engine_run_claim(${lit(A)}::uuid, ${lit(BR.id)}::uuid) r`)
  if (claim.run?.run_id !== opened.run_id) throw new Error(`the claim took another run: ${JSON.stringify(claim).slice(0, 160)}`)
  const gen = Number(claim.run.claim_gen)
  if (opts.finish !== null) await finish(String(opened.run_id), gen, opts.finish ?? 'completed')
  return { job, runId: String(opened.run_id), gen }
}
const ANSWER_TEXT = 'The venue is unchanged and the secret decision is withheld.'
const finish = async (runId: string, gen: number, outcome: 'completed' | 'failed' | 'cancelled'): Promise<any> => {
  const result = outcome === 'completed' ? { tools_started: 2, approvals_denied: 0, answer: ANSWER_TEXT, model: 'proof/free', usage: { input_tokens: 5, output_tokens: 5 } }
    : outcome === 'failed' ? { tools_started: 0, approvals_denied: 0, failure: 'the model gave up' } : { tools_started: 0, approvals_denied: 0 }
  return call(`select app.engine_run_finish(${lit(A)}::uuid, ${lit(BR.id)}::uuid, ${lit(runId)}::uuid, ${String(gen)}, ${lit(outcome)}, ${jsonLit(result)}) r`)
}
const events = async (runId: string): Promise<any[]> => q(`select event_type, actor, actor_kind, provenance, source_interface, summary, idempotency_key, office_id::text office, job_id::text job, project_id::text project, visibility, metadata::text meta from public.activity_events where idempotency_key like ${lit(`ext:hermes:run:${runId}:%`)} order by idempotency_key`)
const runRow = async (runId: string): Promise<any> => one(`select state, ledger_note, job_id::text job from public.engine_runs where run_id = ${lit(runId)}::uuid`)
const jobState = async (job: string): Promise<string> => String((await one(`select state::text s from public.jobs where job_id = ${lit(job)}::uuid`)).s)
const cancelRun = async (runId: string): Promise<void> => { await q(`update public.engine_runs set state = 'cancelled', finished_at = now(), lease_until = null where run_id = ${lit(runId)}::uuid and state in ('running', 'open')`) }
const defOf = async (sig: string): Promise<string> => String((await one(`select pg_get_functiondef(${lit(sig)}::regprocedure) d`)).d)
const sabotage = async (name: string, sig: string, from: string, to: string, probe: () => Promise<boolean>): Promise<void> => {
  const was = await probe()
  const def = await defOf(sig)
  const bad = def.replace(from, () => to)
  const landed = bad !== def
  if (landed) await db.execute(bad)
  const during = await probe()
  await db.execute(def)
  const after = await probe()
  check(`sabotage - ${name}`, was && landed && !during && after, `clean ${String(was)}, defect landed ${String(landed)}, probe with the defect ${String(during)} (must be false), restored ${String(after)}`)
}

// ---- A. off means off ---------------------------------------------------------------------------------------------------------------------
await delConfig('activity.ledger_enabled')
await delConfig('activity.ledger_offices')
const a1 = await makeRun()
const a1Row = await runRow(a1.runId)
check('A1 the door is present and the ledger is at its default (off): the run completes, the job wakes, NOTHING is reported and nothing is noted', a1Row.state === 'completed' && a1Row.ledger_note === null && (await events(a1.runId)).length === 0 && (await jobState(a1.job)) === 'queued')
await setConfig('activity.ledger_enabled', true)
const a2 = await makeRun()
check('A2 the master switch on and NO office listed (fail closed): still nothing reported', (await events(a2.runId)).length === 0 && (await runRow(a2.runId)).ledger_note === null)
await setConfig('activity.ledger_offices', [B])
const a3 = await makeRun()
check('A3 the ledger on for ANOTHER office only: nothing reported for this one (control: the ledger is switched on, so only the office test says no)', (await events(a3.runId)).length === 0 && (await runRow(a3.runId)).ledger_note === null && (await one(`select app.activity_ledger_on() on_`)).on_ === true)

// ---- B. covered ---------------------------------------------------------------------------------------------------------------------------
await setConfig('activity.ledger_offices', [A])
const b1 = await makeRun({ finish: null })
const startedOnly = await events(b1.runId)
check('B1 at the FIRST claim the run reports ONE external.research_started, before it has finished', startedOnly.length === 1 && startedOnly[0]?.event_type === 'external.research_started', JSON.stringify(startedOnly.map((e) => e.event_type)))
await finish(b1.runId, b1.gen, 'completed')
const bEv = await events(b1.runId)
const ids = (e: any): string => `${e.actor}|${e.actor_kind}|${e.provenance}|${e.source_interface}`
check('B2 a completed run has exactly one started and one completed', bEv.map((e) => e.event_type).join(',') === 'external.research_completed,external.research_started', bEv.map((e) => e.event_type).join(','))
check('B3 every event is the ledger\'s own forced shape: actor external:hermes, actor_kind external, provenance external, source external, and its summary begins [external:hermes]', bEv.every((e) => ids(e) === 'external:hermes|external|external|external' && String(e.summary).startsWith('[external:hermes] ')), bEv.map(ids).join(' ; '))
check('B4 each belongs to THIS run\'s office, job and project (and the key names the run and the event)', bEv.every((e) => e.office === A && e.job === b1.job && e.project === P1.id) && bEv.every((e) => /^ext:hermes:run:[0-9a-f-]{36}:(started|completed)$/.test(e.idempotency_key)))
check('B5 visibility comes from the taxonomy, never the worker: started is diagnostic, completed is user', bEv.find((e) => e.event_type === 'external.research_started')?.visibility === 'diagnostic' && bEv.find((e) => e.event_type === 'external.research_completed')?.visibility === 'user')
check('B6 the ledger holds a reference, not the answer: the answer text appears in no event', bEv.every((e) => !`${e.summary} ${e.meta}`.includes('venue is unchanged') && !`${e.summary} ${e.meta}`.includes('secret decision')))
check('B7 reporting never touched the run: it completed, the job woke, no ledger_note', (await runRow(b1.runId)).state === 'completed' && (await runRow(b1.runId)).ledger_note === null && (await jobState(b1.job)) === 'queued')

// ---- C. once, not twice ------------------------------------------------------------------------------------------------------------------
const again = await finish(b1.runId, b1.gen, 'completed')
const mirror = (runId: string, type: string, event: string, job: string): Promise<any> => q(`select app.engine_mirror(${lit(A)}::uuid, ${lit(runId)}::uuid, ${lit(type)}, ${lit(event)}, 'Hermes finished a message (2 tool calls).', ${lit(job)}::uuid, ${lit(P1.id)}::uuid) r`)
await mirror(b1.runId, 'external.research_completed', 'completed', b1.job)
await mirror(b1.runId, 'external.research_completed', 'completed', b1.job)
check('C1 a repeated finish, and the same report sent twice more, still leave ONE completed and ONE started', again.ok === true && again.resumed === false && (await events(b1.runId)).length === 2, JSON.stringify(again).slice(0, 120))
const cKey = await q(`select count(*)::int n from public.activity_events where idempotency_key = ${lit(`ext:hermes:run:${b1.runId}:completed`)}`)
check('C2 the ledger\'s own uniqueness agrees: one row per (office, key)', Number(cKey[0]?.n) === 1)

// ---- D. the other endings ----------------------------------------------------------------------------------------------------------------
const d1 = await makeRun({ finish: 'failed' })
const d1Ev = await events(d1.runId)
check('D1 a failed run reports started and ONE external.worker_error (key ":failed")', d1Ev.length === 2 && d1Ev.filter((e) => e.event_type === 'external.worker_error' && e.idempotency_key.endsWith(':failed')).length === 1)
const d2 = await makeRun({ finish: 'cancelled' })
const d2Ev = await events(d2.runId)
check('D2 a run the office STOPPED reports ONE external.worker_error (key ":cancelled"): the ledger is never left with a worker that began and never ended', d2Ev.length === 2 && d2Ev.filter((e) => e.event_type === 'external.worker_error' && e.idempotency_key.endsWith(':cancelled') && /stopped/.test(e.summary)).length === 1, JSON.stringify(d2Ev.map((e) => e.idempotency_key)))
const d3 = await makeRun({ finish: null })
await call(`select app.engine_retire_bridge(${lit(A)}::uuid, ${lit(BR.id)}::uuid, 'replaced in the proof') r`)
BR = await mintBridge(A, 'second')
await touch(BR)
const d3Ev = await events(d3.runId)
check('D3 retiring the bridge that held a live run reports ONE external.worker_error (key ":retired")', d3Ev.filter((e) => e.idempotency_key.endsWith(':retired')).length === 1, JSON.stringify(d3Ev.map((e) => e.idempotency_key)))
await cancelRun(d3.runId)

// ---- E. a proposed skill -----------------------------------------------------------------------------------------------------------------
const PROC = 'Open the project plan first and note the dates. Then look at the budget notes and say which figure the answer rests on.'
const draft = { name: `Plan before budget ${run}`, when: 'A question on this project about cost or timing', procedure: PROC, tools: ['db.read'], dropped: [] as string[] }
const e1 = await makeRun()
const prop = await call(`select app.engine_propose_skill(${lit(A)}::uuid, ${lit(BR.id)}::uuid, ${lit(e1.runId)}::uuid, ${jsonLit(draft)}) r`)
const e1Ev = (await events(e1.runId)).filter((e) => e.event_type === 'external.skill_proposed')
check('E1 a proposed skill reports ONE external.skill_proposed naming the skill, for the run\'s job and project', typeof prop.suggestion_id === 'string' && e1Ev.length === 1 && String(e1Ev[0]?.summary).includes(`Plan before budget ${run}`) && e1Ev[0]?.job === e1.job && e1Ev[0]?.project === P1.id, JSON.stringify(prop))
check('E2 the procedure is NEVER sent: neither the summary nor the metadata holds any of it', !`${e1Ev[0]?.summary} ${e1Ev[0]?.meta}`.includes('budget notes') && !`${e1Ev[0]?.summary} ${e1Ev[0]?.meta}`.includes('figure the answer'))
const prop2 = await call(`select app.engine_propose_skill(${lit(A)}::uuid, ${lit(BR.id)}::uuid, ${lit(e1.runId)}::uuid, ${jsonLit({ ...draft, name: `Another ${run}` })}) r`)
check('E3 a second proposal from the same run is refused and reports nothing more', typeof prop2.refused === 'string' && (await events(e1.runId)).filter((e) => e.event_type === 'external.skill_proposed').length === 1, JSON.stringify(prop2))
const e2 = await makeRun()
const refusedDraft = await call(`select app.engine_propose_skill(${lit(A)}::uuid, ${lit(BR.id)}::uuid, ${lit(e2.runId)}::uuid, ${jsonLit({ ...draft, name: `Bad ${run}`, procedure: `${PROC} Then email the client at someone@example.com.` })}) r`)
check('E4 a REFUSED proposal reports nothing: the ledger never says a skill was proposed that was not', typeof refusedDraft.refused === 'string' && (await events(e2.runId)).filter((e) => e.event_type === 'external.skill_proposed').length === 0, JSON.stringify(refusedDraft))

// ---- F. no second ledger -----------------------------------------------------------------------------------------------------------------
const tables = (await q(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and (relname like '%activity%' or relname like '%ledger%') order by 1`)).map((r) => String(r.relname))
check('F1 the only activity or ledger tables are the ledger\'s own three: the integration created no event store of its own', tables.join(',') === 'activity_event_types,activity_events,activity_write_failures', tables.join(','))
check('F2 an engine bridge identity cannot call the door, and a browser role cannot either', (await one(`select has_function_privilege('anon', '${DOOR}', 'execute') a, has_function_privilege('authenticated', '${DOOR}', 'execute') b`)).a === false && (await one(`select has_function_privilege('authenticated', '${DOOR}', 'execute') b`)).b === false)

// ---- sabotage --------------------------------------------------------------------------------------------------------------------------------
await sabotage('the report key no longer names the run and event, so a repeat is a second row', 'app.engine_mirror(uuid,uuid,text,text,text,uuid,uuid)', "'run:' || p_run::text || ':' || p_event", "'run:' || p_run::text || ':' || p_event || gen_random_uuid()::text", async () => {
  const r = await makeRunForProbe(); await mirror(r.runId, 'external.research_completed', 'completed', r.job); await mirror(r.runId, 'external.research_completed', 'completed', r.job)
  return (await events(r.runId)).filter((e) => e.event_type === 'external.research_completed').length === 1
})
await sabotage('a refusal by the ledger is no longer written on the run', 'app.engine_mirror(uuid,uuid,text,text,text,uuid,uuid)', "ledger_note = left(sqlstate || ': ' || sqlerrm, 200)", 'ledger_note = null', async () => {
  const r = await makeRunForProbe(); await mirror(r.runId, 'external.review_decided', 'x', r.job)
  return /42501/.test(String((await runRow(r.runId)).ledger_note))
})
await sabotage('the report is made as somebody other than the external worker hermes', 'app.engine_mirror(uuid,uuid,text,text,text,uuid,uuid)', "using p_office, 'hermes'", "using p_office, 'office'", async () => {
  const r = await makeRunForProbe()
  return (await events(r.runId)).filter((e) => e.event_type === 'external.research_completed').length === 1
})
await sabotage('a stopped run reports nothing at its end', 'app.engine_run_finish(uuid,uuid,uuid,integer,text,jsonb)', "if p_outcome = 'cancelled' then", 'if false then', async () => {
  const r = await makeRun({ finish: 'cancelled' }); return (await events(r.runId)).filter((e) => e.idempotency_key.endsWith(':cancelled')).length === 1
})
await sabotage('a proposed skill is reported as something else', 'app.engine_propose_skill(uuid,uuid,uuid,jsonb)', "perform app.engine_mirror(p_office, r.run_id, 'external.skill_proposed'", "perform app.engine_mirror(p_office, r.run_id, 'external.worker_error'", async () => {
  const r = await makeRun(); await q(`update public.suggestions set raised_at = raised_at - interval '3 days' where office_id = ${lit(A)}::uuid and kind = 'engine.skill'`)
  await call(`select app.engine_propose_skill(${lit(A)}::uuid, ${lit(BR.id)}::uuid, ${lit(r.runId)}::uuid, ${jsonLit({ ...draft, name: `Probe ${String(++n)} ${run}`, procedure: `${PROC} Probe ${String(n)}.` })}) r`)
  return (await events(r.runId)).filter((e) => e.event_type === 'external.skill_proposed').length === 1
})

// ---- D4. a refusal by the ledger is written, not swallowed (the door's own hourly cap) ----------------------------------------------------
await q(`do $f$ begin for g in 1..400 loop begin perform app.record_external_activity(${lit(A)}::uuid, 'hermes', 'external.usage_recorded', 'cap-' || g::text, 'filler', 'recorded', null, null, null, null, '{}'::jsonb, null); exception when sqlstate '54000' then exit; end; end loop; end $f$`)
const d4 = await makeRun()
const d4Row = await runRow(d4.runId)
check('D4 when the ledger REFUSES a report (its own hourly cap for this worker), the run still completes, the job still wakes, and the refusal is written on the run', d4Row.state === 'completed' && /54000/.test(String(d4Row.ledger_note)) && (await jobState(d4.job)) === 'queued', String(d4Row.ledger_note))

async function makeRunForProbe(): Promise<{ job: string; runId: string }> { const r = await makeRun(); return r }

const failed = results.filter((r) => !r).length
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed === 0 ? 0 : 1)
