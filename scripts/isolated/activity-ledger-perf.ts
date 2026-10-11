// biome-ignore-all format: a dense measurement script kept readable as written
/**
 * What the unified activity ledger costs (migrations 1060 and 1061), measured on the isolated replica.
 *
 *   npx tsx scripts/isolated/activity-ledger-perf.ts <replica-db> [jobs]
 *
 * Reports, never gates on a wall-clock number of its own (a laptop and a 434 MiB host are not the same machine). What it DOES assert is
 * about shape, which does not depend on the machine:
 *   - a page of fifty never reads a table in full: the slowest read at the largest size stays within a stated multiple of the fastest
 *     at the smallest, so a plan that has stopped using an index shows as a ratio, not as a number somebody has to remember;
 *   - recording a native event is one insert (index maintenance included) and the strict writer costs about what the safe one does;
 *   - twenty concurrent writers produce exactly the rows they should, with no deadlock and no lost event;
 *   - the jobs table has no new trigger: the ledger adds nothing to a job's critical path, because it reads the transitions the existing trigger already writes.
 *
 * Seeding uses the product's own writers where there is one (a real turn, enqueue_child, the transition trigger) and set-based inserts for the
 * volume tables (model usage, deliveries, native events) so a run is minutes, not hours.
 */
import { PgExecutor } from '../../src/db/pg-executor.ts'
import { isolated } from './guard.ts'
import { realParent } from './real-telegram.ts'

const dbName = process.argv[2] ?? 'ledger'
const JOBS = Number(process.argv[3] ?? 3000)
const db = await isolated(dbName)
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const ms = async (f: () => Promise<unknown>): Promise<number> => {
  const t = performance.now()
  await f()
  return performance.now() - t
}
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))] ?? 0
const results: boolean[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push(ok)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}
const report: string[] = []

