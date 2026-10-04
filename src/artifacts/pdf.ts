/**
 * A PDF writer with no dependencies, because the office runs in Deno (#258).
 *
 * Grant asked the team to research a subject and send him a beautifully
 * illustrated PDF through Telegram, and was told the office had no means to do
 * it. The means has to work where jobs actually run — a Supabase edge function
 * — so Chromium's `page.pdf()` is out (it exists only in the authoring
 * session) and every npm PDF library is a bundle risk in a function that
 * already bundles 107 files.
 *
 * So: the file format, written out directly. It is less alarming than it
 * sounds. A PDF is a list of numbered objects, a cross-reference table saying
 * where each one starts, and a trailer pointing at the catalogue. The typography
 * is the hard part and that lives in `metrics.ts`.
 *
 * ## What this module is and is not
 *
 * It is the BYTES. It knows about objects, pages, content streams, fonts,
 * colours, text, rules, rectangles and paths, and nothing at all about
 * headings, paragraphs or reports — `report.ts` is the layer that knows a
 * document has a title page. Keeping them apart is what makes a second format
 * (#258 asks for DOCX and slides later) a second writer rather than a rewrite.
 *
 * ## Deno, so no Buffer
 *
 * CLAUDE.md records this trap three times in three files. Everything here is
 * `Uint8Array` and `TextEncoder`, and the one place it matters is that a PDF's
 * cross-reference table holds BYTE offsets — so the document is assembled as
 * bytes from the start rather than as a string that is encoded at the end,
 * because a single non-ASCII character would shift every offset and produce a
 * file that opens in nothing.
 */

import { type Face, widthOf } from './metrics.ts'

/** A colour, 0–1 per channel, because that is what PDF operators take. */
export interface Rgb {
  readonly r: number
  readonly g: number
  readonly b: number
}

export const rgb = (r: number, g: number, b: number): Rgb => ({ b, g, r })

/** A4 in points, which is what everything here is measured in. */
export const A4 = { height: 841.89, width: 595.28 } as const

const enc = new TextEncoder()

/**
 * A string as PDF text, escaped and encoded.
 *
 * WinAnsiEncoding, which is what the font objects below declare. It covers
 * Latin-1 plus the punctuation a report actually uses — the em dash, the
 * curly quotes, the bullet, the pound sign — at code points PDF chose and
 * Unicode did not, so those five need a map rather than a cast.
 */
const WIN_ANSI: Readonly<Record<number, number>> = {
  338: 0x8c,
  339: 0x9c,
  8211: 0x96, // en dash
  8212: 0x97, // em dash
  8216: 0x91,
  8217: 0x92,
  8220: 0x93,
  8221: 0x94,
  8226: 0x95,
  8230: 0x85, // ellipsis
  8249: 0x8b,
  8250: 0x9b,
  8482: 0x99,
}

/**
 * Characters with no WinAnsi slot that have an obvious stand-in.
 *
 * This list exists because the first real report the office wrote came back
 * saying "high?performing", "AI?driven" and "client?focused". The model had
 * used U+2011, the non-breaking hyphen, which has no WinAnsi slot — so every
 * one became a question mark in a document Grant would have received. A hyphen
 * is not the character the model chose and is indistinguishable from it on the
 * page, which a question mark is not.
 *
 * The fallback for anything still unmapped stays a question mark rather than
 * nothing: a dropped character is a sentence that reads correctly and is
 * wrong, and a visible one is a defect somebody reports.
 */
const STANDS_IN: Readonly<Record<number, number>> = {
  160: 0x20, // no-break space
  173: 0x2d, // soft hyphen
  8203: 0x20, // zero-width space
  8206: 0x20,
  8207: 0x20,
  8208: 0x2d, // hyphen
  8209: 0x2d, // non-breaking hyphen
  8210: 0x2d, // figure dash
  8213: 0x2d, // horizontal bar
  8242: 0x27, // prime
  8243: 0x22, // double prime
  8722: 0x2d, // minus sign
  65279: 0x20, // byte order mark
}

const pdfString = (text: string): Uint8Array => {
  const out: number[] = [0x28] // (
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 32
    const byte = WIN_ANSI[cp] ?? STANDS_IN[cp] ?? (cp <= 0xff ? cp : 0x3f)
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) out.push(0x5c)
    out.push(byte)
  }
  out.push(0x29) // )
  return Uint8Array.from(out)
}

const join = (parts: readonly Uint8Array[]): Uint8Array => {
  const size = parts.reduce((n, p) => n + p.length, 0)
  const all = new Uint8Array(size)
  let at = 0
  for (const p of parts) {
    all.set(p, at)
    at += p.length
  }
  return all
}

const n = (v: number): string => {
  // Three decimals is a tenth of a micron on A4 and keeps the file small. A
  // raw JS float would write 0.30000000000000004 into the content stream.
  const r = Math.round(v * 1000) / 1000
  return Object.is(r, -0) ? '0' : String(r)
}

