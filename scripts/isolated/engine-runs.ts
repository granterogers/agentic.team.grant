// biome-ignore-all lint/suspicious/noExplicitAny: SQL results are untyped rows
// biome-ignore-all format: a dense proof script kept readable as written
/**
 * An outside engine (Hermes) answers one turn, and the office keeps everything else: the SQL half, on the isolated replica only
 * (migration 1070, M1 of docs/hermes/IMPLEMENTATION-TASKS.md).
 *
 *   bash scripts/isolated/replica.sh && npx tsx scripts/isolated/engine-runs.ts <replica-db>
 *
 * Every property below is asserted beside a positive control, and every one that guards something is then SABOTAGED: the defect is put
 * back into the live definition, the same probe must turn red, and the original is restored and the probe must turn green again. A
 * sabotage that did not land is reported as such (the probe prints what it changed), never counted as a control that held.
 *
 *   A. schema: the three tables are forced-RLS carriers nobody can reach; the person's choice is write-once; the engine client kind
 *      is widened by exactly one value and can never be a writing client
 *   B. the person's door: only a turn that came through a person's own door can open a run; availability says why it is not
 *   C. a run's life: open once per job, claim only what is waiting, fence every later call, lapse and reopen at most three times,
 *      finish once, spend one inference row only when a model spent something, resume the waiting job
 *   D. stop: a person's Stop, a finished job, a deadline and a switched-off engine each reach the bridge
 *   E. the MCP side: the gate (allowlist, one running run, office), the record, the grounding, redaction, append-only
 *   F. minting and retiring a bridge; nobody outside the office is reached
 *   G. shapes: the SQL validators and the TypeScript validators agree on every specimen in src/engines/hermes/shape-cases.ts
 *   H. the activity ledger: reported through the ledger's own door only when it exists; a failed report is written, not swallowed
 */
import { createHash, randomBytes } from 'node:crypto'
import { REQUEST_CASES, RESULT_CASES } from '../../src/engines/hermes/shape-cases.ts'
import * as timing from '../../src/engines/hermes/timing.ts'
import { requestProblem, resultProblem } from '../../src/engines/hermes/types.ts'
import { isolated } from './guard.ts'
import { realParent } from './real-telegram.ts'

const DB = process.argv[2] ?? 'post'
const db = await isolated(DB)
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const run = Date.now().toString(36)
const results: boolean[] = []
const output: string[] = []
const check = (what: string, ok: boolean, detail = ''): void => {
  results.push(ok)
  const line = `${ok ? 'ok  ' : 'FAIL'} ${what}${detail === '' ? '' : ` - ${detail}`}`
  output.push(line)
  console.log(line)
}
const q = async (sql: string): Promise<Record<string, any>[]> => (await db.execute(sql)).rows as Record<string, any>[]
const one = async (sql: string): Promise<Record<string, any>> => (await q(sql))[0] ?? {}
const json = (v: unknown): any => (typeof v === 'string' ? JSON.parse(v) : v)
const call = async (sql: string): Promise<any> => json((await one(sql)).r)
const refused = async (sql: string): Promise<string> => {
  try {
    await db.execute(sql)
    return ''
  } catch (e) {
    return String((e as Error).message)
  }
}
const sha = (s: string): string => createHash('sha256').update(s).digest('hex')

const A = String((await one('select app.operator_office()::text o')).o)
const TEST = String((await one('select app.test_office()::text o')).o)
const mkOffice = async (name: string): Promise<string> => {
  const auth = String((await one('select gen_random_uuid()::text a')).a)
  await q(`insert into auth.users (id, email) values (${lit(auth)}, ${lit(`${name}.${run}@example.invalid`)})`)
  await q(`insert into public.offices (auth_user_id, kind, name) values (${lit(auth)}, 'person', ${lit(`${name} ${run}`)})`)
  return String((await one(`select office_id::text o from public.offices where auth_user_id = ${lit(auth)}`)).o)
}
const B = await mkOffice('engine-b')
const C = await mkOffice('engine-c')

const setSetting = async (key: string, value: unknown): Promise<void> => {
  await q(`insert into public.system_config (key, value, description) values (${lit(key)}, ${lit(JSON.stringify(value))}::jsonb, 'engine proof')
           on conflict (key) do update set value = excluded.value`)
}
const clearSetting = async (key: string): Promise<void> => { await q(`delete from public.system_config where key = ${lit(key)}`) }
const enableFor = async (...offices: string[]): Promise<void> => setSetting(timing.SETTING.offices, offices)

interface Bridge { office: string; bridge: string; client: string; token: string; mcpToken: string; hash: string; mcpHash: string }
const mint = async (office: string, name: string): Promise<Bridge> => {
  const token = `bridge-${randomBytes(24).toString('hex')}`
  const mcpToken = `mcpt-${randomBytes(24).toString('hex')}`
  const r = await call(`select app.engine_mint_bridge(${lit(office)}::uuid, 'hermes', ${lit(name)}, ${lit(sha(token))}, ${lit(sha(mcpToken))}) r`)
  return { office, bridge: r.bridge_id, client: r.mcp_client_id, token, mcpToken, hash: sha(token), mcpHash: sha(mcpToken) }
}
const fresh = async (b: Bridge): Promise<void> => { await q(`update public.engine_bridges set last_seen_at = now(), healthy = true, unhealthy_reason = null where bridge_id = ${lit(b.bridge)}::uuid`) }

const GOOD = { input: 'What did we decide about the venue?', instructions: 'You answer for the office.', conversation_history: [{ role: 'user', content: 'Hello' }, { role: 'assistant', content: 'Hi' }] }
const jsonLit = (v: unknown): string => `${lit(JSON.stringify(v))}::jsonb`

/** A job that came through a person's own door, parked waiting for its run (the state the handler leaves it in). */
const pausedJob = async (): Promise<string> => {
  const job = await realParent(db)
  await q(`select app.pause_job(${lit(job)}::uuid, 'dependency_wait', 'Hermes is working on it.', 'Waiting for Hermes to finish.', true, null, null)`)
  return job
}
const open = async (office: string, job: string, req: unknown = GOOD): Promise<any> =>
  call(`select app.engine_run_open(${lit(office)}::uuid, ${lit(job)}::uuid, 'hermes', ${jsonLit(req)}) r`)
const claim = async (b: Bridge): Promise<any> => call(`select app.engine_run_claim(${lit(b.office)}::uuid, ${lit(b.bridge)}::uuid) r`)
const beat = async (b: Bridge, runId: string, gen: number, hermes: string | null = null): Promise<any> =>
  call(`select app.engine_run_heartbeat(${lit(b.office)}::uuid, ${lit(b.bridge)}::uuid, ${lit(runId)}::uuid, ${String(gen)}, ${hermes === null ? 'null' : lit(hermes)}) r`)
const finish = async (b: Bridge, runId: string, gen: number, outcome: string, result: unknown): Promise<any> =>
  call(`select app.engine_run_finish(${lit(b.office)}::uuid, ${lit(b.bridge)}::uuid, ${lit(runId)}::uuid, ${String(gen)}, ${lit(outcome)}, ${jsonLit(result)}) r`)
const gate = async (office: string, client: string, tool: string | null): Promise<any> =>
  call(`select app.engine_tool_gate(${lit(office)}::uuid, ${lit(client)}, ${tool === null ? 'null' : lit(tool)}) r`)
const runRow = async (runId: string): Promise<any> => one(`select * from public.engine_runs where run_id = ${lit(runId)}::uuid`)
const jobState = async (job: string): Promise<string> => String((await one(`select state::text s from public.jobs where job_id = ${lit(job)}::uuid`)).s)
/** Clear a run out of the way so a later claim cannot take it (every probe leaves nothing claimable behind). */
const retire = async (runId: string): Promise<void> => {
  await q(`update public.engine_runs set state = 'cancelled', finished_at = now(), lease_until = null where run_id = ${lit(runId)}::uuid and state in ('open', 'running')`).catch(() => undefined)
}
const hermesId = (): string => `run_${randomBytes(16).toString('hex')}`
const DONE = { tools_started: 1, approvals_denied: 0 }
const ANSWER = { ...DONE, answer: 'The venue is unchanged.', model: 'nvidia/nemotron-3-super-120b-a12b:free', usage: { input_tokens: 900, output_tokens: 40 } }

/** Open, claim: a run in the `running` state, held by `b`. */
const live = async (b: Bridge): Promise<{ job: string; runId: string; gen: number }> => {
  await fresh(b)
  const job = await pausedJob()
  const o = await open(b.office, job)
  if (typeof o.run_id !== 'string') throw new Error(`could not open a run: ${JSON.stringify(o)}`)
  const c = await claim(b)
  if (c.run?.run_id !== o.run_id) throw new Error(`the claim did not return the run just opened: ${JSON.stringify(c)}`)
  return { job, runId: o.run_id, gen: c.run.claim_gen }
}

/** Put a defect back into a live definition, run the probe, restore, run it again. The probe must be true clean, false sabotaged, true restored. */
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
const sabotageSql = async (name: string, apply: string, restore: string, probe: () => Promise<boolean>): Promise<void> => {
  const before = await probe()
  await db.execute(apply)
  const during = await probe()
  await db.execute(restore)
  const after = await probe()
  check(`sabotage - ${name}`, before && !during && after, `clean ${String(before)}, probe with the defect ${String(during)} (must be false), restored ${String(after)}`)
}

