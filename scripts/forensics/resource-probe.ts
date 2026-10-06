/**
 * What does each recurring path COST the database, in structural units, on a replica seeded to production scale?
 *
 *   npx tsx scripts/forensics/resource-probe.ts <replica-db> [--passes=10] [--only=a,b] [--budget=<file.json>] [--json] [--quiesce]
 *
 * Why it exists (efficiency run, 5 to 6 October 2026). The first pass inferred from index definitions that the worker's
 * "retrying / paused" sweeps scanned the whole `jobs` heap. Driving them on a table of production's size FALSIFIED that (the
 * partial live-key index serves them), and found the real scanners: the Team HQ poll RPCs (`hq_pulse`, `office_health`), which
 * read the heap several times per call, every 20 seconds, for every open tab. A claim about a plan is settled by a plan, so this
 * tool drives each path and reports what it did: statements, buffer hits and reads, WAL, and the sequential and index scans it
 * made on `public.jobs` (read from pg_stat_user_tables around the call, so it also sees work done inside functions).
 *
 * Structural units only (scans, buffers, statements), never a timing threshold: a count does not flap, a latency does. `ms` is
 * printed for orientation and is never asserted. It runs only against a marked local replica (guard.ts), spends no model call,
 * and refuses the network.
 *
 * Seed first: `psql -d <db> -f scripts/isolated/seed-production-scale.sql` (an empty replica cannot show a scan).
 *
 * `--budget` takes `{ "probes": { "<name>": { "jobs_seq_scans": 0, "hit": 2000, ... } } }`. Every key present must hold or the
 * run exits 1, and a budget that names a probe nothing ran is itself a failure (a guard that matches nothing reports a pass).
 */
import { readFileSync } from 'node:fs'
import { buildPass } from '../../src/office/pass.ts'
import { isolated } from '../isolated/guard.ts'

const args = process.argv.slice(2)
const database = args.find((a) => !a.startsWith('--')) ?? 'post'
const flag = (name: string): string | undefined =>
  args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const has = (name: string): boolean => args.includes(`--${name}`)
const PASSES = Number(flag('passes') ?? 10)
const ONLY = flag('only')?.split(',')
const BUDGET = flag('budget')
const MIN_BUDGET_JOBS = 20_000
const JSON_OUT = has('json')

const db = await isolated(database)
const rows = async (sql: string): Promise<Record<string, unknown>[]> =>
  (await db.execute(sql)).rows as Record<string, unknown>[]
const num = (v: unknown): number => Number(v ?? 0)

let refused = 0
globalThis.fetch = (async () => {
  refused += 1
  throw new Error('REFUSED: the resource probe never leaves the replica')
}) as typeof fetch

const office = String(
  (
    await rows(
      `select office_id from public.offices where kind = 'person' order by created_at limit 1`,
    )
  )[0]?.office_id,
)

type Cost = {
  statements: number
  hit: number
  read: number
  wal: number
  jobs_seq_scans: number
  jobs_seq_tuples: number
  jobs_idx_scans: number
  ms: number
}

const tableStats = async (): Promise<{ seq: number; seqTup: number; idx: number }> => {
  await rows('select pg_stat_force_next_flush()')
  const r = (
    await rows(
      `select seq_scan, seq_tup_read, idx_scan from pg_stat_user_tables where schemaname = 'public' and relname = 'jobs'`,
    )
  )[0]
  return { seq: num(r?.seq_scan), seqTup: num(r?.seq_tup_read), idx: num(r?.idx_scan) }
}

