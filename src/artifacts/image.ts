/**
 * Images a PDF can draw: a PNG or a JPEG, read from bytes and turned into what the file format wants.
 *
 * ## What is supported, and what is refused
 *
 * The writer in `pdf.ts` never decodes pixels it can pass through. So:
 *
 *   - JPEG: the bytes go in as they are, behind `/DCTDecode`. Only the header is read (size and components).
 *     8-bit grey and RGB are drawn. CMYK is refused: Adobe CMYK JPEGs are stored inverted and a reader would show a
 *     negative of the logo, which is worse than no logo.
 *   - PNG, 8-bit, not interlaced: grey, RGB, palette, grey+alpha and RGBA.
 *     Without alpha the IDAT data is already a zlib stream of PNG-filtered rows, which is exactly what `/FlateDecode`
 *     with `/Predictor 15` reads, so it goes in unchanged.
 *     With alpha the rows are inflated, un-filtered, split into colour and alpha, and each is deflated again: the
 *     colour as the image and the alpha as its soft mask (`/SMask`), which is how a transparent logo keeps its shape.
 *   - Anything else (16-bit, interlaced, WebP, SVG, truncated or corrupt data, over the size limits) is refused with a
 *     sentence. The caller renders WITHOUT the image and says so: a logo that cannot be drawn must never fail a report.
 *
 * Pure but for `node:zlib` (Deno ships it too). No network: the caller supplies bytes.
 */

import { deflateSync, inflateSync } from 'node:zlib'

export interface PdfImage {
  readonly width: number
  readonly height: number
  readonly colorSpace: 'DeviceGray' | 'DeviceRGB' | 'Indexed'
  readonly filter: 'FlateDecode' | 'DCTDecode'
  /** The image's own stream bytes, already in `filter`. */
  readonly data: Uint8Array
  /** Extra dictionary entries (`/DecodeParms`) for the image object. */
  readonly extra: string
  /** `Indexed` only: the palette, RGB triples. */
  readonly palette?: Uint8Array
  /** Soft mask (8-bit grey, Flate) when the source had alpha. */
  readonly smask?: Uint8Array
  /**
   * Alpha PNGs only: what the logo's visible pixels look like, so the cover can tell a white mark that would vanish on
   * a light field. `mean` is the mean RELATIVE (linear) luminance, 0 black to 1 white, of the pixels that are at least
   * half opaque; `light` is the share of those pixels with relative luminance of 0.5 or more (a white or pale mark); `opaque` is the share of the image those pixels are.
   */
  readonly luma?: { readonly mean: number; readonly light: number; readonly opaque: number }
}

export type ReadImage =
  | { readonly ok: true; readonly image: PdfImage; readonly kind: 'png' | 'jpeg' }
  | { readonly ok: false; readonly reason: string }

/** Refuse rather than inflate a bomb: a logo is a small file. */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024
export const MAX_IMAGE_PIXELS = 4_000_000
export const MAX_IMAGE_SIDE = 4096

const refuse = (reason: string): ReadImage => ({ ok: false, reason })

const u32 = (b: Uint8Array, at: number): number =>
  ((b[at] ?? 0) * 0x1000000 +
    ((b[at + 1] ?? 0) << 16) +
    ((b[at + 2] ?? 0) << 8) +
    (b[at + 3] ?? 0)) >>>
  0

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

const checkSize = (w: number, h: number): string | null => {
  if (w < 1 || h < 1) return 'the image has no size'
  if (w > MAX_IMAGE_SIDE || h > MAX_IMAGE_SIDE)
    return `the image is ${String(w)}x${String(h)}, over the ${String(MAX_IMAGE_SIDE)}px limit`
  if (w * h > MAX_IMAGE_PIXELS)
    return `the image has ${String(w * h)} pixels, over the ${String(MAX_IMAGE_PIXELS)} limit`
  return null
}

/** sRGB byte to linear light, once. */
const LINEAR: number[] = Array.from({ length: 256 }, (_, i) => {
  const c = i / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
})

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