/**
 * One page being drawn on.
 *
 * Every method appends operators to a content stream. Nothing is measured
 * here and nothing wraps — `report.ts` decides where things go, because layout
 * needs to know about widows, page breaks and section headings and a drawing
 * surface should not.
 */
/** Where a piece of text was put, for the layout QA (`qa.ts`). `y` is the baseline from the bottom. */
export interface TextBox {
  readonly text: string
  readonly x: number
  readonly y: number
  readonly size: number
  readonly width: number
}

export class Page {
  private readonly ops: string[] = []
  private readonly placed: TextBox[] = []

  constructor(
    readonly width: number,
    readonly height: number,
  ) {}

  /** Text at a baseline, in a face and size. `x`/`y` are from the bottom left. */
  text(value: string, x: number, y: number, face: Face, size: number, colour: Rgb): this {
    if (value === '') return this
    this.placed.push({ size, text: value, width: widthOf(value, face, size), x, y })
    this.ops.push(
      'BT',
      `${n(colour.r)} ${n(colour.g)} ${n(colour.b)} rg`,
      `/${FONT_KEY[face]} ${n(size)} Tf`,
      `1 0 0 1 ${n(x)} ${n(y)} Tm`,
      '', // the string is spliced in as bytes below
      'ET',
    )
    this.raw.push({ at: this.ops.length - 2, value })
    return this
  }

  /** A filled rectangle — rules, table stripes, the cover's colour field. */
  rect(x: number, y: number, w: number, h: number, colour: Rgb): this {
    this.ops.push(
      `${n(colour.r)} ${n(colour.g)} ${n(colour.b)} rg`,
      `${n(x)} ${n(y)} ${n(w)} ${n(h)} re`,
      'f',
    )
    return this
  }

  /** A straight line, for a rule under a heading or a table's grid. */
  line(x1: number, y1: number, x2: number, y2: number, thickness: number, colour: Rgb): this {
    this.ops.push(
      `${n(colour.r)} ${n(colour.g)} ${n(colour.b)} RG`,
      `${n(thickness)} w`,
      `${n(x1)} ${n(y1)} m`,
      `${n(x2)} ${n(y2)} l`,
      'S',
    )
    return this
  }

  /**
   * A closed filled polygon, which is how a chart is drawn.
   *
   * #258 asks for charts and diagrams where they materially improve the
   * result. A bar is a rectangle and a line chart is a polyline, so a general
   * path plus `rect` and `line` covers everything this office needs without a
   * charting library — and a vector chart in a PDF stays sharp at any zoom,
   * which a rasterised one does not.
   */
  polygon(points: readonly (readonly [number, number])[], colour: Rgb): this {
    if (points.length < 3) return this
    const [first, ...rest] = points
    if (first === undefined) return this
    this.ops.push(
      `${n(colour.r)} ${n(colour.g)} ${n(colour.b)} rg`,
      `${n(first[0])} ${n(first[1])} m`,
      ...rest.map(([x, y]) => `${n(x)} ${n(y)} l`),
      'h',
      'f',
    )
    return this
  }

  private readonly raw: { at: number; value: string }[] = []

  /**
   * Every string this page will draw, in the order it draws them.
   *
   * For assertions about WORDS rather than bytes. A test that wanted to know
   * whether the cover repeats the opening paragraph would otherwise have to
   * decode the content stream — which means re-implementing the encoder in the
   * test, and a test that re-implements the thing under test agrees with it by
   * construction.
   *
   * Reading only: it returns a copy and the page keeps its own.
   */
  said(): string {
    return this.raw.map((r) => r.value).join('\n')
  }

  /** Every text object drawn, with its box, so a layout check can compare them without decoding the stream. */
  boxes(): readonly TextBox[] {
    return this.placed
  }

  /** The finished content stream, as bytes. */
  stream(): Uint8Array {
    const parts: Uint8Array[] = []
    for (const [i, op] of this.ops.entries()) {
      const swap = this.raw.find((r) => r.at === i)
      if (swap !== undefined) {
        parts.push(pdfString(swap.value), enc.encode(' Tj\n'))
        continue
      }
      parts.push(enc.encode(`${op}\n`))
    }
    return join(parts)
  }
}

/** The resource name each face is given inside the file. */
const FONT_KEY: Readonly<Record<Face, string>> = {
  Helvetica: 'F1',
  'Helvetica-Bold': 'F2',
  'Helvetica-Oblique': 'F3',
  'Times-Bold': 'F5',
  'Times-Italic': 'F6',
  'Times-Roman': 'F4',
}

/** What goes in the file's own metadata, which #258 asks for by name. */
export interface DocumentInfo {
  readonly title: string
  readonly author: string
  readonly subject: string
  /** Who made it, in the sense a PDF reader means: the software. */
  readonly producer: string
  readonly created: Date
}

