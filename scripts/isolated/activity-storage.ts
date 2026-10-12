// biome-ignore-all lint/suspicious/noExplicitAny: the replica's rows are untyped
// biome-ignore-all lint/style/noNonNullAssertion: a measurement script over rows it has just created
// biome-ignore-all format: a dense measurement script kept readable as written
/**
 * What the unified activity ledger really costs in storage, measured on the isolated replica with the FINAL candidate schema
 * (capacity investigation, 11 October 2026; docs/activity-ledger/STORAGE-CAPACITY-DECISION.md).
 *
 *   npx tsx scripts/isolated/activity-storage.ts <replica-db>
 *
 * Three measurements, each printed as a table, and shape assertions that do not depend on the machine:
 *   1. the migrations themselves: pg_database_size before and after applying 1060 to 1062 to a database that has none of the ledger;
 *   2. the eleven read indexes on the tables that already exist, built concurrently on a history copied up to a stated size, with unique
 *      timestamps (a btree deduplicates equal keys, so cloned timestamps would understate the cost): bytes per index, per row of the
 *      table it indexes, the time the build took and the WAL it wrote;
 *   3. native events by kind (a typical tool call with and without a project and job, the largest payload the table accepts, an outside
 *      worker's report through the door): heap, index and TOAST bytes per row, taken as the growth of the table across each batch.
 * Replica numbers describe the SHAPE of the cost; production's row counts and widths come from the baseline step of the runbook.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { ACTIVITY_INDEXES, ensureActivityIndexes } from '../../src/activity/indexes.ts'
import { PgExecutor } from '../../src/db/pg-executor.ts'
import { cloneVolume } from './activity-scale-seed.ts'
import { isolated } from './guard.ts'
import { realParent } from './real-telegram.ts'

const dbName = process.argv[2] ?? 'ledger'
const db = await isolated(dbName)
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, any>
const results: boolean[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push(ok)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}
const mb = (b: number) => (b / 1_000_000).toFixed(2)
const TEMPLATE = Number(process.env.STORAGE_TEMPLATE_JOBS ?? 300)
const COPIES = Number(process.env.STORAGE_COPIES ?? 8)
const EVENTS = Number(process.env.STORAGE_EVENTS ?? 4000)

let exit = 1
try {
  // ---- 1. the migrations --------------------------------------------------------------------------------------------------------
  const sock = process.env.ISOLATED_PG_SOCKET ?? '/tmp/pgs'
  const port = process.env.ISOLATED_PG_PORT ?? '55432'
  const admin = new PgExecutor(`postgresql://postgres@/postgres?host=${sock}&port=${port}`)
  await admin.connect()
  const stripped = `${dbName}_nomig`
  await admin.execute(`drop database if exists ${stripped}`)
  // from the candidate template (`post`), which nothing may be connected to; the database under measurement holds this script's own connection
  await admin.execute(`create database ${stripped} template post`)
  const sdb = new PgExecutor(`postgresql://postgres@/${stripped}?host=${sock}&port=${port}`)
  await sdb.connect()
  await sdb.execute(`do $$ declare r record; begin
      for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname in ('app', 'public') and ((p.proname like 'activity\\_%' and p.proname <> 'activity_category')
                      or p.proname in ('record_activity', 'record_activity_safely', 'record_external_activity'))
      loop execute 'drop function ' || r.sig || ' cascade'; end loop; end $$;
    drop table if exists public.activity_write_failures cascade; drop table if exists public.activity_events cascade; drop table if exists public.activity_event_types cascade;
    delete from public.system_config where key like 'activity.%'`)
  await sdb.execute('checkpoint')
  const before = Number((await sdb.execute(`select pg_database_size(current_database()) as b`)).rows[0]!.b)
  for (const n of ['1060', '1061', '1062']) {
    const f = readdirSync('migrations').find((x) => x.startsWith(`${n}_`)) as string
    await sdb.execute(readFileSync(`migrations/${f}`, 'utf8'))
  }
  await sdb.execute('checkpoint')
  const after = Number((await sdb.execute(`select pg_database_size(current_database()) as b`)).rows[0]!.b)
  const fnBytes = Number((await sdb.execute(`select coalesce(sum(pg_column_size(p.*)), 0) as b from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('app','public') and (p.proname like 'activity\\_%' or p.proname like 'record\\_%activity%')`)).rows[0]!.b)
  console.log('\n1. the three migrations on a database with none of the ledger')
  console.log(`     database before ${mb(before)} MB, after ${mb(after)} MB: +${mb(after - before)} MB (function bodies in pg_proc about ${mb(fnBytes)} MB; the tables and their indexes are empty: one 8 to 16 kB page each)`)
  check('migrations: applying 1060 to 1062 adds well under 2 MB (no data is written: empty tables, indexes and function bodies only)', after - before < 2_000_000, `${mb(after - before)} MB`)
  await sdb.end()
  await admin.execute(`drop database if exists ${stripped}`)
  await admin.end()

  // ---- 2. the eleven read indexes on a copied history --------------------------------------------------------------------------
  await db.execute(`update public.system_config set value = 'true'::jsonb where key = 'activity.ledger_enabled'`)
  await db.execute(`insert into public.system_config (key, value, description) values ('activity.ledger_offices', '{"version":1,"mode":"all"}'::jsonb, 'proof') on conflict (key) do update set value = excluded.value`)
  await db.execute(`insert into public.system_config (key, value, description) values ('activity.diag_native_per_day', '100000'::jsonb, 'measurement') on conflict (key) do update set value = excluded.value`)
  const grant = String((await one(`select app.operator_office() as o`)).o)
  const root = await realParent(db)
  const project = String((await one(`select project_id::text as p from public.jobs where job_id = ${lit(root)}::uuid`)).p)
  await db.execute(`select app.enqueue_child(app.job_office(${lit(root)}::uuid), ${lit(root)}::uuid, 'office.instruction', '{}'::jsonb, interval '0', true, ${lit(project)}::uuid) from generate_series(1, ${TEMPLATE})`)
  const chain = ['running', 'output_created', 'quality_review', 'committing', 'committed', 'notifying', 'complete']
  for (let i = 0; i < chain.length; i++) await db.execute(`update public.jobs set state = '${chain[i]}'${i === 0 ? `, recipient_agent = 'research-director'` : ''} where parent_job_id = ${lit(root)}::uuid and state = '${i === 0 ? 'queued' : chain[i - 1]}'`)
  await db.execute(`insert into public.inference_usage (provider, model_id, job_id, correlation_id, outcome, prompt_tokens, completion_tokens, provenance, office_id, latency_ms, cost_usd, occurred_at)
    select 'openrouter', 'openai/gpt-oss-120b', j.job_id, j.correlation_id, 'ok', 800, 100, 'estimated', j.office_id, 700, 0.001, j.updated_at from public.jobs j, generate_series(1, 4) g where j.parent_job_id = ${lit(root)}::uuid`)
  await db.execute(`insert into public.deliveries (channel, dedupe_key, account_ref, target_ref, purpose, state, attempt, lease_expires_at, correlation_id, job_id, message_ref, send_started_at, sent_at, office_id)
    select 'telegram', 'st-' || j.job_id::text, 'bot', '1386648496', 'result', 'sent', 1, now(), j.correlation_id, j.job_id, 'm-' || substr(j.job_id::text, 1, 8), j.updated_at, j.updated_at, j.office_id from public.jobs j where j.parent_job_id = ${lit(root)}::uuid`)
  const firstLabel = async (typ: string) => String((await one(`select enumlabel as l from pg_enum where enumtypid = ${lit(`public.${typ}`)}::regtype order by enumsortorder limit 1`)).l)
  await db.execute(`insert into public.outputs (job_id, body, confidence, evidence, reviewer_status, created_at)
    select j.job_id, 'An answer', ${lit(await firstLabel('confidence_level'))}::public.confidence_level, ${lit(await firstLabel('evidence_type'))}::public.evidence_type, ${lit(await firstLabel('reviewer_status'))}::public.reviewer_status, j.updated_at from public.jobs j where j.parent_job_id = ${lit(root)}::uuid`)
  const cloned = await cloneVolume(db, grant, grant, project, COPIES, TEMPLATE)
  // every time column gets a distinct value, so the btrees are the size they are in production and not the size a deduplicated copy gives
  await db.execute(`begin; set local session_replication_role = replica;
    update public.job_state_transitions set occurred_at = now() - random() * interval '90 days';
    update public.inference_usage set occurred_at = now() - random() * interval '90 days';
    update public.deliveries set updated_at = now() - random() * interval '90 days', sent_at = now() - random() * interval '90 days', send_started_at = now() - random() * interval '90 days';
    update public.outputs set created_at = now() - random() * interval '90 days'; commit`)
  await db.execute('analyze')
  const rows = async (table: string) => Number((await one(`select count(*) as c from public.${table}`)).c)
  const counts = { jobs: await rows('jobs'), job_state_transitions: await rows('job_state_transitions'), inference_usage: await rows('inference_usage'), deliveries: await rows('deliveries'), outputs: await rows('outputs'), inbound_commands: await rows('inbound_commands'), blockers: await rows('blockers'), events: await rows('events'), job_impediments: await rows('job_impediments') }
  console.log(`\n2. the eleven read indexes (concurrent build) on a copied history: ${JSON.stringify(counts)}`)
  void cloned
  const lsn = async () => String((await one(`select pg_current_wal_lsn()::text as l`)).l)
  const walBetween = async (a: string, b: string) => Number((await one(`select pg_wal_lsn_diff(${lit(b)}::pg_lsn, ${lit(a)}::pg_lsn) as d`)).d)
  const tmpOf = async () => Number((await one(`select temp_bytes as b from pg_stat_database where datname = current_database()`)).b)
  const tmp0 = await tmpOf()
  const l0 = await lsn()
  const t0 = performance.now()
  await ensureActivityIndexes(db)
  const buildMs = performance.now() - t0
  const l1 = await lsn()
  const tmp1 = await tmpOf()
  const table: { name: string; table: string; bytes: number; rows: number }[] = []
  for (const ix of ACTIVITY_INDEXES) {
    const name = ix.name
    const tbl = String((await one(`select tablename as t from pg_indexes where indexname = ${lit(name)}`)).t ?? '')
    const bytes = Number((await one(`select pg_relation_size(${lit(`public.${name}`)}::regclass) as b`)).b)
    const rowsOf = tbl === '' ? 0 : await rows(tbl)
    table.push({ name, table: tbl, bytes, rows: rowsOf })
  }
  let total = 0
  const perRow: Record<string, number> = {}
  for (const r of table) {
    total += r.bytes
    if (r.rows > 0) perRow[r.table] = (perRow[r.table] ?? 0) + r.bytes / r.rows
    console.log(`     ${r.name.padEnd(40)} ${r.table.padEnd(22)} ${String(r.rows).padStart(8)} rows ${String(r.bytes).padStart(10)} B ${r.rows > 0 ? (r.bytes / r.rows).toFixed(1).padStart(7) : '      -'} B/row`)
  }
  console.log(`     all eleven: ${mb(total)} MB; built in ${(buildMs / 1000).toFixed(1)} s, WAL written ${mb(await walBetween(l0, l1))} MB, temp files ${mb(tmp1 - tmp0)} MB`)
  console.log(`     bytes of new index per row of each table: ${JSON.stringify(Object.fromEntries(Object.entries(perRow).map(([k, v]) => [k, Number(v.toFixed(1))])))}`)
  const perJob = total / Math.max(counts.jobs, 1)
  check('indexes: the eleven read indexes together cost under 1 KB per job of history on this shape (about 8 transitions, 4 model calls, a delivery and an output a job)', perJob < 1000, `${perJob.toFixed(0)} B a job`)

  // ---- 3. native events by kind --------------------------------------------------------------------------------------------------
  const jobId = String((await one(`select job_id::text as j from public.jobs where office_id = ${lit(grant)}::uuid and parent_job_id is not null limit 1`)).j)
  type Variant = { label: string; key: string; sql: string; want?: number }
  const writer = (key: string, extra: string, summary: string, meta: string, evidence = 'null') =>
    `select count(*) from (select app.record_activity(p_office => ${lit(grant)}::uuid, p_event_type => 'tool.call_completed', p_idempotency_key => '${key}-' || g || '-' || md5(g::text), p_actor_kind => 'agent', p_actor => 'research-director', p_summary => ${summary}, p_agent_slug => 'research-director', p_tool => 'drive.read'${extra}, p_metadata => ${meta}, p_evidence_ref => ${evidence}) from generate_series(1, ${EVENTS}) g) q`
  const typicalMeta = `jsonb_build_object('capability','drive.read','step', g % 7,'outcome','found','duration_ms', 100 + g % 900)`
  const typicalSummary = `'Looked up the supplier sheet for the launch (' || g || ')'`
  const variants: Variant[] = [
    { label: 'typical tool call, no project or job', key: 'sv1', sql: writer('sv1', '', typicalSummary, typicalMeta) },
    { label: 'typical tool call with a project and a job', key: 'sv2', sql: writer('sv2', `, p_project_id => ${lit(project)}::uuid, p_job_id => ${lit(jobId)}::uuid`, typicalSummary, typicalMeta) },
    { label: 'the largest payload accepted (300 char summary, ~3.8 KB metadata, ~1 KB evidence)', key: 'sv3', sql: writer('sv3', '', `repeat('x', 300)`, `(select jsonb_object_agg('k' || n, md5(n::text || g::text) || md5(n::text)) from generate_series(1, 38) n)`, `jsonb_build_object('kind','job','id', md5(g::text), 'note', repeat('e', 900))`) },
    // the door's own caps (300 an hour a worker, 1 000 an hour an office) bound this variant: four workers, 250 each
    { label: "an outside worker's report through the door (1 000, the hourly office cap)", key: 'ext', want: 1000, sql: `select count(*) from (select app.record_external_activity(${lit(grant)}::uuid, 'worker-' || (g % 4), 'external.usage_recorded', 'ext-' || g || '-' || md5(g::text), 'Reported usage for a research task', 'recorded', null, null, null, null, jsonb_build_object('model','openai/gpt-oss-120b','prompt_tokens', 800 + g % 400,'completion_tokens',120,'cost_usd',0.001)) from generate_series(1, 1000) g) q` },
  ]
  const sizesNow = async () => ({
    heap: Number((await one(`select pg_relation_size('public.activity_events') as b`)).b),
    idx: Number((await one(`select pg_indexes_size('public.activity_events') as b`)).b),
    toast: Number((await one(`select coalesce(pg_total_relation_size(reltoastrelid), 0) as b from pg_class where oid = 'public.activity_events'::regclass`)).b),
    n: Number((await one(`select count(*) as c from public.activity_events`)).c),
  })
  console.log(`\n3. native events by kind (${EVENTS} of each, written one call each; growth of heap, indexes and TOAST across the batch)`)
  console.log(`     ${'kind'.padEnd(84)} ${'heap'.padStart(7)} ${'index'.padStart(7)} ${'toast'.padStart(7)} ${'total'.padStart(7)}  B/event`)
  const out: Record<string, number> = {}
  for (const v of variants) {
    const a = await sizesNow()
    await db.execute(v.sql)
    await db.execute('vacuum (analyze) public.activity_events')
    const b = await sizesNow()
    const n = b.n - a.n
    // The heap is measured from the rows themselves (their stored width plus the 24 byte tuple header and the 4 byte line pointer), not
    // from the growth of the file, because PostgreSQL extends a busy relation several pages at a time and the growth is lumpy.
    const heap = Number((await one(`select avg(pg_column_size(x.*)) as w from public.activity_events x where ${v.key === 'ext' ? `x.actor_kind = 'external'` : `x.idempotency_key like ${lit(`${v.key}-%`)}`}`)).w) + 28
    const idx = (b.idx - a.idx) / n
    const toast = (b.toast - a.toast) / n
    out[v.key] = heap + idx + toast
    console.log(`     ${v.label.padEnd(84)} ${heap.toFixed(0).padStart(7)} ${idx.toFixed(0).padStart(7)} ${toast.toFixed(0).padStart(7)} ${(heap + idx + toast).toFixed(0).padStart(7)}  (${n} written)`)
    check(`native: all ${v.want ?? EVENTS} "${v.label}" events were stored (none refused or dropped)`, n === (v.want ?? EVENTS), `${n}`)
  }
  check('native: a typical event with its indexes stays under 1 KB', (out.sv1 ?? 0) < 1000 && (out.sv2 ?? 0) < 1100, `${(out.sv1 ?? 0).toFixed(0)} B without links, ${(out.sv2 ?? 0).toFixed(0)} B with a project and a job`)
  check('native: even the largest payload the table accepts stays under 6 KB an event', (out.sv3 ?? 0) < 6000, `${(out.sv3 ?? 0).toFixed(0)} B`)
  const idempotent = await one(`select count(*) as c from public.activity_events where idempotency_key like 'sv1-%'`)
  await db.execute(writer('sv1', '', typicalSummary, typicalMeta))
  const idemAfter = await one(`select count(*) as c from public.activity_events where idempotency_key like 'sv1-%'`)
  check('native: writing the same events again adds no row and no byte (idempotent, not duplicated)', Number(idempotent.c) === Number(idemAfter.c), `${idempotent.c} rows before and ${idemAfter.c} after`)

  const failed = results.filter((r) => !r).length
  console.log(`\n${results.length - failed}/${results.length} passed`)
  exit = failed === 0 ? 0 : 1
} finally {
  await db.end()
}
process.exit(exit)
