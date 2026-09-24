/**
 * The recorded collisions, loaded once.
 *
 * Its own module because three callers need the same answer and a file read
 * repeated in three places is three places to disagree about where the
 * manifest lives. Missing or unreadable means an EMPTY history, which is the
 * strict rule -- the safe direction, because a manifest that fails to load
 * must never be the reason a real collision is let through.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { RecordedCollision } from './check.ts'

export async function recordedCollisions(dir = 'migrations'): Promise<RecordedCollision[]> {
  try {
    const raw = await readFile(join(dir, 'collisions.json'), 'utf8')
    const parsed = JSON.parse(raw) as { collisions?: unknown }
    if (!Array.isArray(parsed.collisions)) return []
    return parsed.collisions.filter(
      (c): c is RecordedCollision =>
        typeof c === 'object' &&
        c !== null &&
        typeof (c as RecordedCollision).n === 'string' &&
        Array.isArray((c as RecordedCollision).files),
    )
  } catch {
    return []
  }
}