const measure = async (work: () => Promise<void>): Promise<Cost> => {
  await rows(`select pg_stat_statements_reset()`)
  const before = await tableStats()
  const t0 = performance.now()
  await work()
  const ms = performance.now() - t0
  const after = await tableStats()
  const s = (
    await rows(`
    select coalesce(sum(calls), 0) calls, coalesce(sum(shared_blks_hit), 0) hit, coalesce(sum(shared_blks_read), 0) read,
           coalesce(sum(wal_bytes), 0) wal
      from pg_stat_statements
     where dbid = (select oid from pg_database where datname = current_database())
       and query not ilike '%pg_stat_statements%' and query not ilike '%pg_stat_force_next_flush%'`)
  )[0]
  return {
    statements: num(s?.calls),
    hit: num(s?.hit),
    read: num(s?.read),
    wal: num(s?.wal),
    jobs_seq_scans: after.seq - before.seq,
    jobs_seq_tuples: after.seqTup - before.seqTup,
    jobs_idx_scans: after.idx - before.idx,
    ms: Math.round(ms * 10) / 10,
  }
}

const probes: { name: string; run: () => Promise<void> }[] = []
const add = (name: string, sql: string): void => {
  probes.push({ name, run: async () => void (await rows(sql)) })
}

// ---- Team HQ: what a visible tab asks every 20 seconds, and what a page load asks once ------------------------------------
add('team_hq.pulse', `select public.hq_pulse('${office}')`)
// What the gateway's `thinking` section calls (migration 1028); the whole reading stays probed beside it for the other callers.
add('team_hq.thinking', `select public.cannot_think('${office}')`)
add('team_hq.health_whole', `select public.office_health('${office}', 24)`)
add('team_hq.studio', `select public.hq_studio('${office}')`)
add('team_hq.lately', `select public.hq_studio_lately('${office}', 40)`)
add('team_hq.portfolio_tasks', `select public.hq_portfolio_tasks('${office}', 200)`)
add('team_hq.unseen', `select public.studio_unseen('${office}')`)
add('team_hq.team_work', `select public.studio_team_work('${office}', 7)`)
// ---- the worker's standing sweeps, each driven alone so a scan is attributed to the function that made it ------------------
add('worker.requeue_retrying', `select app.requeue_retrying()`)
add('worker.settle_exhausted', `select * from app.settle_exhausted_jobs()`)
add('worker.resume_paused', `select app.resume_paused(array['office.instruction','drive.watch'])`)
add('worker.resumable_now', `select app.resumable_now()`)
add('worker.recover_stalled', `select app.recover_stalled_jobs()`)
add('worker.claim_pending', `select * from app.claim_pending_notification('probe')`)
add('worker.defer_over_budget', `select app.defer_over_budget()`)
add('worker.enqueue_orphans', `select app.enqueue_orphans()`)
add('worker.dispatch_due', `select * from app.dispatch_due_responsibilities()`)
add('worker.provision_channels', `select app.provision_missing_channels()`)
add('worker.self_improvement_budget', `select app.self_improvement_within_budget()`)
add('worker.fire_pending_signals', `select app.fire_pending_signals('${office}'::uuid, 20)`)
// ---- the model path: once per model call -----------------------------------------------------------------------------------
add('model.model_order', `select app.model_order('office.instruction', 14, 3, 0.5, 6)`)

const results: Record<string, Cost> = {}

// A budget is only meaningful on a replica of production's size: on an empty one every `jobs_seq_scans: 0` ceiling passes because a
// tiny table gets no scan at all. Refuse before measuring anything (`npm run forensics:budget` names `post`, which can be unseeded).
if (BUDGET !== undefined) {
  const n = num((await rows(`select count(*) n from public.jobs`))[0]?.n)
  if (n < MIN_BUDGET_JOBS) {
    console.error(
      `REFUSED: ${database} holds ${String(n)} jobs; a budget is judged on a replica seeded to production shape (at least ${String(MIN_BUDGET_JOBS)}). ` +
        `Seed it first: psql -d ${database} -v jobs=22600 -f scripts/isolated/seed-production-scale.sql`,
    )
    process.exit(2)
  }
}

if (has('quiesce')) {
  // A pass handles any queued, retrying or paused job it can, which would measure the work and not the standing path.
  await rows(`
    begin;
    set local session_replication_role = replica;
    update public.jobs set state = 'cancelled', finished_at = now(), leased_by = null, leased_until = null
     where state in ('queued', 'retrying', 'paused', 'running', 'output_created', 'quality_review', 'committing', 'committed', 'notifying');
    commit;`)
}

