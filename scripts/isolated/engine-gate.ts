// biome-ignore-all lint/suspicious/noExplicitAny: SQL results are untyped rows
// biome-ignore-all format: a dense proof script kept readable as written
/**
 * A worker that does not know about Hermes cannot claim a message sent to it (Hermes, stale-worker prevention; migration 1078), on the
 * isolated replica only.
 *
 *   npx tsx scripts/isolated/engine-gate.ts <replica-db>
 *
 * REAL: the claim in the database; the CURRENT worker's own claim (src/jobs/worker.ts `dequeue`); and a PRE-HERMES WORKER BUILD, run as a
 * separate process from a worktree of the pinned commit below (its own claim, its own `office.instruction` handler, its own router, a
 * stubbed model that counts its calls). Nothing is read about it and assumed: it is run against a database holding a message that chose Hermes.
 *
 *   A. the shape: one claim, one wrapper with no body of its own, no browser role, the five-argument signature unchanged
 *   B. the claim: a worker that cannot answer an engine is refused a Hermes message and still served every team message; one that can, is served both
 *   C. the pre-Hermes worker, run: cannot claim the Hermes message, so no team answer and no team-side effect; still works the team's
 *   D. the current worker: claims a Hermes message, and a team message, with its own code
 *   E. the rest of the lifecycle: a Stop on a waiting message survives and is honoured by a worker that can take it; a repeat is one job; a
 *      schema without the core falls back to the old claim
 * Then each guard is SABOTAGED: put back, the probe must go red, restored, green; the pre-Hermes worker is run under the defect too.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { generateCredentials } from '../../src/engines/hermes/credentials.ts'
import { SETTING } from '../../src/engines/hermes/timing.ts'
import { dequeue } from '../../src/jobs/worker.ts'
import { isolated } from './guard.ts'
import { postTurn, startDoor } from './voice-door.ts'

/** The commit the pre-Hermes worker is built from: the base `main` this branch started from, before any Hermes file existed. */
const OLD_SHA = '3caaebfe932c6e220c4d21b5670820b6a7c1d1b0'
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
const setConfig = async (key: string, value: unknown): Promise<void> => { await q(`insert into public.system_config (key, value, description) values (${lit(key)}, ${jsonLit(value)}, 'engine gate proof') on conflict (key) do update set value = excluded.value`) }

const A = String((await one('select app.operator_office()::text o')).o)
const project = String(json((await one(`select app.hq_create_project(${lit(A)}::uuid, ${lit(`Enggate ${run}`)}, 'upload', ${lit(`enggate-${run}`)}, ${lit(`Enggate ${run}`)}, true) as v`)).v).project_id)
await setConfig(SETTING.offices, [A])
await setConfig(SETTING.dailyRuns, 900)
const creds = generateCredentials()
await q(`select app.engine_mint_bridge(${lit(A)}::uuid, 'hermes', ${lit(`gate ${run}`)}, ${lit(creds.bridgeSha256)}, ${lit(creds.mcpSha256)})`)
const door = await startDoor(db)
let n = 0
const send = async (engine: 'hermes' | 'team', message = `m${run}${String(++n)}g`): Promise<string> => {
  const said = `Claim gate proof ${run} ${message}`
  const r = await postTurn(door, { said, session: `s${run.slice(-6)}${message.slice(-3)}`, message, project, ...(engine === 'hermes' ? { engine: 'hermes' } : {}) })
  const job = String((await one(`select job_id::text j from public.inbound_commands where instruction = ${lit(said)} and office_id = ${lit(A)}::uuid`)).j)
  if (r.status !== 200 || job === 'undefined') throw new Error(`no job (${String(r.status)}): ${JSON.stringify(r.body)}`)
  return job
}
/** Nothing queued or running is left from an earlier scenario (jobs cannot be deleted, so they are cancelled with triggers skipped for the one statement). */
const clear = async (): Promise<void> => { await q(`set local session_replication_role = replica; update public.jobs set state = 'cancelled', finished_at = now() where state in ('queued', 'running', 'retrying', 'paused')`) }
const row = async (job: string): Promise<any> => one(`select state::text s, attempt, stop_requested_at is not null stopped from public.jobs where job_id = ${lit(job)}::uuid`)
const oldClaim = async (): Promise<string | null> => (await q(`select job_id::text j from app.dequeue_job('gate-old-${run}', true, true, null, null)`))[0]?.j ?? null
const coreClaim = async (can: boolean): Promise<string | null> => (await q(`select job_id::text j from app.dequeue_job_core('gate-core-${run}', true, true, null, null, ${can ? 'true' : 'false'})`))[0]?.j ?? null
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
const CORE = 'app.dequeue_job_core(text,boolean,boolean,text[],text,boolean)'
const WRAP = 'app.dequeue_job(text,boolean,boolean,text[],text)'

