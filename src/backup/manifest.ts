/**
 * What a backup manifest claims, and the pure checks of those claims (G-2).
 *
 * `verifyArchive` is asked of a stored archive BEFORE anything is restored: does every object the manifest names
 * exist and carry the checksum recorded beside it, do the counts add up, is anything missing that a working system
 * needs. `verifyRestored` is asked AFTER: did every table come back with the row count and the content fingerprint the
 * manifest recorded. Neither does any I/O, so both can be driven with adversarial manifests in a unit test.
 *
 * A manifest from before this change (no `objects`, no `fingerprints`, no `aux`) still verifies, with WARNINGS saying
 * what could not be checked. It never silently passes a check it was unable to make.
 */

import type { Aux } from './aux.ts'

export interface Manifest {
  readonly format?: string
  readonly exported_at?: string
  readonly project_ref?: string
  readonly latest_migration?: string
  readonly migrations?: readonly string[]
  readonly row_counts?: Readonly<Record<string, number>>
  readonly tables?: number
  readonly rows?: number
  readonly schema?: readonly {
    t: string
    column_name: string
    data_type?: string
    is_nullable?: string
  }[]
  /** Per object key: the sha256 of its compressed bytes and its size. */
  readonly objects?: Readonly<Record<string, { sha256: string; bytes: number }>>
  /** Per table: the content fingerprint (paged.ts). */
  readonly fingerprints?: Readonly<Record<string, string>>
  readonly aux?: Aux
}

export interface Verdict {
  readonly ok: boolean
  /** A restore must refuse. */
  readonly errors: readonly string[]
  /** A restore may proceed, and the person is told. */
  readonly warnings: readonly string[]
  readonly tables: number
  readonly rows: number
}

export interface ObservedObject {
  readonly sha256: string
  readonly bytes: number
}

/** The object key a table lives at under a run prefix. */
export const tableKey = (prefix: string, qualified: string): string =>
  `${prefix}/${qualified}.json.gz`

export function verifyArchive(
  manifest: Manifest,
  prefix: string,
  observed: ReadonlyMap<string, ObservedObject>,
): Verdict {
  const errors: string[] = []
  const warnings: string[] = []
  const counts = manifest.row_counts ?? {}
  const names = Object.keys(counts)

  if (names.length === 0) errors.push('the manifest lists no tables')
  const total = names.reduce((a, t) => a + Number(counts[t] ?? 0), 0)
  if (manifest.rows !== undefined && manifest.rows !== total) {
    errors.push(
      `the manifest says ${String(manifest.rows)} rows and its tables add up to ${String(total)}`,
    )
  }
  if (manifest.tables !== undefined && manifest.tables !== names.length) {
    errors.push(
      `the manifest says ${String(manifest.tables)} tables and lists ${String(names.length)}`,
    )
  }
  for (const [t, n] of Object.entries(counts)) {
    if (!Number.isInteger(n) || n < 0) errors.push(`${t}: row count ${String(n)} is not a count`)
  }

  const recorded = manifest.objects
  if (recorded === undefined) {
    warnings.push(
      'this manifest records no object checksums (taken before they were recorded): objects are checked only against the sidecar files',
    )
  }
  for (const t of names) {
    const key = tableKey(prefix, t)
    const seen = observed.get(key)
    if (seen === undefined) {
      errors.push(`${t}: its object ${key} is missing`)
      continue
    }
    const want = recorded?.[key]
    if (want !== undefined) {
      if (want.sha256 !== seen.sha256)
        errors.push(`${t}: its object does not match the checksum the manifest recorded`)
      else if (want.bytes !== seen.bytes)
        errors.push(
          `${t}: its object is ${String(seen.bytes)} bytes, the manifest recorded ${String(want.bytes)}`,
        )
    }
  }
  const expected = new Set(names.map((t) => tableKey(prefix, t)))
  for (const key of observed.keys()) {
    if (key.endsWith('.json.gz') && !key.endsWith('/manifest.json.gz') && !expected.has(key)) {
      warnings.push(
        `${key} is in the folder and not in the manifest (a table created while the run was in progress)`,
      )
    }
  }

  if (manifest.fingerprints === undefined) {
    warnings.push(
      'no content fingerprints: a restore can check counts but not that every value came back',
    )
  } else {
    for (const t of names) {
      if (counts[t] !== 0 && manifest.fingerprints[t] === undefined) {
        warnings.push(`${t}: no content fingerprint`)
      }
    }
  }

  const aux = manifest.aux
  if (aux === undefined) {
    warnings.push(
      'no auxiliary section: logins, schedules, secret names, storage objects and sequences were not recorded',
    )
  } else {
    for (const [name, sec] of Object.entries(aux)) {
      if (
        typeof sec === 'object' &&
        sec !== null &&
        'ok' in sec &&
        (sec as { ok: boolean }).ok === false
      ) {
        warnings.push(
          `aux.${name} could not be read when the backup ran: ${String((sec as { error?: string }).error ?? 'no reason given')}`,
        )
      }
    }
    if (aux.structure === null)
      warnings.push(
        'aux.structure is missing: a restore cannot check the target was built from the same migrations',
      )
    if (aux.storage_objects?.truncated === true)
      warnings.push('aux.storage_objects was cut at its row limit')
  }

  return { ok: errors.length === 0, errors, warnings, tables: names.length, rows: total }
}

export interface RestoredTable {
  readonly rows: number
  readonly fingerprint: string
}

/** Compare what was loaded with what the manifest recorded, table by table. */
export function verifyRestored(
  manifest: Manifest,
  restored: ReadonlyMap<string, RestoredTable>,
): Verdict {
  const errors: string[] = []
  const warnings: string[] = []
  const counts = manifest.row_counts ?? {}
  let rows = 0
  for (const [t, want] of Object.entries(counts)) {
    const got = restored.get(t)
    if (got === undefined) {
      errors.push(`${t}: not restored`)
      continue
    }
    rows += got.rows
    if (got.rows !== want)
      errors.push(`${t}: restored ${String(got.rows)} rows, the manifest recorded ${String(want)}`)
    const fp = manifest.fingerprints?.[t]
    if (fp === undefined) {
      if (want !== 0) warnings.push(`${t}: no fingerprint to compare`)
    } else if (fp !== got.fingerprint) {
      errors.push(`${t}: content does not match (fingerprint ${got.fingerprint}, recorded ${fp})`)
    }
  }
  return { ok: errors.length === 0, errors, warnings, tables: Object.keys(counts).length, rows }
}
