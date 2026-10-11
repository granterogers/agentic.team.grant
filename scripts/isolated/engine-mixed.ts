// biome-ignore-all lint/suspicious/noExplicitAny: SQL results are untyped rows
// biome-ignore-all format: a dense proof script kept readable as written
/**
 * A message sent to Hermes and answered by the team can be FOUND (Hermes, release audit; migration 1077), on the isolated replica only.
 *
 *   npx tsx scripts/isolated/engine-mixed.ts <replica-db>
 *
 * The risk: a worker that predates the engine seam (a rollback, a skipped deploy step) answers a Hermes-chosen message as the team and nothing
 * says so. Ordering (deploy:voice reads the live worker bundle) and the switch prevent it; this is the DETECTOR for when they did not. A stale worker is
 * modelled by what it leaves behind: a job whose own command chose Hermes, that is over, with no engine run. Nothing calls a model or Hermes.
 *
 *   A. what it reports: a Hermes-chosen job the team answered, by id and channel, never any text
 *   B. what it does not: a Hermes job that opened a run, a team job, a Hermes job still waiting, harness traffic, another office
 *   C. who may ask: nobody outside the database owner
 * Then each filter is SABOTAGED: put back into the live definition, the probe must go red, restored, green.
 */
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
const setConfig = async (key: string, value: unknown): Promise<void> => { await q(`insert into public.system_config (key, value, description) values (${lit(key)}, ${jsonLit(value)}, 'engine mixed proof') on conflict (key) do update set value = excluded.value`) }

const A = String((await one('select app.operator_office()::text o')).o)
const authB = String((await one('select gen_random_uuid()::text a')).a)
await q(`insert into auth.users (id, email) values (${lit(authB)}, ${lit(`engine-mixed.${run}@example.invalid`)})`)
await q(`insert into public.offices (auth_user_id, kind, name) values (${lit(authB)}, 'person', ${lit(`engine mixed ${run}`)})`)
const B = String((await one(`select office_id::text o from public.offices where auth_user_id = ${lit(authB)}`)).o)
const project = String(json((await one(`select app.hq_create_project(${lit(A)}::uuid, ${lit(`Engmixed ${run}`)}, 'upload', ${lit(`engmixed-${run}`)}, ${lit(`Engmixed ${run}`)}, true) as v`)).v).project_id)
await setConfig(SETTING.offices, [A])
await setConfig(SETTING.dailyRuns, 900)
const creds = generateCredentials()
const bridge = String(json((await one(`select app.engine_mint_bridge(${lit(A)}::uuid, 'hermes', ${lit(`mixed ${run}`)}, ${lit(creds.bridgeSha256)}, ${lit(creds.mcpSha256)}) r`)).r).bridge_id)
await q(`update public.engine_bridges set last_seen_at = now(), healthy = true, unhealthy_reason = null where bridge_id = ${lit(bridge)}::uuid`)
const door = await startDoor(db)
let n = 0

/** A message through the voice door. `engine` is what the person chose; `real` is a production-shaped session (the door's own key), else a harness-shaped one. */
const send = async (engine: 'hermes' | 'team', real = true): Promise<string> => {
  const said = `Mixed-version proof ${run} ${String(++n)}`
  const r = await postTurn(door, { said, session: `${real ? 's' : 'x'}${run.slice(-6)}${String(n)}`, message: `m${run}${String(n)}q`, project, ...(engine === 'hermes' ? { engine: 'hermes' } : {}) })
  const job = String((await one(`select job_id::text j from public.inbound_commands where instruction = ${lit(said)} and office_id = ${lit(A)}::uuid`)).j)
  if (r.status !== 200 || job === 'undefined') throw new Error(`no job (${String(r.status)}): ${JSON.stringify(r.body)}`)
  return job
}
/** What a worker that did not know about Hermes leaves behind: the job over, with its answer, and no run. Triggers are skipped for this one statement only. */
const teamAnswered = async (job: string): Promise<void> => {
  await q(`set local session_replication_role = replica; update public.jobs set state = 'complete', finished_at = now() where job_id = ${lit(job)}::uuid`)
}
const mismatches = async (office = A): Promise<{ mismatched: number; jobs: any[] }> => call(`select app.engine_mismatches(${lit(office)}::uuid) r`)
const ids = async (office = A): Promise<string[]> => (await mismatches(office)).jobs.map((j) => String(j.job_id))
const defOf = async (sig: string): Promise<string> => String((await one(`select pg_get_functiondef(${lit(sig)}::regprocedure) d`)).d)
const SIG = 'app.engine_mismatches(uuid)'
const sabotage = async (name: string, from: string, to: string, probe: () => Promise<boolean>): Promise<void> => {
  const was = await probe()
  const def = await defOf(SIG)
  const bad = def.replace(from, () => to)
  const landed = bad !== def
  if (landed) await db.execute(bad)
  const during = await probe()
  await db.execute(def)
  const after = await probe()
  check(`sabotage - ${name}`, was && landed && !during && after, `clean ${String(was)}, defect landed ${String(landed)}, probe with the defect ${String(during)} (must be false), restored ${String(after)}`)
}