// ---- the pre-Hermes worker build ---------------------------------------------------------------------------------------------------------
let tree = ''
const buildOldTree = (): string => {
  try { execFileSync('git', ['cat-file', '-e', `${OLD_SHA}^{commit}`], { stdio: 'ignore' }) } catch { execFileSync('git', ['fetch', '--quiet', 'origin', 'main'], { stdio: 'ignore', timeout: 120_000 }) }
  const dir = mkdtempSync(join(tmpdir(), 'old-worker-'))
  rmSync(dir, { recursive: true, force: true })
  execFileSync('git', ['worktree', 'add', '--detach', '--quiet', dir, OLD_SHA], { stdio: 'ignore' })
  symlinkSync(resolve('node_modules'), join(dir, 'node_modules'))
  copyFileSync(resolve('scripts/isolated/engine-oldworker-child.ts'), join(dir, 'scripts/isolated/engine-oldworker-child.ts'))
  return dir
}
const dropOldTree = (): void => {
  if (tree === '') return
  try { execFileSync('git', ['worktree', 'remove', '--force', tree], { stdio: 'ignore' }) } catch { rmSync(tree, { recursive: true, force: true }) }
  try { execFileSync('git', ['worktree', 'prune'], { stdio: 'ignore' }) } catch { /* nothing to prune */ }
}
const oldWorker = (): { claimedBy: string[]; modelCalls: number } => {
  const r = spawnSync(resolve('node_modules/.bin/tsx'), ['scripts/isolated/engine-oldworker-child.ts', DB, `gate-pre-hermes-${run}`], { cwd: tree, encoding: 'utf8', timeout: 120_000, env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ISOLATED_PG_SOCKET: process.env.ISOLATED_PG_SOCKET ?? '/tmp/pgs', ISOLATED_PG_PORT: process.env.ISOLATED_PG_PORT ?? '55432' } })
  const line = String(r.stdout).trim().split('\n').filter((l) => l.startsWith('{')).pop()
  if (line === undefined) throw new Error(`the pre-Hermes worker printed nothing usable (exit ${String(r.status)}): ${String(r.stderr).slice(0, 300)}`)
  return JSON.parse(line)
}
try {
  tree = buildOldTree()
  const oldSource = execFileSync('git', ['show', `${OLD_SHA}:src/jobs/worker.ts`], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  check('0 (setup) the pre-Hermes worker is a real checkout of the pinned commit, and it holds NO engine seam: its worker source never names the engine claim and the tree has no src/engines', existsSync(join(tree, 'src/jobs/worker.ts')) && !existsSync(join(tree, 'src/engines')) && !/dequeue_job_core|can_engine|engineRunFor/.test(oldSource))

  // ---- A. the shape -------------------------------------------------------------------------------------------------------------------------
  const wrapSrc = await defOf(WRAP)
  check('A1 the five-argument claim every existing worker calls is unchanged in signature and is a wrapper with no body of its own: it says p_can_engine false and holds no row lock, no lease and no loop', /dequeue_job_core\(p_worker, p_can_transcribe, p_can_subprocess, p_kinds, p_requested_by, false\)/.test(wrapSrc) && !/for update|leased_by|advisory/i.test(wrapSrc))
  const priv = await one(`select has_function_privilege('anon', '${CORE}', 'execute') a, has_function_privilege('authenticated', '${CORE}', 'execute') u, has_function_privilege('anon', '${WRAP}', 'execute') wa, has_function_privilege('authenticated', '${WRAP}', 'execute') wu`)
  check('A2 no browser key can execute either function', priv.a === false && priv.u === false && priv.wa === false && priv.wu === false, JSON.stringify(priv))

  // ---- B. the claim -------------------------------------------------------------------------------------------------------------------------
  await clear()
  const h1 = await send('hermes'); const t1 = await send('team')
  const got1 = await oldClaim()
  check('B1 a worker that does not say it can answer an engine, offered a Hermes message queued FIRST and a team message after it, is given the TEAM message and not the Hermes one', got1 === t1 && (await row(h1)).s === 'queued' && (await row(h1)).attempt === 0, `got ${String(got1)}`)
  const got2 = await coreClaim(false)
  check('B2 and a second claim from it gets nothing: the Hermes message is not available to it however many times it asks (it is refused, not skipped once)', got2 === null && (await row(h1)).attempt === 0)
  const got3 = await coreClaim(true)
  check('B3 a worker that says it can answer an engine is given the Hermes message', got3 === h1 && (await row(h1)).s === 'running' && (await row(h1)).attempt === 1, `got ${String(got3)}`)
  await clear()
  const t2 = await send('team')
  check('B4 legacy team work is claimed by both kinds of worker (the column default is the team): one claim each, in the order it was queued', (await oldClaim()) === t2 && (await row(t2)).attempt === 1)
  await clear()
  const t3 = await send('team')
  check('B5 and a worker that says it can answer an engine claims team work exactly as before', (await coreClaim(true)) === t3)
  await clear()

  // ---- C. the pre-Hermes worker, run ----------------------------------------------------------------------------------------------------------
  const pair = async (): Promise<{ h: string; t: string }> => { await clear(); const h = await send('hermes'); const t = await send('team'); return { h, t } }
  const sideEffects = async (job: string): Promise<number> => Number((await one(`select (select count(*) from public.outputs where job_id = ${lit(job)}::uuid) + (select count(*) from public.deliveries where job_id = ${lit(job)}::uuid) + (select count(*) from public.inference_usage where job_id = ${lit(job)}::uuid) + (select count(*) from public.engine_runs where job_id = ${lit(job)}::uuid) n`)).n)
  const oldProbe = async (): Promise<boolean> => {
    const { h, t } = await pair()
    const out = oldWorker()
    const hr = await row(h); const tr = await row(t)
    return hr.attempt === 0 && hr.s === 'queued' && (await sideEffects(h)) === 0 && tr.attempt >= 1 && !out.claimedBy.includes(h)
  }
  const c1 = await pair()
  const out = oldWorker()
  const h1r = await row(c1.h); const t1r = await row(c1.t)
  check('C1 the pre-Hermes worker, run for real against a database holding a Hermes message and a team message, did NOT claim the Hermes message: still queued, attempt 0', h1r.s === 'queued' && h1r.attempt === 0, JSON.stringify(h1r))
  check('C2 and produced no team answer and no team-side effect for it: no output, no delivery, no model usage, no engine run', (await sideEffects(c1.h)) === 0 && !out.claimedBy.includes(c1.h))
  check('C3 while it still worked the team message (the legacy path is preserved): it claimed it', t1r.attempt >= 1 && out.claimedBy.length >= 0, JSON.stringify(t1r))

  // ---- D. the current worker ------------------------------------------------------------------------------------------------------------------
  await clear()
  const dh = await send('hermes'); const dt = await send('team')
  const first = await dequeue(db, `gate-new-${run}`, true, true)
  const second = await dequeue(db, `gate-new-${run}`, true, true)
  check('D1 the current worker\'s own claim takes the Hermes message first and then the team message (it says it can answer an engine)', first?.jobId === dh && second?.jobId === dt, `${String(first?.jobId)} ${String(second?.jobId)}`)

  // ---- E. the rest of the lifecycle ------------------------------------------------------------------------------------------------------------
  await clear()
  const eh = await send('hermes')
  const stopped = await call(`select app.request_stop(${lit(A)}::uuid, ${lit(eh)}::uuid, null) r`)
  check('E1 a Stop pressed while the Hermes message waits cancels it AT ONCE, with no worker needed (so waiting for a worker that can take it never traps a message the person has called off), and then no worker of either kind can claim it', stopped.ok === true && (await row(eh)).s === 'cancelled' && (await oldClaim()) === null && (await coreClaim(true)) === null, JSON.stringify(stopped))
  await clear()
  const dupSaid = `Claim gate proof ${run} duplicate`
  const dupBody = { said: dupSaid, session: `s${run.slice(-6)}dup`, message: `mdup${run}`, project, engine: 'hermes' }
  await postTurn(door, dupBody); await postTurn(door, dupBody)
  const dupJobs = await q(`select distinct job_id::text j from public.inbound_commands where instruction = ${lit(dupSaid)} and office_id = ${lit(A)}::uuid`)
  check('E2 the same message sent twice is ONE command and ONE job (idempotency is the command\'s, untouched by the gate), and the old worker is refused it', dupJobs.length === 1 && (await oldClaim()) === null && (await row(String(dupJobs[0]?.j))).attempt === 0, `${String(dupJobs.length)} job(s)`)
  await clear()
  const ef = await send('team')
  // A schema from before 1078: the five-argument function is the whole claim (rebuilt here from the core with the gate held open) and there is no core.
  const core = await defOf(CORE)
  const wrapper = await defOf(WRAP)
  const legacy = core.replace('app.dequeue_job_core(p_worker text, p_can_transcribe boolean, p_can_subprocess boolean, p_kinds text[], p_requested_by text, p_can_engine boolean)', 'app.dequeue_job(p_worker text, p_can_transcribe boolean DEFAULT true, p_can_subprocess boolean DEFAULT true, p_kinds text[] DEFAULT NULL::text[], p_requested_by text DEFAULT NULL::text)').replaceAll('p_can_engine', 'true')
  await db.execute(legacy)
  await q(`drop function ${CORE}`)
  const fallback = await dequeue(db, `gate-fallback-${run}`, true, true).catch((e: Error) => `error ${e.message.slice(0, 80)}`)
  await db.execute(core)
  await db.execute(wrapper)
  check('E3 against a schema that has no core (older than 1078) the current worker falls back to the five-argument claim and still serves the team (a Hermes message cannot exist there)', typeof fallback === 'object' && fallback?.jobId === ef, JSON.stringify(fallback).slice(0, 100))
  await clear()

  // ---- sabotage ----------------------------------------------------------------------------------------------------------------------------------
  const sqlProbe = async (): Promise<boolean> => { await clear(); const h = await send('hermes'); const t = await send('team'); const got = await oldClaim(); await clear(); return got === t && got !== h }
  await sabotage('the wrapper says p_can_engine true, so a worker that never said it can answer an engine is given the Hermes message', WRAP, 'p_requested_by, false)', 'p_requested_by, true)', sqlProbe)
  await sabotage('the claim ignores p_can_engine (the predicate is gone)', CORE, '      p_can_engine\n      or not exists (', '      true\n      or not exists (', sqlProbe)
  await sabotage('the claim treats a message that chose the team as the engine one, and the engine one as the team (the comparison is inverted)', CORE, "ce.engine <> 'team'", "ce.engine = 'team'", async () => { await clear(); const h = await send('hermes'); const t = await send('team'); const got = await oldClaim(); await clear(); return got === t && got !== h })
  await sabotage('the PRE-HERMES worker is handed the Hermes message when the wrapper is broken (run under the defect, then restored)', WRAP, 'p_requested_by, false)', 'p_requested_by, true)', oldProbe)
  await sabotage('a Hermes message waits for the old worker and also for the new one (the gate refuses everybody)', CORE, '      p_can_engine\n      or not exists (', '      false\n      or not exists (', async () => { await clear(); const h = await send('hermes'); const got = await coreClaim(true); await clear(); return got === h })
} finally {
  await clear().catch(() => undefined)
  dropOldTree()
}
const failed = results.filter((r) => !r).length
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed === 0 ? 0 : 1)
