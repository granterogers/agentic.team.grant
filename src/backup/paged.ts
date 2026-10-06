/**
 * Dump one table without ever holding all of it as rows, JSON text and bytes at once (G-3 of the 6 October audit).
 *
 * `dumpTable` used to be `select *` into one array, `JSON.stringify` of the whole array, then gzip of that string:
 * three full copies of the table in memory on an edge isolate whose ceiling is not documented here. It worked while
 * the biggest table was a few MB. `jobs` is 108 MB on disk and `job_state_transitions` 38 MB (recorded 5 October).
 *
 * ## What is bounded, and what is not
 *
 * Bounded: the rows. They are read in KEYSET pages (`where (pk) > (last pk) order by pk limit N`) and each page's JSON
 * is written into a streaming gzip and then dropped, so peak memory is one page plus the COMPRESSED table so far.
 * Not bounded: that compressed table, because it is uploaded as one object (the folder format has one object per
 * table and `readFolder` expects it). Compression is roughly 5 to 10 to 1 on this data (9.6 MB for what was a 52 MB
 * JSON on 18 September), so the largest table's footprint is a tenth of what it was. A table whose COMPRESSED form
 * would not fit is the point at which the format needs parts, and `maxCompressedBytes` makes that a refusal with a
 * sentence rather than an out-of-memory kill that looks like a retry.
 *
 * ## Why keyset and not OFFSET
 *
 * OFFSET re-reads and discards every earlier row on every page (quadratic) and, worse, a row inserted between pages
 * shifts all the later ones, so a row is read twice or never. Keyset pages are cheap and a concurrent insert lands
 * either in a later page or in none, never duplicated. (A backup taken page by page over HTTP is not one snapshot:
 * that was already true table by table and is stated in docs/ops/restore-procedure.md.)
 *
 * ## Why the rows come back as Postgres's own JSON text
 *
 * `to_jsonb(t)::text` per row, server side, never parsed here. A typed restore feeds that text to
 * `jsonb_populate_recordset(null::the_table, ...)`, so timestamps, numerics, bytea, intervals, arrays and jsonb come
 * back as the column's real type from Postgres's own serialisation, with no JavaScript number in between to lose a
 * digit past 2^53.
 *
 * ## The fingerprint
 *
 * Each row's `md5(to_jsonb(t)::text)` is read beside it and the first 48 bits are summed (mod 2^64) into a
 * per-table fingerprint, order independent. The restore recomputes the same sum over what it loaded and compares:
 * a changed value, a lost row or a duplicated one moves it. It costs a hash per row already being serialised.
 */

import type { SqlExecutor } from '../db/executor.ts'

export const DEFAULT_PAGE_ROWS = 2000
/** 256 MB of COMPRESSED table: well past anything the office holds, and a sentence rather than a crash beyond it. */
export const MAX_COMPRESSED_BYTES = 256 * 1024 * 1024

export interface PagedDump {
  readonly bytes: Uint8Array
  readonly rows: number
  /** Uncompressed bytes of the JSON written. */
  readonly rawBytes: number
  /** Order-independent sum of per-row hashes, decimal. See the header. */
  readonly fingerprint: string
  readonly pages: number
  /** The largest single page's JSON, in characters: what the memory bound actually was. */
  readonly maxPageChars: number
  readonly keyedBy: readonly string[]
}

export interface PagedOptions {
  readonly pageRows?: number
  readonly maxCompressedBytes?: number
}

const quoteIdent = (s: string): string => `"${s.replace(/"/g, '""')}"`
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const TWO_64 = 1n << 64n

/** Is this row hash's contribution to the fingerprint. First 48 bits of an md5 hex digest. */
export const rowHashValue = (md5hex: string): bigint => BigInt(`0x${md5hex.slice(0, 12)}`)

interface Key {
  readonly cols: readonly string[]
  readonly types: readonly string[]
  /** True when the table has no usable key and `ctid` stands in for it. */
  readonly physical: boolean
}

/**
 * The columns to order and page by: the primary key, else the first unique index whose columns are all NOT NULL,
 * else the physical row address. `ctid` is stable for the life of one read of an unchanging table and shifts under a
 * concurrent update, so it is the last resort and the result says so (`physical`).
 */
