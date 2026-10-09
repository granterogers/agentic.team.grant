// biome-ignore-all format: tables of cases, kept readable as written
import { describe, expect, it } from 'vitest'
import {
  BG_LIMITS,
  backgroundKey,
  backgroundPrefix,
  decodeBase64,
  projectOfKey,
  revisionFromStamp,
  sniffImage,
  vetBackground,
} from '../../src/backgrounds/project-background.ts'

const OFFICE = '11111111-2222-4333-8444-555555555555'
const PROJECT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

const png = (w: number, h: number, len = 64): Uint8Array => {
  const b = new Uint8Array(Math.max(len, 33))
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  new DataView(b.buffer).setUint32(16, w)
  new DataView(b.buffer).setUint32(20, h)
  return b
}
const jpg = (w: number, h: number): Uint8Array => {
  const b = new Uint8Array(40)
  b.set([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, (h >> 8) & 255, h & 255, (w >> 8) & 255, w & 255, 3])
  return b
}
const text = (s: string): Uint8Array => new TextEncoder().encode(s.padEnd(64, ' '))

describe('sniffImage and vetBackground read the header, not the name', () => {
  it('reads a PNG and a JPEG', () => {
    expect(sniffImage(png(1600, 900))).toMatchObject({ mime: 'image/png', ext: 'png', w: 1600, h: 900 })
    expect(sniffImage(jpg(800, 600))).toMatchObject({ mime: 'image/jpeg', ext: 'jpg', w: 800, h: 600 })
  })
  it('refuses SVG, HTML, text and a PDF whatever they call themselves', () => {
    for (const s of ['<svg xmlns="http://www.w3.org/2000/svg"/>', '<?xml version="1.0"?><svg/>', '<html><body>x</body></html>', '%PDF-1.7 not a picture', 'plain words, not an image at all']) {
      expect('error' in sniffImage(text(s))).toBe(true)
    }
  })
  it('refuses oversize dimensions, a zero size, an empty body and more than 3 MB', () => {
    expect('error' in vetBackground(png(5000, 10))).toBe(true)
    expect('error' in vetBackground(png(4096, 4096))).toBe(true)
    expect('error' in vetBackground(png(0, 0))).toBe(true)
    expect('error' in vetBackground(new Uint8Array(0))).toBe(true)
    expect('error' in vetBackground(png(100, 100, BG_LIMITS.bytes + 1))).toBe(true)
  })
  it('accepts a picture exactly at the limits (control: the refusals above are not a refuse-everything gate)', () => {
    expect('error' in vetBackground(png(4096, 3906))).toBe(false)
    expect('error' in vetBackground(png(100, 100, BG_LIMITS.bytes))).toBe(false)
  })
})

describe('keys are built from the verified office and the resolved project, and nothing else', () => {
  it('builds <office>/backgrounds/<project>.<ext>', () => {
    expect(backgroundKey(OFFICE, PROJECT, 'png')).toBe(`${OFFICE}/backgrounds/${PROJECT}.png`)
    expect(backgroundPrefix(OFFICE)).toBe(`${OFFICE}/backgrounds/`)
  })
  it('refuses a key built from anything that is not a uuid or a known extension', () => {
    expect(backgroundKey('../x', PROJECT, 'png')).toBeNull()
    expect(backgroundKey(OFFICE, '../../etc', 'png')).toBeNull()
    expect(backgroundKey(OFFICE, `${PROJECT}/../x`, 'png')).toBeNull()
    expect(backgroundKey(OFFICE, PROJECT, 'svg')).toBeNull()
    expect(backgroundKey(OFFICE, PROJECT, 'png/../x')).toBeNull()
    expect(backgroundPrefix('')).toBeNull()
  })
  it('names the project a stored key belongs to, and nothing for a name it did not write', () => {
    expect(projectOfKey(OFFICE, `${PROJECT}.jpg`)).toBe(PROJECT)
    expect(projectOfKey(OFFICE, `${OFFICE}/backgrounds/${PROJECT}.webp`)).toBe(PROJECT)
    expect(projectOfKey(OFFICE, 'notes.txt')).toBeNull()
    expect(projectOfKey(OFFICE, `${PROJECT}.svg`)).toBeNull()
    expect(projectOfKey(OFFICE, `x/${PROJECT}.png`)).toBeNull()
  })
})

describe('revision and base64', () => {
  it('a revision follows the storage time and changes when the object is rewritten', () => {
    const a = revisionFromStamp('2026-10-09T10:00:00.000Z')
    const b = revisionFromStamp('2026-10-09T10:00:00.001Z')
    expect(a).not.toBeNull()
    expect(a).not.toBe(b)
    expect(revisionFromStamp('2026-10-09T10:00:00.000Z')).toBe(a)
    expect(revisionFromStamp('not a date')).toBeNull()
    expect(revisionFromStamp(undefined)).toBeNull()
  })
  it('decodes base64 and data URLs, and says null for a body that is not base64', () => {
    expect(Array.from(decodeBase64(btoa('abc')) ?? [])).toEqual([97, 98, 99])
    expect(Array.from(decodeBase64(`data:image/png;base64,${btoa('abc')}`) ?? [])).toEqual([97, 98, 99])
    expect(decodeBase64('%%%not base64%%%')).toBeNull()
  })
})
