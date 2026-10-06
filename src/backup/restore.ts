/**
 * A TYPED restore, into a marked isolated replica only (G-2 of the 6 October 2026 audit).
 *
 * `backup:rehearse` loads every column as `text` into a scratch schema. That proves the JSON parses and the row counts
 * match; it says nothing about types, NOT NULL, CHECK, unique indexes, foreign keys, composite keys to `(id, office_id)`,
 * triggers, generated columns, identity sequences or row security. This file restores into a database that was built
 * from the repository's own migrations, so every one of those is the REAL one, and then checks what came back:
 *
 *   1. the target is judged BEFORE anything is touched, and anything but a marked local replica is refused;
 *   2. the archive is verified (every object present, every checksum the one the manifest recorded);
 *   3. the target's structure is compared with the structure the rows were taken from, and a mismatch is refused;
 *   4. tables are loaded in FOREIGN-KEY ORDER, parents first, from the real catalogue (Tarjan over the FK graph);
 *   5. only the foreign keys that lie on a CYCLE (a self reference, or two tables pointing at each other) are dropped for
 *      the load and re-added `NOT VALID` then `VALIDATE`d. Every other foreign key is enforced live during the load;
 *   6. user triggers are disabled for the load and put back EXACTLY as they were (each trigger's own prior state), because
 *      a restore must not fire the business logic that wrote those rows the first time (stamping, copying, enqueueing);
 *   7. rows are inserted through `jsonb_populate_recordset(null::the_table, <the dumped text>)`, so every value takes the
 *      column's real type from Postgres's own serialisation and never passes through a JavaScript number;
 *   8. sequences are set from the manifest and never below the largest value in the column that owns them;
 *   9. every table's row count AND content fingerprint are compared with the manifest, every constraint is checked to be
 *      validated, structure is compared before and after (the restore must change none of it), and a smoke test calls the
 *      product's own readers.
 *
 * ## Idempotent, and crash-safe
 *
 * Re-running restores the same archive to the same result. State that must survive a crash (the dropped foreign keys and
 * the triggers' prior states) is written to `restore_state` in the TARGET before it is changed, and a run that finds
 * leftovers puts them back first.
 *
 * ## What it will not do
 *
 * Run against anything else. There is deliberately NO flag that lets it touch a production database in this file: that
 * is a future decision with its own review (docs/ops/restore-procedure.md, "Restoring for real"), and a flag added here
 * "for convenience" is the way a rehearsal tool becomes the thing that overwrote the office.
 */

import type { SqlExecutor } from '../db/executor.ts'
import { type Aux, STRUCTURE_SQL, type StructureFingerprint } from './aux.ts'
import {
  type Manifest,
  type ObservedObject,
  type RestoredTable,
  type Verdict,
  verifyArchive,
  verifyRestored,
} from './manifest.ts'
import { fingerprintSql } from './paged.ts'
import { splitTable } from './rows.ts'

// ------------------------------------------------------------------------------------------------ the target guard

export interface TargetFacts {
  readonly database: string
  /** `inet_server_addr()` is null: connected over a Unix socket, with no network peer. */
  readonly localSocket: boolean
  /** `public.isolated_replica_marker` exists: the database was built by scripts/isolated/replica.sh. */
  readonly marked: boolean
}

/** Databases that are TEMPLATES for the isolated replicas, or the default database of a real server. Never a target. */
export const PROTECTED_DATABASES: readonly string[] = [
  'postgres',
  'template0',
  'template1',
  'base',
  'pre',
  'post',
  'cand',
]

/** The refusal, or null when the target may be restored into. Pure, so every refusal can be driven by a test. */
export function judgeTarget(facts: TargetFacts): string | null {
  if (!facts.localSocket) {
    return 'REFUSED: the target is reached over the network. A restore runs only against a local Unix-socket replica.'
  }
  if (!facts.marked) {
    return `REFUSED: ${facts.database} carries no isolated_replica_marker. A restore runs only against a database built by scripts/isolated/replica.sh.`
  }
  if (PROTECTED_DATABASES.includes(facts.database)) {
    return `REFUSED: ${facts.database} is a template or the default database; restore into a copy (createdb -T) instead.`
  }
  return null
}

export async function assertRestoreTarget(db: SqlExecutor): Promise<TargetFacts> {
  const r = (
    await db.execute(`
      select current_database() as database,
             inet_server_addr() is null as local_socket,
             to_regclass('public.isolated_replica_marker') is not null as marked`)
  ).rows[0] as { database: string; local_socket: boolean; marked: boolean }
  const facts: TargetFacts = {
    database: String(r.database),
    localSocket: r.local_socket === true,
    marked: r.marked === true,
  }
  const refusal = judgeTarget(facts)
  if (refusal !== null) throw new Error(refusal)
  return facts
}

// ----------------------------------------------------------------------------------------------- FK order (pure)

export interface Fk {
  readonly name: string
  readonly table: string
  readonly parent: string
  readonly def: string
  readonly validated: boolean
}