for (const p of probes) {
  if (ONLY !== undefined && !ONLY.includes(p.name)) continue
  await p.run().catch(() => undefined) // warm the plan cache and the pages; the measured run is the second one
  results[p.name] = await measure(async () => {
    await p.run().catch((e: unknown) => {
      throw new Error(`${p.name}: ${String((e as Error).message).slice(0, 200)}`)
    })
  })
}

// ---- the standing pass: N real passes of the real worker with nothing due and nothing queued --------------------------------
if (ONLY === undefined || ONLY.includes('worker.idle_pass')) {
  await rows(`update public.responsibilities set enabled = false`)
  const pass = await buildPass(db, `probe-${database}`, { log: () => undefined, max: 1 })
  await pass() // warm
  const c = await measure(async () => {
    for (let i = 0; i < PASSES; i += 1) await pass()
  })
  const per = (x: number): number => Math.round((x / PASSES) * 10) / 10
  results['worker.idle_pass'] = {
    statements: per(c.statements),
    hit: per(c.hit),
    read: per(c.read),
    wal: per(c.wal),
    jobs_seq_scans: per(c.jobs_seq_scans),
    jobs_seq_tuples: per(c.jobs_seq_tuples),
    jobs_idx_scans: per(c.jobs_idx_scans),
    ms: per(c.ms),
  }
}

const jobsFacts = (
  await rows(
    `select reltuples::bigint rows, relpages pages, pg_relation_size('public.jobs') / 1024 heap_kib from pg_class where oid = 'public.jobs'::regclass`,
  )
)[0]

if (JSON_OUT) {
  console.log(
    JSON.stringify(
      { database, office, passes: PASSES, jobs: jobsFacts, network_refused: refused, results },
      null,
      1,
    ),
  )
} else {
  console.log(
    `replica ${database}: jobs ~${num(jobsFacts?.rows)} rows, ${num(jobsFacts?.pages)} heap pages. Per call; idle_pass is per pass.`,
  )
  console.log(
    'probe'.padEnd(34),
    'stmts'.padStart(6),
    'hit'.padStart(8),
    'read'.padStart(6),
    'seqscan'.padStart(8),
    'seqtup'.padStart(8),
    'idxscan'.padStart(8),
    'ms'.padStart(8),
  )
  for (const [name, c] of Object.entries(results))
    console.log(
      name.padEnd(34),
      String(c.statements).padStart(6),
      String(c.hit).padStart(8),
      String(c.read).padStart(6),
      String(c.jobs_seq_scans).padStart(8),
      String(c.jobs_seq_tuples).padStart(8),
      String(c.jobs_idx_scans).padStart(8),
      String(c.ms).padStart(8),
    )
}

let failed = 0
if (BUDGET !== undefined) {
  const budget = JSON.parse(readFileSync(BUDGET, 'utf8')) as {
    probes: Record<string, Partial<Record<keyof Cost, number>>>
  }
  for (const [name, limits] of Object.entries(budget.probes)) {
    const got = results[name]
    if (got === undefined) {
      console.log(
        `BUDGET FAIL ${name}: no such probe ran (a budget that matches nothing is not a pass)`,
      )
      failed += 1
      continue
    }
    for (const [k, max] of Object.entries(limits)) {
      // `hit` in a budget means buffers TOUCHED (hit + read): whether a page was already cached depends on what ran before, and a
      // ceiling that flaps with cache warmth is a ceiling nobody trusts. Measured on one replica: pulse 62,006 hits + 8,718 reads
      // on one run and 70,724 hits + 0 reads on another, the same 70,724 touched.
      const v = k === 'hit' ? got.hit + got.read : got[k as keyof Cost]
      if (v === undefined || v > (max as number)) {
        console.log(`BUDGET FAIL ${name}.${k}: ${String(v)} > ${String(max)}`)
        failed += 1
      }
    }
  }
  console.log(failed === 0 ? 'budget: PASS' : `budget: ${failed} FAIL`)
}
await db.end()
process.exit(failed === 0 ? 0 : 1)
