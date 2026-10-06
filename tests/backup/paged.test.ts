import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { pagedDump, pageSql, rowHashValue } from '../../src/backup/paged.ts'
import { splitTable } from '../../src/backup/rows.ts'
import { gunzipText } from '../../src/backup/sources.ts'
import type { SqlExecutor } from '../../src/db/executor.ts'

const md5 = (s: string): string => createHash('md5').update(s).digest('hex')

/** A table of `n` rows keyed by `id`, served the way the page query asks for it. Counts the queries it was asked. */
const fakeTable = (
  n: number,
  key: { cols: string[]; types: string[] } | 'none' = { cols: ['id'], types: ['bigint'] },
) => {
  const rows = Array.from(
    { length: n },
    (_, i) => `{"id": ${String(i + 1)}, "big": 9007199254740993, "s": "row ${String(i + 1)} ]},{"}`,
  )
  const asked: string[] = []
  const db: SqlExecutor = {
    kind: 'fake',
    execute: async (sql: string) => {
      asked.push(sql)
      if (sql.includes('pg_catalog.pg_index')) {
        return {
          rows:
            key === 'none'
              ? []
              : key.cols.map((c, i) => ({ col: c, typ: key.types[i], ord: i + 1 })),
        }
      }
      const after = /> \('(\d+)'::bigint\)/.exec(sql)?.[1]
      const ctidAfter = /ctid > '\((\d+),(\d+)\)'::tid/.exec(sql)
      const limit = Number(/limit (\d+)/.exec(sql)?.[1])
      const start =
        after !== undefined ? Number(after) : ctidAfter !== null ? Number(ctidAfter[2]) : 0
      return {
        rows: rows.slice(start, start + limit).map((j, i) => ({
          j,
          h: md5(j),
          k0: key === 'none' ? `(0,${String(start + i + 1)})` : String(start + i + 1),
        })),
      }
    },
  }
  return { db, rows, asked }
}

describe('pagedDump', () => {
  it('reads every row exactly once, in key order, across many pages, and the object is the old shape', async () => {
    const t = fakeTable(2500)
    const d = await pagedDump(t.db, 'public', 'jobs', { pageRows: 1000 })
    expect(d.rows).toBe(2500)
    expect(d.pages).toBe(3)
    const text = await gunzipText(d.bytes)
    const parsed = splitTable(text)
    expect(parsed.table).toBe('public.jobs')
    expect(parsed.rows).toEqual(t.rows)
    // and it is still valid JSON of the shape readFolder expects, with the old reader's field names
    expect(Object.keys(JSON.parse(text))).toEqual(['table', 'rows'])
  })

  it("uses a keyset predicate with the previous page's last key, never OFFSET", async () => {
    const t = fakeTable(2500)
    await pagedDump(t.db, 'public', 'jobs', { pageRows: 1000 })
    const pages = t.asked.filter((q) => q.includes('to_jsonb'))
    expect(pages[0]).not.toContain('where')
    expect(pages[1]).toContain(`where (s."id") > ('1000'::bigint)`)
    expect(pages[2]).toContain(`where (s."id") > ('2000'::bigint)`)
    for (const q of pages) {
      expect(q).not.toMatch(/offset/i)
      expect(q).toMatch(/order by s\."id" limit 1000/)
    }
  })

  it('computes the fingerprint as the sum of the first 48 bits of each row hash, mod 2^64', async () => {
    const t = fakeTable(37)
    const d = await pagedDump(t.db, 'public', 'jobs', { pageRows: 10 })
    const want = t.rows.reduce((a, r) => (a + rowHashValue(md5(r))) % (1n << 64n), 0n)
    expect(d.fingerprint).toBe(want.toString())
    // sensitive to a changed row and to a lost one
    const changed = [...t.rows]
    changed[5] = changed[5]?.replace('row 6', 'row X') as string
    expect(
      changed.reduce((a, r) => (a + rowHashValue(md5(r))) % (1n << 64n), 0n).toString(),
    ).not.toBe(d.fingerprint)
  })

  it('does not parse the row text: a number past 2^53 is in the object as written', async () => {
    const t = fakeTable(3)
    const d = await pagedDump(t.db, 'public', 'jobs')
    expect(await gunzipText(d.bytes)).toContain('"big": 9007199254740993')
  })

  it('handles an empty table and a table that is exactly one page', async () => {
    const empty = await pagedDump(fakeTable(0).db, 'public', 'e')
    expect(empty).toMatchObject({ rows: 0, pages: 0, fingerprint: '0' })
    expect(splitTable(await gunzipText(empty.bytes)).rows).toEqual([])
    const exact = await pagedDump(fakeTable(1000).db, 'public', 'x', { pageRows: 1000 })
    expect(exact).toMatchObject({ rows: 1000 })
    expect(exact.pages).toBeGreaterThanOrEqual(1)
  })

  it('pages by ctid when the table has no key, and says so', async () => {
    const t = fakeTable(25, 'none')
    const d = await pagedDump(t.db, 'public', 'heap', { pageRows: 10 })
    expect(d.keyedBy).toEqual(['ctid'])
    expect(d.rows).toBe(25)
    expect(t.asked.filter((q) => q.includes('to_jsonb')).some((q) => q.includes('s.ctid >'))).toBe(
      true,
    )
  })

  it('stops with a sentence when the compressed table passes the ceiling', async () => {
    const t = fakeTable(5000)
    await expect(
      pagedDump(t.db, 'public', 'jobs', { pageRows: 500, maxCompressedBytes: 50 }),
    ).rejects.toThrow(/public\.jobs is over 50 bytes compressed: it needs to be written in parts/)
  })

  it('holds one page of text at a time: the largest page is a small share of a large table', async () => {
    const t = fakeTable(20000)
    const d = await pagedDump(t.db, 'public', 'jobs', { pageRows: 500 })
    expect(d.pages).toBe(40)
    expect(d.maxPageChars).toBeLessThan(d.rawBytes / 30)
  })
})

describe('pageSql', () => {
  const key = { cols: ['a', 'b'], types: ['bigint', 'uuid'], physical: false }
  it('quotes identifiers and escapes values in a composite keyset predicate', () => {
    const sql = pageSql('public', 'we"ird', key, ['5', "o'brien"], 100)
    expect(sql).toContain('from "public"."we""ird" s')
    expect(sql).toContain(`where (s."a", s."b") > ('5'::bigint, 'o''brien'::uuid)`)
    expect(sql).toContain('order by s."a", s."b" limit 100')
    expect(sql).toContain('to_jsonb(s)::text as j')
  })
  it("selects the table's own row, nothing the query added, so the hash is of the data", () => {
    expect(pageSql('public', 't', key, null, 5)).not.toContain('_ctid')
  })
})
