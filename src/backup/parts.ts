/**
 * Which tables the nightly backup writes in PARTS, and where each part starts and ends (#503).
 *
 * ## Why
 *
 * The backup is one checkpointed step per table, and a worker attempt that finishes at least one step earns another
 * slice rather than spending an attempt (0536). Measured on production, 18 November 2026, from `job_steps`: every
 * attempt died after writing about 13 to 16 MB of compressed output, whatever the time (31 s, 12.6 s, 30 s). From 9
 * November `public.job_state_transitions` alone (280,782 rows, about 18 MB compressed) was more than one attempt can
 * hold, so every attempt began on it, died inside it, finished nothing, and the job ran out of attempts. No backup
 * finished for ten nights.
 *
 * A part is a key range read in the same keyset pages as a whole table (paged.ts), and is its own step. The target is
 * `partRawBytes` of JSON a part, about 2 to 4 MB compressed on this data, so an attempt always finishes several.
 *
 * ## How the parts are chosen
 *
 * Once per run, in the backup's first step, whose answer is checkpointed so every later attempt uses the SAME parts:
 *  - a table is a candidate when its on-disk size (`pg_total_relation_size`) is at least `minTableBytes`;
 *  - its average row, as the JSON the dump writes, is measured on a sample;
 *  - rows per part = `partRawBytes` / that average (at least `minRowsPerPart`);
 *  - the boundaries are the key of every that-many-th row. The last part is open-ended, so a row added after the plan
 *    is still read.
 *  - a table with no usable key (paged.ts reads it by `ctid`) is never split: `ctid` moves under an update.
 *
 * A backup taken over several attempts is not one snapshot. That was already true table by table
 * (docs/ops/restore-procedure.md); a split table is now read part by part, possibly minutes apart, so a row inserted
 * into an already-read part during the run is not in this backup. The manifest records what WAS written, and the
 * restore checks against that.
 */

import type { SqlExecutor } from '../db/executor.ts'
import { boundarySql, type KeyRange, pageKey, rangesFrom } from './paged.ts'

export interface PartOptions {
  /** A table smaller than this on disk is never split. */
  readonly minTableBytes?: number
  /** The JSON a part aims to hold. */
  readonly partRawBytes?: number
  /** Never fewer rows than this a part, whatever the average row says. */
  readonly minRowsPerPart?: number
}

export const MIN_TABLE_BYTES = 8 * 1024 * 1024
export const PART_RAW_BYTES = 16 * 1024 * 1024
export const MIN_ROWS_PER_PART = 500

/** Rows a part holds for a table whose average JSON row is `avgRowBytes`. Pure, so it is tested without a database. */
export function rowsPerPart(avgRowBytes: number, options: PartOptions = {}): number {
  const target = options.partRawBytes ?? PART_RAW_BYTES
  const floor = options.minRowsPerPart ?? MIN_ROWS_PER_PART
  return Math.max(floor, Math.floor(target / Math.max(1, avgRowBytes)))
}

const quoteIdent = (s: string): string => `"${s.replace(/"/g, '""')}"`

/** Key ranges per qualified table name, for the tables written in parts. A table absent here is one object. */
export type PartsPlan = Record<string, KeyRange[]>

export async function planParts(
  db: SqlExecutor,
  tables: readonly { table_schema: string; table_name: string }[],
  options: PartOptions = {},
): Promise<PartsPlan> {
  const minBytes = options.minTableBytes ?? MIN_TABLE_BYTES
  const wanted = new Set(tables.map((t) => `${t.table_schema}.${t.table_name}`))
  const { rows: big } = await db.execute(`
    select n.nspname as s, c.relname as t
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where c.relkind = 'r' and n.nspname in ('public', 'app')
       and pg_catalog.pg_total_relation_size(c.oid) >= ${String(Math.max(0, Math.floor(minBytes)))}
     order by 1, 2
  `)
  const plan: PartsPlan = {}
  for (const r of big) {
    const schema = String(r.s)
    const table = String(r.t)
    if (!wanted.has(`${schema}.${table}`)) continue
    const key = await pageKey(db, schema, table)
    if (key.physical) continue
    const from = `${quoteIdent(schema)}.${quoteIdent(table)}`
    // A sample of pages is enough for an average; a tiny table can sample nothing, so fall back to its first rows.
    let { rows: w } = await db.execute(
      `select count(*)::bigint as n, coalesce(avg(octet_length(to_jsonb(s)::text)), 0)::bigint as w from (select * from ${from} tablesample system (10)) s`,
    )
    if (Number(w[0]?.n ?? 0) === 0)
      ({ rows: w } = await db.execute(
        `select count(*)::bigint as n, coalesce(avg(octet_length(to_jsonb(s)::text)), 0)::bigint as w from (select * from ${from} limit 2000) s`,
      ))
    if (Number(w[0]?.n ?? 0) === 0) continue
    const every = rowsPerPart(Number(w[0]?.w ?? 0), options)
    const { rows: b } = await db.execute(boundarySql(schema, table, key, every))
    if (b.length === 0) continue // fewer rows than one part
    plan[`${schema}.${table}`] = rangesFrom(
      b.map((row) =>
        key.cols.map((_, i) => String((row as Record<string, unknown>)[`k${String(i)}`])),
      ),
    )
  }
  return plan
}

/** The object key of one part. Four digits sort in order up to 9,999 parts. */
export const partKey = (prefix: string, qualified: string, n: number): string =>
  `${prefix}/${qualified}.part-${String(n).padStart(4, '0')}.json.gz`

/** The step name of one part. The first part of a table keeps nothing of the old name, so no old checkpoint is reused. */
export const partStep = (qualified: string, n: number): string =>
  `table:${qualified}#part-${String(n).padStart(4, '0')}`