export interface LoadPlan {
  /** Parents first. Each group is one strongly connected component, loaded together. */
  readonly groups: readonly (readonly string[])[]
  /** The foreign keys inside a component (cycles and self references): the only ones dropped for the load. */
  readonly cyclic: readonly Fk[]
}

/** Order tables so every table follows the tables it references; isolate the foreign keys that lie on a cycle. */
export function planLoadOrder(tables: readonly string[], fks: readonly Fk[]): LoadPlan {
  const names = [...new Set(tables)].sort()
  const known = new Set(names)
  const out = new Map<string, string[]>(names.map((t) => [t, []]))
  for (const fk of fks) {
    if (known.has(fk.table) && known.has(fk.parent)) (out.get(fk.table) as string[]).push(fk.parent)
  }
  for (const list of out.values()) list.sort()

  // Tarjan, iteratively (recursion depth is the longest FK chain, which is small, but a restore tool must not rely on it).
  let counter = 0
  const index = new Map<string, number>()
  const low = new Map<string, number>()
  const onStack = new Set<string>()
  const stack: string[] = []
  const groups: string[][] = []
  for (const root of names) {
    if (index.has(root)) continue
    const work: { v: string; i: number }[] = [{ v: root, i: 0 }]
    index.set(root, counter)
    low.set(root, counter)
    counter += 1
    stack.push(root)
    onStack.add(root)
    while (work.length > 0) {
      const frame = work[work.length - 1] as { v: string; i: number }
      const edges = out.get(frame.v) as string[]
      if (frame.i < edges.length) {
        const w = edges[frame.i] as string
        frame.i += 1
        if (!index.has(w)) {
          index.set(w, counter)
          low.set(w, counter)
          counter += 1
          stack.push(w)
          onStack.add(w)
          work.push({ v: w, i: 0 })
        } else if (onStack.has(w)) {
          low.set(frame.v, Math.min(low.get(frame.v) as number, index.get(w) as number))
        }
      } else {
        work.pop()
        const parentFrame = work[work.length - 1]
        if (parentFrame !== undefined) {
          low.set(
            parentFrame.v,
            Math.min(low.get(parentFrame.v) as number, low.get(frame.v) as number),
          )
        }
        if (low.get(frame.v) === index.get(frame.v)) {
          const group: string[] = []
          for (;;) {
            const w = stack.pop() as string
            onStack.delete(w)
            group.push(w)
            if (w === frame.v) break
          }
          groups.push(group.sort())
        }
      }
    }
  }
  // Tarjan emits a component only after every component it points at: that is parents first for child -> parent edges.
  const groupOf = new Map<string, number>()
  groups.forEach((g, i) => {
    for (const t of g) groupOf.set(t, i)
  })
  const cyclic = fks.filter(
    (fk) =>
      known.has(fk.table) &&
      known.has(fk.parent) &&
      (fk.table === fk.parent || groupOf.get(fk.table) === groupOf.get(fk.parent)),
  )
  return { groups, cyclic }
}

// -------------------------------------------------------------------------------------------------- the source

export interface ArchiveSource {
  /** The run prefix the object keys sit under. */
  readonly prefix: string
  manifest(): Promise<Manifest>
  /** Key to checksum and size, for every object the source can see. */
  observed(): Promise<ReadonlyMap<string, ObservedObject>>
  /** One table object, decompressed, with the checksum of the compressed bytes it came from. */
  table(qualified: string): Promise<{ text: string; sha256: string; bytes: number } | null>
}

// -------------------------------------------------------------------------------------------------- the restore

export interface RestoreOptions {
  /** `refuse` (default) stops if any table holds a row. `truncate` empties every table first. */
  readonly onNonEmpty?: 'refuse' | 'truncate'
  readonly allowSchemaDrift?: boolean
  /** Characters of row text in one INSERT. */
  readonly batchChars?: number
  /**
   * Called with the Auth admin payloads (original ids) BEFORE any row is loaded, because `offices.auth_user_id` points
   * at `auth.users`, which this restore does not own: the logins have to exist first. On a replica the proof inserts
   * them into the stub; in a real recovery this is the Auth admin API (docs/ops/restore-procedure.md, step 4).
   */
  readonly prepareLogins?: (users: Record<string, unknown>[]) => Promise<void>
  readonly log?: (line: string) => void
  /** Smoke statements: each must run and return a row. */
  readonly smoke?: readonly { readonly name: string; readonly sql: string }[]
}

export interface RestoreReport {
  readonly ok: boolean
  readonly target: TargetFacts
  readonly steps: readonly {
    readonly step: string
    readonly ok: boolean
    readonly detail: string
  }[]
  readonly errors: readonly string[]
  readonly warnings: readonly string[]
  readonly archive: Verdict | null
  readonly restored: Verdict | null
  readonly tables: number
  readonly rows: number
  readonly failedTable: string | null
}

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const qi = (s: string): string => `"${s.replace(/"/g, '""')}"`
const qualify = (t: string): string => t.split('.').map(qi).join('.')

