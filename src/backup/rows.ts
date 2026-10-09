/**
 * Read a dumped table back WITHOUT parsing its numbers.
 *
 * A table object is `{"table":"public.jobs","rows":[ROW,ROW,...]}` where each ROW is Postgres's own `to_jsonb` text
 * (see paged.ts). `JSON.parse` would turn a bigint past 2^53 or a numeric with more than 17 significant digits into a
 * double, and then the restore would write a different number than the one that was backed up and say nothing. So the
 * restore never parses: it SPLITS the array into row texts by tracking strings and nesting, and hands those texts
 * unchanged to `jsonb_populate_recordset`.
 *
 * The splitter is a state machine over the characters, not a regex: a row can contain a string holding `]`, `},{`, an
 * escaped quote or a backslash, and a regex over those is the kind of thing that works on every fixture and fails on
 * the one document with a code sample in it.
 */

export interface TableText {
  readonly table: string
  /** Row texts, exactly as dumped, in order. */
  readonly rows: readonly string[]
}

const MARK = ',"rows":['
const OPEN = '{"table":'

/** Split a dumped table object into its table name and row texts. Throws on anything that is not that shape. */
export function splitTable(text: string): TableText {
  const head = text.indexOf(MARK, OPEN.length)
  if (!text.startsWith(`${OPEN}"`) || head < 0) {
    throw new Error('not a table object: it does not begin {"table":"...","rows":[')
  }
  const name = JSON.parse(text.slice(OPEN.length, head)) as string
  const rows: string[] = []
  let i = head + MARK.length
  const n = text.length
  // after the array's `[`: either `]` (empty) or a row
  while (i < n) {
    const c = text.charCodeAt(i)
    if (c === 0x5d /* ] */) {
      if (!text.endsWith(']}')) throw new Error('table object is truncated: no closing ]}')
      return { table: name, rows }
    }
    if (c === 0x2c /* , */ || c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09) {
      i += 1
      continue
    }
    if (c !== 0x7b /* { */)
      throw new Error(`a row must be an object; found ${JSON.stringify(text[i])} at ${String(i)}`)
    let depth = 0
    let inString = false
    const start = i
    for (; i < n; i++) {
      const ch = text.charCodeAt(i)
      if (inString) {
        if (ch === 0x5c /* \ */) i += 1
        else if (ch === 0x22 /* " */) inString = false
        continue
      }
      if (ch === 0x22) inString = true
      else if (ch === 0x7b || ch === 0x5b) depth += 1
      else if (ch === 0x7d || ch === 0x5d) {
        depth -= 1
        if (depth === 0) {
          i += 1
          break
        }
      }
    }
    if (depth !== 0) throw new Error('table object is truncated inside a row')
    rows.push(text.slice(start, i))
  }
  throw new Error('table object is truncated: the rows array never closes')
}
