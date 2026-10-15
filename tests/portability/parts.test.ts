/**
 * Project sets (#471, item 5): a project larger than one archive is carried as parts, each at most 8 MB, under explicit limits.
 * Pure. Each refusal is asserted by its reason, so a refusal for the wrong reason cannot pass.
 */
import { describe, expect, it } from 'vitest'
import { ARCHIVE_LIMITS, ArchiveError, sha256Hex } from '../../src/portability/archive.ts'
import {
  attachOriginals,
  buildPart,
  indexBytes,
  openPart,
  planParts,
  SET_FORMAT,
  SET_LIMITS,
  SET_MAX_FILE_BYTES,
  SET_VERSION,
  type SetEntry,
  type SetIndex,
  setKeyOf,
} from '../../src/portability/parts.ts'

const MB = 1024 * 1024
/** The part at an index. A test that asks for a part that is not there fails here, with a reason. */
const partAt = (list: readonly Uint8Array[], i: number): Uint8Array => {
  const part = list[i]
  if (part === undefined) throw new Error(`there is no part ${String(i)}`)
  return part
}
const bytesOf = (n: number, fill: number): Uint8Array => new Uint8Array(n).fill(fill)
const enc = (s: string) => new TextEncoder().encode(s)
const PKG = enc(
  JSON.stringify({ project: { slug: 'big' }, documents: [{ title: 'a' }, { title: 'b' }] }),
)

/** Build the index and the parts for a list of files, as the gateway does: one part per planned group. */
async function buildSet(files: { bytes: Uint8Array; mime: string }[], pkg: Uint8Array = PKG) {
  const plan = planParts(
    files.map((f, i) => ({ title: `file ${String(i)}`, bytes: f.bytes.length })),
  )
  if (!plan.ok) throw new Error(plan.reason)
  const entries: SetEntry[] = []
  for (const [p, group] of plan.parts.entries()) {
    for (const i of group) {
      const f = files[i]
      if (f === undefined) throw new Error('bad plan')
      const sha = await sha256Hex(f.bytes)
      entries.push({
        doc: i,
        sha256: sha,
        bytes: f.bytes.length,
        mime: f.mime,
        archive_name: `files/${sha}.bin`,
        part: p + 1,
      })
    }
  }
  const index: SetIndex = {
    format: SET_FORMAT,
    version: SET_VERSION,
    slug: 'big',
    package_sha256: await sha256Hex(pkg),
    part_count: plan.parts.length,
    entries,
  }
  const idx = indexBytes(index)
  const parts: Uint8Array[] = []
  for (const [p, group] of plan.parts.entries()) {
    const partFiles = group.map((i) => {
      const f = files[i]
      if (f === undefined) throw new Error('bad plan')
      const e = entries.find((x) => x.doc === i)
      return { name: e?.archive_name ?? '', data: f.bytes }
    })
    parts.push(
      buildPart({
        index: idx,
        number: p + 1,
        files: partFiles,
        pkg: p === 0 ? pkg : null,
        exportedAt: '2026-10-14T12:00:00.000Z',
      }),
    )
  }
  return { index, idx, parts, entries }
}

