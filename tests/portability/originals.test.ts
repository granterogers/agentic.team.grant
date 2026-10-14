/**
 * The original files in the project archive (issue #471, migration 1072): export gathers them, restore plans and writes
 * them, and a full archive round trip keeps every file's SHA-256 exactly. Fixtures only: the in-memory object store.
 */
import { describe, expect, it } from 'vitest'
import { memoryObjectStore } from '../../src/files/object-store.ts'
import { extensionFor } from '../../src/files/store.ts'
import { buildArchive, openArchive, sha256Hex } from '../../src/portability/archive.ts'
import {
  discardOriginals,
  gatherOriginals,
  type OriginalStore,
  planOriginals,
  writeOriginals,
} from '../../src/portability/originals.ts'

const OFFICE = '2a2cd4d4-48c9-41ba-8271-a798631997da'
const OTHER_OFFICE = 'e13ce7a9-831b-49d7-83a5-2ede9c1a97d0'
const KEY = 'k'.repeat(64)
const MAX = 8 * 1024 * 1024
const EXPORTED_AT = '2026-10-14T08:00:00.000Z'

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
const PDF = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 99, 98, 97, 96])

type Doc = Record<string, unknown>

function pkgWith(docs: unknown[]) {
  return {
    format: 'ai-team-hq/project-package',
    format_version: 1,
    project: { slug: 'wellness', name: 'Wellness' },
    documents: docs,
    tasks: [],
  }
}

/** The document at an index of a package, as a plain record. A missing one is a fixture error, so it fails loudly. */
function docAt(pkg: unknown, index: number): Doc {
  const docs = (pkg as { documents: Doc[] }).documents
  const doc = docs[index]
  if (doc === undefined) throw new Error(`fixture: no document at ${index}`)
  return doc
}

function storeWith(objects: Record<string, { bytes: Uint8Array; mime: string }>): OriginalStore {
  const mem = memoryObjectStore()
  for (const [path, o] of Object.entries(objects)) void mem.put(path, o.bytes, o.mime)
  return mem
}

/** A store that works, except that what it reads back differs from what was written (a corrupted copy). */
function corruptingStore(inner: OriginalStore): OriginalStore {
  return {
    read: async (path) => {
      const got = await inner.read(path)
      if (got === null) return null
      return { bytes: Uint8Array.from([0, ...got.bytes.slice(1)]), mime: got.mime }
    },
    put: (path, bytes, mime) => inner.put(path, bytes, mime),
    remove: (path) => inner.remove(path),
  }
}

describe('export gathers each stored original', () => {
  it('reads the file, names it by its SHA-256, and records the checksum on the document', async () => {
    const store = storeWith({ 'files/a/plan.png': { bytes: PNG, mime: 'image/png' } })
    const pkg = pkgWith([
      {
        title: 'Floor plan',
        original: { mime_type: 'image/png', bytes: PNG.length, storage_path: 'files/a/plan.png' },
      },
      { title: 'Meeting note' },
    ])
    const sha = await sha256Hex(PNG)
    const out = await gatherOriginals({ pkg, store, extension: extensionFor, maxBytes: MAX })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(docAt(out.pkg, 0).original).toMatchObject({
      mime_type: 'image/png',
      bytes: PNG.length,
      storage_path: 'files/a/plan.png',
      sha256: sha,
      archive_name: `files/${sha}.png`,
    })
    expect(out.files).toEqual([{ name: `files/${sha}.png`, data: PNG }])
    // The input package is not changed.
    expect(docAt(pkg, 0).original).not.toHaveProperty('sha256')
  })

  it('refuses the whole archive, naming the document, when a stored file is missing', async () => {
    const pkg = pkgWith([
      {
        title: 'Floor plan',
        original: { mime_type: 'image/png', bytes: 16, storage_path: 'files/a/gone.png' },
      },
    ])
    const out = await gatherOriginals({
      pkg,
      store: storeWith({}),
      extension: extensionFor,
      maxBytes: MAX,
    })
    expect(out).toMatchObject({ ok: false, status: 409 })
    if (out.ok) return
    expect(out.error).toContain('"Floor plan"')
  })

  it('refuses a stored file whose length is not the length the document records', async () => {
    const store = storeWith({ 'files/a/plan.png': { bytes: PNG, mime: 'image/png' } })
    const pkg = pkgWith([
      {
        title: 'Floor plan',
        original: { mime_type: 'image/png', bytes: 999, storage_path: 'files/a/plan.png' },
      },
    ])
    const out = await gatherOriginals({ pkg, store, extension: extensionFor, maxBytes: MAX })
    expect(out).toMatchObject({ ok: false, status: 409 })
  })

  it('refuses when the originals would not fit in one archive', async () => {
    const store = storeWith({ 'files/a/plan.png': { bytes: PNG, mime: 'image/png' } })
    const pkg = pkgWith([
      {
        title: 'Floor plan',
        original: {
          mime_type: 'image/png',
          bytes: PNG.length,
          storage_path: 'files/a/plan.png',
        },
      },
    ])
    const out = await gatherOriginals({ pkg, store, extension: extensionFor, maxBytes: 4 })
    expect(out).toMatchObject({ ok: false, status: 413 })
  })

  it('carries a file once when two documents hold the same bytes', async () => {
    const store = storeWith({
      'files/a/one.png': { bytes: PNG, mime: 'image/png' },
      'files/a/two.png': { bytes: PNG, mime: 'image/png' },
    })
    const pkg = pkgWith([
      {
        title: 'One',
        original: { mime_type: 'image/png', bytes: PNG.length, storage_path: 'files/a/one.png' },
      },
      {
        title: 'Two',
        original: { mime_type: 'image/png', bytes: PNG.length, storage_path: 'files/a/two.png' },
      },
    ])
    const out = await gatherOriginals({ pkg, store, extension: extensionFor, maxBytes: MAX })
    expect(out.ok && out.files).toHaveLength(1)
  })
})

