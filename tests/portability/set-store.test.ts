/**
 * Project sets through storage (#471, item 5): export a project larger than one archive, restore it part by part, commit it
 * once, and roll back every way a restore can fail. In memory, with the same rules the gateway uses. Each failure is asserted by
 * its reason and by what was left in storage afterwards, so a refusal cannot pass by writing nothing and a rollback cannot pass
 * by leaving nothing to check.
 */
import { describe, expect, it } from 'vitest'
import { memoryObjectStore } from '../../src/files/object-store.ts'
import { ARCHIVE_LIMITS } from '../../src/portability/archive.ts'
import type { ExtensionFor } from '../../src/portability/originals.ts'
import { SET_LIMITS } from '../../src/portability/parts.ts'
import {
  abandonSet,
  buildSetPart,
  commitSet,
  prepareSet,
  restorePart,
  storeExportCache,
} from '../../src/portability/set-store.ts'

const MB = 1024 * 1024
const OFFICE_A = '2a2cd4d4-48c9-41ba-8271-a798631997da'
const OFFICE_B = 'e13ce7a9-831b-49d7-83a5-2ede9c1a97d0'
const CACHE = 'c0c0c0c0-0000-4000-8000-000000000001'
const extension: ExtensionFor = (mime) => mime.split('/')[1] ?? 'bin'
/** The part at an index. A test that asks for a part that is not there fails here, with a reason. */
const partAt = (list: readonly Uint8Array[], i: number): Uint8Array => {
  const part = list[i]
  if (part === undefined) throw new Error(`there is no part ${String(i)}`)
  return part
}

/** The project as the office holds it: three files, one of them an image, and a text-only note. */
async function seededSource() {
  const store = memoryObjectStore()
  const files = [
    { path: 'src/a.pdf', mime: 'application/pdf', bytes: new Uint8Array(3 * MB).fill(1) },
    { path: 'src/b.pdf', mime: 'application/pdf', bytes: new Uint8Array(3 * MB).fill(2) },
    { path: 'src/c.png', mime: 'image/png', bytes: new Uint8Array(1 * MB).fill(3) },
  ]
  for (const f of files) await store.put(f.path, f.bytes, f.mime)
  const pkg = {
    project: { slug: 'big-project', name: 'Big project' },
    documents: [
      {
        title: 'Plan',
        original: { mime_type: 'application/pdf', bytes: 3 * MB, storage_path: 'src/a.pdf' },
      },
      {
        title: 'Deck',
        original: { mime_type: 'application/pdf', bytes: 3 * MB, storage_path: 'src/b.pdf' },
      },
      {
        title: 'Sketch',
        original: { mime_type: 'image/png', bytes: 1 * MB, storage_path: 'src/c.png' },
      },
      { title: 'Note' },
    ],
  }
  return { store, pkg, files }
}

