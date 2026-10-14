import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ARCHIVE_LIMITS,
  ArchiveError,
  buildArchive,
  buildZip,
  crc32,
  isSafeName,
  openArchive,
  readZip,
  sha256Hex,
} from '../../src/portability/archive.ts'

const enc = new TextEncoder()
const EXPORTED_AT = '2026-10-14T08:00:00.000Z'

const samplePackage = {
  format: 'ai-team-hq/project-package',
  format_version: 1,
  exported_at: EXPORTED_AT,
  project: {
    slug: 'wellness',
    name: 'Wellness',
    brief: 'A brief that is long enough to read as a real brief here.',
  },
  documents: [{ path: 'budget.txt', title: 'Budget', text: 'Totals: 40 and 14 — "£63.50"' }],
  tasks: [{ title: 'Confirm the deposit', state: 'todo' }],
}

describe('the ZIP writer and reader', () => {
  it('round-trips files, names and bytes exactly', () => {
    const zip = buildZip(
      [
        { name: 'a.txt', data: enc.encode('first') },
        { name: 'dir/b.json', data: enc.encode('{"x":1}') },
      ],
      EXPORTED_AT,
    )
    const files = readZip(zip)
    expect([...files.keys()]).toEqual(['a.txt', 'dir/b.json'])
    expect(new TextDecoder().decode(files.get('a.txt'))).toBe('first')
    expect(new TextDecoder().decode(files.get('dir/b.json'))).toBe('{"x":1}')
  })

  it('an empty archive is a valid archive with nothing in it', () => {
    expect(readZip(buildZip([], EXPORTED_AT)).size).toBe(0)
  })

  it('the CRC-32 is the standard one (check value for "123456789")', () => {
    expect(crc32(enc.encode('123456789'))).toBe(0xcbf43926)
  })

  it('refuses to write a name a reader would refuse', () => {
    expect(() => buildZip([{ name: '../escape.txt', data: enc.encode('x') }], EXPORTED_AT)).toThrow(
      ArchiveError,
    )
    expect(() =>
      buildZip(
        [
          { name: 'a.txt', data: enc.encode('x') },
          { name: 'a.txt', data: enc.encode('y') },
        ],
        EXPORTED_AT,
      ),
    ).toThrow(/twice/)
  })
})

describe('ZIP-slip and name safety', () => {
  it('accepts plain names and refuses every path trick', () => {
    expect(isSafeName('project.json')).toBe(true)
    expect(isSafeName('documents/budget-2026.txt')).toBe(true)
    for (const bad of [
      '../x',
      '/etc/passwd',
      'a/../b',
      'a//b',
      'a\\b',
      'C:x',
      'x\0y',
      '',
      './x',
      'a/./b',
      'sp ace.txt',
      'name"quote',
    ]) {
      expect(isSafeName(bad), JSON.stringify(bad)).toBe(false)
    }
    expect(isSafeName('a'.repeat(201))).toBe(false)
  })

  it('a reader refuses an archive whose stored name climbs out of the folder', () => {
    // Build a valid archive, then rewrite the name inside both headers to a traversal, keeping the lengths equal.
    const zip = buildZip([{ name: 'safe.txt', data: enc.encode('x') }], EXPORTED_AT)
    const bad = new TextEncoder().encode('../safe.txt')
    const pad = new Uint8Array(zip)
    const name = enc.encode('safe.txt')
    // The name occurs in the local header and in the central directory; swap both.
    for (let i = 0; i + name.length <= pad.length; i++) {
      if (name.every((b, k) => pad[i + k] === b)) {
        pad.set(bad.subarray(0, name.length), i)
      }
    }
    expect(() => readZip(pad)).toThrow(/not allowed/)
  })
})