export async function pageKey(db: SqlExecutor, schema: string, table: string): Promise<Key> {
  const regclass = lit(`${quoteIdent(schema)}.${quoteIdent(table)}`)
  const { rows } = await db.execute(`
    with idx as (
      select i.indexrelid, i.indkey::int2[] as cols, i.indisprimary as pk
        from pg_catalog.pg_index i
       where i.indrelid = ${regclass}::regclass and i.indisunique and i.indisvalid
         and i.indpred is null and i.indexprs is null
    ), ok as (
      select idx.*,
             (select bool_and(a.attnotnull)
                from unnest(idx.cols) as k(n)
                join pg_catalog.pg_attribute a on a.attrelid = ${regclass}::regclass and a.attnum = k.n) as all_not_null
        from idx
    ), pick as (
      select * from ok where pk or all_not_null order by pk desc, indexrelid limit 1
    )
    select a.attname as col, pg_catalog.format_type(a.atttypid, a.atttypmod) as typ, k.ord
      from pick
     cross join lateral unnest(pick.cols) with ordinality as k(n, ord)
      join pg_catalog.pg_attribute a on a.attrelid = ${regclass}::regclass and a.attnum = k.n
     order by k.ord
  `)
  if (rows.length === 0) return { cols: ['ctid'], types: ['tid'], physical: true }
  return {
    cols: rows.map((r) => String(r.col)),
    types: rows.map((r) => String(r.typ)),
    physical: false,
  }
}

/** The page query. Exported so a test can assert the statement without a database. */
export function pageSql(
  schema: string,
  table: string,
  key: Key,
  after: readonly string[] | null,
  limit: number,
): string {
  const from = `${quoteIdent(schema)}.${quoteIdent(table)}`
  // One level, on the table's own alias: `to_jsonb(s)` is then exactly the table's columns and nothing this query added.
  const col = (c: string): string => (c === 'ctid' ? 's.ctid' : `s.${quoteIdent(c)}`)
  const order = key.cols.map(col).join(', ')
  const where =
    after === null
      ? ''
      : key.physical
        ? `where s.ctid > ${lit(after[0] as string)}::tid`
        : `where (${order}) > (${key.cols.map((_, i) => `${lit(after[i] as string)}::${key.types[i] as string}`).join(', ')})`
  const keyText = key.cols.map((c, i) => `${col(c)}::text as k${String(i)}`).join(', ')
  return `select to_jsonb(s)::text as j, md5(to_jsonb(s)::text) as h, ${keyText} from ${from} s ${where} order by ${order} limit ${String(limit)}`
}

export async function pagedDump(
  db: SqlExecutor,
  schema: string,
  table: string,
  options: PagedOptions = {},
): Promise<PagedDump> {
  const limit = options.pageRows ?? DEFAULT_PAGE_ROWS
  const cap = options.maxCompressedBytes ?? MAX_COMPRESSED_BYTES
  const key = await pageKey(db, schema, table)

  const enc = new TextEncoder()
  const gz = new CompressionStream('gzip')
  const writer = gz.writable.getWriter()
  const reader = gz.readable.getReader()
  const chunks: Uint8Array[] = []
  let compressed = 0
  const drained = (async () => {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      chunks.push(value)
      compressed += value.length
    }
  })()

  let rawBytes = 0
  const put = async (text: string): Promise<void> => {
    const b = enc.encode(text)
    rawBytes += b.length
    await writer.write(b)
    if (compressed > cap) {
      throw new Error(
        `${schema}.${table} is over ${cap >= 1048576 ? `${String(Math.round(cap / 1048576))} MB` : `${String(cap)} bytes`} compressed: it needs to be written in parts`,
      )
    }
  }

  let rows = 0
  let pages = 0
  let maxPageChars = 0
  let fingerprint = 0n
  let after: string[] | null = null
  try {
    await put(`{"table":${JSON.stringify(`${schema}.${table}`)},"rows":[`)
    for (;;) {
      const { rows: page } = await db.execute(pageSql(schema, table, key, after, limit))
      if (page.length === 0) break
      pages += 1
      const text = page.map((r) => String(r.j)).join(',')
      maxPageChars = Math.max(maxPageChars, text.length)
      await put(`${rows === 0 ? '' : ','}${text}`)
      for (const r of page) fingerprint = (fingerprint + rowHashValue(String(r.h))) % TWO_64
      rows += page.length
      const last = page[page.length - 1] as Record<string, unknown>
      after = key.cols.map((_, i) => String(last[`k${String(i)}`]))
      if (page.length < limit) break
    }
    await put(']}')
    await writer.close()
    await drained
  } catch (error) {
    await writer.abort(error).catch(() => undefined)
    await drained.catch(() => undefined)
    throw error
  }

  const bytes = new Uint8Array(compressed)
  let at = 0
  for (const c of chunks) {
    bytes.set(c, at)
    at += c.length
  }
  return {
    bytes,
    rows,
    rawBytes,
    fingerprint: fingerprint.toString(),
    pages,
    maxPageChars,
    keyedBy: key.cols,
  }
}

/** SQL that computes the same fingerprint over a table as it stands, for the restore's comparison. */
export const fingerprintSql = (schema: string, table: string): string =>
  `select count(*)::bigint as n,
          coalesce(mod(sum(('x' || substr(md5(to_jsonb(t)::text), 1, 12))::bit(48)::bigint::numeric), ${TWO_64.toString()}::numeric), 0)::text as fp
     from ${quoteIdent(schema)}.${quoteIdent(table)} t`
// `t` is the table's own alias there too, so `to_jsonb(t)` is the same text the dump hashed.
