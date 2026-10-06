import { describe, expect, it } from 'vitest'
import { splitTable } from '../../src/backup/rows.ts'

const table = (rows: string[], name = 'public.t'): string =>
  `{"table":${JSON.stringify(name)},"rows":[${rows.join(',')}]}`

describe('splitTable: rows come out as the exact text that went in', () => {
  it('splits ordinary rows and an empty table', () => {
    expect(splitTable(table(['{"a": 1}', '{"a": 2}']))).toEqual({
      table: 'public.t',
      rows: ['{"a": 1}', '{"a": 2}'],
    })
    expect(splitTable(table([])).rows).toEqual([])
  })

  it('does not parse numbers: digits past 2^53 survive byte for byte', () => {
    const row = '{"id": 9007199254740993, "n": 12345678901234567890.123456, "e": 1e400}'
    expect(splitTable(table([row])).rows[0]).toBe(row)
    expect(String(JSON.parse(row).id)).toBe('9007199254740992') // a parse would have changed it to this
  })

  it('is not fooled by brackets, braces, commas, escaped quotes and backslashes inside strings', () => {
    const rows = [
      '{"s": "a]},{\\"b\\": [1,2] }"}',
      '{"s": "ends with a backslash \\\\"}',
      '{"s": "\\"", "t": "{[\\u005d"}',
      '{"nested": {"a": [{"b": "}]"}], "c": "x"}}',
    ]
    expect(splitTable(table(rows)).rows).toEqual(rows)
  })

  it('reads the table name with awkward characters', () => {
    expect(splitTable(table(['{"a": 1}'], 'public."odd name"')).table).toBe('public."odd name"')
  })

  it('refuses anything that is not a whole table object', () => {
    expect(() => splitTable('[1,2,3]')).toThrow(/not a table object/)
    expect(() => splitTable('{"table":"t","rows":[{"a": 1}')).toThrow(/truncated/)
    expect(() => splitTable('{"table":"t","rows":[{"a": 1},{"b": ')).toThrow(/truncated/)
    expect(() => splitTable('{"table":"t","rows":[1,2]}')).toThrow(/must be an object/)
    expect(() => splitTable('{"table":"t","rows":[{"a": 1}]')).toThrow(/truncated/)
  })

  it('splits 50,000 rows without losing one', () => {
    const rows = Array.from(
      { length: 50000 },
      (_, i) => `{"i": ${String(i)}, "t": "x,}]${String(i)}"}`,
    )
    const got = splitTable(table(rows)).rows
    expect(got).toHaveLength(50000)
    expect(got[49999]).toBe(rows[49999])
  })
})