describe('integrity: CRC, sizes and the manifest', () => {
  it('refuses a stored file whose bytes were changed (CRC mismatch)', () => {
    const zip = new Uint8Array(
      buildZip([{ name: 'a.txt', data: enc.encode('hello world') }], EXPORTED_AT),
    )
    const at = zip.indexOf(enc.encode('hello world')[0] ?? 0)
    zip[at] = 0x48 // flip one byte of the stored data
    expect(() => readZip(zip)).toThrow(/checksum/)
  })

  it('refuses a truncated archive, which has no directory', () => {
    const zip = buildZip([{ name: 'a.txt', data: enc.encode('x') }], EXPORTED_AT)
    expect(() => readZip(zip.subarray(0, zip.length - 30))).toThrow(ArchiveError)
    expect(() => readZip(new Uint8Array(10))).toThrow(/too short|no ZIP directory/)
  })

  it('refuses a compressed entry (method 8), because archives are stored', () => {
    const zip = new Uint8Array(buildZip([{ name: 'a.txt', data: enc.encode('x') }], EXPORTED_AT))
    const view = new DataView(zip.buffer)
    // The central directory entry starts after the local entry (30 + name 5 + data 1 = 36).
    view.setUint16(36 + 10, 8, true)
    expect(() => readZip(zip)).toThrow(/compressed file is not accepted/)
  })

  it('refuses an archive over the byte limit before reading it', () => {
    const big = new Uint8Array(ARCHIVE_LIMITS.maxBytes + 1)
    expect(() => readZip(big)).toThrow(/larger than the 8 MB/)
  })

  it('refuses an archive with more files than the limit', () => {
    const entries = Array.from({ length: ARCHIVE_LIMITS.maxEntries + 1 }, (_, i) => ({
      name: `f${i}.txt`,
      data: enc.encode('x'),
    }))
    expect(() => buildZip(entries, EXPORTED_AT)).toThrow(/too many entries/)
  })

  it('round-trips a package through buildArchive and openArchive, and the key is the archive hash', async () => {
    const { bytes, key } = await buildArchive(samplePackage, {
      slug: 'wellness',
      exportedAt: EXPORTED_AT,
    })
    expect(key).toBe(await sha256Hex(bytes))
    const opened = await openArchive(bytes)
    expect(opened.pkg).toEqual(samplePackage)
    expect(opened.key).toBe(key)
    expect(opened.manifest.project).toBe('wellness')
  })

  it('a changed byte anywhere gives a different key', async () => {
    const { bytes, key } = await buildArchive(samplePackage, {
      slug: 'wellness',
      exportedAt: EXPORTED_AT,
    })
    const altered = new Uint8Array(bytes)
    // Change a byte inside the package text, leaving the CRC wrong: the reader refuses before any key is used.
    const at = altered.indexOf(enc.encode('Budget')[0] ?? 0)
    altered[at] = 0x62
    await expect(openArchive(altered)).rejects.toThrow()
    expect(await sha256Hex(altered)).not.toBe(key)
  })

  it('refuses a file the manifest does not list', async () => {
    const { bytes } = await buildArchive(samplePackage, {
      slug: 'wellness',
      exportedAt: EXPORTED_AT,
    })
    const files = readZip(bytes)
    const extra = buildZip(
      [
        ...[...files].map(([name, data]) => ({ name, data })),
        { name: 'extra.txt', data: enc.encode('smuggled') },
      ],
      EXPORTED_AT,
    )
    await expect(openArchive(extra)).rejects.toThrow(/not in its manifest/)
  })

  it('refuses a manifest that lists a file the archive does not hold', async () => {
    const manifest = {
      format: 'agentic-team.archive',
      format_version: 1,
      exported_at: EXPORTED_AT,
      project: 'x',
      files: [{ name: 'project.json', bytes: 2, sha256: '0'.repeat(64) }],
    }
    const zip = buildZip(
      [{ name: 'manifest.json', data: enc.encode(JSON.stringify(manifest)) }],
      EXPORTED_AT,
    )
    await expect(openArchive(zip)).rejects.toThrow(/missing from the archive/)
  })

  it('refuses a file whose SHA-256 is not the one the manifest records', async () => {
    const pkg = enc.encode(JSON.stringify({ ...samplePackage, project: { name: 'Other' } }))
    const manifest = {
      format: 'agentic-team.archive',
      format_version: 1,
      exported_at: EXPORTED_AT,
      project: 'x',
      files: [{ name: 'project.json', bytes: pkg.length, sha256: '1'.repeat(64) }],
    }
    const zip = buildZip(
      [
        { name: 'project.json', data: pkg },
        { name: 'manifest.json', data: enc.encode(JSON.stringify(manifest)) },
      ],
      EXPORTED_AT,
    )
    await expect(openArchive(zip)).rejects.toThrow(/SHA-256/)
  })

  it('refuses an archive with no manifest, and one of another format or version', async () => {
    await expect(
      openArchive(buildZip([{ name: 'project.json', data: enc.encode('{}') }], EXPORTED_AT)),
    ).rejects.toThrow(/no manifest/)
    const other = buildZip(
      [
        {
          name: 'manifest.json',
          data: enc.encode(
            JSON.stringify({ format: 'something-else', format_version: 1, files: [] }),
          ),
        },
      ],
      EXPORTED_AT,
    )
    await expect(openArchive(other)).rejects.toThrow(/not an Agentic Team archive/)
    const future = buildZip(
      [
        {
          name: 'manifest.json',
          data: enc.encode(
            JSON.stringify({ format: 'agentic-team.archive', format_version: 9, files: [] }),
          ),
        },
      ],
      EXPORTED_AT,
    )
    await expect(openArchive(future)).rejects.toThrow(/not supported/)
  })
})

describe('interoperability', () => {
  const hasUnzip = (() => {
    try {
      execFileSync('unzip', ['-v'], { stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  })()

  it.runIf(hasUnzip)(
    'the system unzip accepts an archive this module wrote, byte for byte',
    async () => {
      const { bytes } = await buildArchive(samplePackage, {
        slug: 'wellness',
        exportedAt: EXPORTED_AT,
      })
      const dir = mkdtempSync(join(tmpdir(), 'archive-interop-'))
      try {
        const file = join(dir, 'wellness.zip')
        writeFileSync(file, bytes)
        execFileSync('unzip', ['-t', file], { stdio: 'pipe' })
        const listing = execFileSync('unzip', ['-Z1', file], { encoding: 'utf8' })
          .trim()
          .split('\n')
        expect(listing).toEqual(['project.json', 'manifest.json', 'README.txt'])
        const extracted = execFileSync('unzip', ['-p', file, 'project.json'], { encoding: 'utf8' })
        expect(JSON.parse(extracted)).toEqual(samplePackage)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
  )

  it.runIf(hasUnzip)(
    'unzip rejects an archive this reader refuses for a CRC error (both agree on damage)',
    async () => {
      const { bytes } = await buildArchive(samplePackage, {
        slug: 'wellness',
        exportedAt: EXPORTED_AT,
      })
      const damaged = new Uint8Array(bytes)
      const at = damaged.indexOf(enc.encode('Budget')[0] ?? 0)
      damaged[at] = 0x62
      const dir = mkdtempSync(join(tmpdir(), 'archive-damage-'))
      try {
        const file = join(dir, 'damaged.zip')
        writeFileSync(file, damaged)
        expect(() => execFileSync('unzip', ['-t', file], { stdio: 'pipe' })).toThrow()
        expect(() => readZip(damaged)).toThrow(ArchiveError)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
  )
})
