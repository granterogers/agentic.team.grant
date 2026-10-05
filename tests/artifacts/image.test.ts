/**
 * Images in the PDF writer (src/artifacts/image.ts, pdf.ts, qa.ts): HQ-PDF-006/007/014's logo.
 *
 * The fixtures are REAL files from a real encoder (ImageMagick), not bytes this repository generated, so the PNG
 * reader is checked against what an uploaded logo actually looks like. Nothing here touches the network: images
 * arrive as bytes.
 */
import { readFileSync } from 'node:fs'
import { crc32, deflateSync, inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { fit, MAX_IMAGE_BYTES, readImage } from '../../src/artifacts/image.ts'
import { A4, assemble, Page, rgb } from '../../src/artifacts/pdf.ts'
import { layoutCollisions } from '../../src/artifacts/qa.ts'
import { validatePdf } from '../../src/artifacts/validate.ts'

const file = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(`tests/artifacts/fixtures/${name}`))
const dec = new TextDecoder('latin1')
const info = {
  author: 'x',
  created: new Date('2026-10-04T00:00:00Z'),
  producer: 'test',
  subject: 's',
  title: 't',
}

/** A syntactically valid PNG with whatever header fields a test wants, for the cases a real encoder refuses to make. */
function craft(width: number, height: number, depth = 8, colorType = 2, interlace = 0): Uint8Array {
  const chunk = (type: string, body: Uint8Array): number[] => {
    const t = [...type].map((c) => c.charCodeAt(0))
    const len = body.length
    const crc = crc32(Uint8Array.from([...t, ...body]))
    const u = (v: number): number[] => [
      (v >>> 24) & 255,
      (v >>> 16) & 255,
      (v >>> 8) & 255,
      v & 255,
    ]
    return [...u(len), ...t, ...body, ...u(crc)]
  }
  const ihdr = Uint8Array.from([
    ...[width, height].flatMap((v) => [
      (v >>> 24) & 255,
      (v >>> 16) & 255,
      (v >>> 8) & 255,
      v & 255,
    ]),
    depth,
    colorType,
    0,
    0,
    interlace,
  ])
  return Uint8Array.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...chunk('IHDR', ihdr),
    ...chunk('IDAT', new Uint8Array(deflateSync(new Uint8Array(0)))),
    ...chunk('IEND', new Uint8Array(0)),
  ])
}

describe('readImage: what is drawn', () => {
  it('draws an RGBA PNG with its transparency: colour plane and a soft mask, un-filtered correctly', () => {
    const r = readImage(file('logo-rgba.png'))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const { image } = r
    expect([image.width, image.height, image.colorSpace]).toEqual([240, 80, 'DeviceRGB'])
    expect(image.smask).toBeDefined()
    const alpha = inflateSync(image.smask as Uint8Array)
    const colour = inflateSync(image.data)
    expect(alpha.length).toBe(240 * 80)
    expect(colour.length).toBe(240 * 80 * 3)
    // The corner of the artwork is transparent; the middle of the amber badge (x 40, y 40) is opaque and amber.
    expect(alpha[0]).toBe(0)
    const at = 40 * 240 + 22
    expect(alpha[at]).toBe(255)
    expect(colour[at * 3]).toBeGreaterThan(200) // red
    expect(colour[at * 3 + 1]).toBeGreaterThan(120)
    expect(colour[at * 3 + 2]).toBeLessThan(80) // blue
  })

  it('passes an opaque RGB PNG through as Flate with PNG predictors, unchanged', () => {
    const r = readImage(file('logo-rgb.png'))
    expect(r.ok && r.image.filter === 'FlateDecode' && r.image.smask === undefined).toBe(true)
    if (r.ok) expect(r.image.extra).toContain('/Predictor 15')
  })

  it('draws a palette PNG as an indexed image', () => {
    const r = readImage(file('logo-pal.png'))
    expect(r.ok && r.image.colorSpace === 'Indexed' && (r.image.palette?.length ?? 0) > 0).toBe(
      true,
    )
  })

  it('passes a JPEG through behind DCTDecode', () => {
    const bytes = file('logo.jpg')
    const r = readImage(bytes)
    expect(
      r.ok && r.kind === 'jpeg' && r.image.filter === 'DCTDecode' && r.image.data === bytes,
    ).toBe(true)
    if (r.ok) expect([r.image.width, r.image.height]).toEqual([240, 80])
  })

  it('keeps proportions when fitting a box', () => {
    const f = fit({ height: 80, width: 240 }, 150, 52)
    expect(f.w / f.h).toBeCloseTo(3, 5)
    expect(f.w).toBeLessThanOrEqual(150)
    expect(f.h).toBeLessThanOrEqual(52)
  })
})

