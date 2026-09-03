/**
 * Migration integrity checks.
 *
 * Runs in CI before anything touches a database. The point is to catch the
 * mistakes that are cheap to make and expensive to discover later: a migration
 * renumbered under someone else's feet, an already-applied file edited in place,
 * or a statement that quietly undoes one of the core invariants.
 *
 * Pure by design — no filesystem, no network — so every rule below has a unit
 * test rather than a manual trial run.
 */

/** One migration file, as read from disk. */
export interface MigrationFile {
  /** Basename, e.g. `0001_create_events.sql`. */
  readonly name: string
  /** Raw file contents. */
  readonly sql: string
}

/** Content hashes of migrations that have already been applied somewhere. */
export type RecordedChecksums = Readonly<Record<string, string>>

export interface Finding {
  readonly severity: 'error'
  readonly file: string | null
  readonly rule: string
  readonly message: string
}

/**
 * Statements that must never appear in a migration because each one silently
 * dismantles a guarantee the specification requires be enforced by the
 * database rather than by convention.
 *
 * Each rule is matched against a **single statement**, not the whole file.
 * Matching across the file was the first implementation and it was wrong: a
 * legitimate `GRANT SELECT, INSERT ON events` followed by the very
 * `REVOKE UPDATE, DELETE, TRUNCATE ON events` the specification demands read as
 * one "grant … update … on … events" match. A checker that fires on correct
 * code is a checker someone switches off.
 *
 * So every pattern is anchored on the statement's leading keyword. `TRUNCATE`
 * as the verb of a statement is forbidden; `truncate` as a privilege being
 * revoked is required.
 */
const FORBIDDEN: ReadonlyArray<{
  rule: string
  matches: (statement: string) => boolean
  why: string
}> = [
  {
    rule: 'ledger/no-regrant-write',
    matches: (s) =>
      /^grant\b/.test(s) && /\bevents\b/.test(s) && /\b(update|delete|truncate)\b/.test(s),
    why:
      'master spec §6 requires UPDATE/DELETE on events to be revoked from the ' +
      'application role. Granting it back makes the ledger mutable.',
  },
  {
    rule: 'ledger/no-drop',
    matches: (s) => /^drop\s+table\b/.test(s) && /\bevents\b/.test(s),
    why: 'the event ledger is append-only history and is never dropped by a migration.',
  },
  {
    rule: 'ledger/no-truncate',
    // The verb, not the privilege. REVOKE ... TRUNCATE ... is required, not forbidden.
    matches: (s) => /^truncate\b/.test(s) && /\bevents\b/.test(s),
    why: 'TRUNCATE erases history and bypasses the DELETE revoke entirely.',
  },
  {
    rule: 'rls/no-disable',
    matches: (s) => /^alter\s+table\b/.test(s) && /\bdisable\s+row\s+level\s+security\b/.test(s),
    why: 'master spec §6 requires row-level security throughout.',
  },
  {
    rule: 'security/no-superuser-grant',
    matches: (s) => /^grant\s+(postgres|supabase_admin)\s+to\b/.test(s),
    why: 'granting a superuser role to an application role defeats every other check.',
  },
]