describe('exporting a project larger than one archive', () => {
  it('plans two parts, keeps the package in part 1, and builds each part under the part limit', async () => {
    const { store, pkg } = await seededSource()
    const prepared = await prepareSet({ pkg, slug: 'big-project', store, extension })
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    expect(prepared.partCount).toBe(2)
    expect(prepared.plan).toHaveLength(3)
    expect(prepared.setKey).toMatch(/^[0-9a-f]{64}$/)
    // The package carries each original's checksum and archive name, and never the storage path.
    expect(new TextDecoder().decode(prepared.packageBytes)).not.toContain('src/a.pdf')
    expect(await storeExportCache(store, OFFICE_A, CACHE, prepared)).toBe(true)
    const one = await buildSetPart({
      office: OFFICE_A,
      cacheId: CACHE,
      setKey: prepared.setKey,
      number: 1,
      store,
      exportedAt: '2026-10-14T12:00:00.000Z',
    })
    const two = await buildSetPart({
      office: OFFICE_A,
      cacheId: CACHE,
      setKey: prepared.setKey,
      number: 2,
      store,
      exportedAt: '2026-10-14T12:00:00.000Z',
    })
    expect(one.ok && one.bytes.length <= ARCHIVE_LIMITS.maxBytes).toBe(true)
    expect(two.ok && two.bytes.length <= ARCHIVE_LIMITS.maxBytes).toBe(true)
  })

  it('refuses a part number the set does not have, and a set key it does not hold', async () => {
    const { store, pkg } = await seededSource()
    const prepared = await prepareSet({ pkg, slug: 'big-project', store, extension })
    if (!prepared.ok) throw new Error('setup')
    await storeExportCache(store, OFFICE_A, CACHE, prepared)
    const badNumber = await buildSetPart({
      office: OFFICE_A,
      cacheId: CACHE,
      setKey: prepared.setKey,
      number: 9,
      store,
      exportedAt: '2026-10-14T12:00:00.000Z',
    })
    expect(badNumber).toMatchObject({ ok: false, status: 400 })
    const wrongKey = await buildSetPart({
      office: OFFICE_A,
      cacheId: CACHE,
      setKey: 'f'.repeat(64),
      number: 1,
      store,
      exportedAt: '2026-10-14T12:00:00.000Z',
    })
    expect(wrongKey).toMatchObject({
      ok: false,
      status: 409,
      error: 'that part belongs to another set',
    })
  })

  it('refuses an original larger than one part before reading anything, and names it', async () => {
    const store = memoryObjectStore()
    const pkg = {
      documents: [
        {
          title: 'The deck',
          original: {
            mime_type: 'application/pdf',
            bytes: SET_LIMITS.fileBytesPerPart + 1,
            storage_path: 'x',
          },
        },
      ],
    }
    const prepared = await prepareSet({ pkg, slug: 's', store, extension })
    expect(prepared).toMatchObject({ ok: false, status: 413 })
    expect((prepared as { error: string }).error).toContain('"The deck" is larger than one part')
  })

  it('refuses a project whose stored file is missing, and says which one', async () => {
    const store = memoryObjectStore()
    const pkg = {
      documents: [
        {
          title: 'Gone',
          original: { mime_type: 'application/pdf', bytes: 10, storage_path: 'nowhere.pdf' },
        },
      ],
    }
    const prepared = await prepareSet({ pkg, slug: 's', store, extension })
    expect(prepared).toMatchObject({ ok: false, status: 409 })
    expect((prepared as { error: string }).error).toContain('"Gone" could not be read')
  })
})

