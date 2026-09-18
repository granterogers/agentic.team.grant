/**
 * Restore the newest backup into a scratch schema and check what came back.
 *
 *   npm run backup:rehearse
 *
 * §16: *"A backup feature is incomplete until restoration is tested."* Not
 * "until a restore command exists" — until it has been run and the result
 * checked. This is that run.
 *
 * ## What it actually proves
 *
 * It downloads the newest archive from the private bucket, verifies its
 * checksum against the one stored beside it, decompresses it, and then LOADS
 * the rows — into `restore_rehearsal`, a scratch schema created for the purpose
 * and dropped at the end. Loading is the part that matters: a JSON file that
 * parses is not the same as a JSON file whose rows go back into columns of the
 * right type.
 *
 * Then it compares row counts, table by table, against the live database.
 * Small drifts are expected and reported rather than failed — the archive was
 * taken minutes or hours ago and the office has been working since — so what
 * fails is a table MISSING from the archive, or one that loads short of what
 * the archive itself claims to contain.
 *
 * ## What it does not prove, and says so
 *
 * The schema. This archive carries rows and a column listing, not DDL: a real
 * restore applies the migrations from git first. So the rehearsal creates its
 * scratch tables from the archive's own column list, with every column as
 * `text`, and what it demonstrates is that the DATA survived a round trip.
 * Claiming more than that would be the kind of green check this codebase keeps
 * finding underneath a real defect.
 *
 * ## What it deletes
 *
 * One schema, `restore_rehearsal`, which it created seconds earlier and which
 * has never held anything but copies. Nothing else, ever — and in particular no
 * archive: retention is Grant's decision, not a script's.
 */

import {
  checksum,
  downloadArchive,
  listArchives,
  newestFolder,
  readArchive,
  readFolder,
  tablesToBackUp,
} from '../../src/backup/portable.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