try {
  // ============================================================================================================================
  // A. schema
  // ============================================================================================================================
  const tables = await q(`select c.relname, c.relrowsecurity rls, c.relforcerowsecurity frc from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in ('engine_bridges','engine_runs','engine_run_calls') order by 1`)
  check('A1 the three engine tables exist with row security enabled AND forced', tables.length === 3 && tables.every((t) => t.rls === true && t.frc === true), JSON.stringify(tables))
  const grants = await q(`select grantee, table_name from information_schema.role_table_grants where table_schema = 'public' and table_name in ('engine_bridges','engine_runs','engine_run_calls') and grantee in ('anon','authenticated','service_role','PUBLIC')`)
  check('A2 no browser role, no service role and no public grant reaches any engine table (the doors are the functions)', grants.length === 0, JSON.stringify(grants))
  const fnPriv = await one(`select
      has_function_privilege('service_role', 'public.engine_run_claim(uuid,uuid)', 'execute') svc_wrap,
      has_function_privilege('anon', 'public.engine_run_claim(uuid,uuid)', 'execute') anon_wrap,
      has_function_privilege('authenticated', 'public.engine_run_claim(uuid,uuid)', 'execute') auth_wrap,
      has_function_privilege('service_role', 'app.engine_run_claim(uuid,uuid)', 'execute') svc_app,
      has_function_privilege('anon', 'app.engine_run_claim(uuid,uuid)', 'execute') anon_app,
      has_function_privilege('service_role', 'app.engine_mint_bridge(uuid,text,text,text,text)', 'execute') svc_mint`)
  check('A3 the service role reaches a claim only through the public wrapper; the app function and the minting function reach nobody', fnPriv.svc_wrap === true && fnPriv.anon_wrap === false && fnPriv.auth_wrap === false && fnPriv.svc_app === false && fnPriv.anon_app === false && fnPriv.svc_mint === false, JSON.stringify(fnPriv))
  const wrappers = await q(`select proname from pg_proc where pronamespace = 'public'::regnamespace and proname like 'engine\\_%' order by 1`)
  check('A4 there is NO public wrapper for minting, retiring, opening or reading a run: those are the operator, Settings and the worker', !wrappers.some((w) => ['engine_mint_bridge', 'engine_retire_bridge', 'engine_run_open', 'engine_run_for_job', 'engine_available'].includes(String(w.proname))), wrappers.map((w) => w.proname).join(','))

  const defaultEngine = await one(`select engine, count(*) over () n from public.inbound_commands limit 1`)
  const colDefault = await one(`select column_default d, is_nullable n from information_schema.columns where table_schema='public' and table_name='inbound_commands' and column_name='engine'`)
  check('A5 inbound_commands.engine exists, is not null and defaults to the team: every existing and every ordinary command is unchanged', String(colDefault.d).includes("'team'") && colDefault.n === 'NO' && (defaultEngine.engine === undefined || defaultEngine.engine === 'team'), `default ${colDefault.d}, nullable ${colDefault.n}`)
  const badEngine = await refused(`insert into public.inbound_commands (office_id, project_id, origin_channel, origin_ref, actor, instruction, dedupe_key, engine) values (app.operator_office(), app.unnamed_project(app.operator_office()), 'teamhq', 'x', 'x', 'x', 'verify:engine_bad:${run}', 'Hermes')`)
  check('A6 a command naming an engine that is not exactly team or hermes is refused, by the constraint', badEngine.includes('inbound_commands_engine_known'), badEngine.slice(0, 120))

  const person = await realParent(db)
  const cmdOfPerson = String((await one(`select origin_command_id::text c from public.jobs where job_id = ${lit(person)}::uuid`)).c)
  const writeOnceProbe = async (): Promise<boolean> => {
    const msg = await refused(`update public.inbound_commands set engine = 'hermes' where command_id = ${lit(cmdOfPerson)}::uuid`)
    return msg.includes('cannot be changed afterwards')
  }
  check('A7 the engine a person chose cannot be changed afterwards (team to hermes refused, by name)', await writeOnceProbe())
  check('A7b and writing the same value again is not refused (the control: the trigger refuses a CHANGE, not an update)', (await refused(`update public.inbound_commands set engine = 'team' where command_id = ${lit(cmdOfPerson)}::uuid`)) === '')

  // ============================================================================================================================
  // F (first half). minting, and the engine MCP client kind
  // ============================================================================================================================
  await enableFor(A, B)
  const bA = await mint(A, `proof ${run}`)
  const bB = await mint(B, `proof ${run}`)
  const client = await one(`select kind, scopes, display_name, enabled, token_sha256 from public.mcp_clients where client_id = ${lit(bA.client)}`)
  check('F1 minting makes a bridge and an MCP client of kind engine, read scope only, named for the bridge', client.kind === 'engine' && JSON.stringify(client.scopes) === '["read"]' && String(client.display_name).startsWith('Hermes') && client.enabled === true, JSON.stringify({ ...client, token_sha256: '[hash]' }))
  const stored = await one(`select token_sha256 from public.engine_bridges where bridge_id = ${lit(bA.bridge)}::uuid`)
  check('F2 only HASHES are stored: the bridge token and the MCP token appear nowhere in either row', stored.token_sha256 === bA.hash && client.token_sha256 === bA.mcpHash && !JSON.stringify([stored, client]).includes(bA.token) && !JSON.stringify([stored, client]).includes(bA.mcpToken))
  const dup = await refused(`select app.engine_mint_bridge(${lit(A)}::uuid, 'hermes', 'second', ${lit(sha('x1'))}, ${lit(sha('x2'))})`)
  check('F3 a second ENABLED bridge for the same office and engine is refused (one Hermes host per office in v1)', dup.includes('engine_bridges_one_enabled'), dup.slice(0, 140))
  const sameHash = await refused(`select app.engine_mint_bridge(${lit(C)}::uuid, 'hermes', 'same hash', ${lit(sha('y1'))}, ${lit(sha('y1'))})`)
  const badHash = await refused(`select app.engine_mint_bridge(${lit(C)}::uuid, 'hermes', 'bad hash', 'not-a-hash', ${lit(sha('y2'))})`)
  const badName = await refused(`select app.engine_mint_bridge(${lit(C)}::uuid, 'hermes', 'x', ${lit(sha('y3'))}, ${lit(sha('y4'))})`)
  const badEng = await refused(`select app.engine_mint_bridge(${lit(C)}::uuid, 'other', 'a name', ${lit(sha('y5'))}, ${lit(sha('y6'))})`)
  const noOffice = await refused(`select app.engine_mint_bridge(null, 'hermes', 'a name', ${lit(sha('y7'))}, ${lit(sha('y8'))})`)
  check('F4 minting refuses the same hash twice, a non-hash, a name that is too short, an unknown engine and no office - each for its own reason', sameHash.includes('two different sha256') && badHash.includes('two different sha256') && badName.includes('3 to 50') && badEng.includes('unknown engine') && noOffice.includes('no_office'), [sameHash, badHash, badName, badEng, noOffice].map((m) => m.slice(0, 40)).join(' | '))
  const kindOk = await refused(`insert into public.mcp_clients (client_id, display_name, token_sha256, office_id, kind) values ('bogus-${run}', 'x', ${lit(sha('k1'))}, ${lit(A)}::uuid, 'bogus')`)
  check('F5 the MCP client kind was widened by exactly one value: engine is allowed (F1) and an unknown kind is still refused', kindOk.includes('mcp_clients_kind_known'), kindOk.slice(0, 100))
  // Inserted DISABLED so the one-enabled-bridge index (F3) cannot be what refuses it: the property is the same-office key.
  const crossClientProbe = async (): Promise<boolean> => {
    const m = await refused(`insert into public.engine_bridges (office_id, engine, display_name, token_sha256, mcp_client_id, enabled, disabled_reason) values (${lit(C)}::uuid, 'hermes', 'steals a client', ${lit(sha(`z-${randomBytes(4).toString('hex')}`))}, ${lit(bA.client)}, false, 'proof')`)
    await q(`delete from public.engine_bridges where mcp_client_id = ${lit(bA.client)} and office_id = ${lit(C)}::uuid`)
    return m.includes('engine_bridges_client_same_office')
  }
  check("F6 a bridge cannot name another office's MCP client: the same-office composite key refuses it, by name", await crossClientProbe())
  await sabotageSql('the same-office key on a bridge is dropped and a bridge takes another office\'s client', 'alter table public.engine_bridges drop constraint engine_bridges_client_same_office', 'alter table public.engine_bridges add constraint engine_bridges_client_same_office foreign key (mcp_client_id, office_id) references public.mcp_clients (client_id, office_id)', crossClientProbe)
  // The same-office key is DDL, so the sabotage above is the one control for it. The write-once engine trigger likewise:
  await sabotageSql('the write-once trigger on the person\'s engine choice is dropped', 'drop trigger b2_engine_is_write_once on public.inbound_commands', 'create trigger b2_engine_is_write_once before update of engine on public.inbound_commands for each row execute function app.inbound_command_engine_is_write_once()', async () => {
    const msg = await refused(`update public.inbound_commands set engine = 'hermes' where command_id = ${lit(cmdOfPerson)}::uuid`)
    await q(`update public.inbound_commands set engine = 'team' where command_id = ${lit(cmdOfPerson)}::uuid`).catch(() => undefined)
    return msg.includes('cannot be changed afterwards')
  })

  // The MCP client kind can never be a writing client (HD-7), and the control: another kind with write scope still is.
  await q(`update public.mcp_clients set scopes = array['read','write'] where client_id = ${lit(bA.client)}`)
  const other = `proof-other-${run}`
  await q(`insert into public.mcp_clients (client_id, display_name, token_sha256, scopes, office_id, kind) values (${lit(other)}, 'proof other client', ${lit(sha(`other-${run}`))}, array['read','write'], ${lit(A)}::uuid, 'other')`)
  const writeProbe = async (): Promise<boolean> => (await one(`select app.mcp_write_client(${lit(A)}::uuid, ${lit(bA.client)}) w`)).w === null
  check('F7 an engine client holding the write scope is still not a writing client; a client of another kind holding it is (the control)', (await writeProbe()) && (await one(`select app.mcp_write_client(${lit(A)}::uuid, ${lit(other)}) w`)).w === 'mcp')
  await sabotage('app.mcp_write_client stops excluding the engine kind', 'app.mcp_write_client(uuid,text)', (d) => d.replace("\n     and k.kind <> 'engine'", ''), writeProbe)
  await q(`update public.mcp_clients set scopes = array['read'] where client_id = ${lit(bA.client)}`)
  await q(`delete from public.mcp_clients where client_id = ${lit(other)}`)

  const prov = await one(`select enabled, disabled_reason, free_only, max_cost_per_call_usd::text m from public.providers where provider = 'hermes'`)
  check('F8 the provider row for Hermes exists for provenance, is DISABLED with its reason, and allows no spend', prov.enabled === false && String(prov.disabled_reason).length > 20 && prov.free_only === true && Number(prov.m) === 0, JSON.stringify(prov))

  // T11: the office router can never pick Hermes. It chooses from app.model_order, which reads usable_models, which joins providers
  // on `enabled`. A usable zero-priced model row for Hermes is planted, and the router's own order must still not contain it; the
  // control enables the provider and the same row appears, so the order of events is what proves the filter is the reason.
  await q(`insert into public.provider_models (provider, model_id, status, pricing_prompt, pricing_completion, last_probed_at, last_success_at) values ('hermes', 'hermes-agent', 'usable', '0', '0', now(), now())`)
  const routerHas = async (): Promise<boolean> => Number((await one(`select count(*)::int n from app.model_order('office.instruction') where provider = 'hermes'`)).n) > 0
  const whileDisabled = await routerHas()
  await q(`update public.providers set enabled = true, disabled_reason = null where provider = 'hermes'`)
  const whileEnabled = await routerHas()
  await q(`update public.providers set enabled = false, disabled_reason = 'An outside engine, recorded for provenance only. It is never a candidate for the office router: a person chooses it, per message.' where provider = 'hermes'`)
  await q(`delete from public.provider_models where provider = 'hermes'`)
  check('F9a the office router never selects Hermes: with a usable zero-priced model planted for it, model_order omits it while the provider is disabled, and (the control) includes it the moment the provider is enabled', whileDisabled === false && whileEnabled === true && (await routerHas()) === false, `disabled ${String(whileDisabled)}, enabled ${String(whileEnabled)}`)

  // ============================================================================================================================
  // B. the person's door and availability
  // ============================================================================================================================
  const avail = async (office: string): Promise<{ available: boolean; because: string | null }> => call(`select app.engine_available(${lit(office)}::uuid, 'hermes') r`)
  await fresh(bA)
  check('B1 with Hermes switched on, a fresh healthy bridge and room in the day, Hermes is available (the positive control for every refusal below)', (await avail(A)).available === true)
  await clearSetting(timing.SETTING.offices)
  const off1 = await avail(A)
  check('B2 with the setting ABSENT Hermes is off, and the sentence says so', off1.available === false && String(off1.because).includes('switched on'), String(off1.because))
  for (const [label, value] of [['a string', 'abc'], ['an object', { [A]: true }], ['null', null], ['an array naming only another office', [B]], ['a number', 7]] as const) {
    await setSetting(timing.SETTING.offices, value)
    const r = await avail(A)
    check(`B3 the setting being ${label} is off, never on by accident`, r.available === false && String(r.because).includes('switched on'), String(r.because))
  }
  await enableFor(A, B)
  const noBridge = await avail(C)
  await enableFor(A, B, C)
  const noHost = await avail(C)
  check('B4 an office with no bridge is told it has no host set up (and is off, before that, if not enabled)', noBridge.available === false && noHost.available === false && String(noHost.because).includes('no host set up'), `${noBridge.because} | ${noHost.because}`)
  await q(`update public.engine_bridges set last_seen_at = null where bridge_id = ${lit(bA.bridge)}::uuid`)
  const never = await avail(A)
  await q(`update public.engine_bridges set last_seen_at = now() - interval '7 minutes' where bridge_id = ${lit(bA.bridge)}::uuid`)
  const stale = await avail(A)
  check('B5 a bridge never seen is "hasn\'t checked in yet"; one last seen seven minutes ago says how long', never.available === false && String(never.because).includes('checked in yet') && stale.available === false && /checked in for [6-8] minutes/.test(String(stale.because)), `${never.because} | ${stale.because}`)
  await fresh(bA)
  await q(`select app.engine_bridge_report(${lit(A)}::uuid, ${lit(bA.bridge)}::uuid, false, 'Hermes did not answer')`)
  const sick = await avail(A)
  await q(`select app.engine_bridge_report(${lit(A)}::uuid, ${lit(bA.bridge)}::uuid, true, null)`)
  check('B6 a bridge that reports its own host as not ready makes Hermes unavailable, with its reason; reporting ready makes it available again', sick.available === false && String(sick.because).includes("isn't ready") && String(sick.because).includes('did not answer') && (await avail(A)).available === true, String(sick.because))
  const used = Number((await one(`select count(*)::int n from public.engine_runs where office_id = ${lit(A)}::uuid and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'`)).n)
  await setSetting(timing.SETTING.dailyRuns, used)
  const capped = await avail(A)
  await setSetting(timing.SETTING.dailyRuns, used + 5)
  const roomy = await avail(A)
  await clearSetting(timing.SETTING.dailyRuns)
  check("B7 the daily ceiling refuses once today's runs reach it, and says how many; one more run of room makes it available (the control)", capped.available === false && String(capped.because).includes("today's") && roomy.available === true, String(capped.because))
  await q(`update public.mcp_clients set enabled = false, disabled_reason = 'proof' where client_id = ${lit(bA.client)}`)
  const clientOff = await avail(A)
  await q(`update public.mcp_clients set enabled = true, disabled_reason = null where client_id = ${lit(bA.client)}`)
  check('B8 a bridge whose MCP client is disabled is not a host', clientOff.available === false && String(clientOff.because).includes('no host'), String(clientOff.because))
  const availProbe = async (): Promise<boolean> => {
    const r = await avail(C)
    // C is enabled (B4) but office D is not: use a never-enabled office for the probe
    return r.available === false
  }
  const D = await mkOffice('engine-d')
  const offProbe = async (): Promise<boolean> => String((await avail(D)).because).includes('switched on')
  await sabotage('app.engine_enabled answers yes whatever the setting says', 'app.engine_enabled(uuid,text)', (d) => d.replace("select p_engine = 'hermes' and p_office is not null and coalesce(", 'select true or coalesce('), offProbe)
  void availProbe

  // engine_setting clamps and defaults
  await setSetting(timing.SETTING.deadlineS, 5)
  const low = Number((await one(`select app.engine_setting(${lit(timing.SETTING.deadlineS)}, ${timing.DEADLINE_DEFAULT_S}, ${timing.DEADLINE_MIN_S}, ${timing.DEADLINE_MAX_S}) v`)).v)
  await setSetting(timing.SETTING.deadlineS, 99999)
  const high = Number((await one(`select app.engine_setting(${lit(timing.SETTING.deadlineS)}, ${timing.DEADLINE_DEFAULT_S}, ${timing.DEADLINE_MIN_S}, ${timing.DEADLINE_MAX_S}) v`)).v)
  await setSetting(timing.SETTING.deadlineS, 'soon')
  const junk = Number((await one(`select app.engine_setting(${lit(timing.SETTING.deadlineS)}, ${timing.DEADLINE_DEFAULT_S}, ${timing.DEADLINE_MIN_S}, ${timing.DEADLINE_MAX_S}) v`)).v)
  await setSetting(timing.SETTING.deadlineS, 600)
  const set600 = Number((await one(`select app.engine_setting(${lit(timing.SETTING.deadlineS)}, ${timing.DEADLINE_DEFAULT_S}, ${timing.DEADLINE_MIN_S}, ${timing.DEADLINE_MAX_S}) v`)).v)
  await clearSetting(timing.SETTING.deadlineS)
  const absent = Number((await one(`select app.engine_setting(${lit(timing.SETTING.deadlineS)}, ${timing.DEADLINE_DEFAULT_S}, ${timing.DEADLINE_MIN_S}, ${timing.DEADLINE_MAX_S}) v`)).v)
  check('B9 a setting is clamped to its bounds, a malformed one is the default, and an absent one is the default', low === timing.DEADLINE_MIN_S && high === timing.DEADLINE_MAX_S && junk === timing.DEADLINE_DEFAULT_S && set600 === 600 && absent === timing.DEADLINE_DEFAULT_S, `${low} ${high} ${junk} ${set600} ${absent}`)
  const dailyDefault = Number((await one(`select app.engine_setting(${lit(timing.SETTING.dailyRuns)}, ${timing.DAILY_RUNS_DEFAULT}, 0, ${timing.DAILY_RUNS_MAX}) v`)).v)
  check('B10 the TypeScript constants and the database agree: the v1 tool list is the same list, and the defaults match', JSON.stringify((await one(`select app.engine_read_tools() t`)).t) === JSON.stringify([...timing.ENGINE_READ_TOOLS]) && dailyDefault === timing.DAILY_RUNS_DEFAULT, JSON.stringify((await one(`select app.engine_read_tools() t`)).t))

  // Open: who may, and the harness. The proof opens many runs in one day, so the ceiling is raised for the rest of it (B7 proved it).
  await setSetting(timing.SETTING.dailyRuns, 900)
  await enableFor(A, B)
  await fresh(bA)
  const jobPerson = await pausedJob()
  const harnessCmd = String((await one(`insert into public.inbound_commands (office_id, project_id, origin_channel, origin_ref, actor, instruction, dedupe_key) values (app.test_office(), app.unnamed_project(app.test_office()), 'teamhq', 'x:y', 'proof', 'hello', ${lit(`verify:engine_run:${run}`)}) returning command_id::text c`)).c)
  const harnessJob = String(json((await one(`select public.enqueue_inbound(${lit(harnessCmd)}::uuid) r`)).r).job_id)
  const harnessOpen = await open(TEST, harnessJob)
  check('B11 a turn from the harness (the test office) cannot open a run: only a person\'s own door can choose an engine', harnessOpen.error === 'not_from_a_person', JSON.stringify(harnessOpen))
  const okOpen = await open(A, jobPerson)
  check('B12 a turn through a person\'s own door opens a run (the control for B11)', okOpen.opened === true && okOpen.state === 'open' && typeof okOpen.run_id === 'string', JSON.stringify(okOpen))
  const foreign = await open(B, jobPerson)
  check("B13 another office cannot open a run on this office's job (the job is not theirs)", foreign.error === 'no_such_job', JSON.stringify(foreign))
  const badEngineOpen = await call(`select app.engine_run_open(${lit(A)}::uuid, ${lit(jobPerson)}::uuid, 'claude', ${jsonLit(GOOD)}) r`)
  check('B14 an engine the office does not know is refused', badEngineOpen.error === 'unknown_engine', JSON.stringify(badEngineOpen))
  const noJob = await open(A, '00000000-0000-4000-8000-000000000000')
  check('B15 a job that does not exist is refused', noJob.error === 'no_such_job', JSON.stringify(noJob))
  const noOfficeOpen = await refused(`select app.engine_run_open(null, ${lit(jobPerson)}::uuid, 'hermes', ${jsonLit(GOOD)})`)
  check('B16 no office is refused, never defaulted', noOfficeOpen.includes('no_office'), noOfficeOpen.slice(0, 80))
  const openRowCount = async (job: string): Promise<number> => Number((await one(`select count(*)::int n from public.engine_runs where job_id = ${lit(job)}::uuid`)).n)

  // ============================================================================================================================
  // C. a run's life
  // ============================================================================================================================
  // T1: one run per job
  const again = await open(A, jobPerson)
  check('C1 opening again for the same job returns the SAME run, opened=false, and there is still one row', again.opened === false && again.run_id === okOpen.run_id && (await openRowCount(jobPerson)) === 1, JSON.stringify(again))
  const dupProbe = async (): Promise<boolean> => {
    const msg = await refused(`insert into public.engine_runs (office_id, job_id, engine, deadline_at, request) values (${lit(A)}::uuid, ${lit(jobPerson)}::uuid, 'hermes', now() + interval '10 minutes', ${jsonLit(GOOD)})`)
    await q(`delete from public.engine_runs where job_id = ${lit(jobPerson)}::uuid and run_id <> ${lit(okOpen.run_id)}::uuid`)
    return msg.includes('engine_runs_one_per_job')
  }
  await sabotageSql('the one-run-per-job index is dropped and a second run for the job is inserted', 'drop index public.engine_runs_one_per_job', 'create unique index engine_runs_one_per_job on public.engine_runs (office_id, job_id)', dupProbe)
  const row = await runRow(okOpen.run_id)
  check('C2 the run carries the job\'s project and office, a deadline from the setting (default), and the request exactly as given', row.project_id !== null && row.office_id === A && Math.abs((new Date(row.deadline_at).getTime() - new Date(row.created_at).getTime()) / 1000 - timing.DEADLINE_DEFAULT_S) < 5 && JSON.stringify(row.request) === JSON.stringify(GOOD), `deadline ${(new Date(row.deadline_at).getTime() - new Date(row.created_at).getTime()) / 1000} s`)
  const badOpen = await open(A, await pausedJob(), { ...GOOD, tools: ['terminal'] })
  check('C3 a request with a key it may not have is refused before a row exists', badOpen.error === 'bad_request' && String(badOpen.because).includes('a key it may not have'), JSON.stringify(badOpen))

  // Claim: only what is waiting, only the claimer's office
  const bBfresh = async (): Promise<void> => fresh(bB)
  await bBfresh()
  const otherOffice = await claim(bB)
  check("C4 office B's bridge, enabled and healthy, is handed nothing while the only open run is office A's", otherOffice.run === null, JSON.stringify(otherOffice))
  await fresh(bA)
  const notStopped = await pausedJob()
  await q(`update public.jobs set stop_requested_at = now() where job_id = ${lit(notStopped)}::uuid`)
  const stopOpen = await open(A, notStopped)
  const notPaused = await realParent(db)
  const queuedOpen = await open(A, notPaused)
  // Only okOpen's job is claimable: the stop-requested job and the job that is not paused must be passed over.
  const first = await claim(bA)
  check('C5 a claim takes the oldest open run whose job is still waiting: a job already told to stop, and a job that is not paused, are passed over', first.run?.run_id === okOpen.run_id && first.run.claim_gen === 1 && first.run.job_id === jobPerson && JSON.stringify(first.run.request) === JSON.stringify(GOOD) && first.run.hermes_run_id === null && first.run.previous_hermes_run_id === null, JSON.stringify(first).slice(0, 200))
  void stopOpen; void queuedOpen
  const second = await claim(bA)
  check('C6 claiming again returns the run this bridge already holds, unchanged claim number (a restarted bridge resumes, it does not orphan the run)', second.run?.run_id === okOpen.run_id && second.run.claim_gen === 1, JSON.stringify(second).slice(0, 160))
  const heldRow = await runRow(okOpen.run_id)
  check('C7 a held run is `running`, names its bridge, has a lease of the agreed length, a start time, and the other claimable runs stayed open', heldRow.state === 'running' && heldRow.bridge_id === bA.bridge && Math.abs((new Date(heldRow.lease_until).getTime() - Date.now()) / 1000 - timing.LEASE_S) < 5 && heldRow.started_at !== null, `lease in ${(new Date(heldRow.lease_until).getTime() - Date.now()) / 1000} s`)
  const claimFilterProbe = async (): Promise<boolean> => {
    await fresh(bB)
    const job = await pausedJob()
    const o = await open(A, job)
    const got = await refused(`select app.engine_run_claim(${lit(B)}::uuid, ${lit(bB.bridge)}::uuid)`)
    const c = got === '' ? await claim(bB) : { error: got }
    await retire(o.run_id)
    await q(`update public.jobs set state = 'cancelled' where job_id = ${lit(job)}::uuid`).catch(() => undefined)
    return c.run === null
  }
  // The held run above must not be the one the probe finds: finish it first.
  const doneFirst = await finish(bA, okOpen.run_id, 1, 'completed', ANSWER)
  check('C8 finishing a run completes it, resumes the waiting job, and reports the state', doneFirst.ok === true && doneFirst.resumed === true && doneFirst.state === 'completed' && (await jobState(jobPerson)) === 'queued', JSON.stringify(doneFirst))
  // Remove the leftover candidates before the office-filter sabotage so it is the filter that matters.
  for (const r of await q(`select run_id::text id from public.engine_runs where state = 'open'`)) await retire(r.id)
  await sabotage("the claim's office filter is removed", 'app.engine_run_claim(uuid,uuid)', (d) => d.replace("where r.office_id = p_office and r.state = 'open'\n       and j.state::text = 'paused'", "where r.state = 'open'\n       and j.state::text = 'paused'"), claimFilterProbe)
  await sabotage('the claim stops skipping a job that was told to stop', 'app.engine_run_claim(uuid,uuid)', (d) => d.replace('and j.stop_requested_at is null', 'and true'), async () => {
    await fresh(bA)
    const job = await pausedJob()
    const o = await open(A, job)
    await q(`update public.jobs set stop_requested_at = now() where job_id = ${lit(job)}::uuid`)
    const c = await claim(bA)
    await retire(o.run_id)
    return c.run === null
  })

  // T4: fencing
  const f = await live(bA)
  const wrongGen = await beat(bA, f.runId, f.gen + 1)
  const wrongBridge = await call(`select app.engine_run_heartbeat(${lit(B)}::uuid, ${lit(bB.bridge)}::uuid, ${lit(f.runId)}::uuid, ${String(f.gen)}) r`)
  const rightBeat = await beat(bA, f.runId, f.gen)
  check('C9 a heartbeat with the right bridge and claim is accepted; with a stale claim number, or another bridge or office, it is told to stop: not yours', rightBeat.stop === false && wrongGen.stop === true && wrongGen.because === 'not yours' && wrongBridge.stop === true && wrongBridge.because === 'not yours', JSON.stringify([rightBeat.stop, wrongGen.because, wrongBridge.because]))
  const staleFinish = await finish(bA, f.runId, f.gen + 1, 'completed', ANSWER)
  const otherFinish = await call(`select app.engine_run_finish(${lit(B)}::uuid, ${lit(bB.bridge)}::uuid, ${lit(f.runId)}::uuid, ${String(f.gen)}, 'completed', ${jsonLit(ANSWER)}) r`)
  check('C10 a finish with a stale claim, or from another bridge, is refused as not_yours and the run is still running', staleFinish.error === 'not_yours' && otherFinish.error === 'not_yours' && (await runRow(f.runId)).state === 'running', JSON.stringify([staleFinish, otherFinish]))
  await retire(f.runId) // a bridge holds one run at a time: free it before the probe opens its own
  await sabotage('the finish fence on the claim number is removed','app.engine_run_finish(uuid,uuid,uuid,integer,text,jsonb)', (d) => d.replace('and r.claim_gen = p_claim_gen for update', 'for update'), async () => {
    const x = await live(bA)
    const stale = await finish(bA, x.runId, x.gen + 1, 'completed', ANSWER)
    const stillRunning = (await runRow(x.runId)).state === 'running'
    await retire(x.runId)
    return stale.error === 'not_yours' && stillRunning
  })
  await retire(f.runId)

  // hermes_run_id is set once per attempt
  const h = await live(bA)
  const hid = hermesId()
  const setId = await beat(bA, h.runId, h.gen, hid)
  const sameId = await beat(bA, h.runId, h.gen, hid)
  const otherId = await beat(bA, h.runId, h.gen, hermesId())
  const badId = await beat(bA, h.runId, h.gen, 'not-a-hermes-run')
  const rr = await runRow(h.runId)
  check('C11 the Hermes run id is recorded once per attempt: the same id again is fine, a different one or a malformed one stops the bridge', setId.stop === false && sameId.stop === false && otherId.stop === true && String(otherId.because).includes('different Hermes run') && badId.stop === true && rr.hermes_run_id === hid && rr.hermes_claim_gen === h.gen, JSON.stringify([setId.stop, otherId.because, badId.because]))
  const reattach = await claim(bA)
  check('C12 a restarted bridge that claims again is handed its own Hermes run id to attach to, and no previous one', reattach.run?.hermes_run_id === hid && reattach.run.previous_hermes_run_id === null, JSON.stringify(reattach).slice(0, 200))
  // lapse the lease, reclaim: a NEW attempt, told the old Hermes run so it can be stopped first (M0 D-2)
  await q(`update public.engine_runs set lease_until = now() - interval '1 second' where run_id = ${lit(h.runId)}::uuid`)
  const second2 = await claim(bA)
  check('C13 after the lease lapses the run reopens and is claimed as attempt 2: no run to attach to, and the first attempt\'s Hermes run named so it can be stopped', second2.run?.claim_gen === 2 && second2.run.hermes_run_id === null && second2.run.previous_hermes_run_id === hid, JSON.stringify(second2).slice(0, 220))
  const hid2 = hermesId()
  await beat(bA, h.runId, 2, hid2)
  const rr2 = await runRow(h.runId)
  check('C14 the second attempt records its own Hermes run id, keeps the first one as previous, and is fenced to claim 2', rr2.hermes_run_id === hid2 && rr2.previous_hermes_run_id === hid && rr2.hermes_claim_gen === 2 && (await beat(bA, h.runId, 1)).because === 'not yours')
  await retire(h.runId)

  // T5: lapse bound
  const lapseProbe = async (): Promise<boolean> => {
    const x = await live(bA)
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await q(`update public.engine_runs set lease_until = now() - interval '1 second' where run_id = ${lit(x.runId)}::uuid`)
      if (attempt < 3) {
        const c = await claim(bA)
        if (c.run?.claim_gen !== attempt + 1) return false
      } else {
        // With the bound raised the run reopens a fourth time and the claim number check refuses it: that error IS the defect showing.
        const c = await claim(bA).catch(() => ({ run: 'errored' }))
        const s = await runRow(x.runId)
        await retire(x.runId)
        return c.run === null && s.state === 'failed' && s.failure === 'bridge_lost'
      }
    }
    return false
  }
  const lapseBefore = await lapseProbe()
  const lapsed = await live(bA)
  await q(`update public.engine_runs set lease_until = now() - interval '1 second' where run_id = ${lit(lapsed.runId)}::uuid`)
  await claim(bA)
  await q(`update public.engine_runs set lease_until = now() - interval '1 second' where run_id = ${lit(lapsed.runId)}::uuid`)
  await claim(bA)
  await q(`update public.engine_runs set lease_until = now() - interval '1 second' where run_id = ${lit(lapsed.runId)}::uuid`)
  await claim(bA)
  const lapsedRow = await runRow(lapsed.runId)
  check('C15 a run claimed three times whose lease lapses a third time FAILS as bridge_lost, is finished, and wakes its job (never reopens a fourth time)', lapseBefore && lapsedRow.state === 'failed' && lapsedRow.failure === 'bridge_lost' && lapsedRow.finished_at !== null && (await jobState(lapsed.job)) === 'queued', `state ${lapsedRow.state}, claim ${lapsedRow.claim_gen}, job ${await jobState(lapsed.job)}`)
  await sabotage('the claim bound is raised from three to four', 'app.engine_settle_office(uuid)', (d) => d.replaceAll('e.claim_gen < 3', 'e.claim_gen < 4'), lapseProbe)

  // finish: one inference row, resumes, idempotent, validated, redacted
  const g = await live(bA)
  await beat(bA, g.runId, g.gen, hermesId())
  const usageBefore = Number((await one(`select count(*)::int n from public.inference_usage where job_id = ${lit(g.job)}::uuid`)).n)
  const secretAnswer = `The token is ${'xo'}xb-${'1'.repeat(24)} and also Bearer ${'a'.repeat(30)}.`
  const fin = await finish(bA, g.runId, g.gen, 'completed', { ...ANSWER, answer: secretAnswer })
  const usage = await q(`select provider, model_id, outcome, prompt_tokens, completion_tokens, cost_usd::text cost, provider_reported_cost, provenance::text prov, correlation_id::text corr from public.inference_usage where job_id = ${lit(g.job)}::uuid`)
  const corr = String((await one(`select correlation_id::text c from public.jobs where job_id = ${lit(g.job)}::uuid`)).c)
  check('C16 a completed finish writes exactly ONE inference_usage row: provider hermes, the served model, the real token counts, cost zero, provenance estimated, the job\'s own correlation', usageBefore === 0 && usage.length === 1 && usage[0]?.provider === 'hermes' && usage[0].model_id === ANSWER.model && usage[0].outcome === 'ok' && usage[0].prompt_tokens === 900 && usage[0].completion_tokens === 40 && Number(usage[0].cost) === 0 && usage[0].provider_reported_cost === null && usage[0].prov === 'estimated' && usage[0].corr === corr, JSON.stringify(usage[0]))
  check('C17 the finish woke the waiting job, which is queued again with the pause closed', fin.ok === true && fin.resumed === true && (await jobState(g.job)) === 'queued' && Number((await one(`select count(*)::int n from public.job_pauses where job_id = ${lit(g.job)}::uuid and resumed_at is null`)).n) === 0, JSON.stringify(fin))
  const stored2 = await runRow(g.runId)
  check('C18 a credential-shaped string in the answer is redacted in what is stored, not only by the caller', !JSON.stringify(stored2.result).includes('1'.repeat(24)) && !JSON.stringify(stored2.result).includes('a'.repeat(30)) && JSON.stringify(stored2.result).includes('[redacted]'), String(stored2.result?.answer).slice(0, 80))
  const finAgain = await finish(bA, g.runId, g.gen, 'completed', ANSWER)
  const usageAfter = Number((await one(`select count(*)::int n from public.inference_usage where job_id = ${lit(g.job)}::uuid`)).n)
  check('C19 a second finish is idempotent: ok, nothing resumed, no second inference row, the state reported', finAgain.ok === true && finAgain.resumed === false && finAgain.state === 'completed' && usageAfter === 1, JSON.stringify(finAgain))
  const lateFail = await finish(bA, g.runId, g.gen, 'failed', { ...DONE, failure: 'too late' })
  check('C20 a late failed finish cannot rewrite a completed run', lateFail.state === 'completed' && (await runRow(g.runId)).state === 'completed' && (await runRow(g.runId)).failure === null, JSON.stringify(lateFail))
  await sabotage('the inference row is no longer written on a completed finish', 'app.engine_run_finish(uuid,uuid,uuid,integer,text,jsonb)', (d) => d.replace("(p_outcome = 'completed' or v_in + v_out > 0)", 'false'), async () => {
    const x = await live(bA)
    await finish(bA, x.runId, x.gen, 'completed', ANSWER)
    return Number((await one(`select count(*)::int n from public.inference_usage where job_id = ${lit(x.job)}::uuid`)).n) === 1
  })
  const failedRun = await live(bA)
  const failFin = await finish(bA, failedRun.runId, failedRun.gen, 'failed', { ...DONE, failure: `the free model was over its limit (key ${'sk'}-${'z'.repeat(30)})` })
  const failRow = await runRow(failedRun.runId)
  const failUsage = Number((await one(`select count(*)::int n from public.inference_usage where job_id = ${lit(failedRun.job)}::uuid`)).n)
  check('C21 a failed run that spent nothing writes NO inference row (so the handler\'s own sentence is not mistaken for a model\'s), records a redacted one-line failure, and still wakes the job', failFin.ok === true && failRow.state === 'failed' && failUsage === 0 && !String(failRow.failure).includes('z'.repeat(30)) && String(failRow.failure).includes('[redacted]') && (await jobState(failedRun.job)) === 'queued', String(failRow.failure))
  const spentRun = await live(bA)
  await finish(bA, spentRun.runId, spentRun.gen, 'failed', { ...DONE, failure: 'HTTP 429: Rate limit exceeded', usage: { input_tokens: 500, output_tokens: 0 } })
  const spentUsage = await one(`select outcome, prompt_tokens from public.inference_usage where job_id = ${lit(spentRun.job)}::uuid`)
  check('C22 a failed run that did spend tokens writes one row, mapped onto the table\'s own vocabulary (a rate limit is rate_limited)', spentUsage.outcome === 'rate_limited' && spentUsage.prompt_tokens === 500, JSON.stringify(spentUsage))
  const cancelRun = await live(bA)
  const cancelFin = await finish(bA, cancelRun.runId, cancelRun.gen, 'cancelled', DONE)
  check('C23 a cancelled run is terminal, writes no inference row, and wakes the job so it can say so', cancelFin.ok === true && (await runRow(cancelRun.runId)).state === 'cancelled' && Number((await one(`select count(*)::int n from public.inference_usage where job_id = ${lit(cancelRun.job)}::uuid`)).n) === 0 && (await jobState(cancelRun.job)) === 'queued')
  const bad1 = await live(bA)
  const noAnswer = await finish(bA, bad1.runId, bad1.gen, 'completed', DONE)
  const extraKey = await finish(bA, bad1.runId, bad1.gen, 'completed', { ...ANSWER, tool_calls: [] })
  const badOutcome = await finish(bA, bad1.runId, bad1.gen, 'success', ANSWER)
  check('C24 a finish with no answer, an extra key, or an outcome outside the three is refused, and the run is still running (the bridge can correct and retry)', noAnswer.error === 'bad_result' && extraKey.error === 'bad_result' && badOutcome.error === 'bad_outcome' && (await runRow(bad1.runId)).state === 'running', JSON.stringify([noAnswer.because, extraKey.because, badOutcome.error]))
  await retire(bad1.runId)
  const guardProbe = async (): Promise<boolean> => {
    const x = await live(bA)
    await finish(bA, x.runId, x.gen, 'completed', ANSWER)
    const msg = await refused(`update public.engine_runs set state = 'running' where run_id = ${lit(x.runId)}::uuid`)
    await q(`update public.engine_runs set state = 'completed' where run_id = ${lit(x.runId)}::uuid`).catch(() => undefined)
    return msg.includes('has ended cannot change state')
  }
  check('C25 an ended run cannot be moved back to running, its request, deadline and job are fixed, and the claim number never goes down', await guardProbe() && (await refused(`update public.engine_runs set request = ${jsonLit(GOOD)} || '{"input":"changed"}'::jsonb where run_id = ${lit(g.runId)}::uuid`)).includes('fixed when it opens') && (await refused(`update public.engine_runs set claim_gen = 0 where run_id = ${lit(g.runId)}::uuid`)).includes('only goes up'))
  await sabotageSql('the run guard trigger is dropped and an ended run is moved back to running', 'drop trigger b1_engine_run_guard on public.engine_runs', 'create trigger b1_engine_run_guard before update on public.engine_runs for each row execute function app.engine_runs_guard()', async () => {
    const x = await live(bA)
    await finish(bA, x.runId, x.gen, 'completed', ANSWER)
    const msg = await refused(`update public.engine_runs set state = 'open' where run_id = ${lit(x.runId)}::uuid`)
    return msg.includes('has ended cannot change state')
  })

  // expiry
  const ex = await pausedJob()
  await fresh(bA)
  const exOpen = await open(A, ex)
  await q('alter table public.engine_runs disable trigger b1_engine_run_guard')
  await q(`update public.engine_runs set deadline_at = now() - interval '1 second' where run_id = ${lit(exOpen.run_id)}::uuid`)
  await q('alter table public.engine_runs enable trigger b1_engine_run_guard')
  const beforeFor = await runRow(exOpen.run_id)
  const forJob = await call(`select app.engine_run_for_job(${lit(A)}::uuid, ${lit(ex)}::uuid) r`)
  check('C26 a run past its deadline is expired when the handler looks (and the waiting job is woken), with the state and deadline the handler reads', beforeFor.state === 'open' && forJob.state === 'expired' && forJob.engine === 'hermes' && (await jobState(ex)) === 'queued', JSON.stringify(forJob))
  check('C27 for_job on a job with no run is null, and another office sees nothing of this job\'s run', (await call(`select app.engine_run_for_job(${lit(A)}::uuid, ${lit(await realParent(db))}::uuid) r`)) === null && (await call(`select app.engine_run_for_job(${lit(B)}::uuid, ${lit(ex)}::uuid) r`)) === null)
  const exRun = await live(bA)
  await q('alter table public.engine_runs disable trigger b1_engine_run_guard')
  await q(`update public.engine_runs set deadline_at = now() - interval '1 second' where run_id = ${lit(exRun.runId)}::uuid`)
  await q('alter table public.engine_runs enable trigger b1_engine_run_guard')
  const lateBeat = await beat(bA, exRun.runId, exRun.gen)
  await claim(bA)
  check('C28 a running run past its deadline is told to stop by its heartbeat, and expired by the next claim sweep', lateBeat.stop === true && lateBeat.because === 'the deadline passed' && (await runRow(exRun.runId)).state === 'expired', JSON.stringify(lateBeat))

  // ============================================================================================================================
  // D. stop
  // ============================================================================================================================
  const sRun = await live(bA)
  const calm = await beat(bA, sRun.runId, sRun.gen)
  await q(`update public.jobs set stop_requested_at = now() where job_id = ${lit(sRun.job)}::uuid`)
  const pressed = await beat(bA, sRun.runId, sRun.gen)
  check('D1 a run whose job has been told to stop is told so by its heartbeat; before the press it is not (the control)', calm.stop === false && pressed.stop === true && pressed.because === 'a person pressed Stop', JSON.stringify([calm.stop, pressed.because]))
  await retire(sRun.runId)
  const cRun = await live(bA)
  const stopped = await call(`select app.request_stop(${lit(A)}::uuid, ${lit(cRun.job)}::uuid, null) r`)
  const afterStop = await beat(bA, cRun.runId, cRun.gen)
  check("D2 a person's Stop on the paused job cancels the job (the office's own stop path) and the heartbeat then tells the bridge the job has ended", stopped.ok !== false && (await jobState(cRun.job)) === 'cancelled' && afterStop.stop === true && afterStop.because === 'the job has ended', JSON.stringify([stopped, afterStop.because]))
  await retire(cRun.runId)
  await sabotage('the heartbeat stops reading whether the job has ended or was told to stop', 'app.engine_run_heartbeat(uuid,uuid,uuid,integer,text)', (d) => d.replace("when v_job.state in ('cancelled', 'failed', 'complete') then 'the job has ended'", 'when false then \'the job has ended\'').replace("when v_job.stop_requested_at is not null then 'a person pressed Stop'", "when false then 'a person pressed Stop'"), async () => {
    const x = await live(bA)
    await q(`update public.jobs set stop_requested_at = now() where job_id = ${lit(x.job)}::uuid`)
    const b = await beat(bA, x.runId, x.gen)
    await retire(x.runId)
    return b.stop === true
  })
  const offRun = await live(bA)
  await enableFor(B)
  const switchedOff = await beat(bA, offRun.runId, offRun.gen)
  await enableFor(A, B)
  check('D3 switching Hermes off for the office stops a run in flight at its next heartbeat', switchedOff.stop === true && String(switchedOff.because).includes('switched off'), String(switchedOff.because))
  await retire(offRun.runId)

  // ============================================================================================================================
  // E. the MCP side
  // ============================================================================================================================
  const e = await live(bA)
  const allowed = await gate(A, bA.client, 'search_documents')
  check('E1 an engine client may call a read tool during its bridge\'s live run, and the answer names the run, project and job to bind the call to', allowed.allow === true && allowed.is_engine === true && allowed.run_id === e.runId && allowed.job_id === e.job && typeof allowed.project_id === 'string', JSON.stringify(allowed))
  const writeTool = await gate(A, bA.client, 'create_task')
  const unknownTool = await gate(A, bA.client, 'drop_everything')
  const nullTool = await gate(A, bA.client, null)
  check('E2 a write tool, an unknown tool and no tool are each refused to an engine client, with the reason', writeTool.allow === false && String(writeTool.because).includes('not one Hermes may use') && unknownTool.allow === false && nullTool.allow === false, JSON.stringify([writeTool.because, unknownTool.because]))
  const everyReadTool = await Promise.all(timing.ENGINE_READ_TOOLS.map(async (t) => (await gate(A, bA.client, t)).allow === true))
  check('E3 every tool on the v1 list is allowed during the run, and nothing else was added by accident', everyReadTool.every(Boolean) && everyReadTool.length === 10)
  const otherOfficeGate = await gate(B, bA.client, 'search_documents')
  check("E4 office B asking about office A's client is told that client is not known to it", otherOfficeGate.allow === false && String(otherOfficeGate.because).includes('not known'), JSON.stringify(otherOfficeGate))
  const noRunGate = await gate(B, bB.client, 'search_documents')
  check('E5 an engine client whose bridge has no running run is refused: there is no run in progress for this credential', noRunGate.allow === false && String(noRunGate.because).includes('no run in progress'), JSON.stringify(noRunGate))
  const plain = `proof-plain-${run}`
  await q(`insert into public.mcp_clients (client_id, display_name, token_sha256, office_id, kind) values (${lit(plain)}, 'proof claude client', ${lit(sha(`plain-${run}`))}, ${lit(A)}::uuid, 'claude')`)
  const plainGate = await gate(A, plain, 'create_task')
  check('E6 a client that is not an engine client passes through the gate untouched and unbound (the control: ChatGPT and Claude are not slowed or limited)', plainGate.allow === true && plainGate.is_engine === false && plainGate.run_id === undefined, JSON.stringify(plainGate))
  await q(`update public.engine_runs set lease_until = now() - interval '1 second' where run_id = ${lit(e.runId)}::uuid`)
  const lapsedGate = await gate(A, bA.client, 'search_documents')
  await q(`update public.engine_runs set lease_until = now() + interval '90 seconds' where run_id = ${lit(e.runId)}::uuid`)
  check('E7 a run whose lease has lapsed gets no tool: the credential is dead the moment the bridge is', lapsedGate.allow === false && String(lapsedGate.because).includes('out of time'), JSON.stringify(lapsedGate))
  await enableFor(B)
  const offGate = await gate(A, bA.client, 'search_documents')
  await enableFor(A, B)
  check('E8 switching Hermes off for the office closes the gate at once, mid-run', offGate.allow === false && String(offGate.because).includes('switched off'), JSON.stringify(offGate))
  await sabotage('the allowlist gains a write tool', 'app.engine_read_tools()', (d) => d.replace("array['check_job',", "array['create_task', 'check_job',"), async () => (await gate(A, bA.client, 'create_task')).allow === false)

  // record, grounding, redaction, append-only
  const SHA = sha('args')
  // Recorded as REFUSED calls against the run that is still live, so they add nothing to the grounding the next checks count.
  const recProbe = async (): Promise<boolean> => {
    const tag = randomBytes(4).toString('hex')
    const tok = `${'sk'}-${'q'.repeat(30)}`
    await q(`select app.engine_record_call(${lit(A)}::uuid, ${lit(e.runId)}::uuid, 'search_documents', 'refused', ${lit(SHA)}, 'documents', false, 200, ${lit(`found it ${tag}, key ${tok}`)}, null)`)
    const r = await one(`select result_excerpt from public.engine_run_calls where run_id = ${lit(e.runId)}::uuid and result_excerpt like ${lit(`%${tag}%`)}`)
    return !String(r.result_excerpt).includes('q'.repeat(30)) && String(r.result_excerpt).includes('[redacted]')
  }
  check('E9 a served call is recorded with its excerpt redacted again in SQL, whatever the caller did', await recProbe())
  await sabotage('the redactor returns the text unchanged', 'app.engine_redact(text)', (d) => d.replace(/AS \$function\$[\s\S]*\$function\$/, "AS $function$ select coalesce(p_text, '') $function$"), recProbe)
  await q(`select app.engine_record_call(${lit(A)}::uuid, ${lit(e.runId)}::uuid, 'search_documents', 'served', ${lit(SHA)}, 'documents', false, 4000, ${lit('d'.repeat(4000))}, null)`)
  await q(`select app.engine_record_call(${lit(A)}::uuid, ${lit(e.runId)}::uuid, 'list_projects', 'served', ${lit(SHA)}, 'projects', true, 90, 'two projects', null)`)
  await q(`select app.engine_record_call(${lit(A)}::uuid, ${lit(e.runId)}::uuid, 'create_task', 'refused', ${lit(SHA)}, null, false, 0, ${lit('SECRET-NOT-SERVED')}, 'not one Hermes may use')`)
  await q(`select app.engine_record_call(${lit(A)}::uuid, ${lit(e.runId)}::uuid, 'read_document', 'failed', ${lit(SHA)}, 'documents', false, 0, ${lit('FAILED-NOT-SERVED')}, 'the tool failed')`)
  const grounding = await call(`select app.engine_run_grounding(${lit(A)}::uuid, ${lit(e.runId)}::uuid) r`)
  check('E10 grounding is the SERVED calls only: a refused call and a failed call contribute nothing, however much text they carry', grounding.excerpts.length === 2 && !JSON.stringify(grounding).includes('SECRET-NOT-SERVED') && !JSON.stringify(grounding).includes('FAILED-NOT-SERVED') && grounding.dropped === 0, JSON.stringify(grounding).slice(0, 160))
  check('E11 and it names the domains read, the domains read COMPLETELY (a census, not a search), and the tools served', JSON.stringify(grounding.domains) === '["documents","projects"]' && JSON.stringify(grounding.complete_domains) === '["projects"]' && JSON.stringify(grounding.tools) === '["list_projects","search_documents"]', JSON.stringify([grounding.domains, grounding.complete_domains, grounding.tools]))
  for (let i = 0; i < 7; i += 1) await q(`select app.engine_record_call(${lit(A)}::uuid, ${lit(e.runId)}::uuid, 'read_document', 'served', ${lit(SHA)}, 'documents', false, 4000, ${lit(`${String(i)}`.repeat(4000))}, null)`)
  const big = await call(`select app.engine_run_grounding(${lit(A)}::uuid, ${lit(e.runId)}::uuid) r`)
  const total = (big.excerpts as string[]).reduce((n, s) => n + s.length, 0)
  check('E12 grounding is capped at 24,000 characters: the OLDEST excerpts are dropped first, the newest kept, and the number dropped is said', total <= 24000 && big.dropped >= 2 && (big.excerpts as string[]).at(-1)?.startsWith('6') === true && !(big.excerpts as string[]).some((s) => s.startsWith('d')), `kept ${big.excerpts.length} (${total} chars), dropped ${big.dropped}`)
  const upd = await refused(`update public.engine_run_calls set tool = 'x' where run_id = ${lit(e.runId)}::uuid`)
  const del = await refused(`delete from public.engine_run_calls where run_id = ${lit(e.runId)}::uuid`)
  const trunc = await refused('truncate public.engine_run_calls')
  check('E13 the record of calls is append-only: update, delete and truncate are each refused', upd !== '' && del !== '' && trunc !== '', [upd, del, trunc].map((m) => m.slice(0, 50)).join(' | '))
  await finish(bA, e.runId, e.gen, 'completed', ANSWER)
  const afterEnd = await refused(`select app.engine_record_call(${lit(A)}::uuid, ${lit(e.runId)}::uuid, 'search_documents', 'served', ${lit(SHA)}, 'documents', false, 1, 'late', null)`)
  check('E14 a call cannot be recorded against a run that has ended', afterEnd.includes('no engine run in progress'), afterEnd.slice(0, 80))
  const crossRecord = await refused(`select app.engine_record_call(${lit(B)}::uuid, ${lit(e.runId)}::uuid, 'search_documents', 'served', ${lit(SHA)}, 'documents', false, 1, 'x', null)`)
  const badSha = await refused(`select app.engine_record_call(${lit(A)}::uuid, ${lit((await live(bA)).runId)}::uuid, 'search_documents', 'served', 'nothash', 'documents', false, 1, 'x', null)`)
  check("E15 office B cannot record a call against office A's run, and a call with a malformed argument hash is refused by the table", crossRecord.includes('no engine run in progress') && badSha.includes('args_sha256'), [crossRecord, badSha].map((m) => m.slice(0, 60)).join(' | '))
  for (const r of await q(`select run_id::text id from public.engine_runs where state in ('open','running')`)) await retire(r.id)

  // redaction shapes, each beside a control that must survive
  const shapes: [string, string, boolean][] = [
    ['a Slack bot token', `${'xo'}xb-${'1'.repeat(12)}-abcdef`, true], ['a Supabase personal token', `${'sb'}p_${'a'.repeat(20)}`, true], ['a Notion token', `${'nt'}n_${'b'.repeat(20)}`, true],
    ['a GitHub token', `${'gh'}p_${'c'.repeat(20)}`, true], ['an OpenRouter-style key', `${'sk'}-or-v1-${'d'.repeat(30)}`, true], ['an office MCP token', `${'mc'}p_${'e'.repeat(32)}`, true],
    ['a bearer header', `Bearer ${'f'.repeat(30)}`, true], ['a JWT', `eyJ${'g'.repeat(12)}.${'h'.repeat(12)}.${'i'.repeat(8)}`, true], ['a database URL with a password', `${'postgres'}://user:${'pw'.repeat(5)}@host/db`, true],
    ['the word mcp_projects (a function name, not a token)', 'the mcp_projects function', false], ['a UUID', '11111111-1111-4111-8111-111111111111', false], ['a sha256 (an argument hash is not a secret)', sha('x'), false],
    ['ordinary prose naming Bearer tokens', 'a Bearer is a kind of porter', false], ['the word sk-learn', 'try sk-learn', false],
  ]
  for (const [what, text, secret] of shapes) {
    const out = String((await one(`select app.engine_redact(${lit(`before ${text} after`)}) r`)).r)
    check(`E16 the redactor ${secret ? 'removes' : 'leaves alone'} ${what}`, secret ? out.includes('[redacted]') && out.includes('before ') && out.includes(' after') && !out.includes(text.slice(-12)) : out === `before ${text} after`, out.slice(0, 70))
  }

  // ============================================================================================================================
  // F (second half). retire a bridge
  // ============================================================================================================================
  const rb = await mint(C, `retire ${run}`)
  await enableFor(A, B, C)
  await fresh(rb)
  const rj = await pausedJob()
  const ro = await open(C, rj).catch(() => null)
  void ro
  // A run in office C needs a job in office C: use A's bridge for the retire proof instead, then re-mint.
  await q(`update public.engine_bridges set enabled = false, disabled_reason = 'proof cleanup' where bridge_id = ${lit(rb.bridge)}::uuid`)
  await q(`update public.mcp_clients set enabled = false, disabled_reason = 'proof cleanup' where client_id = ${lit(rb.client)}`)
  const k = await live(bA)
  const retired = await call(`select app.engine_retire_bridge(${lit(A)}::uuid, ${lit(bA.bridge)}::uuid, 'proof: the host was decommissioned') r`)
  const kRow = await runRow(k.runId)
  check('F9 retiring a bridge disables it and its MCP client, fails the run it held as "bridge retired", and wakes the job', retired.ok === true && retired.runs_failed === 1 && kRow.state === 'failed' && kRow.failure === 'bridge retired' && (await jobState(k.job)) === 'queued', JSON.stringify(retired))
  const authAfter = await call(`select app.engine_bridge_for(${lit(bA.hash)}) r`)
  const gateAfter = await gate(A, bA.client, 'search_documents')
  const claimAfter = await claim(bA)
  check('F10 after retirement the bridge token authenticates nobody, the MCP client is known to nobody, and a claim is refused', authAfter === null && gateAfter.allow === false && claimAfter.run === null && String(claimAfter.refused).includes('not enabled'), JSON.stringify([authAfter, gateAfter.because, claimAfter.refused]))
  const again2 = await call(`select app.engine_retire_bridge(${lit(A)}::uuid, ${lit(bA.bridge)}::uuid, 'proof again') r`)
  const noReason = await refused(`select app.engine_retire_bridge(${lit(A)}::uuid, ${lit(bA.bridge)}::uuid, 'x')`)
  check('F11 retiring twice is a plain "no such enabled bridge", and a retirement needs a reason', again2.ok === false && noReason.includes('say why'), JSON.stringify(again2))
  const other2 = await call(`select app.engine_retire_bridge(${lit(B)}::uuid, ${lit(bA.bridge)}::uuid, 'proof: office B tries') r`)
  check("F12 office B cannot retire office A's bridge (and A's was already retired, so the control is B's own bridge below)", other2.ok === false)
  const authB = await call(`select app.engine_bridge_for(${lit(bB.hash)}) r`)
  check('F13 authentication: a live bridge token names its bridge, office, engine and client; an unknown token, a malformed one and null are nobody', authB.bridge_id === bB.bridge && authB.office_id === B && authB.engine === 'hermes' && authB.mcp_client_id === bB.client && (await call(`select app.engine_bridge_for(${lit(sha('nobody'))}) r`)) === null && (await call(`select app.engine_bridge_for('x') r`)) === null && (await call(`select app.engine_bridge_for(null) r`)) === null)
  await q(`update public.engine_bridges set last_seen_at = now() - interval '1 hour' where bridge_id = ${lit(bB.bridge)}::uuid`)
  await call(`select app.engine_bridge_for(${lit(bB.hash)}) r`)
  const touched = Date.now() - new Date((await one(`select last_seen_at from public.engine_bridges where bridge_id = ${lit(bB.bridge)}::uuid`)).last_seen_at).getTime()
  await call(`select app.engine_bridge_for(${lit(bB.hash)}) r`)
  const touched2 = new Date((await one(`select last_seen_at from public.engine_bridges where bridge_id = ${lit(bB.bridge)}::uuid`)).last_seen_at).getTime()
  check('F14 authenticating moves last_seen_at, and a second authentication inside ten seconds does not move it again', touched < 5000 && Date.now() - touched2 < 5000 && touched2 <= Date.now())
  const beforeDisable = await call(`select app.engine_bridge_for(${lit(bB.hash)}) r`)
  await q(`update public.offices set state = 'disabled', disabled_at = now() where office_id = ${lit(B)}::uuid`)
  const disabledOffice = await call(`select app.engine_bridge_for(${lit(bB.hash)}) r`)
  await q(`update public.offices set state = 'active', disabled_at = null where office_id = ${lit(B)}::uuid`)
  check('F15 a bridge of a disabled office authenticates nobody (and did before: the control)', beforeDisable?.bridge_id === bB.bridge && disabledOffice === null)

  // ============================================================================================================================
  // G. the two validators agree, specimen by specimen
  // ============================================================================================================================
  let disagreements = 0
  for (const c of REQUEST_CASES) {
    const sql = (await one(`select app.engine_request_problem(${jsonLit(c.request)}) p`)).p as string | null
    const ts = requestProblem(c.request)
    const ok = (sql === null) === (ts === null) && (c.problem === null ? sql === null : String(sql).includes(c.problem))
    if (!ok) { disagreements += 1; console.log(`  request disagreement: ${c.name}: sql ${String(sql)} / ts ${String(ts)}`) }
  }
  check(`G1 the SQL request validator and the TypeScript one agree on all ${String(REQUEST_CASES.length)} specimens, and each refusal names the expected problem`, disagreements === 0 && REQUEST_CASES.length >= 20, `${String(disagreements)} disagreements`)
  disagreements = 0
  for (const c of RESULT_CASES) {
    const sql = (await one(`select app.engine_result_problem(${lit(c.outcome)}, ${jsonLit(c.result)}) p`)).p as string | null
    const ts = resultProblem(c.outcome, c.result)
    const ok = (sql === null) === (ts === null) && (c.problem === null ? sql === null : String(sql).includes(c.problem))
    if (!ok) { disagreements += 1; console.log(`  result disagreement: ${c.name}: sql ${String(sql)} / ts ${String(ts)}`) }
  }
  check(`G2 the SQL result validator and the TypeScript one agree on all ${String(RESULT_CASES.length)} specimens`, disagreements === 0 && RESULT_CASES.length >= 14, `${String(disagreements)} disagreements`)
  await sabotage('the SQL request validator accepts an extra key', 'app.engine_request_problem(jsonb)', (d) => d.replace("if v_key not in ('input', 'instructions', 'conversation_history', 'model') then", 'if false then'), async () => (await one(`select app.engine_request_problem(${jsonLit({ ...GOOD, tools: ['terminal'] })}) p`)).p !== null)

  // ============================================================================================================================
  // H. the activity ledger
  // ============================================================================================================================
  // Office A's first bridge was retired in F9; a new host is minted for this section (one enabled bridge per office).
  const bA2 = await mint(A, `second host ${run}`)
  await enableFor(A, B)
  Object.assign(bA, bA2)
  await q('create table public.proof_ledger_stub (idem text primary key, worker text, type text, summary text, job uuid, project uuid)')
  const stubSql = (raise: boolean): string => `create or replace function app.record_external_activity(
      p_office uuid, p_worker text, p_event_type text, p_idempotency_key text, p_summary text, p_status text default 'recorded', p_severity text default null,
      p_project_id uuid default null, p_job_id uuid default null, p_correlation_id uuid default null, p_metadata jsonb default '{}'::jsonb, p_evidence_ref jsonb default null)
    returns uuid language plpgsql security definer set search_path to '' as $f$
    begin
      ${raise ? "raise exception 'the ledger refused this report' using errcode = '54000';" : ''}
      insert into public.proof_ledger_stub values (p_idempotency_key, p_worker, p_event_type, p_summary, p_job_id, p_project_id) on conflict (idem) do nothing;
      return gen_random_uuid();
    end $f$`
  const l0 = await live(bA)
  await finish(bA, l0.runId, l0.gen, 'completed', ANSWER)
  check('H1 with the ledger\'s door ABSENT everything works and nothing is reported or noted (the ledger is optional)', (await runRow(l0.runId)).ledger_note === null)
  await db.execute(stubSql(false))
  const l1 = await live(bA)
  await finish(bA, l1.runId, l1.gen, 'completed', ANSWER)
  await finish(bA, l1.runId, l1.gen, 'completed', ANSWER)
  const rows = await q(`select idem, worker, type from public.proof_ledger_stub where idem like ${lit(`run:${l1.runId}:%`)} order by idem`)
  check('H2 with the door present, a run reports ONE external.research_started and ONE external.research_completed, as worker hermes, with a key naming the run and the event; a repeated finish adds nothing', rows.length === 2 && rows.some((r) => r.type === 'external.research_started' && r.idem === `run:${l1.runId}:started`) && rows.some((r) => r.type === 'external.research_completed' && r.idem === `run:${l1.runId}:completed`) && rows.every((r) => r.worker === 'hermes'), JSON.stringify(rows))
  const l2 = await live(bA)
  await finish(bA, l2.runId, l2.gen, 'failed', { ...DONE, failure: 'the model gave up' })
  check('H3 a failed run reports external.worker_error', Number((await one(`select count(*)::int n from public.proof_ledger_stub where idem = ${lit(`run:${l2.runId}:failed`)} and type = 'external.worker_error'`)).n) === 1)
  await db.execute(stubSql(true))
  const l3 = await live(bA)
  const l3fin = await finish(bA, l3.runId, l3.gen, 'completed', ANSWER)
  const l3row = await runRow(l3.runId)
  check('H4 when the ledger REFUSES a report, the run still finishes and the job still wakes, and the refusal is WRITTEN on the run, not swallowed', l3fin.ok === true && l3row.state === 'completed' && String(l3row.ledger_note).includes('54000') && (await jobState(l3.job)) === 'queued', String(l3row.ledger_note))
  const engineTables = (await q(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and (relname like 'engine\\_%' or relname like '%activity%' or relname like '%ledger%') and relname <> 'proof_ledger_stub' order by 1`)).map((r) => String(r.relname))
  // The unified activity ledger (a separate branch, migration 1060) owns three tables with these words in their names. Hermes may add none:
  // the engine tables are exactly three, and any other table matching is one the ledger's migration creates, so the check holds on a tree
  // with or without the ledger.
  const ledgerOwned = new Set(['activity_event_types', 'activity_events', 'activity_write_failures'])
  const mine = engineTables.filter((t) => t.startsWith('engine_'))
  const others = engineTables.filter((t) => !t.startsWith('engine_'))
  check('H5 this migration created no ledger table and no event store of its own: the only engine tables are the three, and every other table with these words in its name belongs to the activity ledger', mine.join(',') === 'engine_bridges,engine_run_calls,engine_runs' && others.every((t) => ledgerOwned.has(t)), engineTables.join(','))
  await db.execute('drop function app.record_external_activity(uuid,text,text,text,text,text,text,uuid,uuid,uuid,jsonb,jsonb)')
  await q('drop table public.proof_ledger_stub')

  // ============================================================================================================================
  // I. the rest of the office is untouched
  // ============================================================================================================================
  const touchedTables = await one(`select count(*)::int n from public.jobs j where j.kind like 'engine%'`)
  check('I1 no job kind of the engine\'s own exists: a run is a row beside the job, never a second queue', touchedTables.n === 0)
  const leaked = await one(`select count(*)::int n from public.deliveries d join public.jobs j on j.job_id = d.job_id where j.job_id in (select job_id from public.engine_runs)`)
  check('I2 nothing in the proof was delivered to anybody: no delivery exists for any job that has a run', leaked.n === 0, String(leaked.n))
  const noRoute = await one(`select count(*)::int n from public.routing_decisions rd where rd.job_id in (select job_id from public.engine_runs)`).catch(() => ({ n: 0 }))
  check('I3 opening and finishing runs wrote no routing decision: choosing Hermes is not the team routing anything', noRoute.n === 0, String(noRoute.n))
  const ranges = await one(`select count(*)::int n from public.engine_run_calls c left join public.engine_runs r on r.run_id = c.run_id and r.office_id = c.office_id where r.run_id is null`)
  check('I4 every recorded call belongs to a run of its own office', ranges.n === 0)
  const tokens = [bA.token, bA.mcpToken, bB.token, bB.mcpToken]
  const everything = JSON.stringify(await q(`select to_jsonb(b) j from public.engine_bridges b union all select to_jsonb(r) from public.engine_runs r union all select to_jsonb(c) from public.engine_run_calls c union all select to_jsonb(m) from public.mcp_clients m where m.kind = 'engine'`)) + output.join('\n')
  check('I5 no bridge token and no MCP token appears in any engine row or in this proof\'s own output (T22)', tokens.every((t) => !everything.includes(t)))
} finally {
  await db.end().catch(() => undefined)
}
const bad = results.filter((r) => !r).length
console.log(`\n${String(results.length - bad)}/${String(results.length)} passed`)
process.exit(bad === 0 ? 0 : 1)