interface Catalogue {
  tables: string[]
  columns: Map<string, { col: string; gen: string; identity: string }[]>
  fks: Fk[]
  triggers: { t: string; name: string; enabled: string }[]
  sequences: { seq: string; t: string; col: string }[]
}

const CATALOGUE_SQL = `
  select jsonb_build_object(
    'tables', coalesce((select jsonb_agg(n.nspname || '.' || c.relname order by n.nspname, c.relname)
        from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where n.nspname in ('public','app') and c.relkind = 'r'), '[]'),
    'columns', coalesce((select jsonb_agg(jsonb_build_object('t', n.nspname || '.' || c.relname, 'col', a.attname,
                                                             'gen', a.attgenerated::text, 'identity', a.attidentity::text)
                                          order by n.nspname, c.relname, a.attnum)
        from pg_catalog.pg_attribute a
        join pg_catalog.pg_class c on c.oid = a.attrelid join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where a.attnum > 0 and not a.attisdropped and c.relkind = 'r' and n.nspname in ('public','app')), '[]'),
    'fks', coalesce((select jsonb_agg(jsonb_build_object('name', con.conname,
                                                         'table', cn.nspname || '.' || cc.relname,
                                                         'parent', pn.nspname || '.' || pc.relname,
                                                         'def', pg_catalog.pg_get_constraintdef(con.oid),
                                                         'validated', con.convalidated) order by cn.nspname, cc.relname, con.conname)
        from pg_catalog.pg_constraint con
        join pg_catalog.pg_class cc on cc.oid = con.conrelid join pg_catalog.pg_namespace cn on cn.oid = cc.relnamespace
        join pg_catalog.pg_class pc on pc.oid = con.confrelid join pg_catalog.pg_namespace pn on pn.oid = pc.relnamespace
       where con.contype = 'f' and cn.nspname in ('public','app')), '[]'),
    'triggers', coalesce((select jsonb_agg(jsonb_build_object('t', n.nspname || '.' || c.relname, 'name', t.tgname,
                                                              'enabled', t.tgenabled::text) order by n.nspname, c.relname, t.tgname)
        from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid = t.tgrelid
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where not t.tgisinternal and n.nspname in ('public','app')), '[]'),
    'sequences', coalesce((select jsonb_agg(jsonb_build_object('seq', sn.nspname || '.' || s.relname,
                                                               't', tn.nspname || '.' || tc.relname, 'col', a.attname)
                                            order by sn.nspname, s.relname)
        from pg_catalog.pg_depend d
        join pg_catalog.pg_class s on s.oid = d.objid and s.relkind = 'S'
        join pg_catalog.pg_namespace sn on sn.oid = s.relnamespace
        join pg_catalog.pg_class tc on tc.oid = d.refobjid
        join pg_catalog.pg_namespace tn on tn.oid = tc.relnamespace
        join pg_catalog.pg_attribute a on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
       where d.classid = 'pg_catalog.pg_class'::regclass and d.deptype in ('a','i') and tn.nspname in ('public','app')), '[]')
  ) as c`

async function readCatalogue(db: SqlExecutor): Promise<Catalogue> {
  const raw = (await db.execute(CATALOGUE_SQL)).rows[0]?.c
  const c = (typeof raw === 'string' ? JSON.parse(raw) : raw) as {
    tables: string[]
    columns: { t: string; col: string; gen: string; identity: string }[]
    fks: Fk[]
    triggers: { t: string; name: string; enabled: string }[]
    sequences: { seq: string; t: string; col: string }[]
  }
  const columns = new Map<string, { col: string; gen: string; identity: string }[]>()
  for (const x of c.columns) {
    const list = columns.get(x.t) ?? []
    list.push({ col: x.col, gen: x.gen, identity: x.identity })
    columns.set(x.t, list)
  }
  return { tables: c.tables, columns, fks: c.fks, triggers: c.triggers, sequences: c.sequences }
}

/** Everything about the target's structure the restore must leave exactly as it found it. */
async function structureOf(db: SqlExecutor): Promise<string> {
  const s = (await db.execute(STRUCTURE_SQL)).rows[0] as unknown as StructureFingerprint
  const trig = (
    await db.execute(`
      select md5(string_agg(n.nspname || '.' || c.relname || ':' || t.tgname || ':' || t.tgenabled::text, '|'
                            order by n.nspname, c.relname, t.tgname)) as m
        from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid = t.tgrelid
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where not t.tgisinternal and n.nspname in ('public','app')`)
  ).rows[0]?.m
  // Whether a constraint is VALIDATED is deliberately not part of this: a restore that repairs an interrupted run
  // legitimately ends with more validated constraints than it began with, and "every constraint is validated" is
  // asserted on its own, after the load.
  return JSON.stringify({ ...s, trigger_states_md5: trig })
}

function sameStructure(a: StructureFingerprint, b: StructureFingerprint): string[] {
  const diffs: string[] = []
  for (const k of Object.keys(a) as (keyof StructureFingerprint)[]) {
    if (a[k] !== b[k]) diffs.push(`${k}: archive ${String(a[k])}, target ${String(b[k])}`)
  }
  return diffs
}

