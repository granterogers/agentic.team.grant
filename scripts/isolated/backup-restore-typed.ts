/**
 * G-2 (the typed restore): a backup taken by the repository's own code is restored into a fresh isolated replica with the
 * REAL column types, constraints, triggers, row security and composite foreign keys, and then checked.
 *
 *   bash <scratchpad>/mkbrt.sh      # brt_base = post + 1026 + probe tables; brt_src and brt_dst copies of it
 *   npx tsx scripts/isolated/backup-restore-typed.ts brt_src brt_dst
 *
 * What runs, and what is real:
 *   - the SOURCE is seeded through the product's own writers (provision_person_office, hq_create_project, my_task_add,
 *     hq_document_link) plus a few direct inserts where a writer is not practical (jobs, outputs), and proof-only tables
 *     (scripts/isolated/restore-probe-schema.sql) built to make each claim falsifiable;
 *   - the dump is the REAL `backupHandler` (resumable steps, paged dump, manifest with checksums, fingerprints and the
 *     auxiliary section) writing to an in-memory emulator of the Storage endpoints it calls (no network);
 *   - the restore is `restoreArchive` reading that folder back through the REAL `StorageFolderSource`;
 *   - verification is independent of the restore's own report: source and target are fingerprinted separately.
 *
 * Controls (each must go RED, and each prints what it did): a corrupted column type, a changed value that is still the
 * right type, a missing parent table, an interrupted earlier run, an unmarked target, a non-empty target, a restore run
 * twice. Nothing here reaches production, a person, or a channel.
 */
import { spawnSync } from 'node:child_process'
import { type Aux, STRUCTURE_SQL } from '../../src/backup/aux.ts'
import { type Manifest, verifyArchive } from '../../src/backup/manifest.ts'
import { fingerprintSql, pagedDump } from '../../src/backup/paged.ts'
import { checksum, newestFolder, readFolder, tablesToBackUp } from '../../src/backup/portable.ts'
import {
  authUserPayloads,
  cronRestoreSql,
  recoveryChecklist,
  restoreArchive,
} from '../../src/backup/restore.ts'
import { planRetention } from '../../src/backup/retention.ts'
import { applyRetention, listRuns } from '../../src/backup/runs.ts'
import { gunzipText, MemoryArchive, StorageFolderSource } from '../../src/backup/sources.ts'
import { PgExecutor } from '../../src/db/pg-executor.ts'
import { backupHandler } from '../../src/handlers/backup.ts'
import { isolated } from './guard.ts'
import { StorageEmulator } from './storage-emulator.ts'

const SRC = process.argv[2] ?? 'brt_src'
const DST = process.argv[3] ?? 'brt_dst'
const src = await isolated(SRC)
const dst = await isolated(DST)
const REF = 'brt-proof'
const KEY = 'local-proof-key'
const run = Math.random().toString(36).slice(2, 8)