let exit = 1
try {
  await db.execute(`update public.system_config set value = 'true'::jsonb where key = 'activity.ledger_enabled'`)
  const grant = String((await one(`select app.operator_office() as o`)).o)
  const project = String(((await one(`select app.hq_create_project(${lit(grant)}::uuid, 'Perf ${Date.now().toString(36)}', 'upload', 'perf-${Date.now().toString(36)}', 'Perf', true) as v`)).v as { project_id: string }).project_id ?? '')
  const root = await realParent(db)
  const proj = project !== '' ? project : String((await one(`select project_id::text as p from public.jobs where job_id = ${lit(root)}::uuid`)).p)
  const corr = String((await one(`select correlation_id::text as c from public.jobs where job_id = ${lit(root)}::uuid`)).c)

  // ---- seed ---------------------------------------------------------------------------------------------------------------------
  const seedStart = performance.now()
  const sizes = [JOBS / 10, JOBS]
  const readAt: Record<number, Record<string, number[]>> = {}
  let made = 0
  const grow = async (to: number) => {
    const n = to - made
    await db.execute(`select app.enqueue_child(app.job_office(${lit(root)}::uuid), ${lit(root)}::uuid, 'office.instruction', '{}'::jsonb, interval '0', true, ${lit(proj)}::uuid) from generate_series(1, ${n})`)
    // every child: queued -> running -> complete, through the real transition trigger (one row each)
    await db.execute(`update public.jobs set state = 'running', recipient_agent = (array['research-director','finance-director','chief-of-staff'])[1 + (abs(hashtext(job_id::text)) % 3)] where parent_job_id = ${lit(root)}::uuid and state = 'queued'`)
    await db.execute(`update public.jobs set state = 'output_created' where parent_job_id = ${lit(root)}::uuid and state = 'running'`)
    await db.execute(`update public.jobs set state = 'quality_review' where parent_job_id = ${lit(root)}::uuid and state = 'output_created'`)
    await db.execute(`update public.jobs set state = 'committing' where parent_job_id = ${lit(root)}::uuid and state = 'quality_review'`)
    await db.execute(`update public.jobs set state = 'committed' where parent_job_id = ${lit(root)}::uuid and state = 'committing'`)
    await db.execute(`update public.jobs set state = 'notifying' where parent_job_id = ${lit(root)}::uuid and state = 'committed'`)
    await db.execute(`update public.jobs set state = 'complete' where parent_job_id = ${lit(root)}::uuid and state = 'notifying'`)
    await db.execute(`insert into public.inference_usage (provider, model_id, job_id, correlation_id, outcome, prompt_tokens, completion_tokens, provenance, office_id, latency_ms, cost_usd, occurred_at)
      select 'openrouter', 'openai/gpt-oss-120b', j.job_id, j.correlation_id, case when abs(hashtext(j.job_id::text)) % 20 = 0 then 'rate_limited' else 'ok' end, 800, 100, 'estimated', j.office_id, 700, 0.001, j.updated_at - interval '1 second'
        from public.jobs j, generate_series(1, 6) g where j.parent_job_id = ${lit(root)}::uuid and j.job_id not in (select job_id from public.inference_usage where job_id is not null)`)
    await db.execute(`insert into public.deliveries (channel, dedupe_key, account_ref, target_ref, purpose, state, attempt, lease_expires_at, correlation_id, job_id, message_ref, send_started_at, sent_at, office_id)
      select 'telegram', 'perf-' || j.job_id::text, 'bot', '1386648496', 'result', 'sent', 1, now(), j.correlation_id, j.job_id, 'm-' || substr(j.job_id::text, 1, 8), j.updated_at, j.updated_at, j.office_id
        from public.jobs j where j.parent_job_id = ${lit(root)}::uuid and not exists (select 1 from public.deliveries d where d.job_id = j.job_id)`)
    made = to
  }
  const native = async (n: number) => {
    await db.execute(`insert into public.activity_events (office_id, event_type, occurred_at, actor_kind, actor, status, severity, visibility, summary, idempotency_key, project_id, correlation_id)
      select ${lit(grant)}::uuid, (array['tool.requested','tool.completed','tool.failed','integration.rate_limited','budget.threshold_reached'])[1 + g % 5],
             now() - (g || ' seconds')::interval, 'agent', 'research-director', 'recorded', (array['info','info','warning','warning','notice'])[1 + g % 5],
             case when g % 5 in (4) then 'user' else 'diagnostic' end, 'seeded ' || g, 'perf-seed-' || g || '-' || md5(random()::text), ${lit(proj)}::uuid, ${lit(corr)}::uuid
        from generate_series(1, ${n}) g`)
  }
  for (const target of sizes) {
    await grow(target)
    await native(Math.max(500, target))
    const counts = await one(`select (select count(*) from public.job_state_transitions t join public.jobs j on j.job_id = t.job_id where j.office_id = ${lit(grant)}::uuid) as transitions,
      (select count(*) from public.inference_usage where office_id = ${lit(grant)}::uuid) as usage, (select count(*) from public.deliveries where office_id = ${lit(grant)}::uuid) as deliveries,
      (select count(*) from public.activity_events where office_id = ${lit(grant)}::uuid) as native`)
    await db.execute('analyze')
    // PERF_SEED_ONLY=1 stops here, so a plan can be read with EXPLAIN against the same data without paying for the measurements.
    if (process.env.PERF_SEED_ONLY === '1' && target === sizes[1]) {
      console.log(`seeded: ${JSON.stringify(counts)}`)
      await db.end()
      process.exit(0)
    }
    // ---- read latency ----------------------------------------------------------------------------------------------------------
    const mid = await one(`select (e ->> 'at') as at, (e ->> 'id') as id from jsonb_array_elements(app.activity_read(p_office => ${lit(grant)}::uuid, p_visibility => 'diagnostic', p_limit => 200) -> 'events') with ordinality t(e, n) where n = 100`)
    const cases: [string, string][] = [
      ['newest 50, ordinary', `app.activity_read(p_office => ${lit(grant)}::uuid)`],
      ['newest 50, diagnostic', `app.activity_read(p_office => ${lit(grant)}::uuid, p_visibility => 'diagnostic')`],
      ['one project, diagnostic', `app.activity_read(p_office => ${lit(grant)}::uuid, p_project => ${lit(proj)}::uuid, p_visibility => 'diagnostic')`],
      ['severity >= error (selective)', `app.activity_read(p_office => ${lit(grant)}::uuid, p_min_severity => 'error', p_visibility => 'diagnostic')`],
      ['one agent', `app.activity_read(p_office => ${lit(grant)}::uuid, p_agent => 'finance-director', p_visibility => 'diagnostic')`],
      ['page 3 by cursor', `app.activity_read(p_office => ${lit(grant)}::uuid, p_visibility => 'diagnostic', p_before_at => ${lit(String(mid.at))}::timestamptz, p_before_id => ${lit(String(mid.id))}::uuid)`],
      ['one root job (chain by job)', `app.activity_chain(${lit(grant)}::uuid, p_job => ${lit(root)}::uuid)`],
      ['the existing hq_studio_lately (baseline)', `app.hq_studio_lately(${lit(grant)}::uuid, 40)`],
    ]
    readAt[target] = {}
    console.log(`\n== ${target} jobs: ${String(counts.transitions)} transitions, ${String(counts.usage)} model calls, ${String(counts.deliveries)} deliveries, ${String(counts.native)} native events`)
    for (const [name, expr] of cases) {
      const first = await ms(() => db.execute(`select ${expr}`))
      const runs: number[] = []
      for (let i = 0; i < 15; i++) runs.push(await ms(() => db.execute(`select ${expr}`)))
      readAt[target][name] = runs
      console.log(`   ${name.padEnd(42)} first ${first.toFixed(0).padStart(5)} ms   p50 ${pct(runs, 50).toFixed(0).padStart(5)}   p95 ${pct(runs, 95).toFixed(0).padStart(5)}`)
      report.push(`${target}|${name}|first ${first.toFixed(0)}|p50 ${pct(runs, 50).toFixed(0)}|p95 ${pct(runs, 95).toFixed(0)}`)
    }
  }
  const small = sizes[0] as number
  const big = sizes[1] as number
  const feed = 'newest 50, ordinary'
  const ratio = pct(readAt[big]?.[feed] ?? [1], 50) / Math.max(1, pct(readAt[small]?.[feed] ?? [1], 50))
  check('reads: ten times the history does not make the newest page ten times slower', ratio < 6, `p50 ratio ${ratio.toFixed(2)} for ${big / small}x the rows`)

  // ---- write cost -------------------------------------------------------------------------------------------------------------
  const N = 500
  const strict = await ms(async () => {
    for (let i = 0; i < N; i++) await db.execute(`select app.record_activity(${lit(grant)}::uuid, 'tool.completed', ${lit(`perf-w1-${i}-${Date.now()}`)}, 'agent', 'a', 'Tool finished')`)
  })
  const safe = await ms(async () => {
    for (let i = 0; i < N; i++) await db.execute(`select app.record_activity_safely(${lit(grant)}::uuid, 'tool.completed', ${lit(`perf-w2-${i}-${Date.now()}`)}, 'agent', 'a', 'Tool finished')`)
  })
  await db.execute(`update public.system_config set value = 'false'::jsonb where key = 'activity.ledger_enabled'`)
  const off = await ms(async () => {
    for (let i = 0; i < N; i++) await db.execute(`select app.record_activity(${lit(grant)}::uuid, 'tool.completed', ${lit(`perf-w3-${i}-${Date.now()}`)}, 'agent', 'a', 'Tool finished')`)
  })
  await db.execute(`update public.system_config set value = 'true'::jsonb where key = 'activity.ledger_enabled'`)
  console.log(`\n== native writes, ${N} each, one round trip per write: strict ${(strict / N).toFixed(2)} ms, safe ${(safe / N).toFixed(2)} ms, switched off ${(off / N).toFixed(2)} ms`)
  report.push(`writes|strict ${(strict / N).toFixed(2)}|safe ${(safe / N).toFixed(2)}|off ${(off / N).toFixed(2)}`)
  check('writes: the safe writer costs about what the strict one does (its catch block is free on the happy path)', safe / strict < 1.6, `safe/strict ${(safe / strict).toFixed(2)}`)
  check('writes: switched off, a write is cheaper than switched on and still a single call', off < strict, `off ${(off / N).toFixed(2)} ms vs on ${(strict / N).toFixed(2)} ms`)

  // ---- concurrency -------------------------------------------------------------------------------------------------------------
  const W = 20
  const PER = 50
  const conns = await Promise.all(
    Array.from({ length: W }, async () => {
      const c = new PgExecutor(`postgresql://postgres@/${dbName}?host=${process.env.ISOLATED_PG_SOCKET ?? '/tmp/pgs'}&port=${process.env.ISOLATED_PG_PORT ?? '55432'}`)
      await c.connect()
      return c
    }),
  )
  const tag = Date.now().toString(36)
  const before = Number((await one(`select count(*) as c from public.activity_events where idempotency_key like ${lit(`perf-c-${tag}-%`)}`)).c)
  const cstart = performance.now()
  let errors = 0
  await Promise.all(conns.map(async (c, w) => {
    for (let i = 0; i < PER; i++) {
      // every writer also repeats a shared key, so duplicates are suppressed under contention, not just distinct rows inserted
      await c.execute(`select app.record_activity(${lit(grant)}::uuid, 'tool.requested', ${lit(`perf-c-${tag}-${w}-${i}`)}, 'agent', 'a', 'concurrent'), app.record_activity(${lit(grant)}::uuid, 'tool.requested', ${lit(`perf-c-${tag}-shared-${i}`)}, 'agent', 'a', 'shared')`).catch(() => { errors++ })
    }
  }))
  const took = performance.now() - cstart
  await Promise.all(conns.map((c) => c.end()))
  const after = Number((await one(`select count(*) as c from public.activity_events where idempotency_key like ${lit(`perf-c-${tag}-%`)}`)).c)
  check('concurrency: twenty writers, no error, no lost event, shared keys written once', errors === 0 && after - before === W * PER + PER, `${after - before} rows (expected ${W * PER + PER}), ${errors} errors, ${(((W * PER * 2) / took) * 1000).toFixed(0)} calls/s`)

  // ---- footprint ---------------------------------------------------------------------------------------------------------------
  const size = await one(`select pg_total_relation_size('public.activity_events') as total, pg_relation_size('public.activity_events') as heap, (select count(*) from public.activity_events) as n, (select avg(pg_column_size(a.*)) from public.activity_events a) as rowbytes`)
  const perRow = Number(size.total) / Math.max(1, Number(size.n))
  console.log(`\n== footprint: ${String(size.n)} native events, ${(Number(size.total) / 1e6).toFixed(1)} MB with indexes, ${perRow.toFixed(0)} bytes an event (row ${Number(size.rowbytes).toFixed(0)} bytes)`)
  report.push(`footprint|${String(size.n)} events|${perRow.toFixed(0)} bytes per event with indexes`)
  check('footprint: an event with its indexes stays under 1 KB', perRow < 1024, `${perRow.toFixed(0)} bytes`)
  const trig = await one(`select count(*) as c from pg_trigger where tgrelid = 'public.jobs'::regclass and not tgisinternal and tgname ~* '(activity|ledger)'`)
  check('critical path: the ledger adds no trigger to jobs, so a job transition costs what it did before', Number(trig.c) === 0, `${String(trig.c)} ledger triggers on public.jobs`)
  const trig2 = await one(`select count(*) as c from pg_trigger where tgrelid in ('public.deliveries'::regclass, 'public.inbound_commands'::regclass, 'public.blockers'::regclass, 'public.outputs'::regclass, 'public.inference_usage'::regclass, 'public.job_state_transitions'::regclass) and not tgisinternal and tgname ~* '(activity|ledger)'`)
  check('critical path: nor to the delivery, request, approval, output, usage or transition tables', Number(trig2.c) === 0, `${String(trig2.c)} ledger triggers`)
  console.log(`\nseeded and measured in ${((performance.now() - seedStart) / 1000).toFixed(0)} s`)
  const failed = results.filter((r) => !r).length
  console.log(`${results.length - failed}/${results.length} passed`)
  exit = failed === 0 ? 0 : 1
} finally {
  await db.end()
}
process.exit(exit)
