/**
 * Large tables written in parts (#503). The pure pieces, without a database: the range a part reads, where parts
 * start and end, how their fingerprints combine, how many rows a part holds, how a part object is read back, and how a
 * manifest that lists parts is verified. The real end-to-end proof, including a worker that dies part way through a
 * split table and the next attempt carrying on, is `scripts/isolated/backup-restore-typed.ts`.
 */
import { describe, expect, it } from 'vitest'
import {
  type Manifest,
  type ObservedObject,
  objectKeys,
  tableKey,
  verifyArchive,
} from '../../src/backup/manifest.ts'
import {
  addFingerprints,
  boundarySql,
  type Key,
  pageSql,
  rangesFrom,
  rowHashValue,
} from '../../src/backup/paged.ts'
import { partKey, partStep, rowsPerPart } from '../../src/backup/parts.ts'
import { splitTable } from '../../src/backup/rows.ts'

const composite: Key = { cols: ['a', 'b'], types: ['bigint', 'uuid'], physical: false }
const heap: Key = { cols: ['ctid'], types: ['tid'], physical: true }

describe('a part reads a key range', () => {
  it('bounds a page on both sides, strictly after and up to and including', () => {
    const sql = pageSql('public', 't', composite, ['5', 'x'], 100, ['9', 'y'])
    expect(sql).toContain(`(s."a", s."b") > ('5'::bigint, 'x'::uuid)`)
    expect(sql).toContain(`(s."a", s."b") <= ('9'::bigint, 'y'::uuid)`)
    expect(sql).toMatch(/where .+ and .+ order by/)
  })

  it('is open on a side given null, and the whole table with neither (control: the unbounded query is unchanged)', () => {
    expect(pageSql('public', 't', composite, null, 100, ['9', 'y'])).not.toContain(' > (')
    expect(pageSql('public', 't', composite, ['5', 'x'], 100, null)).not.toContain('<=')
    expect(pageSql('public', 't', composite, null, 100)).toBe(
      pageSql('public', 't', composite, null, 100, null),
    )
    expect(pageSql('public', 't', composite, null, 100)).not.toContain('where')
  })

  it('refuses a range on a table with no key: ctid moves under an update', () => {
    expect(() => pageSql('public', 'h', heap, null, 100, ['(0,1)'])).toThrow(/no key/)
    expect(() => boundarySql('public', 'h', heap, 10)).toThrow(/cannot be split/)
  })

  it('quotes a literal inside a boundary, so a key value cannot end the statement', () => {
    const sql = pageSql('public', 't', { ...composite, types: ['text', 'text'] }, null, 1, [
      "o'brien",
      'x',
    ])
    expect(sql).toContain(`'o''brien'::text`)
  })
})

describe('where parts start and end', () => {
  it('picks every Nth key in key order, by the key columns only', () => {
    const sql = boundarySql('public', 't', composite, 40000)
    expect(sql).toContain('row_number() over (order by s."a", s."b")')
    expect(sql).toContain('x.rn__ % 40000 = 0')
    expect(sql).not.toContain('to_jsonb')
  })

  it('turns N boundaries into N+1 consecutive ranges, the last open for rows added since', () => {
    expect(rangesFrom([['10'], ['20']])).toEqual([
      { after: null, through: ['10'] },
      { after: ['10'], through: ['20'] },
      { after: ['20'], through: null },
    ])
    // no boundary: the whole table, which is what an unsplit table reads
    expect(rangesFrom([])).toEqual([{ after: null, through: null }])
  })

  it('each boundary ends one part and starts the next exactly once (no gap, no overlap)', () => {
    const ranges = rangesFrom([['3'], ['6']])
    const inRange = (k: number, r: (typeof ranges)[number]): boolean =>
      (r.after === null || k > Number(r.after[0])) &&
      (r.through === null || k <= Number(r.through[0]))
    for (let k = 0; k <= 10; k++) expect(ranges.filter((r) => inRange(k, r))).toHaveLength(1)
  })
})

describe('how big a part is', () => {
  it('aims at the raw JSON budget, never below the floor', () => {
    expect(rowsPerPart(400)).toBe(Math.floor((16 * 1024 * 1024) / 400))
    expect(rowsPerPart(10_000_000)).toBe(500)
    expect(rowsPerPart(0)).toBe(16 * 1024 * 1024)
    expect(rowsPerPart(100, { partRawBytes: 1000, minRowsPerPart: 2 })).toBe(10)
  })

  it('names parts so they sort in order, and the step names cannot collide with a whole table step', () => {
    expect(partKey('run-x', 'public.t', 2)).toBe('run-x/public.t.part-0002.json.gz')
    expect(partKey('run-x', 'public.t', 10) > partKey('run-x', 'public.t', 9)).toBe(true)
    expect(partStep('public.t', 1)).toBe('table:public.t#part-0001')
    expect(partStep('public.t', 1)).not.toBe('table:public.t')
  })
})