/** Undo PNG row filtering. `raw` is rows of (1 filter byte + stride bytes). Returns null on a bad filter byte. */
function unfilter(raw: Uint8Array, stride: number, bpp: number, height: number): Uint8Array | null {
  const out = new Uint8Array(stride * height)
  for (let y = 0; y < height; y += 1) {
    const f = raw[y * (stride + 1)] ?? 0
    const src = y * (stride + 1) + 1
    const dst = y * stride
    const prev = dst - stride
    for (let x = 0; x < stride; x += 1) {
      const v = raw[src + x] ?? 0
      const a = x >= bpp ? (out[dst + x - bpp] ?? 0) : 0
      const b = y > 0 ? (out[prev + x] ?? 0) : 0
      const c = y > 0 && x >= bpp ? (out[prev + x - bpp] ?? 0) : 0
      let r: number
      switch (f) {
        case 0:
          r = v
          break
        case 1:
          r = v + a
          break
        case 2:
          r = v + b
          break
        case 3:
          r = v + ((a + b) >> 1)
          break
        case 4:
          r = v + paeth(a, b, c)
          break
        default:
          return null
      }
      out[dst + x] = r & 0xff
    }
  }
  return out
}

function readPng(bytes: Uint8Array): ReadImage {
  for (const [i, v] of PNG_SIG.entries()) if (bytes[i] !== v) return refuse('not a PNG file')
  let at = 8
  let width = 0
  let height = 0
  let depth = 0
  let colorType = -1
  let interlace = 0
  let palette: Uint8Array | undefined
  let sawEnd = false
  let sawHeader = false
  const idat: Uint8Array[] = []
  while (at + 8 <= bytes.length) {
    const len = u32(bytes, at)
    const type = String.fromCharCode(
      bytes[at + 4] ?? 0,
      bytes[at + 5] ?? 0,
      bytes[at + 6] ?? 0,
      bytes[at + 7] ?? 0,
    )
    const body = at + 8
    if (body + len + 4 > bytes.length) return refuse('the PNG is truncated')
    if (type === 'IHDR') {
      if (len !== 13) return refuse('the PNG header is malformed')
      width = u32(bytes, body)
      height = u32(bytes, body + 4)
      depth = bytes[body + 8] ?? 0
      colorType = bytes[body + 9] ?? -1
      interlace = bytes[body + 12] ?? 0
      sawHeader = true
    } else if (type === 'PLTE') {
      palette = bytes.slice(body, body + len)
    } else if (type === 'IDAT') {
      idat.push(bytes.slice(body, body + len))
    } else if (type === 'IEND') {
      sawEnd = true
      break
    }
    at = body + len + 4
  }
  if (!sawHeader) return refuse('the PNG has no header')
  if (!sawEnd || idat.length === 0) return refuse('the PNG is truncated')
  if (depth !== 8) return refuse(`a ${String(depth)}-bit PNG cannot be drawn (8-bit only)`)
  if (interlace !== 0) return refuse('an interlaced PNG cannot be drawn')
  const tooBig = checkSize(width, height)
  if (tooBig !== null) return refuse(tooBig)
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[colorType]
  if (channels === undefined) return refuse(`PNG colour type ${String(colorType)} is not supported`)
  if (
    colorType === 3 &&
    (palette === undefined || palette.length === 0 || palette.length % 3 !== 0)
  )
    return refuse('the PNG palette is missing or malformed')

  const total = idat.reduce((n, p) => n + p.length, 0)
  const z = new Uint8Array(total)
  let o = 0
  for (const p of idat) {
    z.set(p, o)
    o += p.length
  }
  const stride = width * channels
  const expected = (stride + 1) * height

  // Opaque: the IDAT stream IS what Flate + PNG predictors reads. It is still inflated once, to prove it is intact and
  // the right size: a corrupt stream passed through would draw as a grey smear or fail in the reader.
  let raw: Uint8Array
  try {
    raw = inflateSync(z, { maxOutputLength: expected + 1 })
  } catch {
    return refuse('the PNG image data is corrupt')
  }
  if (raw.length !== expected) return refuse('the PNG image data is the wrong size')

  if (colorType === 0 || colorType === 2 || colorType === 3) {
    return {
      image: {
        colorSpace: colorType === 0 ? 'DeviceGray' : colorType === 2 ? 'DeviceRGB' : 'Indexed',
        data: z,
        extra: `/DecodeParms << /Predictor 15 /Colors ${String(channels)} /BitsPerComponent 8 /Columns ${String(width)} >>`,
        filter: 'FlateDecode',
        height,
        ...(colorType === 3 && palette !== undefined ? { palette } : {}),
        width,
      },
      kind: 'png',
      ok: true,
    }
  }

  // Alpha: split the planes.
  const px = unfilter(raw, stride, channels, height)
  if (px === null) return refuse('the PNG uses a row filter that does not exist')
  const colourChannels = channels - 1
  const colour = new Uint8Array(width * height * colourChannels)
  const alpha = new Uint8Array(width * height)
  let lumSum = 0
  let seen = 0
  let lightN = 0
  for (let i = 0; i < width * height; i += 1) {
    for (let c = 0; c < colourChannels; c += 1)
      colour[i * colourChannels + c] = px[i * channels + c] ?? 0
    alpha[i] = px[i * channels + colourChannels] ?? 255
    if ((alpha[i] ?? 255) >= 128) {
      const r = px[i * channels] ?? 0
      const g = colourChannels === 3 ? (px[i * channels + 1] ?? 0) : r
      const b = colourChannels === 3 ? (px[i * channels + 2] ?? 0) : r
      const y = 0.2126 * (LINEAR[r] ?? 0) + 0.7152 * (LINEAR[g] ?? 0) + 0.0722 * (LINEAR[b] ?? 0)
      lumSum += y
      if (y >= 0.5) lightN += 1
      seen += 1
    }
  }
  return {
    image: {
      colorSpace: colourChannels === 1 ? 'DeviceGray' : 'DeviceRGB',
      data: new Uint8Array(deflateSync(colour, { level: 9 })),
      extra: '',
      filter: 'FlateDecode',
      height,
      luma: {
        light: seen === 0 ? 0 : lightN / seen,
        mean: seen === 0 ? 0 : lumSum / seen,
        opaque: seen / (width * height),
      },
      smask: new Uint8Array(deflateSync(alpha, { level: 9 })),
      width,
    },
    kind: 'png',
    ok: true,
  }
}