/** A dollar-quote tag that does not occur in the payload, so the payload can be embedded without escaping it. */
export function dollarTag(payload: string): string {
  for (let i = 0; ; i++) {
    const tag = `$r${String(i)}$`
    if (!payload.includes(tag)) return tag
  }
}

/** Put up to `batchChars` of row text into one array literal, never splitting a row. */
export function batchRows(rows: readonly string[], batchChars: number): string[] {
  const out: string[] = []
  let cur: string[] = []
  let size = 0
  for (const r of rows) {
    if (cur.length > 0 && size + r.length > batchChars) {
      out.push(`[${cur.join(',')}]`)
      cur = []
      size = 0
    }
    cur.push(r)
    size += r.length + 1
  }
  if (cur.length > 0) out.push(`[${cur.join(',')}]`)
  return out
}

export async function restoreArchive(
  db: SqlExecutor,
  source: ArchiveSource,
  options: RestoreOptions = {},
): Promise<RestoreReport> {
  const log = options.log ?? (() => undefined)
  const steps: { step: string; ok: boolean; detail: string }[] = []
  const errors: string[] = []
  const warnings: string[] = []
  const step = (name: string, ok: boolean, detail: string): void => {
    steps.push({ step: name, ok, detail })
    log(`${ok ? 'ok  ' : 'FAIL'} ${name} - ${detail}`)
    if (!ok) errors.push(`${name}: ${detail}`)
  }
  const finish = (
    target: TargetFacts,
    archive: Verdict | null,
    restored: Verdict | null,
    tables: number,
    rows: number,
    failedTable: string | null,
  ): RestoreReport => ({
    ok: errors.length === 0,
    target,
    steps,
    errors,
    warnings,
    archive,
    restored,
    tables,
    rows,
    failedTable,
  })

  // 1. the target, before anything is touched. This throws: nothing below runs against an unmarked database.
  const target = await assertRestoreTarget(db)
  step('target', true, `${target.database}: local socket, marked replica`)

  // 2. the archive
  const manifest = await source.manifest()
  const observed = await source.observed()
  const archive = verifyArchive(manifest, source.prefix, observed)
  warnings.push(...archive.warnings)
  step(
    'archive verified',
    archive.ok,
    archive.ok
      ? `${String(archive.tables)} tables, ${String(archive.rows)} rows, every object present and matching`
      : archive.errors.slice(0, 5).join('; '),
  )
  if (!archive.ok) return finish(target, archive, null, archive.tables, 0, null)

  // 3a. the journal FIRST: what an interrupted earlier run left changed goes back before anything is compared, because a
  // target with a foreign key dropped is not "different migrations", it is a half-finished restore, and comparing it
  // would refuse the very run that repairs it.
  await db.execute(`
    create schema if not exists restore_state;
    create table if not exists restore_state.fks (rel text not null, name text not null, def text not null, primary key (rel, name));
    create table if not exists restore_state.triggers (rel text not null, name text not null, enabled text not null, primary key (rel, name));
  `)
  const leftoverFks = (
    await db.execute(`select rel, name, def from restore_state.fks order by rel, name`)
  ).rows as { rel: string; name: string; def: string }[]
  const leftoverTriggers = (
    await db.execute(`select rel, name, enabled from restore_state.triggers order by rel, name`)
  ).rows as { rel: string; name: string; enabled: string }[]
  if (leftoverFks.length > 0 || leftoverTriggers.length > 0) {
    warnings.push(
      `an earlier run was interrupted: putting back ${String(leftoverFks.length)} foreign key(s) and ${String(leftoverTriggers.length)} trigger(s) first`,
    )
    await putBack(db, leftoverFks, leftoverTriggers, log, errors, false)
    if (errors.length > 0) {
      step('an interrupted earlier run was put right', false, errors.slice(0, 3).join('; '))
      return finish(target, archive, null, archive.tables, 0, null)
    }
    step(
      'an interrupted earlier run was put right',
      true,
      `${String(leftoverFks.length)} foreign key(s) and ${String(leftoverTriggers.length)} trigger(s) restored`,
    )
  }

  // 3b. structure: the target must be what the rows were taken from
  const catalogue0 = await readCatalogue(db)
  const before = await structureOf(db)
  const targetStructure = (await db.execute(STRUCTURE_SQL))
    .rows[0] as unknown as StructureFingerprint
  const archiveStructure = manifest.aux?.structure ?? null
  if (archiveStructure === null) {
    warnings.push(
      'the archive recorded no structure fingerprint; only table and column presence is checked',
    )
  } else {
    const diffs = sameStructure(archiveStructure, targetStructure)
    if (diffs.length > 0 && options.allowSchemaDrift !== true) {
      step(
        'structure matches the archive',
        false,
        `the target was built from different migrations: ${diffs.slice(0, 4).join('; ')}`,
      )
      return finish(target, archive, null, archive.tables, 0, null)
    }
    if (diffs.length > 0) warnings.push(`structure drift allowed: ${diffs.join('; ')}`)
    else
      step(
        'structure matches the archive',
        true,
        `${String(targetStructure.tables)} tables, ${String(targetStructure.foreign_keys)} foreign keys, ${String(targetStructure.triggers)} triggers, ${String(targetStructure.policies)} policies`,
      )
  }
  const archiveTables = Object.keys(manifest.row_counts ?? {})
  const missing = archiveTables.filter((t) => !catalogue0.tables.includes(t))
  if (missing.length > 0) {
    step(
      'every archived table exists in the target',
      false,
      `missing: ${missing.slice(0, 5).join(', ')}`,
    )
    return finish(target, archive, null, archive.tables, 0, null)
  }
  const columnsInArchive = new Map<string, string[]>()
  for (const c of manifest.schema ?? []) {
    const l = columnsInArchive.get(c.t) ?? []
    l.push(c.column_name)
    columnsInArchive.set(c.t, l)
  }
  for (const t of archiveTables) {
    const have = new Set((catalogue0.columns.get(t) ?? []).map((c) => c.col))
    const lost = (columnsInArchive.get(t) ?? []).filter((c) => !have.has(c))
    if (lost.length > 0 && options.allowSchemaDrift !== true) {
      step(
        'every archived column exists in the target',
        false,
        `${t}: ${lost.join(', ')} would be dropped`,
      )
      return finish(target, archive, null, archive.tables, 0, null)
    }
  }

  const catalogue = await readCatalogue(db)
  const outside = catalogue.fks.filter((fk) => !catalogue.tables.includes(fk.parent))
  if (outside.length > 0 && options.prepareLogins === undefined) {
    warnings.push(
      `${String(outside.length)} foreign key(s) point outside public and app (${[...new Set(outside.map((f) => f.parent))].join(', ')}): those rows must already exist in the target or the load stops at the first row that needs them`,
    )
  }
  const plan = planLoadOrder(catalogue.tables, catalogue.fks)
  step(
    'load order',
    true,
    `${String(plan.groups.length)} groups, ${String(plan.cyclic.length)} cyclic foreign key(s) handled separately`,
  )

  // 5. empty or refuse
  const counts = new Map<string, number>()
  {
    const sql = catalogue.tables
      .map((t) => `select ${lit(t)} as t, count(*)::bigint as n from ${qualify(t)}`)
      .join(' union all ')
    for (const r of (await db.execute(sql)).rows) counts.set(String(r.t), Number(r.n))
  }
  const nonEmpty = [...counts].filter(([, n]) => n > 0)
  if (nonEmpty.length > 0 && options.onNonEmpty !== 'truncate') {
    step(
      'target is empty',
      false,
      `${String(nonEmpty.length)} table(s) hold rows (${nonEmpty
        .slice(0, 4)
        .map(([t]) => t)
        .join(', ')}); pass onNonEmpty: 'truncate' to empty them`,
    )
    return finish(target, archive, null, archive.tables, 0, null)
  }

  if (outside.length > 0 && options.prepareLogins !== undefined) {
    await options.prepareLogins(authUserPayloads(manifest))
    step(
      'logins exist before the rows that reference them',
      true,
      `${String((manifest.aux?.auth_users.rows ?? []).length)} login(s) prepared`,
    )
  }

  // 6. record, then change: triggers first (a truncate and a load must not fire business logic), then cyclic FKs
  const withTriggers = [...new Set(catalogue.triggers.map((t) => t.t))]
  for (const t of catalogue.triggers) {
    await db.execute(
      `insert into restore_state.triggers (rel, name, enabled) values (${lit(t.t)}, ${lit(t.name)}, ${lit(t.enabled)}) on conflict do nothing`,
    )
  }
  for (const rel of withTriggers)
    await db.execute(`alter table ${qualify(rel)} disable trigger user`)
  for (const fk of plan.cyclic) {
    await db.execute(
      `insert into restore_state.fks (rel, name, def) values (${lit(fk.table)}, ${lit(fk.name)}, ${lit(fk.def)}) on conflict do nothing;
       alter table ${qualify(fk.table)} drop constraint ${qi(fk.name)};`,
    )
  }

  let restoredRows = 0
  let loadFailed = false
  let failedTable: string | null = null
  const restored = new Map<string, RestoredTable>()
  try {
    if (nonEmpty.length > 0) {
      await db.execute(
        `truncate table ${catalogue.tables.map(qualify).join(', ')} restart identity`,
      )
      step('target emptied', true, `${String(nonEmpty.length)} table(s) had rows`)
    }

    // 7. load, parents first
    const batchChars = options.batchChars ?? 4_000_000
    for (const group of plan.groups) {
      for (const t of group) {
        const rowsExpected = manifest.row_counts?.[t]
        if (rowsExpected === undefined) continue // created after the backup: stays empty
        if (rowsExpected === 0) continue
        const got = await source.table(t)
        if (got === null) throw new Error(`${t}: the archive has no object for it`)
        const seen = observed.get(`${source.prefix}/${t}.json.gz`)
        if (seen !== undefined && seen.sha256 !== got.sha256) {
          throw new Error(`${t}: its bytes changed between verification and load`)
        }
        const { rows } = splitTable(got.text)
        if (rows.length !== rowsExpected) {
          throw new Error(
            `${t}: the object holds ${String(rows.length)} rows and the manifest says ${String(rowsExpected)}`,
          )
        }
        const cols = catalogue.columns.get(t) ?? []
        const archiveCols = new Set(columnsInArchive.get(t) ?? cols.map((c) => c.col))
        const insertable = cols.filter((c) => c.gen === '' && archiveCols.has(c.col))
        const list = insertable.map((c) => qi(c.col)).join(', ')
        const overriding = cols.some((c) => c.identity === 'a') ? ' overriding system value' : ''
        for (const payload of batchRows(rows, batchChars)) {
          const tag = dollarTag(payload)
          try {
            await db.execute(
              `insert into ${qualify(t)} (${list})${overriding}
               select ${list} from jsonb_populate_recordset(null::${qualify(t)}, ${tag}${payload}${tag}::jsonb)`,
            )
          } catch (error) {
            failedTable = t
            throw new Error(`${t}: ${String((error as Error).message).slice(0, 300)}`)
          }
        }
        restoredRows += rows.length
      }
    }
    step(
      'rows loaded',
      true,
      `${String(restoredRows)} rows into ${String(archiveTables.length)} tables, typed, in foreign-key order`,
    )
  } catch (error) {
    loadFailed = true
    step('rows loaded', false, String((error as Error).message))
  } finally {
    // 8. put the structure back whatever happened: the FKs the load needed gone, then the triggers. After a failed
    // load the foreign keys go back NOT VALID and are not validated (see putBack): the next run does that.
    const fksLeft = (
      await db.execute(`select rel, name, def from restore_state.fks order by rel, name`)
    ).rows as { rel: string; name: string; def: string }[]
    const trigLeft = (
      await db.execute(`select rel, name, enabled from restore_state.triggers order by rel, name`)
    ).rows as { rel: string; name: string; enabled: string }[]
    const orphans = await putBack(db, fksLeft, trigLeft, log, errors, !loadFailed)
    if (!loadFailed && orphans === 0 && fksLeft.length > 0)
      step(
        'cyclic foreign keys re-added and validated',
        true,
        `${String(fksLeft.length)} foreign key(s)`,
      )
    else if (orphans > 0)
      step(
        'cyclic foreign keys re-added and validated',
        false,
        `${String(orphans)} could not be validated`,
      )
    step(
      'triggers put back as they were',
      errors.every((e) => !e.startsWith('trigger')),
      `${String(trigLeft.length)} trigger(s)`,
    )
  }
  if (failedTable !== null || errors.length > 0) {
    return finish(target, archive, null, archive.tables, restoredRows, failedTable)
  }

  // 9. sequences continue where they were
  const aux: Aux | undefined = manifest.aux
  const seqValues = new Map(
    (aux?.sequences.rows ?? []).map((s) => [`${s.schema}.${s.name}`, s.last_value]),
  )
  let seqSet = 0
  for (const s of catalogue.sequences) {
    const recorded = seqValues.get(s.seq)
    const maxRow = Number(
      (
        await db.execute(
          `select coalesce(max(${qi(s.col)}), 0)::numeric::text as m from ${qualify(s.t)}`,
        )
      ).rows[0]?.m ?? 0,
    )
    const want = Math.max(Number(recorded ?? 0), maxRow)
    if (want > 0) {
      await db.execute(`select setval(${lit(s.seq)}, ${String(want)}, true)`)
      seqSet += 1
    }
  }
  step(
    'sequences set',
    true,
    `${String(seqSet)} of ${String(catalogue.sequences.length)} owned sequence(s) set from the manifest or the column maximum, whichever is higher`,
  )

  // 10. verification: counts and content
  const fpSql = archiveTables
    .map((t) => {
      const [s, n] = t.split('.') as [string, string]
      return `select ${lit(t)} as t, n, fp from (${fingerprintSql(s, n)}) q_${String(archiveTables.indexOf(t))}`
    })
    .join(' union all ')
  for (const r of (await db.execute(fpSql)).rows) {
    restored.set(String(r.t), { rows: Number(r.n), fingerprint: String(r.fp) })
  }
  const verdict = verifyRestored(manifest, restored)
  warnings.push(...verdict.warnings)
  step(
    'every table has the rows and the content the manifest recorded',
    verdict.ok,
    verdict.ok
      ? `${String(verdict.tables)} tables, ${String(verdict.rows)} rows, counts and fingerprints match`
      : verdict.errors.slice(0, 5).join('; '),
  )

  const notValid = (
    await db.execute(`
      select c.conname as name, c.conrelid::regclass::text as rel from pg_catalog.pg_constraint c
        join pg_catalog.pg_namespace n on n.oid = c.connamespace
       where n.nspname in ('public','app') and not c.convalidated order by 1`)
  ).rows as { name: string; rel: string }[]
  step(
    'every constraint is validated',
    notValid.length === 0,
    notValid.length === 0
      ? 'none left NOT VALID'
      : notValid
          .slice(0, 4)
          .map((r) => `${r.rel}.${r.name}`)
          .join(', '),
  )

  const nextBelow: string[] = []
  for (const s of catalogue.sequences) {
    const row = (
      await db.execute(
        `select (select last_value from pg_sequences where schemaname || '.' || sequencename = ${lit(s.seq)}) as last_value,
                (select coalesce(max(${qi(s.col)}), 0)::numeric from ${qualify(s.t)}) as max_col`,
      )
    ).rows[0] as { last_value: string | number | null; max_col: string | number }
    if (row.last_value !== null && Number(row.last_value) < Number(row.max_col))
      nextBelow.push(s.seq)
  }
  step(
    'no sequence would hand out a value already in its column',
    nextBelow.length === 0,
    nextBelow.length === 0
      ? `${String(catalogue.sequences.length)} checked`
      : nextBelow.slice(0, 4).join(', '),
  )

  const after = await structureOf(db)
  step(
    'the restore changed no structure',
    before === after,
    before === after
      ? 'tables, columns, constraints, triggers (and their states), policies and indexes identical before and after'
      : `before ${before} after ${after}`,
  )

  // 11. the product's own readers
  const smoke = options.smoke ?? [
    { name: 'free_tier_headroom', sql: 'select app.free_tier_headroom() as r' },
    { name: 'backup_health', sql: 'select app.backup_health() as r' },
  ]
  for (const s of smoke) {
    try {
      const r = (await db.execute(s.sql)).rows[0]
      step(
        `smoke: ${s.name}`,
        r !== undefined,
        r === undefined ? 'returned no row' : 'ran and returned a row',
      )
    } catch (error) {
      step(`smoke: ${s.name}`, false, String((error as Error).message).slice(0, 200))
    }
  }

  await db.execute('drop schema if exists restore_state cascade')
  return finish(target, archive, verdict, archive.tables, restoredRows, null)
}