describe('the parts add up to the table', () => {
  it('the table fingerprint is the sum of the parts, mod 2^64, in any order', () => {
    const hashes = ['ffffffffffff0000', '0123456789ab0000', 'aaaaaaaaaaaa0000', '000000000001ffff']
    const v = hashes.map(rowHashValue)
    const whole = v.reduce((a, b) => (a + b) % (1n << 64n), 0n).toString()
    const p1 = ((v[0] as bigint) + (v[1] as bigint)).toString()
    const p2 = ((v[2] as bigint) + (v[3] as bigint)).toString()
    expect(addFingerprints([p1, p2])).toBe(whole)
    expect(addFingerprints([p2, p1])).toBe(whole)
    expect(addFingerprints([])).toBe('0')
  })

  it('wraps at 2^64 rather than growing (control: without the mod the sum would be larger)', () => {
    const near = ((1n << 64n) - 1n).toString()
    expect(addFingerprints([near, '2'])).toBe('1')
  })
})

describe('a part object reads back', () => {
  it('splits a part, whose header carries its number, into the same table name and rows', () => {
    const got = splitTable('{"table":"public.t","part":3,"rows":[{"a":1},{"a":"]},{"}]}')
    expect(got.table).toBe('public.t')
    expect(got.rows).toEqual(['{"a":1}', '{"a":"]},{"}'])
  })

  it('still reads a whole-table object, and refuses a header that is neither', () => {
    expect(splitTable('{"table":"public.t","rows":[]}').rows).toEqual([])
    expect(() => splitTable('{"table":"public.t","other":1,"rows":[]}')).toThrow(/header/)
  })
})

describe('verifying a manifest that lists parts', () => {
  const P = 'run-aaaaaaaa-0000-4000-8000-000000000000'
  const sha = (c: string): string => c.repeat(64)
  const parts = [partKey(P, 'public.big', 1), partKey(P, 'public.big', 2)]
  const good = (): { manifest: Manifest; observed: Map<string, ObservedObject> } => ({
    manifest: {
      format: 'folder/2',
      row_counts: { 'public.big': 10, 'public.small': 1 },
      rows: 11,
      tables: 2,
      objects: {
        [parts[0] as string]: { sha256: sha('a'), bytes: 5 },
        [parts[1] as string]: { sha256: sha('b'), bytes: 6 },
        [tableKey(P, 'public.small')]: { sha256: sha('c'), bytes: 7 },
      },
      fingerprints: { 'public.big': '1', 'public.small': '2' },
      parts: { 'public.big': parts },
    },
    observed: new Map<string, ObservedObject>([
      [parts[0] as string, { sha256: sha('a'), bytes: 5 }],
      [parts[1] as string, { sha256: sha('b'), bytes: 6 }],
      [tableKey(P, 'public.small'), { sha256: sha('c'), bytes: 7 }],
    ]),
  })

  it('names the objects of a split table and of a whole one', () => {
    const { manifest } = good()
    expect(objectKeys(manifest, P, 'public.big')).toEqual(parts)
    expect(objectKeys(manifest, P, 'public.small')).toEqual([tableKey(P, 'public.small')])
  })

  it('passes a complete folder (control for every refusal below)', () => {
    const { manifest, observed } = good()
    const v = verifyArchive(manifest, P, observed)
    expect(v.errors).toEqual([])
    expect(v.warnings.some((w) => w.includes('not in the manifest'))).toBe(false)
  })

  it('refuses a missing part, naming it', () => {
    const { manifest, observed } = good()
    observed.delete(parts[1] as string)
    expect(verifyArchive(manifest, P, observed).errors.join()).toContain(parts[1] as string)
  })

  it('refuses a part whose bytes are not the ones its attempt recorded', () => {
    const { manifest, observed } = good()
    observed.set(parts[0] as string, { sha256: sha('z'), bytes: 5 })
    expect(verifyArchive(manifest, P, observed).ok).toBe(false)
  })

  it('refuses a part the manifest names without a recorded checksum', () => {
    const { manifest, observed } = good()
    const objects = { ...manifest.objects }
    delete objects[parts[1] as string]
    expect(verifyArchive({ ...manifest, objects }, P, observed).errors.join()).toMatch(
      /no checksum for its part/,
    )
  })

  it('refuses parts listed for a table it does not count, an empty list, or a part outside the folder', () => {
    const { manifest, observed } = good()
    expect(
      verifyArchive(
        { ...manifest, parts: { ...manifest.parts, 'public.ghost': parts } },
        P,
        observed,
      ).ok,
    ).toBe(false)
    expect(verifyArchive({ ...manifest, parts: { 'public.big': [] } }, P, observed).ok).toBe(false)
    expect(
      verifyArchive(
        { ...manifest, parts: { 'public.big': ['run-other/public.big.part-0001.json.gz'] } },
        P,
        observed,
      ).ok,
    ).toBe(false)
  })
})
