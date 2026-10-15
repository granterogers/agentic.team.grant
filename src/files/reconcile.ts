/**
 * Metadata against objects: what the database says is stored, and what the provider actually holds (#469, B2).
 *
 * Pure. The caller reads the rows and the objects; this only compares them. A row with no object is a file that will fail
 * when someone opens it. An object with no row is storage nobody can account for. A checksum that differs is corruption
 * or a bad copy, and it is reported with the path so the owner can act on it.
 *
 * Plain words in this file's comments; no backticks, because this file is read by the template check.
 */

export interface StoredRow {
  path: string
  sha256: string
  bytes: number
}

export interface StoredObject {
  path: string
  sha256: string
  bytes: number
}

export interface Reconciliation {
  /** Recorded in a row, not present in the store. */
  missing: string[]
  /** Present in the store, recorded in no row. */
  orphaned: string[]
  /** Present in both, with a different checksum or size. */
  mismatched: { path: string; reason: 'sha256' | 'bytes' }[]
  /** True only when nothing is missing, orphaned or mismatched. */
  clean: boolean
}

export function reconcile(rows: StoredRow[], objects: StoredObject[]): Reconciliation {
  const byPath = new Map(objects.map((o) => [o.path, o]))
  const recorded = new Set(rows.map((r) => r.path))
  const missing: string[] = []
  const mismatched: Reconciliation['mismatched'] = []
  for (const row of rows) {
    const obj = byPath.get(row.path)
    if (!obj) {
      missing.push(row.path)
      continue
    }
    if (obj.sha256 !== row.sha256) mismatched.push({ path: row.path, reason: 'sha256' })
    else if (obj.bytes !== row.bytes) mismatched.push({ path: row.path, reason: 'bytes' })
  }
  const orphaned = objects.filter((o) => !recorded.has(o.path)).map((o) => o.path)
  return {
    missing,
    orphaned,
    mismatched,
    clean: missing.length === 0 && orphaned.length === 0 && mismatched.length === 0,
  }
}
