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
 * Every pattern is anchored on the `events` ledger. A future table with the
 * same requirements should be added here rather than trusted to review.
 */
const FORBIDDEN: ReadonlyArray<{ rule: string; pattern: RegExp; why: string }> = [
  {
    rule: 'ledger/no-regrant-write',
    pattern:
      /\bgrant\b[\s\S]{0,200}?\b(update|delete|truncate)\b[\s\S]{0,200}?\bon\b[\s\S]{0,80}?\bevents\b/i,
    why:
      'master spec §6 requires UPDATE/DELETE on events to be revoked from the ' +
      'application role. Granting it back makes the ledger mutable.',
  },
  {
    rule: 'ledger/no-drop',
    pattern: /\bdrop\s+table\b[\s\S]{0,40}?\bevents\b/i,
    why: 'the event ledger is append-only history and is never dropped by a migration.',
  },
  {
    rule: 'ledger/no-truncate',
    pattern: /\btruncate\b[\s\S]{0,40}?\bevents\b/i,
    why: 'TRUNCATE erases history and bypasses the DELETE revoke entirely.',
  },
  {
    rule: 'rls/no-disable',
    pattern: /\balter\s+table\b[\s\S]{0,120}?\bdisable\s+row\s+level\s+security\b/i,
    why: 'master spec §6 requires row-level security throughout.',
  },
  {
    rule: 'security/no-superuser-grant',
    pattern: /\bgrant\b[\s\S]{0,80}?\b(postgres|supabase_admin)\b[\s\S]{0,40}?\bto\b/i,
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
    const sql = stripComments(file.sql)
    for (const { rule, pattern, why } of FORBIDDEN) {
      if (pattern.test(sql)) {
        err(file.name, rule, why)
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