/**
 * Re-add journaled foreign keys NOT VALID then VALIDATE, and put each trigger back in its own prior state, then clear the
 * journal. Returns how many foreign keys failed validation. Failures go to `errors` and the journal is kept for them.
 */
async function putBack(
  db: SqlExecutor,
  fks: readonly { rel: string; name: string; def: string }[],
  triggers: readonly { rel: string; name: string; enabled: string }[],
  log: (line: string) => void,
  errors: string[] = [],
  /**
   * Validate the re-added foreign keys. True only after a load that SUCCEEDED: validating against rows that are half a
   * table, or about to be truncated and reloaded, reports violations that are the interruption and not the data, and
   * would make a run that repairs an interrupted one refuse itself.
   */
  validate = true,
): Promise<number> {
  let failed = 0
  for (const fk of fks) {
    const exists = (
      await db.execute(
        `select 1 from pg_catalog.pg_constraint where conrelid = ${lit(qualify(fk.rel))}::regclass and conname = ${lit(fk.name)}`,
      )
    ).rows.length
    try {
      if (exists === 0) {
        await db.execute(
          `alter table ${qualify(fk.rel)} add constraint ${qi(fk.name)} ${fk.def.replace(/\s+NOT VALID\s*$/i, '')} not valid`,
        )
      }
      if (validate)
        await db.execute(`alter table ${qualify(fk.rel)} validate constraint ${qi(fk.name)}`)
      await db.execute(
        `delete from restore_state.fks where rel = ${lit(fk.rel)} and name = ${lit(fk.name)}`,
      )
    } catch (error) {
      failed += 1
      errors.push(
        `foreign key ${fk.rel}.${fk.name} is violated by the restored rows: ${String((error as Error).message).slice(0, 200)}`,
      )
      log(`FAIL foreign key ${fk.rel}.${fk.name}`)
    }
  }
  for (const t of triggers) {
    const how =
      t.enabled === 'O'
        ? 'enable trigger'
        : t.enabled === 'R'
          ? 'enable replica trigger'
          : t.enabled === 'A'
            ? 'enable always trigger'
            : 'disable trigger'
    try {
      await db.execute(`alter table ${qualify(t.rel)} ${how} ${qi(t.name)}`)
      await db.execute(
        `delete from restore_state.triggers where rel = ${lit(t.rel)} and name = ${lit(t.name)}`,
      )
    } catch (error) {
      errors.push(
        `trigger ${t.rel}.${t.name} could not be put back: ${String((error as Error).message).slice(0, 200)}`,
      )
    }
  }
  return failed
}