describe('planParts: what fits in one part, and the refusals', () => {
  it('keeps a small project in one part', () => {
    const plan = planParts([
      { title: 'a', bytes: 1 * MB },
      { title: 'b', bytes: 1 * MB },
    ])
    expect(plan).toEqual({ ok: true, parts: [[0, 1]] })
  })

  it('splits a project across parts, first-fit, in document order', () => {
    const plan = planParts([
      { title: 'a', bytes: 3 * MB },
      { title: 'b', bytes: 3 * MB },
      { title: 'c', bytes: 1 * MB },
    ])
    expect(plan).toEqual({ ok: true, parts: [[0], [1, 2]] })
  })

  it('refuses a single original larger than one part, and names it', () => {
    const plan = planParts([{ title: 'the big deck', bytes: SET_LIMITS.fileBytesPerPart + 1 }])
    expect(plan).toMatchObject({ ok: false, status: 413 })
    expect((plan as { reason: string }).reason).toContain('"the big deck" is larger than one part')
  })

  it('refuses a set whose total is over the set limit, before any file is read', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      title: `f${String(i)}`,
      bytes: SET_LIMITS.fileBytesPerPart,
    }))
    const plan = planParts(many)
    expect(plan).toMatchObject({ ok: false, status: 413 })
    expect((plan as { reason: string }).reason).toContain('a set can hold')
  })

  it('refuses a plan that would need more parts than one set holds', () => {
    // Files just over half a part each, so every part carries one: more parts than the limit allows, yet under the total.
    const each = Math.floor(SET_LIMITS.fileBytesPerPart / 2) + 1
    const count = SET_LIMITS.maxParts + 1
    expect(each * count).toBeLessThan(SET_MAX_FILE_BYTES + each)
    const plan = planParts(
      Array.from({ length: count }, (_, i) => ({ title: `f${String(i)}`, bytes: each })),
    )
    expect(plan).toMatchObject({ ok: false, status: 413 })
    expect((plan as { reason: string }).reason).toContain('parts, and a set holds at most')
  })

  it('keeps the limits inside the 8 MB a part is allowed', () => {
    expect(SET_LIMITS.fileBytesPerPart + SET_LIMITS.packageBytes).toBeLessThan(
      ARCHIVE_LIMITS.maxBytes,
    )
    expect(SET_MAX_FILE_BYTES).toBe(SET_LIMITS.fileBytesPerPart * SET_LIMITS.maxParts)
  })
})

describe('the index: one set of bytes per index, and a key that changes with any byte', () => {
  it('serialises the same index to the same bytes', async () => {
    const { index } = await buildSet([{ bytes: bytesOf(1000, 1), mime: 'application/pdf' }])
    expect(indexBytes(index)).toEqual(indexBytes({ ...index }))
  })

  it('changes the set key when one byte of one entry changes', async () => {
    const { index } = await buildSet([{ bytes: bytesOf(1000, 1), mime: 'application/pdf' }])
    const first = index.entries[0] as SetEntry
    const changed = { ...index, entries: [{ ...first, sha256: 'f'.repeat(64) }] }
    expect(await setKeyOf(indexBytes(index))).not.toBe(await setKeyOf(indexBytes(changed)))
  })
})

