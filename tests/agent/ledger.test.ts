/**
 * The execution ledger under the conditions that corrupt state in practice: two writers at once, a writer that died
 * halfway, a lock left behind by a dead process, a lock held by a live one, and a file that is not valid JSON (P0 R3, R6).
 */
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  acquireLock,
  emptyState,
  LockTimeoutError,
  readState,
  releaseLock,
  StateConflictError,
  sweepTemporaries,
  updateState,
  writeAtomic,
} from '../../scripts/agent/lib/state.mjs'

let dir = ''
let statePath = ''
let lockPath = ''

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ledger-'))
  statePath = join(dir, 'docs/agent/EXECUTION-STATE.json')
  lockPath = join(dir, '.out/agent/state.lock')
  mkdirSync(join(dir, 'docs/agent'), { recursive: true })
  writeFileSync(statePath, JSON.stringify(emptyState(new Date('2026-10-14T08:00:00Z')), null, 2))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('atomic writes', () => {
  it('replaces the document in one step, so a reader sees the old or the new, never a part', () => {
    writeAtomic(statePath, '{"schema":1,"revision":7}\n')
    expect(JSON.parse(readFileSync(statePath, 'utf8')).revision).toBe(7)
  })

  it('leaves no temporary file behind after a successful write', () => {
    writeAtomic(statePath, '{"schema":1,"revision":1}\n')
    expect(readdirSync(join(dir, 'docs/agent')).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })

  it('ignores and removes a temporary file a crashed writer left behind; the complete document still reads', () => {
    writeFileSync(`${statePath}.4242.deadbeef.tmp`, '{"schema":1,"revisi')
    const before = readState(statePath)
    expect(before.revision).toBe(0)
    expect(sweepTemporaries(statePath)).toHaveLength(1)
    expect(readdirSync(join(dir, 'docs/agent')).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })
})

describe('compare and swap', () => {
  it('advances the revision on every change', async () => {
    const a = await updateState(statePath, lockPath, undefined, (s) => ({
      ...s,
      mission: { id: 'A' },
    }))
    const b = await updateState(statePath, lockPath, undefined, (s) => ({
      ...s,
      mission: { id: 'B' },
    }))
    expect(a.state.revision).toBe(1)
    expect(b.state.revision).toBe(2)
    expect(readState(statePath).mission).toEqual({ id: 'B' })
  })

  it('refuses a write based on a revision that has since moved, and changes nothing', async () => {
    await updateState(statePath, lockPath, undefined, (s) => ({ ...s, mission: { id: 'first' } }))
    await expect(
      updateState(statePath, lockPath, 0, (s) => ({ ...s, mission: { id: 'stale' } })),
    ).rejects.toBeInstanceOf(StateConflictError)
    expect(readState(statePath).mission).toEqual({ id: 'first' })
  })

  it('reports both revisions in the refusal, so the caller can re-read and decide', async () => {
    await updateState(statePath, lockPath, undefined, (s) => s)
    try {
      await updateState(statePath, lockPath, 0, (s) => s)
      throw new Error('expected a conflict')
    } catch (error) {
      expect(error).toBeInstanceOf(StateConflictError)
      expect((error as StateConflictError).expected).toBe(0)
      expect((error as StateConflictError).actual).toBe(1)
    }
  })
})

describe('two writers at once', () => {
  it('loses no write when twenty writers update together: the revision counts every one', async () => {
    const writes = Array.from({ length: 20 }, (_, i) =>
      updateState(
        statePath,
        lockPath,
        undefined,
        (s) => {
          s.sessions.push({ id: `session-${i}` })
          return s
        },
        { waitMs: 20_000 },
      ),
    )
    await Promise.all(writes)
    const final = readState(statePath)
    expect(final.revision).toBe(20)
    expect(final.sessions.map((x) => x.id).sort()).toEqual(
      Array.from({ length: 20 }, (_, i) => `session-${i}`).sort(),
    )
  })

  it('loses no write when six separate processes update the same ledger at once', async () => {
    // Threads inside one process interleave only at awaits; separate processes are the real race the lock exists for.
    const stateUrl = new URL('../../scripts/agent/lib/state.mjs', import.meta.url).href
    const script = `import { updateState } from ${JSON.stringify(stateUrl)};
      for (let i = 0; i < 10; i++) {
        await updateState(${JSON.stringify(statePath)}, ${JSON.stringify(lockPath)}, undefined, (s) => {
          s.sessions.push({ id: process.pid + ':' + i });
          return s;
        }, { waitMs: 60000 });
      }`
    const children = Array.from({ length: 6 }, () => {
      return new Promise<number | null>((resolveExit) => {
        const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
          stdio: ['ignore', 'ignore', 'pipe'],
        })
        let err = ''
        child.stderr.on('data', (d) => (err += d))
        child.on('exit', (code) => {
          if (code !== 0) process.stderr.write(err)
          resolveExit(code)
        })
      })
    })
    const codes = await Promise.all(children)
    expect(codes).toEqual([0, 0, 0, 0, 0, 0])
    const final = readState(statePath)
    expect(final.revision).toBe(60)
    expect(final.sessions).toHaveLength(60)
    expect(new Set(final.sessions.map((x) => x.id)).size).toBe(60)
  }, 60_000)

  it('does not write while another writer holds the lock, and says the lock is held', async () => {
    const held = await acquireLock(lockPath)
    await expect(acquireLock(lockPath, { waitMs: 150 })).rejects.toBeInstanceOf(LockTimeoutError)
    releaseLock(held)
  })
})

describe('locks left behind', () => {
  it('takes over a lock whose owner process is gone, and reports the takeover', async () => {
    mkdirSync(join(dir, '.out/agent'), { recursive: true })
    // A pid far above any live process on this machine.
    writeFileSync(lockPath, JSON.stringify({ pid: 2147483646, at: new Date().toISOString() }))
    const lock = await acquireLock(lockPath, { waitMs: 500 })
    expect(lock.takenOver).toMatchObject({ previousPid: 2147483646, reason: 'owner process gone' })
    releaseLock(lock)
  })

  it('takes over a lock older than the stale age even when its owner looks alive', async () => {
    mkdirSync(join(dir, '.out/agent'), { recursive: true })
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid, at: '2000-01-01T00:00:00.000Z' }))
    const lock = await acquireLock(lockPath, { waitMs: 500 })
    expect(lock.takenOver?.reason).toBe('lock too old')
    releaseLock(lock)
  })

  it('a lock that vanishes between the check and the release is not an error', async () => {
    const lock = await acquireLock(lockPath)
    releaseLock(lock)
    expect(() => releaseLock(lock)).not.toThrow()
  })
})

describe('a ledger that is not what it should be', () => {
  it('refuses a file that is not JSON and does not replace it, because replacing it destroys the only record', () => {
    writeFileSync(statePath, '{ not json')
    expect(() => readState(statePath)).toThrow(/not valid JSON/)
    expect(readFileSync(statePath, 'utf8')).toBe('{ not json')
  })

  it('refuses a file of another schema version', () => {
    writeFileSync(statePath, JSON.stringify({ schema: 99, revision: 0 }))
    expect(() => readState(statePath)).toThrow(/schema 99/)
  })

  it('treats a missing file as an empty ledger, so a repository with no mission is a valid state', () => {
    rmSync(statePath)
    expect(readState(statePath).mission).toBeNull()
  })
})
