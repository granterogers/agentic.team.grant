/**
 * The static half of the preflight's read-only guarantee: a statement is sent only if it is ONE `select`, with no second statement and
 * none of the words that write, lock, sleep or change a setting. It is a refusal in front of the real guarantee, which is the database's:
 * the preflight sends everything through the Management API's read-only endpoint, which runs as a read-only role. This module has no side
 * effect when imported, so a test can hold every statement of the preflight file to it.
 */
export const isPlainSelect = (sql: string): boolean => {
  const s = sql.trim().replace(/;\s*$/, '')
  if (!/^select\b/i.test(s)) return false
  if (s.includes(';')) return false
  return !/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|call|do|pg_sleep|nextval|setval|set_config|lock)\b/i.test(
    s.replace(/'[^']*'/g, "''"),
  )
}

/** Statements are the lines after a `-- Pnn` comment, up to the next blank line; comment lines are dropped. */
export const parsePreflight = (text: string): { id: string; sql: string }[] => {
  const out: { id: string; sql: string }[] = []
  let id = ''
  let buf: string[] = []
  const flush = (): void => {
    if (id !== '' && buf.length > 0) out.push({ id, sql: buf.join(' ').trim() })
    buf = []
  }
  for (const line of text.split('\n')) {
    const m = /^-- (P\d\d[a-z]?) /.exec(line)
    if (m !== null) {
      flush()
      id = m[1] ?? ''
      continue
    }
    if (line.startsWith('--')) continue
    if (line.trim() === '') {
      // the id is kept until the next label; a following statement without a label is ignored
      flush()
      continue
    }
    buf.push(line)
  }
  flush()
  return out
}
