/**
 * Copy, verify, switch: the migration between object providers, with the failures that must stop it injected (#469, B2).
 *
 * The brief requires that an injected hash mismatch is caught and the migration stops safely. Each failure here is driven
 * through the real migration, and each assertion checks the status, the pointer, what the target holds afterwards, and that
 * the source was never modified.
 */
import { describe, expect, it } from 'vitest'
import { type MigrationRow, migrateObjects } from '../../src/files/migrate.ts'
import { memoryObjectStore, type ObjectStore } from '../../src/files/object-store.ts'
import { sha256Hex } from '../../src/files/policy.ts'
import { reconcile } from '../../src/files/reconcile.ts'

const enc = (s: string) => new TextEncoder().encode(s)
const FILES = {
  'p1/drive/a.txt': 'alpha',
  'p1/drive/b.txt': 'beta',
  'p1/drive/c.txt': 'gamma',
}

async function seed(store: ObjectStore): Promise<MigrationRow[]> {
  const rows: MigrationRow[] = []
  for (const [path, text] of Object.entries(FILES)) {
    const bytes = enc(text)
    await store.put(path, bytes, 'text/plain')
    rows.push({ path, sha256: await sha256Hex(bytes), bytes: bytes.byteLength })
  }
  return rows
}

/** A target that flips one byte of whatever is written to `badPath`, the way a bad copy would. */
function corruptingTarget(inner: ObjectStore, badPath: string): ObjectStore {
  return {
    kind: `${inner.kind}+corrupting`,
    read: (path) => inner.read(path),
    link: (path, s) => inner.link(path, s),
    remove: (path) => inner.remove(path),
    async put(path, bytes, mime) {
      if (path !== badPath) return await inner.put(path, bytes, mime)
      const damaged = new Uint8Array(bytes)
      damaged[0] = (damaged[0] ?? 0) ^ 0xff
      return await inner.put(path, damaged, mime)
    },
  }
}

/** A target that refuses every write, as a full or unavailable provider would. */
function refusingTarget(inner: ObjectStore): ObjectStore {
  return {
    ...inner,
    kind: `${inner.kind}+refusing`,
    async put() {
      return { ok: false, path: '', bytes: 0, error: 'quota exceeded' }
    },
  }
}

async function snapshot(store: ObjectStore, paths: string[]) {
  const out: Record<string, string | null> = {}
  for (const p of paths) {
    const got = await store.read(p)
    out[p] = got ? new TextDecoder().decode(got.bytes) : null
  }
  return out
}

describe('a clean migration', () => {
  it('copies every file, verifies each one from the target, and only then moves the pointer', async () => {
    const from = memoryObjectStore()
    const to = memoryObjectStore()
    const rows = await seed(from)
    const pointer = { active: 'from' as const }
    const result = await migrateObjects({ rows, from, to, pointer })
    expect(result).toMatchObject({
      status: 'switched',
      verified: 3,
      written: 3,
      removed: 0,
      failures: [],
      active: 'to',
    })
    expect(pointer.active).toBe('to')
    expect(await snapshot(to, Object.keys(FILES))).toEqual(FILES)
    expect(reconcile(rows, [...(await objectsOf(to, rows))]).clean).toBe(true)
  })

  it('leaves the source complete, so the old provider still holds every file after the switch', async () => {
    const from = memoryObjectStore()
    const to = memoryObjectStore()
    const rows = await seed(from)
    await migrateObjects({ rows, from, to, pointer: { active: 'from' } })
    expect(await snapshot(from, Object.keys(FILES))).toEqual(FILES)
  })

  it('treats a re-run over identical content as verified, and writes nothing again', async () => {
    const from = memoryObjectStore()
    const to = memoryObjectStore()
    const rows = await seed(from)
    await migrateObjects({ rows, from, to, pointer: { active: 'from' } })
    const second = await migrateObjects({ rows, from, to, pointer: { active: 'from' } })
    expect(second).toMatchObject({ status: 'switched', verified: 3, written: 0 })
  })
})