/**
 * Assemble the pages into a file.
 *
 * Objects are numbered from 1 and the cross-reference table records each
 * one's byte offset, so the parts are built in order and measured as they go.
 * There is no compression: a report of a few dozen pages is tens of kilobytes
 * either way, and an uncompressed content stream is one a person can read
 * with `strings`, which is worth more here than the bytes are.
 */
export function assemble(pages: readonly Page[], info: DocumentInfo): Uint8Array {
  if (pages.length === 0) throw new Error('a PDF with no pages is not a PDF')

  const objects: Uint8Array[] = []
  const add = (body: string | Uint8Array): number => {
    objects.push(typeof body === 'string' ? enc.encode(body) : body)
    return objects.length // 1-based, which is what the file wants
  }

  // 1 catalogue, 2 pages tree — reserved first so children can point at them.
  add('') // 1
  add('') // 2
  const fontIds: Record<string, number> = {}
  for (const [face, key] of Object.entries(FONT_KEY)) {
    fontIds[key] = add(
      `<< /Type /Font /Subtype /Type1 /BaseFont /${face} /Encoding /WinAnsiEncoding >>`,
    )
  }
  const resources = `<< /Font << ${Object.entries(fontIds)
    .map(([k, id]) => `/${k} ${String(id)} 0 R`)
    .join(' ')} >> >>`

  const pageIds: number[] = []
  for (const page of pages) {
    const body = page.stream()
    const contentId = add(
      join([
        enc.encode(`<< /Length ${String(body.length)} >>\nstream\n`),
        body,
        enc.encode('\nendstream'),
      ]),
    )
    pageIds.push(
      add(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(page.width)} ${n(page.height)}] ` +
          `/Resources ${resources} /Contents ${String(contentId)} 0 R >>`,
      ),
    )
  }

  const iso = (d: Date): string => {
    const p = (v: number): string => String(v).padStart(2, '0')
    return (
      `D:${String(d.getUTCFullYear())}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
      `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
    )
  }
  /*
    Metadata is UTF-16, and the page content is not.

    A PDF string is PDFDocEncoding unless it opens with the UTF-16 big-endian
    byte order mark, while a string inside a content stream is in the FONT's
    encoding, which these fonts declare as WinAnsi. Writing the title in
    WinAnsi put an en dash at 0x96, which is a control character in the
    encoding a reader applies to metadata: Chromium showed the tab as
    "Legacy Coaching Course OE Current Status Report" while the same dash on
    the page was perfect. Two encodings in one file is not a mistake — it is
    what the format says — and using one for both is.
  */
  const utf16 = (text: string): Uint8Array => {
    const out: number[] = [0x28, 0xfe, 0xff]
    for (const ch of text) {
      const cp = ch.codePointAt(0) ?? 32
      const units =
        cp > 0xffff ? [0xd800 + ((cp - 0x10000) >> 10), 0xdc00 + ((cp - 0x10000) & 0x3ff)] : [cp]
      for (const u of units) {
        for (const b of [u >> 8, u & 0xff]) {
          if (b === 0x28 || b === 0x29 || b === 0x5c) out.push(0x5c)
          out.push(b)
        }
      }
    }
    out.push(0x29)
    return Uint8Array.from(out)
  }
  const infoParts = join([
    enc.encode('<< /Title '),
    utf16(info.title),
    enc.encode(' /Author '),
    utf16(info.author),
    enc.encode(' /Subject '),
    utf16(info.subject),
    enc.encode(' /Producer '),
    utf16(info.producer),
    enc.encode(' /Creator '),
    utf16(info.producer),
    enc.encode(` /CreationDate (${iso(info.created)}) /ModDate (${iso(info.created)}) >>`),
  ])
  const infoId = add(infoParts)

  objects[0] = enc.encode('<< /Type /Catalog /Pages 2 0 R >>')
  objects[1] = enc.encode(
    `<< /Type /Pages /Count ${String(pageIds.length)} /Kids [${pageIds
      .map((id) => `${String(id)} 0 R`)
      .join(' ')}] >>`,
  )

  const head = enc.encode('%PDF-1.7\n%âãÏÓ\n')
  const parts: Uint8Array[] = [head]
  let at = head.length
  const offsets: number[] = []
  for (const [i, body] of objects.entries()) {
    offsets.push(at)
    const open = enc.encode(`${String(i + 1)} 0 obj\n`)
    const close = enc.encode('\nendobj\n')
    parts.push(open, body, close)
    at += open.length + body.length + close.length
  }

  const xrefAt = at
  const rows = [
    '0000000000 65535 f \n',
    ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`),
  ]
  parts.push(
    enc.encode(
      `xref\n0 ${String(objects.length + 1)}\n${rows.join('')}` +
        `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R /Info ${String(infoId)} 0 R >>\n` +
        `startxref\n${String(xrefAt)}\n%%EOF\n`,
    ),
  )
  return join(parts)
}

export type { Face }
/** Re-exported so a caller measuring for layout does not import two modules. */
export { widthOf }