function readJpeg(bytes: Uint8Array): ReadImage {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return refuse('not a JPEG file')
  let at = 2
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return refuse('the JPEG is malformed')
    const marker = bytes[at + 1] ?? 0
    if (marker === 0xff) {
      at += 1
      continue
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2
      continue
    }
    const len = ((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0)
    if (len < 2 || at + 2 + len > bytes.length) return refuse('the JPEG is truncated')
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      // C0 baseline, C1 extended, C2 progressive are drawable; the lossless and arithmetic-coded ones are not.
      if (marker !== 0xc0 && marker !== 0xc1 && marker !== 0xc2)
        return refuse('this kind of JPEG cannot be drawn')
      const precision = bytes[at + 4] ?? 0
      const height = ((bytes[at + 5] ?? 0) << 8) | (bytes[at + 6] ?? 0)
      const width = ((bytes[at + 7] ?? 0) << 8) | (bytes[at + 8] ?? 0)
      const comps = bytes[at + 9] ?? 0
      if (precision !== 8) return refuse('only 8-bit JPEGs can be drawn')
      if (comps !== 1 && comps !== 3)
        return refuse(
          comps === 4
            ? 'a CMYK JPEG cannot be drawn (it would show inverted)'
            : 'this JPEG has an unsupported number of colour channels',
        )
      const tooBig = checkSize(width, height)
      if (tooBig !== null) return refuse(tooBig)
      if (bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9)
        return refuse('the JPEG is truncated (no end marker)')
      return {
        image: {
          colorSpace: comps === 1 ? 'DeviceGray' : 'DeviceRGB',
          data: bytes,
          extra: '',
          filter: 'DCTDecode',
          height,
          width,
        },
        kind: 'jpeg',
        ok: true,
      }
    }
    if (marker === 0xda) break // start of scan before any frame header
    at += 2 + len
  }
  return refuse('the JPEG has no frame header')
}

/** Read an image, or say in a sentence why it cannot be drawn. Never throws. */
export function readImage(bytes: Uint8Array): ReadImage {
  try {
    if (bytes.length === 0) return refuse('the image file is empty')
    if (bytes.length > MAX_IMAGE_BYTES)
      return refuse(
        `the image is ${String(Math.round(bytes.length / 1024))} kB, over the ${String(MAX_IMAGE_BYTES / 1024)} kB limit`,
      )
    if (bytes[0] === 0x89) return readPng(bytes)
    if (bytes[0] === 0xff) return readJpeg(bytes)
    return refuse('only PNG and JPEG images can be drawn')
  } catch (e) {
    return refuse(`the image could not be read (${(e as Error).message})`)
  }
}

/** The largest box a logo may fill, scaled to keep its proportions. */
export function fit(
  image: { readonly width: number; readonly height: number },
  maxW: number,
  maxH: number,
): { readonly w: number; readonly h: number } {
  const s = Math.min(maxW / image.width, maxH / image.height)
  return { h: image.height * s, w: image.width * s }
}