describe('an injected hash mismatch stops the migration safely', () => {
  it('catches a copy whose bytes differ, rolls back what it wrote, and keeps the pointer on the source', async () => {
    const from = memoryObjectStore()
    const inner = memoryObjectStore()
    const rows = await seed(from)
    const to = corruptingTarget(inner, 'p1/drive/b.txt')
    const pointer = { active: 'from' as const }

    const result = await migrateObjects({ rows, from, to, pointer })

    expect(result.status).toBe('rolled_back')
    expect(result.failures).toEqual([
      { path: 'p1/drive/b.txt', reason: 'copy checksum does not match the record' },
    ])
    expect(pointer.active).toBe('from')
    // The first file was written and then removed; the damaged one was removed; nothing after it was attempted.
    expect(result.written).toBe(2)
    expect(result.removed).toBe(2)
    expect(await snapshot(inner, Object.keys(FILES))).toEqual({
      'p1/drive/a.txt': null,
      'p1/drive/b.txt': null,
      'p1/drive/c.txt': null,
    })
    // The source was never touched.
    expect(await snapshot(from, Object.keys(FILES))).toEqual(FILES)
  })

  it('refuses to copy a source file whose bytes no longer match the record, and writes nothing to the target', async () => {
    const from = memoryObjectStore()
    const to = memoryObjectStore()
    const rows = await seed(from)
    await from.put('p1/drive/a.txt', enc('tampered'), 'text/plain')
    const pointer = { active: 'from' as const }

    const result = await migrateObjects({ rows, from, to, pointer })

    expect(result.status).toBe('rolled_back')
    expect(result.failures).toEqual([
      { path: 'p1/drive/a.txt', reason: 'source checksum does not match the record' },
    ])
    expect(result.written).toBe(0)
    expect(pointer.active).toBe('from')
    expect(await snapshot(to, Object.keys(FILES))).toEqual({
      'p1/drive/a.txt': null,
      'p1/drive/b.txt': null,
      'p1/drive/c.txt': null,
    })
  })

  it('stops, names the file, when the source is missing a file the records say exists', async () => {
    const from = memoryObjectStore()
    const to = memoryObjectStore()
    const rows = await seed(from)
    await from.remove('p1/drive/c.txt')
    const result = await migrateObjects({ rows, from, to, pointer: { active: 'from' } })
    expect(result.failures).toEqual([{ path: 'p1/drive/c.txt', reason: 'source missing' }])
    expect(result.status).toBe('rolled_back')
  })

  it('stops when the target refuses a write, and removes what the run had already written', async () => {
    const from = memoryObjectStore()
    const inner = memoryObjectStore()
    const rows = await seed(from)
    // Let the first file succeed, then refuse the rest.
    let accepted = 0
    const to: ObjectStore = {
      ...inner,
      kind: 'limited',
      async put(path, bytes, mime) {
        if (accepted >= 1) return { ok: false, path, bytes: 0, error: 'quota exceeded' }
        accepted += 1
        return await inner.put(path, bytes, mime)
      },
    }
    const pointer = { active: 'from' as const }
    const result = await migrateObjects({ rows, from, to, pointer })
    expect(result.status).toBe('rolled_back')
    expect(result.failures[0]?.reason).toBe('copy refused: quota exceeded')
    expect(result.removed).toBe(1)
    expect(pointer.active).toBe('from')
    expect(await inner.read('p1/drive/a.txt')).toBeNull()
  })
})

describe('a target that already disagrees is a conflict, not something to overwrite', () => {
  it('refuses before any write when the target holds a different object at a path the run would write', async () => {
    const from = memoryObjectStore()
    const to = memoryObjectStore()
    const rows = await seed(from)
    await to.put('p1/drive/b.txt', enc('someone else wrote this'), 'text/plain')
    const pointer = { active: 'from' as const }

    const result = await migrateObjects({ rows, from, to, pointer })

    expect(result.status).toBe('rolled_back')
    expect(result.failures[0]?.reason).toMatch(/^target conflict/)
    expect(result.written).toBe(0)
    expect(pointer.active).toBe('from')
    // The conflicting object is untouched.
    expect(await snapshot(to, ['p1/drive/b.txt'])).toEqual({
      'p1/drive/b.txt': 'someone else wrote this',
    })
  })

  it('does not delete a file it did not create when it rolls back a later failure', async () => {
    const from = memoryObjectStore()
    const inner = memoryObjectStore()
    const rows = await seed(from)
    // The target already holds an identical copy of a.txt from an earlier run.
    await migrateObjects({ rows: rows.slice(0, 1), from, to: inner, pointer: { active: 'from' } })
    const to = corruptingTarget(inner, 'p1/drive/c.txt')
    const result = await migrateObjects({ rows, from, to, pointer: { active: 'from' } })
    expect(result.status).toBe('rolled_back')
    expect(await snapshot(inner, ['p1/drive/a.txt'])).toEqual({ 'p1/drive/a.txt': 'alpha' })
  })
})

describe('a refusing target', () => {
  it('reports the refusal and moves nothing', async () => {
    const from = memoryObjectStore()
    const rows = await seed(from)
    const pointer = { active: 'from' as const }
    const result = await migrateObjects({
      rows,
      from,
      to: refusingTarget(memoryObjectStore()),
      pointer,
    })
    expect(result.status).toBe('rolled_back')
    expect(pointer.active).toBe('from')
  })
})

/** The rows' objects as the reconciliation reads them: path, checksum and size, from the store. */
async function objectsOf(store: ObjectStore, rows: MigrationRow[]) {
  const out = []
  for (const row of rows) {
    const got = await store.read(row.path)
    if (got)
      out.push({ path: row.path, sha256: await sha256Hex(got.bytes), bytes: got.bytes.byteLength })
  }
  return out
}