describe('restore plans each file before anything is written', () => {
  async function exported() {
    const store = storeWith({ 'files/a/plan.png': { bytes: PNG, mime: 'image/png' } })
    const pkg = pkgWith([
      {
        title: 'Floor plan',
        original: { mime_type: 'image/png', bytes: PNG.length, storage_path: 'files/a/plan.png' },
      },
      { title: 'Meeting note' },
    ])
    const out = await gatherOriginals({ pkg, store, extension: extensionFor, maxBytes: MAX })
    if (!out.ok) throw new Error('fixture export failed')
    return { pkg: out.pkg, files: new Map(out.files.map((f) => [f.name, f.data])) }
  }

  it('builds the stored path under this office and this archive key, and ignores any path the package names', async () => {
    const { pkg, files } = await exported()
    const sha = await sha256Hex(PNG)
    const first = docAt(pkg, 0)
    first.original = {
      ...(first.original as object),
      storage_path: 'files/someone-elses-office/plan.png',
    }
    const plan = await planOriginals({
      pkg,
      files,
      key: KEY,
      office: OFFICE,
      extension: extensionFor,
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    const path = `restores/${OFFICE}/${KEY}/${sha}.png`
    expect(plan.writes).toEqual([{ path, bytes: PNG, mime: 'image/png', sha256: sha }])
    expect(docAt(plan.pkg, 0).original).toEqual({
      mime_type: 'image/png',
      bytes: PNG.length,
      storage_path: path,
    })
  })

  it('refuses a document whose file the archive does not hold, by name', async () => {
    const { pkg } = await exported()
    const plan = await planOriginals({
      pkg,
      files: new Map(),
      key: KEY,
      office: OFFICE,
      extension: extensionFor,
    })
    expect(plan).toMatchObject({ ok: false })
    if (plan.ok) return
    expect(plan.reason).toContain('"Floor plan"')
  })

  it('refuses a file whose bytes do not match the recorded checksum', async () => {
    const { pkg } = await exported()
    const name = String((docAt(pkg, 0).original as Doc).archive_name)
    const tampered = new Map([[name, Uint8Array.from(PNG).map((b, i) => (i === 3 ? b ^ 1 : b))]])
    const plan = await planOriginals({
      pkg,
      files: tampered,
      key: KEY,
      office: OFFICE,
      extension: extensionFor,
    })
    expect(plan).toMatchObject({ ok: false })
    if (!plan.ok) expect(plan.reason).toContain('recorded checksum')
  })

  it('refuses a document with no checksum', async () => {
    const pkg = pkgWith([
      {
        title: 'Floor plan',
        original: { mime_type: 'image/png', bytes: 16, archive_name: 'files/x.png' },
      },
    ])
    const plan = await planOriginals({
      pkg,
      files: new Map([['files/x.png', PNG]]),
      key: KEY,
      office: OFFICE,
      extension: extensionFor,
    })
    expect(plan).toMatchObject({ ok: false })
  })
})

describe('writing originals is verified, and a failure leaves nothing behind', () => {
  const path = (sha: string) => `restores/${OFFICE}/${KEY}/${sha}.png`

  it('writes each file, reads it back, and reports what it wrote', async () => {
    const store = memoryObjectStore()
    const sha = await sha256Hex(PNG)
    const out = await writeOriginals({
      writes: [{ path: path(sha), bytes: PNG, mime: 'image/png', sha256: sha }],
      store,
    })
    expect(out).toEqual({ ok: true, written: [path(sha)] })
    expect(await store.read(path(sha))).toMatchObject({ mime: 'image/png' })
  })

  it('leaves an identical file already at its path alone and does not count it as written', async () => {
    const sha = await sha256Hex(PNG)
    const store = storeWith({ [path(sha)]: { bytes: PNG, mime: 'image/png' } })
    const out = await writeOriginals({
      writes: [{ path: path(sha), bytes: PNG, mime: 'image/png', sha256: sha }],
      store,
    })
    expect(out).toEqual({ ok: true, written: [] })
    // Discarding after a later failure must not remove it.
    await discardOriginals({ store, written: out.ok ? out.written : [] })
    expect(await store.read(path(sha))).not.toBeNull()
  })

  it('refuses a different file at the same path and removes what this run wrote first', async () => {
    const shaA = await sha256Hex(PNG)
    const shaB = await sha256Hex(PDF)
    const store = storeWith({
      [path(shaB)]: { bytes: Uint8Array.from([1, 2, 3]), mime: 'image/png' },
    })
    const out = await writeOriginals({
      writes: [
        { path: path(shaA), bytes: PNG, mime: 'image/png', sha256: shaA },
        { path: path(shaB), bytes: PDF, mime: 'image/png', sha256: shaB },
      ],
      store,
    })
    expect(out).toMatchObject({ ok: false })
    expect(await store.read(path(shaA))).toBeNull()
    expect(await store.read(path(shaB))).toMatchObject({
      bytes: Uint8Array.from([1, 2, 3]),
    })
  })

  it('catches a copy that does not read back the same, and removes it', async () => {
    const sha = await sha256Hex(PNG)
    const inner = memoryObjectStore()
    const out = await writeOriginals({
      writes: [{ path: path(sha), bytes: PNG, mime: 'image/png', sha256: sha }],
      store: corruptingStore(inner),
    })
    expect(out).toMatchObject({ ok: false })
    if (!out.ok) expect(out.reason).toContain('did not read back the same')
    expect(await inner.read(path(sha))).toBeNull()
  })
})

describe('a full archive round trip keeps every file hash', () => {
  it('exports to a ZIP, opens it, plans and writes the files, and reads back the same SHA-256', async () => {
    const source = storeWith({
      'files/a/plan.png': { bytes: PNG, mime: 'image/png' },
      'files/a/budget.pdf': { bytes: PDF, mime: 'application/pdf' },
    })
    const pkg = pkgWith([
      {
        title: 'Floor plan',
        original: { mime_type: 'image/png', bytes: PNG.length, storage_path: 'files/a/plan.png' },
      },
      {
        title: 'Budget',
        original: {
          mime_type: 'application/pdf',
          bytes: PDF.length,
          storage_path: 'files/a/budget.pdf',
        },
      },
      { title: 'Meeting note' },
    ])
    const gathered = await gatherOriginals({
      pkg,
      store: source,
      extension: extensionFor,
      maxBytes: MAX,
    })
    if (!gathered.ok) throw new Error('export refused')
    const archive = await buildArchive(
      gathered.pkg,
      { slug: 'wellness', exportedAt: EXPORTED_AT },
      gathered.files,
    )

    const opened = await openArchive(archive.bytes)
    expect(opened.files.size).toBe(2)

    const target = memoryObjectStore()
    const plan = await planOriginals({
      pkg: opened.pkg,
      files: opened.files,
      key: archive.key,
      office: OTHER_OFFICE,
      extension: extensionFor,
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    const written = await writeOriginals({ writes: plan.writes, store: target })
    expect(written.ok).toBe(true)

    // Every restored file reads back with the SHA-256 the document recorded, and sits under the restoring office.
    for (const w of plan.writes) {
      expect(w.path.startsWith(`restores/${OTHER_OFFICE}/${archive.key}/`)).toBe(true)
      const back = await target.read(w.path)
      expect(back === null ? null : await sha256Hex(back.bytes)).toBe(w.sha256)
    }
    expect(plan.writes.map((w) => w.sha256).sort()).toEqual(
      [await sha256Hex(PNG), await sha256Hex(PDF)].sort(),
    )
  })

  it('refuses an archive whose original file was changed after it was made', async () => {
    const source = storeWith({ 'files/a/plan.png': { bytes: PNG, mime: 'image/png' } })
    const pkg = pkgWith([
      {
        title: 'Floor plan',
        original: { mime_type: 'image/png', bytes: PNG.length, storage_path: 'files/a/plan.png' },
      },
    ])
    const gathered = await gatherOriginals({
      pkg,
      store: source,
      extension: extensionFor,
      maxBytes: MAX,
    })
    if (!gathered.ok) throw new Error('export refused')
    const archive = await buildArchive(
      gathered.pkg,
      { slug: 'wellness', exportedAt: EXPORTED_AT },
      gathered.files,
    )
    // Change one byte of the stored PNG inside the ZIP. The CRC and the manifest both refuse it.
    const damaged = Uint8Array.from(archive.bytes)
    const at = Array.from({ length: damaged.length - PNG.length + 1 }, (_, i) => i).find((i) =>
      PNG.every((b, j) => damaged[i + j] === b),
    )
    if (at === undefined) throw new Error('fixture: the PNG bytes are not in the archive')
    damaged[at + 5] = (damaged[at + 5] ?? 0) ^ 0xff
    await expect(openArchive(damaged)).rejects.toThrow()
  })
})
