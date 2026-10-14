/**
 * Moving an office's stored files from one provider to another, safely (#469, B2).
 *
 * Copy, verify, then switch. Nothing is removed from the source, so the old provider stays complete until the switch.
 *
 *   1. Preflight: a target that already holds a different object at a path is a conflict, and the run stops before any write.
 *   2. For each file, in order: read it from the source and check its checksum against the recorded one; write it to the
 *      target; read it back from the target and check the checksum again.
 *   3. The first failure stops the run. Every object this run wrote is removed from the target, and the pointer stays on
 *      the source. Nothing the run did not write is touched.
 *   4. Only when every file has verified is the pointer moved to the target.
 *
 * The pointer is a plain object the caller owns (in production, a row the owner's office reads). Tests drive it directly.
 * A hash mismatch is a refusal, not a warning: a copy that cannot be proven identical is not switched to.
 *
 * Plain words in this file's comments; no backticks, because this file is read by the template check.
 */

import { assertSafePath, type ObjectStore } from './object-store.ts'
import { sha256Hex } from './policy.ts'

export interface MigrationRow {
  path: string
  sha256: string
  bytes: number
}

export interface ProviderPointer {
  active: 'from' | 'to'
}

export interface MigrationFailure {
  path: string
  reason: string
}

export interface MigrationResult {
  status: 'switched' | 'rolled_back'
  verified: number
  written: number
  removed: number
  failures: MigrationFailure[]
  active: 'from' | 'to'
}

export async function migrateObjects(options: {
  rows: MigrationRow[]
  from: ObjectStore
  to: ObjectStore
  pointer: ProviderPointer
  hash?: (bytes: Uint8Array) => Promise<string>
}): Promise<MigrationResult> {
  const hash = options.hash ?? sha256Hex
  const { from, to, pointer } = options
  const failures: MigrationFailure[] = []
  const written: string[] = []
  let verified = 0

  for (const row of options.rows) {
    assertSafePath(row.path)
  }

  // 1. Preflight: nothing is written if the target already disagrees about any path this run would write.
  for (const row of options.rows) {
    const existing = await to.read(row.path)
    if (existing && (await hash(existing.bytes)) !== row.sha256) {
      failures.push({
        path: row.path,
        reason: 'target conflict: a different object already exists at this path',
      })
      return {
        status: 'rolled_back',
        verified: 0,
        written: 0,
        removed: 0,
        failures,
        active: pointer.active,
      }
    }
  }

  // 2 and 3. Copy and verify, stopping at the first failure.
  for (const row of options.rows) {
    // A target that already holds the identical file (an earlier run) is verified and left alone. Writing it again and then
    // removing it on rollback would delete data this run never created.
    const already = await to.read(row.path)
    if (already && (await hash(already.bytes)) === row.sha256) {
      verified += 1
      continue
    }
    const source = await from.read(row.path)
    if (!source) {
      failures.push({ path: row.path, reason: 'source missing' })
      break
    }
    if ((await hash(source.bytes)) !== row.sha256) {
      failures.push({ path: row.path, reason: 'source checksum does not match the record' })
      break
    }
    const put = await to.put(row.path, source.bytes, source.mime)
    if (!put.ok) {
      failures.push({ path: row.path, reason: `copy refused: ${put.error ?? 'unknown'}` })
      break
    }
    written.push(row.path)
    const copy = await to.read(row.path)
    if (!copy || (await hash(copy.bytes)) !== row.sha256) {
      failures.push({ path: row.path, reason: 'copy checksum does not match the record' })
      break
    }
    verified += 1
  }

  if (failures.length > 0) {
    let removed = 0
    for (const path of written) {
      if (await to.remove(path)) removed += 1
    }
    return {
      status: 'rolled_back',
      verified,
      written: written.length,
      removed,
      failures,
      active: pointer.active,
    }
  }

  // 4. Every file verified: only now does the pointer move.
  pointer.active = 'to'
  return {
    status: 'switched',
    verified,
    written: written.length,
    removed: 0,
    failures: [],
    active: 'to',
  }
}
