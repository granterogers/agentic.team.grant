/**
 * Split a migration into the statements a server would run one at a time, keeping their text exactly.
 *
 * This is NOT `splitStatements` in check.ts (which lowercases and normalises for pattern matching and so cannot be executed).
 * It exists for one use: replaying history on a FRESH project over the Management API, where a few old migrations end in
 * a data assertion that needs production rows and the rest of the file must still apply (src/migrations/fresh.ts).
 * It understands what can hide a semicolon: single-quoted strings (with '' escapes, and backslash escapes in E'...'),
 * double-quoted identifiers, dollar-quoted bodies ($$ ... $$ and $tag$ ... $tag$), `--` line comments and nested
 * block comments. It is not a SQL parser and does not need to be.
 */

const isIdent = (c: string | undefined): boolean => c !== undefined && /[A-Za-z0-9_]/.test(c)

export function splitExecutable(sql: string): string[] {
  const out: string[] = []
  let start = 0
  let i = 0
  const n = sql.length
  const flush = (end: number): void => {
    const piece = sql.slice(start, end).trim()
    // Only comments and whitespace between two semicolons is not a statement. (A regex for this backtracks exponentially.)
    if (piece !== '' && withoutLeadingComments(piece) !== '') out.push(piece)
    start = end + 1
  }
  while (i < n) {
    const c = sql[i] as string
    const d = sql[i + 1]
    if (c === '-' && d === '-') {
      const nl = sql.indexOf('\n', i)
      i = nl === -1 ? n : nl + 1
    } else if (c === '/' && d === '*') {
      let depth = 1
      i += 2
      while (i < n && depth > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') {
          depth += 1
          i += 2
        } else if (sql[i] === '*' && sql[i + 1] === '/') {
          depth -= 1
          i += 2
        } else i += 1
      }
    } else if (c === "'") {
      const escaped = isIdent(sql[i - 1])
        ? /[eE]/.test(sql[i - 1] as string) && !isIdent(sql[i - 2])
        : false
      i += 1
      while (i < n) {
        if (escaped && sql[i] === '\\') i += 2
        else if (sql[i] === "'" && sql[i + 1] === "'") i += 2
        else if (sql[i] === "'") {
          i += 1
          break
        } else i += 1
      }
    } else if (c === '"') {
      i += 1
      while (i < n) {
        if (sql[i] === '"' && sql[i + 1] === '"') i += 2
        else if (sql[i] === '"') {
          i += 1
          break
        } else i += 1
      }
    } else if (c === '$' && !isIdent(sql[i - 1])) {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 80))
      if (m === null) {
        i += 1
      } else {
        const tag = m[0]
        const close = sql.indexOf(tag, i + tag.length)
        i = close === -1 ? n : close + tag.length
      }
    } else if (c === ';') {
      flush(i)
      i += 1
    } else i += 1
  }
  flush(n)
  return out
}

/** The statement without the comments that precede it (a statement carries the comment lines written above it). */
export const withoutLeadingComments = (statement: string): string => {
  let t = statement.trimStart()
  for (;;) {
    if (t.startsWith('--')) {
      const nl = t.indexOf('\n')
      t = nl === -1 ? '' : t.slice(nl + 1).trimStart()
    } else if (t.startsWith('/*')) {
      let depth = 0
      let i = 0
      do {
        if (t.startsWith('/*', i)) {
          depth += 1
          i += 2
        } else if (t.startsWith('*/', i)) {
          depth -= 1
          i += 2
        } else i += 1
      } while (i < t.length && depth > 0)
      t = t.slice(i).trimStart()
    } else return t
  }
}

/** A statement that only controls the transaction. Replaying statement by statement, each one commits on its own. */
export const isTransactionControl = (statement: string): boolean => {
  const t = withoutLeadingComments(statement)
  return (
    /^(begin|commit|end|rollback|abort|start\s+transaction)\b/i.test(t) &&
    !/^begin\s+atomic\b/i.test(t)
  )
}