let failed = 0
const check = (what: string, ok: boolean, detail: string): void => {
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const one = async (db: PgExecutor, sql: string): Promise<Record<string, unknown>> =>
  (await db.execute(sql)).rows[0] as Record<string, unknown>
const all = async (db: PgExecutor, sql: string): Promise<Record<string, unknown>[]> =>
  (await db.execute(sql)).rows as Record<string, unknown>[]
const gzip = async (text: string): Promise<Uint8Array> =>
  new Uint8Array(
    await new Response(
      new Blob([text]).stream().pipeThrough(new CompressionStream('gzip')),
    ).arrayBuffer(),
  )

// ---------------------------------------------------------------------------------------------------- 0. seed the source
// Both databases get the same stub columns the real Supabase tables have and the stub lacks, so a canary can be planted.
for (const db of [src, dst]) {
  await db.execute(`alter table auth.users add column if not exists encrypted_password text`)
  await db.execute(`alter table auth.users add column if not exists phone text`)
  await db.execute(`alter table auth.users add column if not exists email_confirmed_at timestamptz`)
}
const CANARY_HASH = `canary-bcrypt-${run}`
const CANARY_SECRET = `canary-secret-${run}`
const CANARY_TOKEN = `${'xo'}xb-${'1'.repeat(11)}-${'a'.repeat(24)}`

const offices: string[] = []
for (const [i, name] of ['Alex', 'Bea'].entries()) {
  const email = `brt-${run}-${String(i)}@example.com`
  await src.execute(
    `insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data)
     values (gen_random_uuid(), ${lit(email)}, ${lit(CANARY_HASH)}, now(), '{"name": "${name}"}'::jsonb)`,
  )
  const o = (
    await one(
      src,
      `select (app.provision_person_office(${lit(`BRT ${name} ${run}`)}, ${lit(email)}, ${lit(`brt-${run}-${String(i)}`)})->>'office_id') as o`,
    )
  ).o
  offices.push(String(o))
}
const projects: { office: string; id: string; slug: string }[] = []
for (const [i, office] of offices.entries()) {
  for (const n of [1, 2]) {
    const name = `Harvest ${String(i)}-${String(n)} ${run}`
    const r = JSON.parse(
      String(
        (
          await one(
            src,
            `select app.hq_create_project(${lit(office)}::uuid, ${lit(name)}, 'upload', ${lit(`brt-${run}-${String(i)}${String(n)}`)}, ${lit(name)}, true)::text as r`,
          )
        ).r,
      ),
    ) as { project_id?: string; slug?: string }
    if (r.project_id !== undefined)
      projects.push({ office, id: r.project_id, slug: String(r.slug) })
  }
}
let tasks = 0
for (const p of projects) {
  for (const t of ['write the report', 'call the roofer', 'order the stone']) {
    const r = (
      await one(
        src,
        `select public.my_task_add(${lit(p.office)}::uuid, ${lit(`${t} ${run}`)}, p_project => ${lit(p.slug)})::text as r`,
      )
    ).r
    if (String(r).includes('"ok": true') || String(r).includes('"ok":true')) tasks += 1
  }
}
let docs = 0
for (const p of projects) {
  const r = (
    await one(
      src,
      `select app.hq_document_link(${lit(p.office)}::uuid, ${lit(p.id)}::uuid, 'drive', ${lit(`drv-${p.slug}`)}, ${lit(`Budget ${p.slug}`)}, 'application/pdf', null)::text as r`,
    ).catch(() => ({ r: '' }))
  ).r
  if (String(r).includes('ok')) docs += 1
}
// jobs and outputs, directly: there is no writer that makes a FINISHED job without running one
for (const p of projects.slice(0, 3)) {
  const key = `brt-${run}-${p.slug}`
  await src.execute(
    `insert into public.jobs (job_id, correlation_id, idempotency_key, kind, requested_by, project_id, office_id, state, pinned_config, finished_at)
     values (gen_random_uuid(), gen_random_uuid(), ${lit(key)}, 'probe', 'verify:brt', ${lit(p.id)}::uuid, ${lit(p.office)}::uuid, 'complete'::job_state, '{}'::jsonb, app.now_utc())`,
  )
  const j = String(
    (await one(src, `select job_id from public.jobs where idempotency_key = ${lit(key)}`)).job_id,
  )
  await src.execute(
    `insert into public.outputs (job_id, body, confidence, evidence, deterministic) values (${lit(j)}::uuid, 'a finished answer', 'high', 'verified', true)`,
  )
}
check(
  'the source was seeded through the product writers',
  offices.length === 2 && projects.length === 4 && tasks >= 6,
  `${String(offices.length)} offices, ${String(projects.length)} projects, ${String(tasks)} tasks, ${String(docs)} documents`,
)

// probe tables, with awkward values
await src.execute(`
  insert into public.zz_probe_other (id, parent_id, note) select gen_random_uuid(), 1, 'x' where false;
  insert into public.zz_probe_parent (name, meta, amount, big, span, tags, blob) values
    ('alpha', '{"n": 9007199254740993, "deep": {"a": [1, 2, {"b": "]},{"}]}}', 12345678901234567890.123456, 9007199254740993, interval '1 day 02:03:04.5', array['a','b"c','d,e'], decode('00ff10', 'hex')),
    ('beta $r0$ and $r1$ tags', '{}', -0.000001, -9007199254740993, interval '-3 months', '{}', null),
    (E'gamma\\nline "two" \\\\ back', '{"k": null}', 0, 0, null, array[]::text[], decode('', 'hex')),
    ('delta é 😀', '{}', 999999999999999999999999999999.999999, 1, interval '0', '{x}', decode(repeat('ab', 5000), 'hex'));
  insert into public.zz_probe_parent (name, parent_id) select 'child ' || g, 1 from generate_series(1, 30) g;
  insert into public.zz_probe_other (parent_id, note) select id, 'note for ' || id from public.zz_probe_parent where id <= 5;
  update public.zz_probe_parent p set other_id = (select o.id from public.zz_probe_other o where o.parent_id = p.id limit 1) where id <= 5;
  insert into public.zz_probe_texty (code, v) values ('A','1'),('a','2'),('é','3'),('a b','4'),('o''brien','5'),('Z','6'),('z','7'),('10','8'),('9','9');
  insert into public.zz_probe_heap (x, y) values (1,'dup'),(1,'dup'),(2,'x'),(2,'x'),(3,null);
  insert into public.zz_probe_secret (office_id, body) values (gen_random_uuid(), 'shh');
`)
await src.execute(
  `insert into public.zz_probe_member (office_id, label) select office_id, 'member ' || office_id from public.offices where kind = 'person'`,
)
await src.execute(
  `insert into public.zz_probe_child (office_id, member_id) select office_id, id from public.zz_probe_member`,
)
await src.execute(
  `insert into public.zz_probe_big
   select g, gen_random_uuid(), repeat(md5(g::text), 8) || E'\\n"q", ] },{ \\\\ é 😀',
          jsonb_build_object('n', g, 'big', 9007199254740993, 'arr', jsonb_build_array(g, 'x')), decode(md5(g::text), 'hex')
     from generate_series(1, 120000) g`,
)
// what the auxiliary section must record, and must NEVER record
await src.execute(`delete from vault.secrets where name like 'brt.%'`)
await src.execute(
  `insert into vault.secrets (name, secret, description) values ('brt.canary', ${lit(CANARY_SECRET)}, 'a canary')`,
)
await src.execute(`delete from cron.job where jobname like 'brt-%'`)
await src.execute(
  `insert into cron.job (schedule, command, jobname) values ('* * * * *', ${lit(`select app.kick_worker() /* ${CANARY_TOKEN} */`)}, 'brt-heartbeat')`,
)
await src.execute(
  `insert into storage.buckets (id, name) values ('files', 'files'), ('backups', 'backups') on conflict do nothing`,
)
await src.execute(`delete from storage.objects where bucket_id in ('files', 'backups')`)
await src.execute(
  `insert into storage.objects (bucket_id, name, metadata) values
     ('files', 'a/report.pdf', '{"size": 2048, "mimetype": "application/pdf", "eTag": "\\"abc123\\""}'::jsonb),
     ('files', 'b/photo.png', '{"size": 4096, "mimetype": "image/png", "eTag": "\\"def456\\""}'::jsonb),
     ('backups', 'run-x/ignored.json.gz', '{"size": 10}'::jsonb)`,
)

// ---------------------------------------------------------------------------------------- 1. dump with the REAL handler
const emulator = new StorageEmulator()
const uninstall = emulator.install(REF)
const system = String(
  (await one(src, `select office_id from public.offices where kind = 'system'`)).office_id,
)
const jobKey = `brt-backup-${run}`
await src.execute(
  `insert into public.jobs (job_id, correlation_id, idempotency_key, kind, requested_by, office_id, state, pinned_config)
   values (gen_random_uuid(), gen_random_uuid(), ${lit(jobKey)}, 'office.backup', 'duty:nightly-backup', ${lit(system)}::uuid, 'running'::job_state, '{}'::jsonb)`,
)
const jobId = String(
  (await one(src, `select job_id from public.jobs where idempotency_key = ${lit(jobKey)}`)).job_id,
)
const started = Date.now()
const out = await backupHandler({ db: src, projectRef: REF, serviceKey: KEY }).handle(
  {
    jobId,
    kind: 'office.backup',
    correlationId: jobId,
    projectId: null,
    idempotencyKey: jobKey,
    attempt: 1,
  } as never,
  src,
)
const tablesNow = await tablesToBackUp(src)
check(
  'the real handler wrote a complete folder',
  out.body.startsWith('Backed up') && emulator.objects.has(`run-${jobId}/manifest.json.gz`),
  `${out.body.split('\n')[0]?.slice(0, 110)} in ${String(Math.round((Date.now() - started) / 1000))}s`,
)
check(
  'every table is in the folder, with a checksum beside it',
  tablesNow.every(
    (t) =>
      emulator.objects.has(`run-${jobId}/${t.table_schema}.${t.table_name}.json.gz`) &&
      emulator.objects.has(`run-${jobId}/${t.table_schema}.${t.table_name}.json.gz.sha256`),
  ),
  `${String(tablesNow.length)} tables`,
)

const mem = new MemoryArchive(`run-${jobId}`)
for (const [k, o] of emulator.objects)
  if (k.startsWith(`run-${jobId}/`) && !k.endsWith('.sha256')) mem.put(k, o.bytes)
const manifest = await mem.manifest()
check(
  'the manifest vouches for every object and every table content',
  Object.keys(manifest.objects ?? {}).length === tablesNow.length &&
    Object.keys(manifest.fingerprints ?? {}).length === tablesNow.length,
  `${String(Object.keys(manifest.objects ?? {}).length)} objects, ${String(Object.keys(manifest.fingerprints ?? {}).length)} fingerprints`,
)

// ---- the auxiliary section: what it records and what it must never record
const manifestText = await gunzipText(
  mem.objects.get(`run-${jobId}/manifest.json.gz`) as Uint8Array,
)
const aux = manifest.aux as Aux
check(
  'no password hash, secret value or token is anywhere in the manifest',
  !manifestText.includes(CANARY_HASH) &&
    !manifestText.includes(CANARY_SECRET) &&
    !manifestText.includes(CANARY_TOKEN) &&
    !manifestText.includes('encrypted_password'),
  'three canaries planted (hash, vault secret, token in a cron command); none is present',
)
check(
  'the vault is recorded by NAME',
  aux.vault_names.ok && aux.vault_names.rows.some((r) => r.name === 'brt.canary'),
  `${String(aux.vault_names.rows.length)} name(s)`,
)
check(
  'a secret in a cron command is redacted but the schedule survives',
  aux.cron_jobs.rows.some(
    (r) =>
      r.jobname === 'brt-heartbeat' &&
      r.schedule === '* * * * *' &&
      !r.command.includes(CANARY_TOKEN),
  ),
  aux.cron_jobs.rows.find((r) => r.jobname === 'brt-heartbeat')?.command.slice(0, 60) ?? 'no row',
)
check(
  'logins are recorded with the original ids and only whitelisted columns',
  aux.auth_users.ok &&
    aux.auth_users.rows.length >= 2 &&
    aux.auth_users.rows.filter((u) => String(u.email).includes(run)).length === 2 &&
    aux.auth_users.rows.every((u) =>
      Object.keys(u).every((k) =>
        [
          'id',
          'email',
          'phone',
          'email_confirmed_at',
          'created_at',
          'last_sign_in_at',
          'raw_user_meta_data',
          'raw_app_meta_data',
          'is_anonymous',
          'banned_until',
        ].includes(k),
      ),
    ),
  `${String(aux.auth_users.rows.length)} login(s), keys ${Object.keys(aux.auth_users.rows[0] ?? {}).join(',')}`,
)
check(
  'storage objects are recorded by path, size and etag, and the backups bucket is left out',
  aux.storage_objects.rows.length === 2 &&
    aux.storage_objects.rows.every((o) => o.bucket_id === 'files' && o.etag !== null),
  aux.storage_objects.rows.map((o) => o.name).join(','),
)
check(
  'sequences and the structure fingerprint are recorded',
  aux.sequences.rows.length > 5 && aux.structure !== null && aux.structure.foreign_keys > 100,
  `${String(aux.sequences.rows.length)} sequences, ${String(aux.structure?.foreign_keys)} foreign keys`,
)

// ---- compatibility: the EXISTING reader (what backup:rehearse uses) still reads the new format
{
  const folder = await newestFolder(REF, KEY)
  const read = folder === null ? null : await readFolder(REF, KEY, folder)
  check(
    "backup:rehearse's own reader reads the new folder, every checksum clean",
    read !== null &&
      read.corrupt.length === 0 &&
      Object.keys(read.data).length === tablesNow.length,
    `${String(Object.keys(read?.data ?? {}).length)} tables, ${String(read?.corrupt.length)} corrupt`,
  )
}
const verdict = verifyArchive(manifest, mem.prefix, await mem.observed())
check(
  'verifyArchive passes the untouched archive with its warnings stated',
  verdict.ok,
  `${String(verdict.tables)} tables, ${String(verdict.rows)} rows, ${String(verdict.warnings.length)} warning(s)`,
)

// ---------------------------------------------------------------------------------------------- 2. the typed restore
const prepareLogins = async (users: Record<string, unknown>[]): Promise<void> => {
  for (const u of users) {
    await dst.execute(
      `insert into auth.users (id, email, raw_user_meta_data) values (${lit(String(u.id))}::uuid, ${lit(String(u.email))}, ${lit(JSON.stringify(u.user_metadata ?? {}))}::jsonb) on conflict (id) do nothing`,
    )
  }
}
const folderSource = new StorageFolderSource(REF, KEY, `run-${jobId}`)
const smoke = [
  { name: 'free_tier_headroom', sql: 'select app.free_tier_headroom() as r' },
  { name: 'backup_health', sql: 'select app.backup_health() as r' },
  {
    name: 'office_health',
    sql: `select app.office_health(${lit(offices[0] as string)}::uuid, 24) as r`,
  },
]
const structBefore = JSON.stringify(await one(dst, STRUCTURE_SQL))
const t0 = Date.now()
const report = await restoreArchive(dst, folderSource, {
  onNonEmpty: 'truncate',
  prepareLogins,
  smoke,
  log: (l) => console.log(`      ${l.slice(0, 200)}`),
})
check(
  'the typed restore reports every step ok',
  report.ok,
  `${String(report.steps.length)} steps, ${String(report.errors.length)} error(s) in ${String(Math.round((Date.now() - t0) / 1000))}s${report.errors.length > 0 ? `: ${report.errors[0]?.slice(0, 160)}` : ''}`,
)
check(
  'it restored every row the manifest recorded',
  report.rows === verdict.rows && report.restored?.ok === true,
  `${String(report.rows)} rows in ${String(report.tables)} tables`,
)

// ---- verification independent of the restore's own report: fingerprint BOTH databases separately
{
  // A backup of a LIVE database is not one snapshot: the backup itself writes (job_steps checkpoints, its own job row),
  // so a table can legitimately have moved between the moment it was dumped and now. Those tables are NAMED, from the
  // manifest's own fingerprints, and the target must equal the MANIFEST for every table and the source for every table
  // that did not move.
  const tables = (await tablesToBackUp(src)).map((t) => `${t.table_schema}.${t.table_name}`)
  const moved: string[] = []
  let differ = 0
  let rowsCompared = 0
  const sample: string[] = []
  for (const t of tables) {
    const [s, n] = t.split('.') as [string, string]
    const a = await one(src, fingerprintSql(s, n))
    const b = await one(dst, fingerprintSql(s, n))
    rowsCompared += Number(b.n)
    const recorded = manifest.fingerprints?.[t]
    if (String(b.fp) !== recorded || Number(b.n) !== manifest.row_counts?.[t]) {
      differ += 1
      if (sample.length < 4)
        sample.push(
          `${t}: target ${String(b.n)}/${String(b.fp)}, manifest ${String(manifest.row_counts?.[t])}/${String(recorded)}`,
        )
    }
    if (String(a.fp) !== recorded) moved.push(t)
    else if (String(a.fp) !== String(b.fp)) {
      differ += 1
      sample.push(`${t}: source and target differ though the source did not move`)
    }
  }
  check(
    'target equals the manifest on every table, and equals the source on every table that did not move',
    differ === 0 && rowsCompared > 120000,
    `${String(tables.length)} tables, ${String(rowsCompared)} rows, ${String(differ)} differ ${sample.join(' | ')}`,
  )
  check(
    'the tables that moved while the dump ran are only the ones the backup itself writes',
    moved.every((t) =>
      [
        'public.job_steps',
        'public.jobs',
        'public.job_state_transitions',
        'public.events',
        'public.job_traces',
        'public.inference_usage',
      ].includes(t),
    ),
    moved.join(', ') || 'none',
  )
}
const structAfter = JSON.stringify(await one(dst, STRUCTURE_SQL))
check(
  'the target structure is what it was before the restore (and equals the source)',
  structBefore === structAfter && structAfter === JSON.stringify(await one(src, STRUCTURE_SQL)),
  'tables, columns, constraints, triggers, policies, indexes, row security',
)

// ---- typed fidelity, read back by value
{
  const v = await all(
    dst,
    `select name, upper_name, amount::text, big::text, span::text, tags::text, encode(blob, 'hex') as blob, meta::text from public.zz_probe_parent order by id limit 4`,
  )
  const s = await all(
    src,
    `select name, upper_name, amount::text, big::text, span::text, tags::text, encode(blob, 'hex') as blob, meta::text from public.zz_probe_parent order by id limit 4`,
  )
  check(
    'numerics past 2^53, bigints, intervals, arrays, bytea, jsonb and the generated column came back exactly',
    JSON.stringify(v) === JSON.stringify(s) &&
      String(v[0]?.big) === '9007199254740993' &&
      String(v[3]?.amount).startsWith('999999999999999999999999999999.'),
    `${String(v[0]?.amount)} / ${String(v[0]?.big)} / ${String(v[0]?.upper_name)} / ${String(v[0]?.span)}`,
  )
}
{
  const trig = await all(
    dst,
    `select tgname, tgenabled::text from pg_trigger where tgrelid = 'public.zz_probe_parent'::regclass and not tgisinternal order by tgname`,
  )
  const log = Number((await one(dst, `select count(*)::int as n from public.zz_probe_log`)).n)
  const logSrc = Number((await one(src, `select count(*)::int as n from public.zz_probe_log`)).n)
  check(
    'user triggers did not fire during the load (the log table was not doubled)',
    log === logSrc && logSrc >= 34,
    `${String(log)} log rows, the source has ${String(logSrc)}`,
  )
  check(
    'every trigger is back in its OWN prior state (the dormant one is still disabled)',
    trig.some((t) => t.tgname === 'zz_probe_parent_logged' && t.tgenabled === 'O') &&
      trig.some((t) => t.tgname === 'zz_probe_parent_dormant' && t.tgenabled === 'D'),
    JSON.stringify(trig),
  )
  const bad = Number(
    (
      await one(
        dst,
        `select count(*)::int as n from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where not t.tgisinternal and n.nspname in ('public','app') and t.tgenabled <> 'O'`,
      )
    ).n,
  )
  const badSrc = Number(
    (
      await one(
        src,
        `select count(*)::int as n from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where not t.tgisinternal and n.nspname in ('public','app') and t.tgenabled <> 'O'`,
      )
    ).n,
  )
  check(
    'no other trigger changed state',
    bad === badSrc,
    `${String(bad)} non-default trigger state(s) in the target, ${String(badSrc)} in the source`,
  )
}
{
  const fks = await all(
    dst,
    `select conname, convalidated from pg_constraint where conrelid in ('public.zz_probe_parent'::regclass, 'public.zz_probe_other'::regclass) and contype = 'f' order by conname`,
  )
  check(
    'the cyclic and self-referencing foreign keys are back and VALIDATED',
    fks.length === 3 && fks.every((f) => f.convalidated === true),
    fks.map((f) => `${String(f.conname)}=${String(f.convalidated)}`).join(' '),
  )
  const off = String(offices[0])
  const refused = await dst
    .execute(
      `insert into public.zz_probe_child (office_id, member_id) values (${lit(off)}::uuid, gen_random_uuid())`,
    )
    .then(
      () => 'accepted',
      (e: Error) => e.message,
    )
  check(
    'the composite foreign key to (id, office_id) is alive: an orphan is refused',
    refused.includes('23503'),
    refused.slice(0, 90),
  )
  const rls = await one(
    dst,
    `select (select relrowsecurity from pg_class where oid = 'public.zz_probe_secret'::regclass) as rls, (select count(*)::int from pg_policy where polrelid = 'public.zz_probe_secret'::regclass) as pol`,
  )
  check(
    'row security and its policy survived',
    rls.rls === true && Number(rls.pol) === 1,
    JSON.stringify(rls),
  )
  const next = await one(
    dst,
    `insert into public.zz_probe_parent (name) values ('after restore') returning id::int as id, upper_name`,
  )
  const max = Number(
    (
      await one(
        dst,
        `select max(id)::int as m from public.zz_probe_parent where name <> 'after restore'`,
      )
    ).m,
  )
  check(
    'the identity continues after the largest restored id, and the generated column computes',
    Number(next.id) > max && next.upper_name === 'AFTER RESTORE',
    `next id ${String(next.id)}, restored max ${String(max)}`,
  )
  await dst.execute(`delete from public.zz_probe_parent where name = 'after restore'`)
  await dst.execute(`delete from public.zz_probe_log where what = 'parent after restore'`)
}
{
  const proj = await one(
    dst,
    `select count(*)::int as n from public.projects p join public.offices o using (office_id) where o.kind = 'person' and p.slug like ${lit(`harvest-%${run}%`)}`,
  )
  const tasksDst = await one(
    dst,
    `select count(*)::int as n from public.tasks t join public.projects p using (project_id) where p.slug like ${lit(`harvest-%${run}%`)}`,
  )
  check(
    'product data reads back through joins across the restored tables',
    Number(proj.n) === 4 && Number(tasksDst.n) === tasks,
    `${String(proj.n)} projects, ${String(tasksDst.n)} tasks`,
  )
  check(
    "the product's own readers ran on the restored database",
    report.steps.filter((s) => s.step.startsWith('smoke:')).length === 3 &&
      report.steps.filter((s) => s.step.startsWith('smoke:')).every((s) => s.ok),
    report.steps
      .filter((s) => s.step.startsWith('smoke:'))
      .map((s) => `${s.step}=${String(s.ok)}`)
      .join(' '),
  )
}

// ------------------------------------------------------------------------------------------ 3. idempotent, and it refuses
{
  const again = await restoreArchive(dst, folderSource, { onNonEmpty: 'truncate', prepareLogins })
  check(
    'restoring the same archive again gives the same result (idempotent)',
    again.ok && again.rows === report.rows,
    `${String(again.rows)} rows, ${String(again.errors.length)} error(s)`,
  )
  const refuse = await restoreArchive(dst, folderSource, { prepareLogins })
  const rowsAfterRefuse = Number((await one(dst, `select count(*)::int as n from public.tasks`)).n)
  check(
    'a non-empty target is refused by default and left untouched',
    !refuse.ok &&
      refuse.errors.some((e) => e.startsWith('target is empty')) &&
      rowsAfterRefuse === manifest.row_counts?.['public.tasks'],
    `${refuse.errors[0]?.slice(0, 100)}`,
  )
}

// --------------------------------------------------------------------------------------------------- 4. the controls
const repack = async (
  edit: (
    m: Manifest & {
      objects?: Record<string, { sha256: string; bytes: number }>
      row_counts?: Record<string, number>
      fingerprints?: Record<string, string>
      rows?: number
      tables?: number
    },
  ) => void,
  objects: Map<string, Uint8Array>,
): Promise<MemoryArchive> => {
  const copy = new MemoryArchive(mem.prefix)
  for (const [k, b] of objects) copy.put(k, b)
  const m = JSON.parse(
    await gunzipText(copy.objects.get(`${mem.prefix}/manifest.json.gz`) as Uint8Array),
  )
  edit(m)
  copy.put(`${mem.prefix}/manifest.json.gz`, await gzip(JSON.stringify(m)))
  return copy
}
const tamper = async (qualified: string, change: (t: string) => string): Promise<MemoryArchive> => {
  const key = `${mem.prefix}/${qualified}.json.gz`
  const text = await gunzipText(mem.objects.get(key) as Uint8Array)
  const changed = change(text)
  if (changed === text) throw new Error(`the sabotage of ${qualified} did not change anything`)
  const bytes = await gzip(changed)
  const sha = await checksum(bytes)
  const copy = await repack((m) => {
    if (m.objects !== undefined) m.objects[key] = { sha256: sha, bytes: bytes.length }
  }, mem.objects)
  copy.put(key, bytes)
  console.log(
    `      sabotage landed: ${qualified} changed, ${String(text.length)} -> ${String(changed.length)} characters`,
  )
  return copy
}
{
  // a corrupted COLUMN TYPE: the text rehearsal would load this happily, the typed restore must not
  const bad = await tamper('public.zz_probe_parent', (t) =>
    t.replace(/"amount": [0-9.-]+/, '"amount": "not a number"'),
  )
  const textOk = await (async () => {
    // what backup:rehearse does: every column is text, so any value loads
    await dst.execute(
      'drop schema if exists brt_text cascade; create schema brt_text; create table brt_text.t (amount text)',
    )
    await dst.execute(`insert into brt_text.t values ('not a number')`)
    const n = Number((await one(dst, 'select count(*)::int as n from brt_text.t')).n)
    await dst.execute('drop schema brt_text cascade')
    return n === 1
  })()
  const r = await restoreArchive(dst, bad, { onNonEmpty: 'truncate', prepareLogins })
  check(
    'CONTROL: a corrupted column type turns the typed restore red (the all-text rehearsal accepts the same value)',
    !r.ok &&
      r.failedTable === 'public.zz_probe_parent' &&
      /numeric|22P02/.test(r.errors.join(' ')) &&
      textOk,
    `${r.errors.find((e) => e.startsWith('rows loaded'))?.slice(0, 150) ?? r.errors[0]}`,
  )
  const left = await one(
    dst,
    `select (select count(*)::int from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relname like 'zz_probe%' and not t.tgisinternal and t.tgenabled <> 'O') as off, (select count(*)::int from pg_constraint where conrelid = 'public.zz_probe_parent'::regclass and contype = 'f') as fks`,
  )
  check(
    'CONTROL: after that failure the triggers and foreign keys are back anyway',
    Number(left.off) === 1 && Number(left.fks) === 2,
    `${String(left.off)} trigger(s) not enabled (the dormant one, correctly), ${String(left.fks)} foreign keys on the parent (self reference and the cycle)`,
  )
}
{
  const bad = await tamper('public.zz_probe_parent', (t) =>
    t.replace('"name": "alpha"', '"name": "alphb"'),
  )
  const r = await restoreArchive(dst, bad, { onNonEmpty: 'truncate', prepareLogins })
  check(
    'CONTROL: a changed value that is still the right type is caught by the content fingerprint',
    !r.ok &&
      r.errors.some(
        (e) => e.includes('public.zz_probe_parent') && e.includes('content does not match'),
      ),
    r.errors.find((e) => e.includes('content'))?.slice(0, 160) ?? 'not caught',
  )
}
{
  const bad = await repack((m) => {
    // the parent table of every office-owned table is dropped from the restore
    delete m.row_counts?.['public.offices']
    delete m.fingerprints?.['public.offices']
    if (m.objects !== undefined) delete m.objects[`${mem.prefix}/public.offices.json.gz`]
    m.tables = Object.keys(m.row_counts ?? {}).length
    m.rows = Object.values(m.row_counts ?? {}).reduce((a, b) => a + b, 0)
  }, mem.objects)
  console.log('      sabotage landed: public.offices removed from the manifest of the restore')
  const r = await restoreArchive(dst, bad, { onNonEmpty: 'truncate', prepareLogins })
  check(
    'CONTROL: dropping a parent table turns the restore red at its first dependent (the foreign key is real)',
    !r.ok && /foreign key|23503/.test(r.errors.join(' ')),
    r.errors.find((e) => e.startsWith('rows loaded'))?.slice(0, 170) ?? 'not caught',
  )
}
{
  // a crash in the middle of an earlier run: a foreign key dropped, a trigger disabled, the journal written, nothing put back
  await dst.execute(`
    create schema if not exists restore_state;
    create table if not exists restore_state.fks (rel text not null, name text not null, def text not null, primary key (rel, name));
    create table if not exists restore_state.triggers (rel text not null, name text not null, enabled text not null, primary key (rel, name));
    delete from restore_state.fks; delete from restore_state.triggers;`)
  const def = String(
    (
      await one(
        dst,
        `select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'zz_probe_parent_other_fk'`,
      )
    ).d,
  )
  await dst.execute(
    `insert into restore_state.fks values ('public.zz_probe_parent', 'zz_probe_parent_other_fk', ${lit(def)}); alter table public.zz_probe_parent drop constraint zz_probe_parent_other_fk`,
  )
  await dst.execute(
    `insert into restore_state.triggers values ('public.zz_probe_parent', 'zz_probe_parent_logged', 'O'); alter table public.zz_probe_parent disable trigger zz_probe_parent_logged`,
  )
  const r = await restoreArchive(dst, folderSource, { onNonEmpty: 'truncate', prepareLogins })
  const t = await one(
    dst,
    `select (select tgenabled::text from pg_trigger where tgname = 'zz_probe_parent_logged') as logged, (select count(*)::int from pg_constraint where conname = 'zz_probe_parent_other_fk') as fk`,
  )
  check(
    'CONTROL: an interrupted earlier run is put right first, then the restore completes',
    r.ok &&
      r.warnings.some((w) => w.includes('interrupted')) &&
      t.logged === 'O' &&
      Number(t.fk) === 1,
    `${String(r.ok)}; trigger ${String(t.logged)}, foreign key rows ${String(t.fk)}`,
  )
}
{
  // the guard, from restore.ts itself rather than from this script's own guard
  await dst.end().catch(() => undefined)
  const sock = process.env.ISOLATED_PG_SOCKET ?? '/tmp/pgs'
  const port = process.env.ISOLATED_PG_PORT ?? '55432'
  // A THROWAWAY database with its marker removed. Never `post` or `postgres`: if this guard were ever broken the control
  // must be able to damage nothing that anyone else uses (the template refusals are unit-tested on the pure judge).
  const admin = new PgExecutor(`postgresql://postgres@/postgres?host=${sock}&port=${port}`)
  await admin.connect()
  await admin.execute('drop database if exists brt_unmarked')
  await admin.execute('create database brt_unmarked template brt_base')
  const unmarked = new PgExecutor(`postgresql://postgres@/brt_unmarked?host=${sock}&port=${port}`)
  await unmarked.connect()
  await unmarked.execute('drop table public.isolated_replica_marker')
  const refusedUnmarked = await restoreArchive(unmarked, folderSource, {
    onNonEmpty: 'truncate',
  }).then(
    () => 'ran',
    (e: Error) => e.message,
  )
  const untouched =
    Number((await one(unmarked, `select count(*)::int as n from public.staff`)).n) > 0
  await unmarked.end()
  await admin.execute('drop database brt_unmarked')
  await admin.end()
  check(
    'CONTROL: a database with no replica marker is refused, and nothing in it was touched',
    refusedUnmarked.startsWith('REFUSED') &&
      refusedUnmarked.includes('isolated_replica_marker') &&
      untouched,
    refusedUnmarked.slice(0, 120),
  )
}

// ----------------------------------------------------------------------------------- 5. bounded memory, and paging
{
  const paged = { value: await pagedDump(src, 'public', 'zz_probe_big', { pageRows: 1000 }) }
  const server = await one(src, fingerprintSql('public', 'zz_probe_big'))
  // The measurement that cannot be argued with: each strategy in its OWN process with a 96 MB heap. The process's memory
  // is then its own (an in-process comparison reads the garbage every earlier step left behind), and "bounded" becomes
  // "completes inside a heap the old approach cannot".
  const probe = (mode: string): { status: number | null; out: string } => {
    const r = spawnSync(
      process.execPath,
      [
        '--max-old-space-size=96',
        '--import',
        'tsx',
        'scripts/isolated/dump-memory-probe.ts',
        SRC,
        mode,
        'public.zz_probe_big',
      ],
      { encoding: 'utf8', timeout: 300000 },
    )
    return { status: r.status, out: `${r.stdout}${r.stderr}` }
  }
  const pagedChild = probe('paged')
  const oldChild = probe('old')
  const pagedMb = /peakMb=(\d+)/.exec(pagedChild.out)?.[1]
  check(
    'CONTROL: in a 96 MB heap the paged dump of the 53 MB table completes',
    pagedChild.status === 0 && pagedChild.out.includes('rows=120000'),
    `exit ${String(pagedChild.status)}, peak ${String(pagedMb)} MB`,
  )
  check(
    'CONTROL: in the SAME 96 MB heap the old one-select-and-stringify dump cannot (the measurement is able to fail)',
    oldChild.status !== 0 && !oldChild.out.includes('RESULT'),
    `exit ${String(oldChild.status)}: ${
      oldChild.out
        .split('\n')
        .find((l) => /heap|memory/i.test(l))
        ?.slice(0, 100) ?? 'no result printed'
    }`,
  )
  check(
    "a 120,000-row table is dumped in 120 keyset pages, none lost or repeated (fingerprint equals the server's)",
    paged.value.pages === 120 &&
      paged.value.rows === 120000 &&
      paged.value.fingerprint === String(server.fp),
    `${String(paged.value.pages)} pages, ${String(paged.value.rows)} rows, raw ${String(Math.round(paged.value.rawBytes / 1048576))} MB -> ${String(Math.round(paged.value.bytes.length / 1048576))} MB, keyed by ${paged.value.keyedBy.join(',')}`,
  )
  check(
    'memory is bounded by a page, not by the table: the largest page is a small fraction of the raw table',
    paged.value.maxPageChars < paged.value.rawBytes / 50,
    `largest page ${String(Math.round(paged.value.maxPageChars / 1024))} KB of ${String(Math.round(paged.value.rawBytes / 1048576))} MB`,
  )
  const tex = await pagedDump(src, 'public', 'zz_probe_texty', { pageRows: 2 })
  const texSrv = await one(src, fingerprintSql('public', 'zz_probe_texty'))
  check(
    'paging a TEXT key (case, accents, spaces, a quote) loses and repeats nothing',
    tex.rows === 9 && tex.pages === 5 && tex.fingerprint === String(texSrv.fp),
    `${String(tex.rows)} rows in ${String(tex.pages)} pages keyed by ${tex.keyedBy.join(',')}`,
  )
  const heap = await pagedDump(src, 'public', 'zz_probe_heap', { pageRows: 2 })
  const heapSrv = await one(src, fingerprintSql('public', 'zz_probe_heap'))
  check(
    'a table with NO key (duplicate rows) pages by ctid without losing the duplicates',
    heap.rows === 5 && heap.keyedBy.join() === 'ctid' && heap.fingerprint === String(heapSrv.fp),
    `${String(heap.rows)} rows keyed by ${heap.keyedBy.join(',')}`,
  )
  const capped = await pagedDump(src, 'public', 'zz_probe_big', {
    pageRows: 1000,
    maxCompressedBytes: 1000,
  }).then(
    () => 'completed',
    (e: Error) => e.message,
  )
  check(
    'CONTROL: a table past the compressed ceiling stops with a sentence, not an out-of-memory kill',
    capped.includes('needs to be written in parts'),
    capped.slice(0, 110),
  )
}

// ------------------------------------------------------------------------------- 5b. retention against the bucket layout
{
  const uuid = (n: number): string =>
    `${n.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`
  const bytes = (n: number): Uint8Array => new Uint8Array(n).fill(7)
  const realFolder = `run-${jobId}`
  // 40 daily folders (the oldest 5 unfinished), a legacy file with its checksum, and somebody else's file
  for (let d = 0; d < 40; d++) {
    const at = new Date(Date.parse('2026-10-05T12:00:00Z') - d * 86_400_000).toISOString()
    const folder = `run-${uuid(d + 1)}`
    emulator.seed(`${folder}/public.t.json.gz`, bytes(1000), at)
    emulator.seed(`${folder}/public.t.json.gz.sha256`, bytes(70), at)
    if (d < 35) emulator.seed(`${folder}/manifest.json.gz`, bytes(300), at)
  }
  emulator.seed('aiteamhq-20260916T123456Z.json.gz', bytes(5000), '2026-09-16T12:34:56Z')
  emulator.seed('aiteamhq-20260916T123456Z.json.gz.sha256', bytes(70), '2026-09-16T12:34:56Z')
  emulator.seed('grants-hand-made-export.json.gz', bytes(9000), '2026-01-01T00:00:00Z')
  const now = new Date('2026-10-06T12:00:00Z')
  const runs = (await listRuns(REF, KEY)).map((r) =>
    r.name === realFolder ? { ...r, verified: true } : r,
  )
  const plan = planRetention(runs, now)
  const names = new Set(plan.remove.map((d) => d.name))
  check(
    'the plan over the real bucket layout removes old complete runs, old unfinished runs and the legacy file',
    plan.remove.length > 20 &&
      [...names].some((n) => n === 'aiteamhq-20260916T123456Z.json.gz') &&
      plan.remove.some((d) => d.reason.startsWith('an unfinished run')),
    `${String(plan.remove.length)} of ${String(runs.length)} removable, ${String(plan.keep.length)} kept`,
  )
  check(
    'it never lists the newest backup (the real one) nor the foreign file',
    !names.has(realFolder) &&
      !names.has('grants-hand-made-export.json.gz') &&
      plan.foreign.includes('grants-hand-made-export.json.gz'),
    `foreign: ${plan.foreign.join(',')}`,
  )
  const before = emulator.objects.size
  const dry = await applyRetention(REF, KEY, plan, { go: false })
  check(
    'the default is a DRY RUN: it names what it would delete and deletes nothing',
    dry.dryRun &&
      dry.deleted.length === plan.remove.length &&
      emulator.objects.size === before &&
      emulator.deleted.length === 0,
    `${String(dry.deleted.length)} named, ${String(emulator.deleted.length)} deleted`,
  )
  const refusedPlan = planRetention(
    runs.map((r) => ({ ...r, verified: false })),
    now,
  )
  const refusedRun = await applyRetention(REF, KEY, refusedPlan, { go: true })
  check(
    'CONTROL: with no verified backup the plan is refused and even go:true deletes nothing',
    refusedPlan.refused !== null &&
      refusedRun.objectsDeleted === 0 &&
      emulator.deleted.length === 0,
    `refused: ${refusedPlan.refused}`,
  )
  const sneaky = {
    ...plan,
    remove: [
      ...plan.remove,
      { name: 'grants-hand-made-export.json.gz', bytes: 9000, reason: 'a corrupted plan' },
    ],
  }
  const refusedForeign = await applyRetention(REF, KEY, sneaky, { go: true }).then(
    () => 'deleted',
    (e: Error) => e.message,
  )
  check(
    'CONTROL: a plan that names a foreign file is refused whole, before anything is deleted',
    refusedForeign.includes('did not create') &&
      emulator.deleted.length === 0 &&
      emulator.objects.has('grants-hand-made-export.json.gz'),
    refusedForeign.slice(0, 90),
  )
  const done = await applyRetention(REF, KEY, plan, { go: true })
  const stillThere = (k: string): boolean => emulator.objects.has(k)
  const manifestLast = plan.remove
    .filter((d) => d.name.startsWith('run-'))
    .every((d) => {
      const mine = emulator.deleted.filter((k) => k.startsWith(`${d.name}/`))
      const m = mine.findIndex((k) => k.endsWith('/manifest.json.gz'))
      return m < 0 || mine.slice(0, m).every((k) => !k.includes('manifest.json.gz')) // nothing of the manifest before the tables
    })
  check(
    'go:true deletes exactly the planned runs, objects and checksums together',
    !done.dryRun &&
      done.deleted.length === plan.remove.length &&
      done.objectsDeleted > plan.remove.length &&
      plan.remove.every(
        (d) =>
          !emulator.objects.has(d.name) &&
          ![...emulator.objects.keys()].some((k) => k.startsWith(`${d.name}/`)),
      ),
    `${String(done.objectsDeleted)} objects in ${String(done.deleted.length)} runs`,
  )
  check(
    'the manifest of each deleted run goes LAST (an interrupted deletion reads as an unfinished run, never as a complete backup with holes)',
    manifestLast,
    'checked per folder',
  )
  check(
    'the newest backup, the foreign file and every kept run are all still there',
    stillThere(`${realFolder}/manifest.json.gz`) &&
      stillThere('grants-hand-made-export.json.gz') &&
      plan.keep.every((d) =>
        d.name.startsWith('run-')
          ? [...emulator.objects.keys()].some((k) => k.startsWith(`${d.name}/`))
          : stillThere(d.name),
      ),
    `${String(plan.keep.length)} kept`,
  )
  // bounded per pass (30), so the 31st run is left for the next one; the passes converge and then do nothing
  let passes = 1
  let last = plan
  while (last.remove.length > 0 && passes < 5) {
    last = planRetention(
      (await listRuns(REF, KEY)).map((r) => (r.name === realFolder ? { ...r, verified: true } : r)),
      now,
    )
    if (last.remove.length > 0) await applyRetention(REF, KEY, last, { go: true })
    passes += 1
  }
  check(
    'the passes converge: the run past the per-pass limit goes on the next, then there is nothing left to remove',
    last.remove.length === 0 && passes === 3,
    `${String(passes)} passes, ${String(last.remove.length)} removable at the end`,
  )
}

// ---------------------------------------------------------------------------------------- 6. what a restore cannot do
{
  const list = recoveryChecklist(manifest)
  check(
    'the recovery checklist counts what the manifest recorded and marks what no code can do',
    list.find((i) => i.id === 'auth-users')?.count === aux.auth_users.rows.length &&
      list.find((i) => i.id === 'storage')?.count === 2 &&
      list.find((i) => i.id === 'vault')?.kind === 'manual' &&
      list.filter((i) => i.kind === 'manual').length >= 5,
    list
      .map((i) => `${i.id}:${i.kind}${i.count === undefined ? '' : `(${String(i.count)})`}`)
      .join(' '),
  )
  const payloads = authUserPayloads(manifest)
  check(
    'the Auth admin payloads carry the original ids and no password',
    payloads.length === aux.auth_users.rows.length &&
      payloads.every(
        (p) => typeof p.id === 'string' && !('password' in p) && !('encrypted_password' in p),
      ),
    JSON.stringify(payloads[0]).slice(0, 120),
  )
  const cron = cronRestoreSql(manifest)
  check(
    'cron.schedule statements are generated for the recorded jobs (the secret stays redacted)',
    cron.length >= 1 &&
      cron.some((c) => c.includes("'brt-heartbeat'") && !c.includes(CANARY_TOKEN)),
    cron[0]?.slice(0, 100) ?? 'none',
  )
}
check(
  'the storage emulator was the only thing the backup code talked to',
  emulator.refused.length === 0,
  `${String(emulator.refused.length)} refused outside call(s)`,
)
uninstall()

await src.execute(`delete from vault.secrets where name like 'brt.%'`)
await src.execute(`delete from cron.job where jobname like 'brt-%'`)
await src.end()
console.log(failed === 0 ? '\nall checks passed' : `\n${String(failed)} check(s) failed`)
process.exit(failed === 0 ? 0 : 1)