/** `0001_snake_case_name.sql` — four digits, underscore, lower snake case. */
const NAME_PATTERN = /^(\d{4})_([a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/

/**
 * Check a set of migration files against the recorded checksums.
 *
 * @param files Migrations as read from `migrations/`, in any order.
 * @param recorded Checksums of migrations already applied. Pass `{}` before the
 *   first migration has ever run.
 * @param hash Content hashing function, injected so this stays pure.
 * @returns Every finding, in a stable order. Empty means the check passed.
 */
export function checkMigrations(
  files: readonly MigrationFile[],
  recorded: RecordedChecksums,
  hash: (content: string) => string,
): Finding[] {
  const findings: Finding[] = []
  const err = (file: string | null, rule: string, message: string): void => {
    findings.push({ severity: 'error', file, rule, message })
  }

  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name))

  // --- naming, and the sequence numbers we can trust afterwards -------------
  const sequences = new Map<number, string[]>()
  for (const file of sorted) {
    const match = NAME_PATTERN.exec(file.name)
    if (!match) {
      err(
        file.name,
        'name/format',
        'expected NNNN_snake_case_name.sql — four digits, underscore, lower snake case',
      )
      continue
    }
    // Group indices 1 and 2 exist whenever the regex matched.
    const sequence = Number.parseInt(match[1] as string, 10)
    const existing = sequences.get(sequence)
    if (existing) existing.push(file.name)
    else sequences.set(sequence, [file.name])

    if (file.sql.trim() === '') {
      err(file.name, 'content/empty', 'migration is empty')
    }
  }

  // --- duplicate and missing sequence numbers ------------------------------
  for (const [sequence, names] of [...sequences].sort((a, b) => a[0] - b[0])) {
    if (names.length > 1) {
      err(
        null,
        'sequence/duplicate',
        `sequence ${String(sequence).padStart(4, '0')} used by ${names.length} files: ${names.join(', ')}`,
      )
    }
  }

  const numbers = [...sequences.keys()].sort((a, b) => a - b)
  if (numbers.length > 0) {
    if (numbers[0] !== 1) {
      err(null, 'sequence/start', `migrations must start at 0001, found ${String(numbers[0])}`)
    }
    for (let i = 1; i < numbers.length; i++) {
      const previous = numbers[i - 1] as number
      const current = numbers[i] as number
      if (current !== previous + 1) {
        err(
          null,
          'sequence/gap',
          `gap between ${String(previous).padStart(4, '0')} and ${String(current).padStart(4, '0')}`,
        )
      }
    }
  }

  // --- forbidden statements ------------------------------------------------
  for (const file of sorted) {
    const reported = new Set<string>()
    for (const statement of splitStatements(file.sql)) {
      for (const { rule, matches, why } of FORBIDDEN) {
        // One finding per rule per file. Ten offending statements are one
        // mistake to fix, not ten.
        if (!reported.has(rule) && matches(statement)) {
          reported.add(rule)
          err(file.name, rule, why)
        }
      }
    }
  }

  // --- immutability of applied history -------------------------------------
  const present = new Set(sorted.map((f) => f.name))
  for (const file of sorted) {
    const known = recorded[file.name]
    if (known !== undefined && known !== hash(file.sql)) {
      err(
        file.name,
        'checksum/modified',
        'this migration has already been applied and its contents changed. ' +
          'Applied migrations are immutable — add a new migration instead.',
      )
    }
  }
  for (const name of Object.keys(recorded).sort()) {
    if (!present.has(name)) {
      err(
        name,
        'checksum/missing',
        'a migration that has already been applied is no longer in migrations/. ' +
          'Deleting applied history makes the database unreproducible.',
      )
    }
  }

  return findings
}

/**
 * Remove SQL comments so a forbidden pattern cannot hide in prose — and, just
 * as importantly, so a comment *explaining* a rule does not trip it.
 */
export function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')
}

/**
 * Split SQL into individual statements, lowercased and whitespace-normalised.
 *
 * Dollar-quote aware, which is not optional here: this project's migrations
 * define plpgsql functions whose bodies are full of semicolons. Splitting
 * naively on `;` would shred `$$ ... $$` bodies into fragments and match
 * patterns against nonsense.
 *
 * Single-quoted literals are tracked for the same reason — a semicolon inside a
 * comment string is not a statement boundary.
 *
 * This is not a SQL parser and does not need to be. It needs to find statement
 * boundaries well enough that a leading-keyword anchor means what it says.
 */
export function splitStatements(sql: string): string[] {
  const source = stripComments(sql)
  const statements: string[] = []
  let current = ''
  let index = 0

  while (index < source.length) {
    const rest = source.slice(index)

    // Dollar-quoted string: $tag$ ... $tag$
    const dollarOpen = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(rest)
    if (dollarOpen) {
      const tag = dollarOpen[0]
      const closeAt = source.indexOf(tag, index + tag.length)
      const end = closeAt === -1 ? source.length : closeAt + tag.length
      current += source.slice(index, end)
      index = end
      continue
    }

    const char = source[index] as string

    // Single-quoted literal, with '' as an escaped quote.
    if (char === "'") {
      let cursor = index + 1
      while (cursor < source.length) {
        if (source[cursor] === "'") {
          if (source[cursor + 1] === "'") cursor += 2
          else {
            cursor += 1
            break
          }
        } else cursor += 1
      }
      current += source.slice(index, cursor)
      index = cursor
      continue
    }

    if (char === ';') {
      statements.push(current)
      current = ''
      index += 1
      continue
    }

    current += char
    index += 1
  }
  statements.push(current)

  return statements.map((s) => s.replace(/\s+/g, ' ').trim().toLowerCase()).filter((s) => s !== '')
}