const supabase = process.env.SUPABASE_ACCESS_TOKEN
if (supabase === undefined || supabase === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const db = new ManagementApiExecutor(ref, supabase)

const checks: { what: string; outcome: string; passed: boolean }[] = []
const record = (what: string, outcome: string, passed: boolean): void => {
  checks.push({ what, outcome, passed })
  console.log(`${passed ? '✅' : '❌'} ${what} — ${outcome}`)
}

const SCRATCH = 'restore_rehearsal'

const serviceKey = String(
  (
    await db.execute(
      `select coalesce(decrypted_secret, '') as k from vault.decrypted_secrets
        where name = 'supabase.service_role_key'`,
    )
  ).rows[0]?.k ?? '',
)
if (serviceKey === '') {
  console.error(
    'no `supabase.service_role_key` in the vault, so the bucket cannot be read.\n' +
      'Store it first — the backup handler needs the same key to write.',
  )
  process.exit(2)
}

/*
  A FOLDER backup first, a legacy single file second (0492).

  The nightly backup stopped being one 52MB object and became one gzipped
  object per table plus a manifest, because the single build took 148 seconds
  and an edge function does not get that long — the job's own history is five
  ticks of `worker died holding this in running` and then `5 attempts
  exhausted`, with the last complete backup on 16 September.

  The fallback is not politeness: the single files already in the bucket are
  real backups of a real office and this rehearsal is what says they can be
  restored. It goes when they age out, not before.
*/
const folder = await newestFolder(ref, serviceKey)
const legacy = (await listArchives(ref, serviceKey)).filter(
  (o) => !o.name.includes('/') && o.name.endsWith('.json.gz'),
)
record(
  'there is a backup to restore from',
  folder !== null
    ? `folder ${folder.prefix}, ${String(folder.tables.length)} table object(s)`
    : legacy.length === 0
      ? 'the bucket is empty'
      : `${String(legacy.length)} legacy archive(s), no folder backup yet`,
  folder !== null || legacy.length > 0,
)
if (folder === null && legacy.length === 0) process.exit(1)

let archive: {
  data?: Record<string, unknown[]>
  row_counts?: Record<string, number>
  schema?: { t: string; column_name: string }[]
  latest_migration?: string
}

if (folder !== null) {
  const read = await readFolder(ref, serviceKey, folder)
  record(
    'every object in it is the one that was written, byte for byte',
    read.corrupt.length === 0
      ? `${String(folder.tables.length + 1)} object(s) checksum clean`
      : `CORRUPT: ${read.corrupt.slice(0, 4).join(', ')}`,
    read.corrupt.length === 0,
  )
  record(
    'it decompresses into something with tables in it',
    `${String(Object.keys(read.data).length)} table(s), taken at migration ${read.latest_migration}`,
    Object.keys(read.data).length > 0,
  )
  archive = read
} else {
  // Newest by name, which sorts correctly because the legacy stamp is ISO
  // without separators.
  const newest = [...legacy].sort((a, b) => b.name.localeCompare(a.name))[0]
  if (newest === undefined) process.exit(1)
  const bytes = await downloadArchive(ref, serviceKey, newest.name)
  record(
    'the newest one downloads',
    `${newest.name}, ${String(Math.round(bytes.length / 1024))}KB`,
    bytes.length > 0,
  )
  const stated = await downloadArchive(ref, serviceKey, `${newest.name}.sha256`)
    .then((b) => new TextDecoder().decode(b).trim().split(/\s+/)[0] ?? '')
    .catch(() => '')
  const actual = await checksum(bytes)
  record(
    'it is the file that was written, byte for byte',
    stated === '' ? 'no checksum was stored beside it' : `${actual.slice(0, 16)}…`,
    stated !== '' && stated === actual,
  )
  archive = (await readArchive(bytes)) as typeof archive
  record(
    'it decompresses into something with tables in it',
    `${String(Object.keys(archive.data ?? {}).length)} table(s), taken at migration ` +
      `${String(archive.latest_migration)}`,
    Object.keys(archive.data ?? {}).length > 0,
  )
}

const data = archive.data ?? {}
const tables = Object.keys(data)
record(
  'it decompresses into something with tables in it',
  `${String(tables.length)} table(s), taken at migration ${String(archive.latest_migration)}`,
  tables.length > 0,
)

/*
  Two different questions, which the first version of this check confused.

  **Would tonight's backup cover everything?** That is about the BUILDER, and it
  is the defect worth catching — a table quietly excluded is invisible until
  somebody needs it back. Asked of `tablesToBackUp`, the same function the
  builder uses, so the answer cannot drift from the behaviour.

  **Does the stored archive contain everything that exists now?** It cannot, and
  should not be expected to: any migration that adds a table between the last
  nightly run and this check leaves the archive legitimately behind.
  `project_aliases` (0153) tripped exactly that and was reported as a missing
  table, which is the wrong defect — and worse, a check that fails for a routine
  reason is a check people learn to ignore, hiding the real one.

  So the first is asserted and the second is reported.
*/
const live = (
  await db.execute(`
    select table_schema || '.' || table_name as t
      from information_schema.tables
     where table_schema in ('public', 'app') and table_type = 'BASE TABLE'
  `)
).rows.map((r) => String(r.t))

const wouldCover = (await tablesToBackUp(db)).map((t) => `${t.table_schema}.${t.table_name}`)
const skipped = live.filter((t) => !wouldCover.includes(t))
record(
  'the next backup would contain every table in the database',
  skipped.length === 0
    ? `${String(live.length)} table(s), none skipped`
    : `WOULD SKIP: ${skipped.slice(0, 6).join(', ')}`,
  skipped.length === 0,
)

const newer = live.filter((t) => !tables.includes(t))
record(
  'and the stored copy is either current or honestly behind',
  newer.length === 0
    ? `current — all ${String(live.length)} tables present`
    : `${String(newer.length)} table(s) created since it was taken (${newer.slice(0, 4).join(', ')}) — ` +
        "tonight's run picks them up",
  // Never a failure. The archive being older than the schema is what an archive
  // IS; the only thing that would make it one is the builder skipping a table,
  // which is the check above.
  true,
)

// --- and now actually load it ----------------------------------------------

const columnsFor = new Map<string, string[]>()
for (const c of archive.schema ?? []) {
  const list = columnsFor.get(c.t) ?? []
  list.push(c.column_name)
  columnsFor.set(c.t, list)
}

await db.execute(`drop schema if exists ${SCRATCH} cascade`)
await db.execute(`create schema ${SCRATCH}`)

let loaded = 0
let attempted = 0
const failures: string[] = []
try {
  for (const qualified of tables) {
    const rows = data[qualified] ?? []
    if (rows.length === 0) continue
    const columns = columnsFor.get(qualified) ?? Object.keys(rows[0] as object)
    if (columns.length === 0) continue

    // Every column as text. See the header: this rehearses the DATA round
    // trip, not the schema, and pretending otherwise would be a green check
    // over an untested claim.
    const target = `${SCRATCH}."${qualified.replace('.', '__')}"`
    await db.execute(`create table ${target} (${columns.map((c) => `"${c}" text`).join(', ')})`)

    // Batched by BYTES, not by row count.
    //
    // The first version used a flat 200 rows and took a quarter of an hour:
    // `documents` holds whole notebook sources, one of which is 69KB, so two
    // hundred of those is a thirteen-megabyte SQL statement. Row count is the
    // obvious unit and the wrong one whenever a table has a text column in it.
    const tuple = (row: unknown): string =>
      `(${columns
        .map((c) => {
          const v = (row as Record<string, unknown>)[c]
          if (v === null || v === undefined) return 'null'
          return lit(typeof v === 'object' ? JSON.stringify(v) : String(v))
        })
        .join(', ')})`

    const BATCH_BYTES = 400_000
    const columnList = columns.map((c) => `"${c}"`).join(', ')
    let batch: string[] = []
    let batchRows = 0
    let bytes = 0

    const flush = async (): Promise<boolean> => {
      if (batch.length === 0) return true
      attempted += batchRows
      try {
        await db.execute(`insert into ${target} (${columnList}) values ${batch.join(', ')}`)
        loaded += batchRows
      } catch (error) {
        failures.push(`${qualified}: ${(error as Error).message.slice(0, 100)}`)
        return false
      }
      batch = []
      batchRows = 0
      bytes = 0
      return true
    }

    let ok = true
    for (const row of rows) {
      const text = tuple(row)
      if (bytes + text.length > BATCH_BYTES && batch.length > 0) {
        if (!(await flush())) {
          ok = false
          break
        }
      }
      batch.push(text)
      batchRows += 1
      bytes += text.length
    }
    if (ok) await flush()
  }

  record(
    'the rows load back into a database',
    failures.length === 0
      ? `${String(loaded)} of ${String(attempted)} row(s) restored into ${SCRATCH}`
      : `${String(loaded)} of ${String(attempted)}; first failure — ${failures[0]}`,
    failures.length === 0 && loaded === attempted && loaded > 0,
  )

  /*
    The counts the archive claims, against the counts that actually came back.

    This is the assertion that catches a truncated write or a silently dropped
    batch, and until tonight it did not make it: the query counted rows in
    `pg_catalog.pg_class` matching one oid — which is one, always — so the check
    proved only that a table existed. It now counts the rows in each restored
    table and compares them to the number the archive says it wrote.
  */
  const restored = (
    await db.execute(`
      select c.relname as t
        from pg_catalog.pg_class c
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where n.nspname = ${lit(SCRATCH)} and c.relkind = 'r'
    `)
  ).rows
  const short: string[] = []
  for (const [qualified, claimed] of Object.entries(archive.row_counts ?? {})) {
    const name = qualified.replace('.', '__')
    if (!restored.some((r) => String(r.t) === name)) continue
    const back = Number(
      (await db.execute(`select count(*)::int as n from ${SCRATCH}."${name}"`)).rows[0]?.n ?? 0,
    )
    if (back !== Number(claimed)) short.push(`${qualified} ${String(back)}/${String(claimed)}`)
  }
  record(
    'and every table came back with the number of rows the archive claims',
    short.length === 0
      ? `${String(restored.length)} table(s), every count matched`
      : short.slice(0, 4).join(', '),
    restored.length > 0 && short.length === 0,
  )

  /*
    Drift against live.

    The office has been working since the archive was taken, so a table holding
    MORE than the archive is normal and is only reported.

    Holding FEWER is normal too — for most tables. Fixtures are purged, projects
    are deleted, documents are removed. The first version of this check called
    any shrink "impossible" and failed the whole rehearsal on
    `public.documents 55>51`, which was four fixture documents being tidied up
    exactly as designed. A backup is a photograph; objecting that the room has
    changed is not a defect report.

    Where a shrink IS impossible is the append-only tables — §6 of the master
    spec, enforced by `app.reject_ledger_mutation()` on DELETE, UPDATE and
    TRUNCATE. If one of those has fewer rows than an archive taken yesterday,
    something got past a trigger that cannot be got past, and that is worth
    failing over. The list is read from the triggers rather than written down
    here, so a table made append-only later is covered without anyone
    remembering to come back.
  */
  const appendOnly = new Set(
    (
      await db.execute(`
        select n.nspname || '.' || c.relname as t
          from pg_catalog.pg_trigger g
          join pg_catalog.pg_class c on c.oid = g.tgrelid
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
          join pg_catalog.pg_proc p on p.oid = g.tgfoid
         where p.proname = 'reject_ledger_mutation' and not g.tgisinternal
      `)
    ).rows.map((r) => String(r.t)),
  )

  const shrunk: string[] = []
  const impossible: string[] = []
  for (const [qualified, claimed] of Object.entries(archive.row_counts ?? {})) {
    if (!live.includes(qualified)) continue
    const [schema, table] = qualified.split('.')
    const now = Number(
      (await db.execute(`select count(*)::int as n from "${String(schema)}"."${String(table)}"`))
        .rows[0]?.n ?? 0,
    )
    if (Number(claimed) <= now) continue
    const gap = `${qualified} ${String(claimed)}→${String(now)}`
    if (appendOnly.has(qualified)) impossible.push(gap)
    else shrunk.push(gap)
  }
  record(
    'no append-only table has lost rows since the archive was taken',
    impossible.length === 0
      ? `${String(appendOnly.size)} append-only table(s), none shorter than the archive`
      : impossible.slice(0, 4).join(', '),
    impossible.length === 0,
  )
  if (shrunk.length > 0) {
    console.log(
      `   (${String(shrunk.length)} table(s) smaller than the archive, which is allowed: ${shrunk.slice(0, 6).join(', ')})`,
    )
  }
} finally {
  // Created seconds ago, never held anything but copies.
  await db.execute(`drop schema if exists ${SCRATCH} cascade`)
}

const passed = checks.filter((c) => c.passed).length
console.log(`\n| check | outcome | |`)
console.log('|---|---|---|')
for (const c of checks) console.log(`| ${c.what} | ${c.outcome} | ${c.passed ? '✅' : '❌'} |`)
console.log(`\n${String(passed)}/${String(checks.length)} checks passed`)
console.log(`The scratch schema ${SCRATCH} has been dropped. No archive was touched.`)

process.exit(passed === checks.length ? 0 : 1)