describe('restoring a set: round trip, one commit, and rollback at every step', () => {
  async function exportSet() {
    const src = await seededSource()
    const prepared = await prepareSet({
      pkg: src.pkg,
      slug: 'big-project',
      store: src.store,
      extension,
    })
    if (!prepared.ok) throw new Error(prepared.error)
    await storeExportCache(src.store, OFFICE_A, CACHE, prepared)
    const parts: Uint8Array[] = []
    for (let n = 1; n <= prepared.partCount; n++) {
      const built = await buildSetPart({
        office: OFFICE_A,
        cacheId: CACHE,
        setKey: prepared.setKey,
        number: n,
        store: src.store,
        exportedAt: '2026-10-14T12:00:00.000Z',
      })
      if (!built.ok) throw new Error(built.error)
      parts.push(built.bytes)
    }
    return { parts, setKey: prepared.setKey, src }
  }

  it('restores every original under the restoring office, and creates the project once', async () => {
    const { parts, setKey } = await exportSet()
    const dest = memoryObjectStore()
    const first = await restorePart({
      bytes: partAt(parts, 0),
      office: OFFICE_B,
      setKey,
      number: 1,
      store: dest,
      extension,
    })
    const second = await restorePart({
      bytes: partAt(parts, 1),
      office: OFFICE_B,
      setKey,
      number: 2,
      store: dest,
      extension,
    })
    expect(first).toMatchObject({ ok: true, partCount: 2, already: false })
    expect(second).toMatchObject({ ok: true, partCount: 2, already: false })
    let sent = null as {
      documents: { original?: { storage_path?: string; sha256?: string } }[]
    } | null
    const committed = await commitSet({
      office: OFFICE_B,
      setKey,
      store: dest,
      extension,
      restore: async (pkg) => {
        sent = pkg as typeof sent
        return { ok: true }
      },
    })
    expect(committed).toMatchObject({ ok: true, already: false })
    const docs = sent?.documents ?? []
    expect(docs).toHaveLength(4)
    for (const i of [0, 1, 2]) {
      const orig = docs[i]?.original
      expect(orig?.storage_path?.startsWith(`restores/${OFFICE_B}/${setKey}/`)).toBe(true)
      const stored = await dest.read(orig?.storage_path ?? '')
      expect(stored).not.toBeNull()
    }
    expect(docs[3]?.original).toBeUndefined()
  })

  it('refuses the commit until every part is present, and names the missing one', async () => {
    const { parts, setKey } = await exportSet()
    const dest = memoryObjectStore()
    await restorePart({
      bytes: partAt(parts, 0),
      office: OFFICE_B,
      setKey,
      number: 1,
      store: dest,
      extension,
    })
    const early = await commitSet({
      office: OFFICE_B,
      setKey,
      store: dest,
      extension,
      restore: async () => ({ ok: true }),
    })
    expect(early).toMatchObject({
      ok: false,
      status: 409,
      error: 'part 2 of 2 has not been received',
    })
  })

  it('refuses part 2 before part 1, because part 1 is the one that carries the project', async () => {
    const { parts, setKey } = await exportSet()
    const dest = memoryObjectStore()
    const out = await restorePart({
      bytes: partAt(parts, 1),
      office: OFFICE_B,
      setKey,
      number: 2,
      store: dest,
      extension,
    })
    expect(out).toMatchObject({
      ok: false,
      status: 409,
      error: 'send part 1 first: it carries the project itself',
    })
  })

  it('rolls a corrupted part back: nothing from it is written, and abandoning the set removes what the good part wrote', async () => {
    const { parts, setKey } = await exportSet()
    const dest = memoryObjectStore()
    await restorePart({
      bytes: partAt(parts, 0),
      office: OFFICE_B,
      setKey,
      number: 1,
      store: dest,
      extension,
    })
    const bad = partAt(parts, 1).slice()
    bad[Math.floor(bad.length / 2)] = (bad[Math.floor(bad.length / 2)] ?? 0) ^ 0xff
    const refused = await restorePart({
      bytes: bad,
      office: OFFICE_B,
      setKey,
      number: 2,
      store: dest,
      extension,
    })
    expect(refused.ok).toBe(false)
    // Part 1 carries one original (the first 3 MB file); the corrupted part 2 wrote nothing.
    const abandoned = await abandonSet({ office: OFFICE_B, setKey, store: dest })
    expect(abandoned).toMatchObject({ ok: true, removed: 1 })
    const leftover = await dest.read(`restores/${OFFICE_B}/${setKey}/_index.json`)
    expect(leftover).toBeNull()
  })

  it('a refused commit removes every original the set wrote, so a refused restore leaves no file behind', async () => {
    const { parts, setKey } = await exportSet()
    const dest = memoryObjectStore()
    await restorePart({
      bytes: partAt(parts, 0),
      office: OFFICE_B,
      setKey,
      number: 1,
      store: dest,
      extension,
    })
    await restorePart({
      bytes: partAt(parts, 1),
      office: OFFICE_B,
      setKey,
      number: 2,
      store: dest,
      extension,
    })
    const refused = await commitSet({
      office: OFFICE_B,
      setKey,
      store: dest,
      extension,
      restore: async () => ({ ok: false, error: 'the database refused the project' }),
    })
    expect(refused).toMatchObject({
      ok: false,
      status: 400,
      error: 'the database refused the project',
    })
    // The originals are gone; abandoning finds nothing left to remove.
    const after = await abandonSet({ office: OFFICE_B, setKey, store: dest })
    expect(after).toMatchObject({ ok: true, removed: 0 })
  })

  it('after a refused commit, a resent part is written again, and the commit then succeeds over real files', async () => {
    // The regression this pins: the refused commit used to leave its markers behind, so a resent part was answered as already
    // received over files that were gone, and a later commit created a project whose originals did not exist.
    const { parts, setKey } = await exportSet()
    const dest = memoryObjectStore()
    await restorePart({
      bytes: partAt(parts, 0),
      office: OFFICE_B,
      setKey,
      number: 1,
      store: dest,
      extension,
    })
    await restorePart({
      bytes: partAt(parts, 1),
      office: OFFICE_B,
      setKey,
      number: 2,
      store: dest,
      extension,
    })
    await commitSet({
      office: OFFICE_B,
      setKey,
      store: dest,
      extension,
      restore: async () => ({ ok: false, error: 'refused once' }),
    })
    const resent = await restorePart({
      bytes: partAt(parts, 0),
      office: OFFICE_B,
      setKey,
      number: 1,
      store: dest,
      extension,
    })
    expect(resent).toMatchObject({ ok: true, already: false, written: 1 })
    await restorePart({
      bytes: partAt(parts, 1),
      office: OFFICE_B,
      setKey,
      number: 2,
      store: dest,
      extension,
    })
    let sent = null as { documents: { original?: { storage_path?: string } }[] } | null
    const ok = await commitSet({
      office: OFFICE_B,
      setKey,
      store: dest,
      extension,
      restore: async (pkg) => {
        sent = pkg as typeof sent
        return { ok: true }
      },
    })
    expect(ok).toMatchObject({ ok: true })
    for (const i of [0, 1, 2]) {
      const path = sent?.documents[i]?.original?.storage_path ?? ''
      expect(await dest.read(path)).not.toBeNull()
    }
  })

  it('answers a repeated part as already received, and writes nothing again', async () => {
    const { parts, setKey } = await exportSet()
    const dest = memoryObjectStore()
    await restorePart({
      bytes: partAt(parts, 0),
      office: OFFICE_B,
      setKey,
      number: 1,
      store: dest,
      extension,
    })
    const again = await restorePart({
      bytes: partAt(parts, 0),
      office: OFFICE_B,
      setKey,
      number: 1,
      store: dest,
      extension,
    })
    expect(again).toMatchObject({ ok: true, already: true })
  })

  it('refuses a part that belongs to another set', async () => {
    const { parts } = await exportSet()
    const dest = memoryObjectStore()
    const out = await restorePart({
      bytes: partAt(parts, 0),
      office: OFFICE_B,
      setKey: 'a'.repeat(64),
      number: 1,
      store: dest,
      extension,
    })
    expect(out).toMatchObject({ ok: false, status: 409, error: 'this part belongs to another set' })
  })

  it('a restored set cannot be abandoned, because its files now belong to a project', async () => {
    const { parts, setKey } = await exportSet()
    const dest = memoryObjectStore()
    await restorePart({
      bytes: partAt(parts, 0),
      office: OFFICE_B,
      setKey,
      number: 1,
      store: dest,
      extension,
    })
    await restorePart({
      bytes: partAt(parts, 1),
      office: OFFICE_B,
      setKey,
      number: 2,
      store: dest,
      extension,
    })
    await commitSet({
      office: OFFICE_B,
      setKey,
      store: dest,
      extension,
      restore: async () => ({ ok: true }),
    })
    const out = await abandonSet({ office: OFFICE_B, setKey, store: dest })
    expect(out).toMatchObject({
      ok: false,
      status: 409,
      error: 'this set was restored, so it cannot be abandoned',
    })
  })
})