// ---------------------------------------------------------------- what a restore cannot do, as data (pure)

export interface ChecklistItem {
  readonly id: string
  readonly what: string
  /** `automated` is done by code with evidence; `assisted` has a generator here and a human step; `manual` is a person. */
  readonly kind: 'automated' | 'assisted' | 'manual'
  readonly count?: number
  readonly evidence: string
}

/** The ordered things a recovery needs that are not rows, with the counts the manifest recorded. */
export function recoveryChecklist(manifest: Manifest): ChecklistItem[] {
  const aux = manifest.aux
  const n = (s: { rows: readonly unknown[] } | undefined): number => s?.rows.length ?? 0
  const missing = (s: { ok: boolean } | undefined): string =>
    s === undefined
      ? ' (the archive recorded none)'
      : s.ok
        ? ''
        : ' (could not be read when the backup ran)'
  return [
    {
      id: 'project',
      what: 'Provision a Supabase project (a new one: the lost one is gone) and note its ref',
      kind: 'manual',
      evidence: 'the Management API lists the project as ACTIVE_HEALTHY',
    },
    {
      id: 'migrations',
      what: `Apply the migrations from git up to ${manifest.latest_migration ?? 'the latest the archive names'} (npm run migrate against the new project)`,
      kind: 'automated',
      evidence:
        'app.schema_migrations equals the archive migration list; structure fingerprint matches',
    },
    {
      id: 'rows',
      what: `Restore ${String(manifest.rows ?? 0)} rows in ${String(manifest.tables ?? 0)} tables (restoreArchive)`,
      kind: 'automated',
      count: manifest.rows ?? 0,
      evidence:
        'restoreArchive report ok: counts and content fingerprints match, every constraint validated',
    },
    {
      id: 'auth-users',
      what: `Re-create ${String(n(aux?.auth_users))} login(s) with their original ids through the Auth admin API (authUserPayloads), then send each person a sign-in link${missing(aux?.auth_users)}`,
      kind: 'assisted',
      count: n(aux?.auth_users),
      evidence:
        'every office_members.auth_user_id resolves in auth.users; one magic-link sign-in succeeds',
    },
    {
      id: 'vault',
      what: `Re-enter ${String(n(aux?.vault_names))} vault secret name(s) by hand from their providers; the values are in no backup${missing(aux?.vault_names)}`,
      kind: 'manual',
      count: n(aux?.vault_names),
      evidence: 'app.resolve_secret returns for every name; audit:credentials reports WORKING',
    },
    {
      id: 'cron',
      what: `Re-create ${String(n(aux?.cron_jobs))} cron job(s) (cronRestoreSql); without the heartbeat nothing runs${missing(aux?.cron_jobs)}`,
      kind: 'assisted',
      count: n(aux?.cron_jobs),
      evidence:
        'cron.job lists them; net._http_response shows 200s from the worker within two minutes',
    },
    {
      id: 'storage',
      what: `Upload ${String(n(aux?.storage_objects))} Storage object(s): their BYTES are not in the backup, only their paths and checksums${missing(aux?.storage_objects)}`,
      kind: 'manual',
      count: n(aux?.storage_objects),
      evidence: 'each object downloads and matches the recorded size and etag',
    },
    {
      id: 'functions',
      what: 'Redeploy the edge functions from git (npm run deploy:worker, deploy:hq, deploy:mcp, deploy:voice, deploy:telegram, deploy:slack) and set their function secrets',
      kind: 'manual',
      evidence: 'each deploy probe passes',
    },
    {
      id: 'webhooks',
      what: 'Re-register the Telegram webhooks (npm run telegram:webhooks) and the Slack event and interactivity URLs',
      kind: 'manual',
      evidence: 'a message to each bot reaches the new project',
    },
    {
      id: 'auth-config',
      what: 'Re-apply the Auth configuration: redirect allow-list, site URL, SMTP, email templates (not in the repository and not in the backup)',
      kind: 'manual',
      evidence: 'a magic link lands on the page and signs in',
    },
  ]
}