// ---- the specimens -------------------------------------------------------------------------------------------------------------------------
const stale = await send('hermes')
await teamAnswered(stale)
const withRun = await send('hermes')
const opened = await call(`select app.engine_run_open(${lit(A)}::uuid, ${lit(withRun)}::uuid, 'hermes', ${jsonLit({ input: 'x', instructions: 'You answer for the office.', conversation_history: [] })}) r`)
await teamAnswered(withRun)
const team = await send('team')
await teamAnswered(team)
const waiting = await send('hermes')
const harness = await send('hermes', false)
await teamAnswered(harness)

check('0 (setup) the specimens exist: a Hermes job the team answered, one that opened a run, a team job, one still waiting and a harness one', typeof opened.run_id === 'string' && [stale, withRun, team, waiting, harness].every((j) => /^[0-9a-f-]{36}$/.test(j)), JSON.stringify(opened).slice(0, 100))
const found = await mismatches()
check('A1 a message sent to Hermes that the team answered is reported, by job id and channel and when it ended', found.jobs.some((j) => j.job_id === stale && j.channel === 'voice' && j.state === 'complete' && j.finished_at !== null), JSON.stringify(found).slice(0, 200))
check('A2 and ONLY that one is reported: not the Hermes job that opened a run, not the team job, not the one still waiting, not the harness one', found.mismatched === 1 && (await ids()).length === 1 && (await ids())[0] === stale, `count ${String(found.mismatched)}`)
check('A3 the report carries no text of anything anybody said: ids, channel, state and a time', JSON.stringify(found).indexOf('Mixed-version proof') === -1 && Object.keys(found.jobs[0] ?? {}).sort().join(',') === 'channel,command_id,finished_at,job_id,state')
check('B1 another office sees none of it (an office is always named, and it answers for that office only)', (await mismatches(B)).mismatched === 0)
const noOffice = await db.execute(`select app.engine_mismatches(null)`).then(() => '', (e) => String((e as Error).message))
check('B2 with no office named it refuses rather than answering for somebody (there is no person default)', noOffice !== '', noOffice.slice(0, 100))
const priv = await one(`select has_function_privilege('anon', 'app.engine_mismatches(uuid)', 'execute') a, has_function_privilege('authenticated', 'app.engine_mismatches(uuid)', 'execute') u, has_function_privilege('service_role', 'app.engine_mismatches(uuid)', 'execute') s`)
check('C1 a browser key, a signed-in stranger and the service role cannot execute it', priv.a === false && priv.u === false && priv.s === false, JSON.stringify(priv))

// ---- sabotage -------------------------------------------------------------------------------------------------------------------------------
await sabotage('a team job is reported as a Hermes mismatch (the engine filter is gone)', "and c.engine = 'hermes'", 'and true', async () => !(await ids()).includes(team))
await sabotage('a Hermes job that opened a run is reported (the run check is gone)', 'and not exists (select 1 from public.engine_runs r where r.job_id = j.job_id and r.office_id = p_office)', 'and true', async () => !(await ids()).includes(withRun))
await sabotage('harness traffic is reported (the canonical predicate is gone)', 'and not app.harness_job(j.job_id)', 'and true', async () => !(await ids()).includes(harness))
await sabotage('a job still waiting is reported (the state filter is gone)', "and j.state::text in ('complete', 'failed', 'cancelled')", 'and true', async () => !(await ids()).includes(waiting))
await sabotage('another office\'s mismatch is shown to this one (the office filter is gone)', 'where c.office_id = p_office', 'where true', async () => (await mismatches(B)).mismatched === 0)

await q(`update public.engine_runs set state = 'cancelled', finished_at = now(), lease_until = null where job_id in (${lit(withRun)}::uuid, ${lit(waiting)}::uuid) and state in ('open', 'running')`).catch(() => undefined)
const failed = results.filter((r) => !r).length
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed === 0 ? 0 : 1)