describe('a part: round trip and each way it is refused', () => {
  it('round-trips a two-part set and returns every file and the package', async () => {
    const files = [
      { bytes: bytesOf(3 * MB, 1), mime: 'application/pdf' },
      { bytes: bytesOf(3 * MB, 2), mime: 'application/pdf' },
      { bytes: bytesOf(1 * MB, 3), mime: 'image/png' },
    ]
    const { parts, idx } = await buildSet(files)
    // 3 MB, then 3 MB (which does not fit beside it), then 1 MB (which fits beside the second): two parts.
    expect(parts).toHaveLength(2)
    const first = await openPart(partAt(parts, 0))
    expect(first.number).toBe(1)
    expect(first.pkg).toEqual(PKG)
    expect(first.files.size).toBe(1)
    const second = await openPart(partAt(parts, 1))
    expect(second.pkg).toBeNull()
    expect(second.files.size).toBe(2)
    expect(second.indexBytes).toEqual(idx)
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(ARCHIVE_LIMITS.maxBytes)
  })

  it('refuses a part whose file was altered, by its checksum', async () => {
    const { parts } = await buildSet([{ bytes: bytesOf(2 * MB, 7), mime: 'application/pdf' }])
    const tampered = partAt(parts, 0).slice()
    // Flip a byte in the middle of the stored file (the PDF data, not the ZIP's own structure).
    tampered[Math.floor(tampered.length / 2)] =
      (tampered[Math.floor(tampered.length / 2)] ?? 0) ^ 0xff
    await expect(openPart(tampered)).rejects.toThrow(
      /checksum|not the size|could not be read|CRC|ZIP/i,
    )
  })

  it('refuses a part that names a part number the set does not have', async () => {
    const { idx } = await buildSet([{ bytes: bytesOf(10, 1), mime: 'application/pdf' }])
    const bogus = buildPart({
      index: idx,
      number: 5,
      files: [],
      pkg: null,
      exportedAt: '2026-10-14T12:00:00.000Z',
    })
    await expect(openPart(bogus)).rejects.toThrow('does not name a part number the set has')
  })

  it('refuses a part that carries a file the set does not assign to it', async () => {
    const { parts } = await buildSet([
      { bytes: bytesOf(10, 1), mime: 'application/pdf' },
      { bytes: bytesOf(10, 2), mime: 'application/pdf' },
    ])
    const { idx } = await buildSet([{ bytes: bytesOf(10, 1), mime: 'application/pdf' }])
    const extra = buildPart({
      index: idx,
      number: 1,
      files: [{ name: 'files/' + 'a'.repeat(64) + '.bin', data: bytesOf(10, 9) }],
      pkg: PKG,
      exportedAt: '2026-10-14T12:00:00.000Z',
    })
    await expect(openPart(extra)).rejects.toThrow('a file the set does not assign to it')
    expect(parts.length).toBeGreaterThan(0)
  })

  it('refuses the package on a part other than part 1, and building part 1 without one', async () => {
    const { idx } = await buildSet([{ bytes: bytesOf(10, 1), mime: 'application/pdf' }])
    expect(() =>
      buildPart({
        index: idx,
        number: 2,
        files: [],
        pkg: PKG,
        exportedAt: '2026-10-14T12:00:00.000Z',
      }),
    ).toThrow(ArchiveError)
    expect(() =>
      buildPart({
        index: idx,
        number: 1,
        files: [],
        pkg: null,
        exportedAt: '2026-10-14T12:00:00.000Z',
      }),
    ).toThrow('part 1 carries the project package')
  })

  it('refuses a part that is not a set at all', async () => {
    const plain = buildPart({
      index: enc('{}'),
      number: 1,
      files: [],
      pkg: PKG,
      exportedAt: '2026-10-14T12:00:00.000Z',
    })
    await expect(openPart(plain)).rejects.toThrow(
      'this set is in a format this office does not read',
    )
  })
})

describe('attachOriginals: the commit puts each original back on its own document, and no other', () => {
  const entry = (doc: number): SetEntry => ({
    doc,
    sha256: 'a'.repeat(64),
    bytes: 4,
    mime: 'application/pdf',
    archive_name: `files/${'a'.repeat(64)}.pdf`,
    part: 1,
  })
  const index = (entries: SetEntry[]): SetIndex => ({
    format: SET_FORMAT,
    version: SET_VERSION,
    slug: 'x',
    package_sha256: 'b'.repeat(64),
    part_count: 1,
    entries,
  })

  it('sets the path the gateway chose on the named document', () => {
    const pkg = { documents: [{ title: 'a' }, { title: 'b' }] }
    const out = attachOriginals(pkg, index([entry(1)]), (e) => `restores/o/k/${e.sha256}.pdf`)
    expect(out).toEqual({
      ok: true,
      pkg: {
        documents: [
          { title: 'a' },
          {
            title: 'b',
            original: {
              mime_type: 'application/pdf',
              bytes: 4,
              storage_path: `restores/o/k/${'a'.repeat(64)}.pdf`,
            },
          },
        ],
      },
    })
  })

  it('refuses an index that names a document the package does not hold', () => {
    const out = attachOriginals({ documents: [] }, index([entry(3)]), () => 'p')
    expect(out).toEqual({
      ok: false,
      reason: 'the set names a document the package does not hold',
    })
  })

  it('refuses a package that holds an original the index does not name', () => {
    const pkg = { documents: [{ original: { mime_type: 'application/pdf' } }] }
    const out = attachOriginals(pkg, index([]), () => 'p')
    expect(out).toEqual({
      ok: false,
      reason: 'the package holds an original the set does not name',
    })
  })
})