/** The Auth admin API body for each recorded login: the original id, so every foreign key to it still resolves. */
export function authUserPayloads(manifest: Manifest): Record<string, unknown>[] {
  return (manifest.aux?.auth_users.rows ?? []).map((u) => {
    const body: Record<string, unknown> = { id: u.id, email_confirm: u.email_confirmed_at != null }
    if (typeof u.email === 'string' && u.email !== '') body.email = u.email
    if (typeof u.phone === 'string' && u.phone !== '') body.phone = u.phone
    if (u.raw_user_meta_data != null) body.user_metadata = u.raw_user_meta_data
    if (u.raw_app_meta_data != null) body.app_metadata = u.raw_app_meta_data
    return body
  })
}

/** `cron.schedule` statements for the recorded jobs. A job's command is dollar-quoted with a tag its text cannot contain. */
export function cronRestoreSql(manifest: Manifest): string[] {
  return (manifest.aux?.cron_jobs.rows ?? []).flatMap((j) => {
    const tag = dollarTag(j.command)
    const call =
      j.jobname === null
        ? `select cron.schedule(${lit(j.schedule)}, ${tag}${j.command}${tag})`
        : `select cron.schedule(${lit(j.jobname)}, ${lit(j.schedule)}, ${tag}${j.command}${tag})`
    return j.active || j.jobname === null
      ? [call]
      : [call, `update cron.job set active = false where jobname = ${lit(j.jobname)}`]
  })
}