describe('readImage: what is refused, in a sentence, never thrown', () => {
  const refused = (bytes: Uint8Array): string => {
    const r = readImage(bytes)
    if (r.ok) throw new Error('should have been refused')
    return r.reason
  }
  it('16-bit, interlaced, CMYK and unknown formats', () => {
    expect(refused(file('logo-16.png'))).toMatch(/16-bit/)
    expect(refused(file('logo-interlaced.png'))).toMatch(/interlaced/)
    expect(refused(file('logo-cmyk.jpg'))).toMatch(/CMYK/)
    expect(refused(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toMatch(
      /PNG and JPEG/,
    )
    expect(refused(new Uint8Array(0))).toMatch(/empty/)
  })
  it('oversized files and oversized pixels', () => {
    expect(refused(new Uint8Array(MAX_IMAGE_BYTES + 1).fill(0x89))).toMatch(/limit/)
    expect(refused(craft(5000, 10))).toMatch(/limit/)
    expect(refused(craft(3000, 3000))).toMatch(/pixels/)
  })
  it('truncated and corrupt data', () => {
    const png = file('logo-rgba.png')
    expect(refused(png.slice(0, png.length - 40))).toMatch(/truncated|corrupt/)
    const bad = png.slice()
    for (let i = 300; i < 600; i += 1) bad[i] = (bad[i] ?? 0) ^ 0x5a
    expect(refused(bad)).toMatch(/corrupt|wrong size|filter/)
    const jpg = file('logo.jpg')
    expect(refused(jpg.slice(0, 30))).toMatch(/truncated|frame/)
    expect(refused(jpg.slice(0, jpg.length - 2))).toMatch(/truncated/)
  })
  it('control: the same files, intact, are accepted (a refuse-everything reader would pass the above)', () => {
    for (const name of ['logo-rgba.png', 'logo-rgb.png', 'logo-pal.png', 'logo.jpg'])
      expect(readImage(file(name)).ok, name).toBe(true)
  })
})

describe('the writer draws it, and the layout check sees it', () => {
  const logo = (): NonNullable<ReturnType<typeof readImage> & { ok: true }>['image'] => {
    const r = readImage(file('logo-rgba.png'))
    if (!r.ok) throw new Error('fixture')
    return r.image
  }

  it('writes an image XObject with its soft mask, and the file still validates', () => {
    const p = new Page(A4.width, A4.height)
    p.text('A cover with a logo on it for the validator', 64, 700, 'Helvetica', 12, rgb(0, 0, 0))
    p.image(logo(), 64, 760, 120, 40)
    const bytes = assemble([p], info)
    const t = dec.decode(bytes)
    expect(t).toContain('/Subtype /Image')
    expect(t).toContain('/SMask')
    expect(t).toMatch(/\/Im1 Do/)
    expect(validatePdf(bytes).problems.filter((x) => !/too small/.test(x))).toEqual([])
  })

  it('one image on two pages is one object', () => {
    const img = logo()
    const a = new Page(A4.width, A4.height).text('a', 64, 700, 'Helvetica', 12, rgb(0, 0, 0))
    const b = new Page(A4.width, A4.height).text('b', 64, 700, 'Helvetica', 12, rgb(0, 0, 0))
    a.image(img, 64, 760, 120, 40)
    b.image(img, 64, 760, 120, 40)
    const t = dec.decode(assemble([a, b], info))
    expect(t.match(/\/Subtype \/Image/g)?.length).toBe(2) // the image and its mask, once each
  })

  it('a page with no image keeps exactly the resources it always had', () => {
    const p = new Page(A4.width, A4.height).text('plain', 64, 700, 'Helvetica', 12, rgb(0, 0, 0))
    expect(dec.decode(assemble([p], info))).not.toContain('/XObject')
  })

  const overText = (): Page => {
    const p = new Page(A4.width, A4.height)
    p.image(logo(), 64, 700, 120, 40)
    p.text('Kicker printed on the logo', 70, 715, 'Helvetica-Bold', 9, rgb(0, 0, 0))
    return p
  }
  it('RED: text printed over an image is a collision', () => {
    expect(layoutCollisions([overText()]).join('|')).toMatch(/text overlaps an image/)
  })
  it('GREEN control: the same text beside the image is clean', () => {
    const p = new Page(A4.width, A4.height)
    p.image(logo(), 64, 700, 120, 40)
    p.text('Kicker beside the logo', 200, 715, 'Helvetica-Bold', 9, rgb(0, 0, 0))
    expect(layoutCollisions([p])).toEqual([])
  })
  it('an image off the page, and two images overlapping, are reported', () => {
    const p = new Page(A4.width, A4.height)
    p.image(logo(), 560, 700, 120, 40)
    expect(layoutCollisions([p]).join('|')).toMatch(/runs off/)
    const q = new Page(A4.width, A4.height)
    q.image(logo(), 64, 700, 120, 40)
    q.image(logo(), 100, 710, 120, 40)
    expect(layoutCollisions([q]).join('|')).toMatch(/overlaps another image/)
  })
})
