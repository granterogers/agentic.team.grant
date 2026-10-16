/**
 * The execution ledger: one JSON file that says what the current autonomous mission is, what is done, what remains, and
 * what the last session did. It is what lets a session that was killed, compacted or restarted continue without
 * depending on anything the model remembers.
 *
 * Guarantees, and how each is kept:
 *   - A reader never sees a half-written file. Every write goes to a temporary file in the same directory, is flushed,
 *     and is renamed over the target. A rename is atomic on one filesystem, so the target is always a complete document.
 *   - Two writers cannot silently overwrite each other. A write names the revision it was based on and is refused if the
 *     file has moved on (compare and swap). The refusal says so; the caller re-reads and decides.
 *   - Two processes cannot write at the same moment. A lock file is created exclusively. A lock whose owner process is
 *     gone, or that is older than the stale age, is removed by the next writer and the removal is reported.
 *   - An interrupted write leaves the previous complete file in place and at most a temporary file behind, which the
 *     next write ignores and which readers never open.
 *
 * What this does NOT do: it does not coordinate two checkouts on different machines. The ledger is committed, so two
 * machines writing it produce a git conflict, which is reported as such. Use one mission per branch.
 *
 * Plain words in this file's comments; no backticks, because this file is read by the template check.
 */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeSync, fsyncSync, unlinkSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'

export const SCHEMA = 1
export const STALE_LOCK_MS = 60_000

/** The default location, relative to the repository root. The state is committed; the lock is local. */
export const DEFAULT_STATE_PATH = 'docs/agent/EXECUTION-STATE.json'
export const DEFAULT_LOCK_PATH = '.out/agent/state.lock'

export class StateConflictError extends Error {
  constructor(expected, actual) {
    super(`state moved on: expected revision ${expected}, found ${actual}`)
    this.name = 'StateConflictError'
    this.expected = expected
    this.actual = actual
  }
}

export class LockTimeoutError extends Error {
  constructor(path, waitedMs) {
    super(`state lock ${path} is held by a live process after ${waitedMs} ms`)
    this.name = 'LockTimeoutError'
  }
}

/** A fresh, empty ledger. Used by tests and by the first mission. */
export function emptyState(now = new Date()) {
  return {
    schema: SCHEMA,
    revision: 0,
    updatedAt: now.toISOString(),
    mission: null,
    sessions: [],
    stopGate: { blocksTotal: 0, lastBlockAt: null, blocksBySession: {} },
  }
}

/** Read the ledger. A missing file is an empty ledger, not an error: a repository with no mission is a valid state. */
export function readState(path) {
  if (!existsSync(path)) return emptyState()
  const text = readFileSync(path, 'utf8')
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    // A corrupt file is reported, never silently replaced: replacing it would destroy the only record of the mission.
    throw new Error(`execution state at ${path} is not valid JSON: ${error.message}`)
  }
  if (parsed.schema !== SCHEMA) throw new Error(`execution state schema ${String(parsed.schema)} is not ${SCHEMA}`)
  return parsed
}

/** Write a complete document atomically: temporary file in the same directory, flush, rename over the target. */
export function writeAtomic(path, data) {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  const fd = openSync(tmp, 'w')
  try {
    writeSync(fd, data)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(tmp, path)
}

/** Remove temporary files a crashed writer left beside the state. Readers never open them, so this only tidies. */
export function sweepTemporaries(path) {
  const dir = dirname(path)
  if (!existsSync(dir)) return []
  const name = path.slice(dir.length + 1)
  const removed = []
  for (const f of readdirSync(dir)) {
    if (f.startsWith(`${name}.`) && f.endsWith('.tmp')) {
      rmSync(join(dir, f), { force: true })
      removed.push(f)
    }
  }
  return removed
}

function processAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

/**
 * Take the lock. Exclusive create; a lock held by a dead process or older than the stale age is taken over, and the
 * takeover is returned so the caller can record it. Waits briefly rather than failing on the first contention.
 */
export async function acquireLock(lockPath, { waitMs = 5_000, staleMs = STALE_LOCK_MS, now = () => Date.now() } = {}) {
  mkdirSync(dirname(lockPath), { recursive: true })
  const started = now()
  let takenOver = null
  for (;;) {
    try {
      const fd = openSync(lockPath, 'wx')
      writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date(now()).toISOString() }))
      closeSync(fd)
      return { path: lockPath, takenOver }
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
    let owner = null
    try {
      owner = JSON.parse(readFileSync(lockPath, 'utf8'))
    } catch {
      owner = null
    }
    const age = now() - (owner?.at ? Date.parse(owner.at) : statSync(lockPath).mtimeMs)
    const dead = owner?.pid !== undefined && !processAlive(owner.pid)
    if (dead || age > staleMs) {
      takenOver = { previousPid: owner?.pid ?? null, reason: dead ? 'owner process gone' : 'lock too old' }
      rmSync(lockPath, { force: true })
      continue
    }
    if (now() - started >= waitMs) throw new LockTimeoutError(lockPath, now() - started)
    await new Promise((r) => setTimeout(r, 50))
  }
}

export function releaseLock(lock) {
  try {
    unlinkSync(lock.path)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

/**
 * Change the ledger under the lock, compare and swap on the revision. The mutation receives a copy and returns the new
 * document; the revision is advanced here, not by the caller. A stale expected revision is refused with a conflict.
 */
export async function updateState(path, lockPath, expectedRevision, mutate, options = {}) {
  const lock = await acquireLock(lockPath, options)
  try {
    const current = readState(path)
    if (expectedRevision !== undefined && current.revision !== expectedRevision) {
      throw new StateConflictError(expectedRevision, current.revision)
    }
    const next = mutate(structuredClone(current))
    next.schema = SCHEMA
    next.revision = current.revision + 1
    next.updatedAt = new Date(options.now?.() ?? Date.now()).toISOString()
    writeAtomic(path, `${JSON.stringify(next, null, 2)}\n`)
    return { state: next, takenOver: lock.takenOver }
  } finally {
    releaseLock(lock)
  }
}
