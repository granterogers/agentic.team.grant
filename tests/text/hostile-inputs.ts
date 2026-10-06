/**
 * Hostile documents for the file reader (B-01), built programmatically so nothing malicious is committed. Every case stays
 * inside the 8 MB upload limit (`document_upload`), because that is the budget an attacker has. A case is a function so the
 * parent process never holds the bytes: the child builds, reads and reports.
 *
 * Each case names the decoder or scan it aims at. `expect` says what a bounded reader must answer: `refused` (null text, a
 * reason naming size or complexity) or `any` (it may read or decline, but it must be fast and small).
 */
import { deflateRawSync, deflateSync } from 'node:zlib'

export const MB = 1024 * 1024
export const UPLOAD_LIMIT = 8 * MB
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export interface Hostile {
  readonly bytes: Uint8Array
  readonly mime: string
  readonly name: string
}

const L = (s: string): Buffer => Buffer.from(s, 'latin1')

/** One PDF object, with an optional stream whose /Length is honest. */
const obj = (num: number, dict: string, stream?: Buffer): Buffer =>
  stream === undefined
    ? L(`${String(num)} 0 obj\n${dict}\nendobj\n`)
    : Buffer.concat([
        L(`${String(num)} 0 obj\n<< ${dict} /Length ${String(stream.length)} >>\nstream\n`),
        stream,
        L('\nendstream\nendobj\n'),
      ])

const wrap = (parts: Buffer[]): Uint8Array =>
  new Uint8Array(
    Buffer.concat([L('%PDF-1.4\n'), ...parts, L('trailer\n<< /Root 1 0 R >>\n%%EOF\n')]),
  )

const CATALOG = (): Buffer => obj(1, '<< /Type /Catalog /Pages 2 0 R >>')
const PAGES = (): Buffer => obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
const PAGE = (): Buffer =>
  obj(3, '<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>')
const FONT = (extra = ''): Buffer =>
  obj(5, `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica ${extra} >>`)

/** The ordinary one-page document: catalog, tree, page, a content stream, a font. */
const onePage = (
  contentDict: string,
  content: Buffer,
  fontExtra = '',
  more: Buffer[] = [],
): Uint8Array =>
  wrap([CATALOG(), PAGES(), PAGE(), obj(4, contentDict, content), FONT(fontExtra), ...more])

const pdfCase = (bytes: Uint8Array): Hostile => ({
  bytes,
  mime: 'application/pdf',
  name: 'hostile.pdf',
})

/** Run-length bytes that expand 64x: 0x81 means "copy the next byte 128 times". */
const rlBomb = (pairs: number): Buffer => {
  const b = Buffer.alloc(pairs * 2 + 1)
  for (let i = 0; i < pairs; i += 1) {
    b[i * 2] = 0x81
    b[i * 2 + 1] = 0x41
  }
  b[pairs * 2] = 128
  return b
}

/** Zeros compress about 1000:1, so a few KB inflate to the per-stream cap. */
const zerosFlate = (bytes: number): Buffer => deflateSync(Buffer.alloc(bytes))

const content = (s: string): Buffer => L(s)

/** A stored zip with deflated entries, enough for a DOCX the reader will open. */
function zip(entries: { name: string; data: Buffer }[]): Uint8Array {
  const chunks: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const body = deflateRawSync(e.data)
    const name = Buffer.from(e.name)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(e.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    chunks.push(local, name, body)
    const c = Buffer.alloc(46)
    c.writeUInt32LE(0x02014b50, 0)
    c.writeUInt16LE(8, 10)
    c.writeUInt32LE(body.length, 20)
    c.writeUInt32LE(e.data.length, 24)
    c.writeUInt16LE(name.length, 28)
    c.writeUInt32LE(offset, 42)
    central.push(c, name)
    offset += 30 + name.length + body.length
  }
  const cd = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  return new Uint8Array(Buffer.concat([...chunks, cd, end]))
}

const text = (s: string, name = 'hostile.html', mime = 'text/html'): Hostile => ({
  bytes: new Uint8Array(Buffer.from(s)),
  mime,
  name,
})

export interface HostileCase {
  readonly aims: string
  readonly build: () => Hostile
}

export const HOSTILE: Record<string, HostileCase> = {
  'runlength-2mb': {
    aims: 'runLength(): a 2 byte run expands 64x into a number[] with no cap (the audit B-01 case)',
    build: () => pdfCase(onePage('/Filter /RunLengthDecode', rlBomb(1_000_000))),
  },
  'runlength-8mb': {
    aims: 'runLength() at the whole upload limit: 512 MB of output',
    build: () => pdfCase(onePage('/Filter /RunLengthDecode', rlBomb(4_000_000))),
  },
  'ascii85-z-8mb': {
    aims: 'ascii85(): one "z" is four zero bytes, into a number[]',
    build: () => pdfCase(onePage('/Filter /ASCII85Decode', Buffer.alloc(7 * MB, 'z'))),
  },
  'asciihex-8mb': {
    aims: 'asciiHex(): number[] with no cap',
    build: () => pdfCase(onePage('/Filter /ASCIIHexDecode', Buffer.alloc(7 * MB, '4'))),
  },
  'flate-unreferenced-streams': {
    aims: 'every stream was decoded and retained up front, wanted or not (images, font programs): now only what is read is decoded',
    build: () => {
      const z = zerosFlate(25 * MB)
      const parts: Buffer[] = []
      for (let i = 0; i < 120; i += 1) parts.push(obj(10 + i, '/Filter /FlateDecode', z))
      return pdfCase(onePage('', content('BT ET'), '', parts))
    },
  },
  'flate-many-content-streams': {
    aims: 'every Flate stream is under the per-stream cap and a page reads all of them: nothing bounded the TOTAL',
    build: () => {
      const z = zerosFlate(25 * MB)
      const refs: string[] = []
      const parts: Buffer[] = []
      for (let i = 0; i < 120; i += 1) {
        refs.push(`${String(10 + i)} 0 R`)
        parts.push(obj(10 + i, '/Filter /FlateDecode', z))
      }
      return pdfCase(
        wrap([
          CATALOG(),
          PAGES(),
          obj(3, `<< /Type /Page /Parent 2 0 R /Contents [${refs.join(' ')}] >>`),
          ...parts,
        ]),
      )
    },
  },
  'objstm-many-streams': {
    aims: 'decoded object streams are retained and re-split: aggregate across ObjStm',
    build: () => {
      const z = zerosFlate(25 * MB)
      const parts: Buffer[] = []
      for (let i = 0; i < 120; i += 1)
        parts.push(obj(10 + i, '/Type /ObjStm /N 1 /First 4 /Filter /FlateDecode', z))
      return pdfCase(onePage('', content('BT ET'), '', parts))
    },
  },
  'objstm-lying-n': {
    aims: 'ObjStm /N is read from the dictionary and used as a loop bound',
    build: () =>
      pdfCase(
        onePage('', content('BT ET'), '', [
          obj(10, '/Type /ObjStm /N 4000000000 /First 6', content('1 0 2 3 x')),
        ]),
      ),
  },
  'objstm-many-objects': {
    aims: 'one object stream naming a million objects: Map growth and per-object slicing',
    build: () => {
      let head = ''
      const n = 700_000
      for (let i = 0; i < n; i += 1) head += `${String(1000 + i)} ${String(i % 7)} `
      const body = Buffer.concat([L(head), Buffer.alloc(100, ' ')])
      return pdfCase(
        onePage('', content('BT ET'), '', [
          obj(
            10,
            `/Type /ObjStm /N ${String(n)} /First ${String(head.length)} /Filter /FlateDecode`,
            deflateSync(body),
          ),
        ]),
      )
    },
  },
  'many-tiny-objects': {
    aims: 'object count: the marker scan keeps one entry per "n 0 obj"',
    build: () => {
      const b = Buffer.alloc(UPLOAD_LIMIT - 1024)
      const unit = L('1 0 obj\n')
      for (let at = 0; at + unit.length <= b.length; at += unit.length) unit.copy(b, at)
      return pdfCase(new Uint8Array(Buffer.concat([L('%PDF-1.4\n'), b])))
    },
  },
  'digit-run': {
    aims: 'the object-marker regex against one 8 MB run of digits (backtracking)',
    build: () =>
      pdfCase(new Uint8Array(Buffer.concat([L('%PDF-1.4\n'), Buffer.alloc(7 * MB, '1'), L(' x')]))),
  },
  'refs-digit-run': {
    aims: 'refsIn() over a Kids array holding a very long digit run (backtracking)',
    build: () =>
      pdfCase(
        wrap([
          CATALOG(),
          obj(2, `<< /Type /Pages /Kids [${'1'.repeat(3 * MB)} x] /Count 1 >>`),
          PAGE(),
          obj(4, '', content('BT ET')),
          FONT(),
        ]),
      ),
  },
  'kids-chain': {
    aims: 'page-tree depth: walk() recurses once per level',
    build: () => {
      const parts: Buffer[] = [CATALOG()]
      const depth = 90_000
      for (let i = 0; i < depth; i += 1)
        parts.push(obj(2 + i, `<< /Type /Pages /Kids [${String(3 + i)} 0 R] >>`))
      return pdfCase(wrap(parts))
    },
  },
  'page-fanout-cmap': {
    aims: 'many pages sharing one font: the ToUnicode map is parsed once per PAGE',
    build: () => {
      let cmap = 'begincmap 1 begincodespacerange <00> <FF> endcodespacerange beginbfchar '
      for (let i = 0; i < 30_000; i += 1)
        cmap += `<${(i % 256).toString(16).padStart(2, '0')}> <0041> `
      cmap += 'endbfchar endcmap'
      const pages = 50_000
      const kids = Array.from({ length: pages }, (_, i) => `${String(20 + i)} 0 R`).join(' ')
      const parts: Buffer[] = [
        CATALOG(),
        obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${String(pages)} >>`),
        obj(4, '', content('BT /F1 12 Tf (Shared text on every page of this document.) Tj ET')),
        obj(5, '<< /Type /Font /Subtype /Type1 /BaseFont /X /ToUnicode 6 0 R >>'),
        obj(6, '', L(cmap)),
      ]
      for (let i = 0; i < pages; i += 1)
        parts.push(
          obj(
            20 + i,
            '<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
          ),
        )
      return pdfCase(wrap(parts))
    },
  },
  'contents-repeat': {
    aims: 'one page listing the same content stream a million times: output grows without bound',
    build: () => {
      const refs = '4 0 R '.repeat(1_000_000)
      return pdfCase(
        wrap([
          CATALOG(),
          PAGES(),
          obj(
            3,
            `<< /Type /Page /Parent 2 0 R /Contents [${refs}] /Resources << /Font << /F1 5 0 R >> >> >>`,
          ),
          obj(
            4,
            '',
            content(
              `BT /F1 12 Tf ${'(A line of ordinary text for the page.) Tj '.repeat(20_000)} ET`,
            ),
          ),
          FONT(),
        ]),
      )
    },
  },
  'cmap-range-bomb': {
    aims: 'parseCMap(): every bfrange can add 65,536 entries',
    build: () => {
      const cmap = `begincmap 1 begincodespacerange <0000> <FFFF> endcodespacerange beginbfrange ${'<0000> <FFFF> <0000> '.repeat(300_000)} endbfrange endcmap`
      return pdfCase(
        onePage('', content('BT /F1 12 Tf <0041> Tj ET'), '/ToUnicode 6 0 R', [
          obj(6, '', L(cmap)),
        ]),
      )
    },
  },
  'cmap-unclosed-blocks': {
    aims: 'parseCMap(): lazy [\\s\\S]*? scans to the end from every "beginbfchar" that has no end',
    build: () => {
      const cmap = `begincmap ${'beginbfchar '.repeat(500_000)}`
      return pdfCase(
        onePage('', content('BT /F1 12 Tf <41> Tj ET'), '/ToUnicode 6 0 R', [obj(6, '', L(cmap))]),
      )
    },
  },
  'cmap-unclosed-array': {
    aims: 'parseCMap(): an unclosed "[" in a bfrange scans to the end from every range',
    build: () => {
      const cmap = `begincmap beginbfrange ${'<00> <01> [ '.repeat(500_000)} endbfrange`
      return pdfCase(
        onePage('', content('BT /F1 12 Tf <41> Tj ET'), '/ToUnicode 6 0 R', [obj(6, '', L(cmap))]),
      )
    },
  },
  'cmap-long-destination': {
    aims: 'one code maps to a 200 KB string and the page shows that code a hundred and fifty thousand times',
    build: () => {
      const cmap = `begincmap 1 begincodespacerange <00> <FF> endcodespacerange 1 beginbfchar <41> <${'0042'.repeat(50_000)}> endbfchar endcmap`
      return pdfCase(
        onePage('', content(`BT /F1 12 Tf [${'<41>'.repeat(150_000)}] TJ ET`), '/ToUnicode 6 0 R', [
          obj(6, '', L(cmap)),
        ]),
      )
    },
  },
  'content-open-hex': {
    aims: 'contentText(): every "<" with no ">" scans to the end of the stream',
    build: () => pdfCase(onePage('', content('<a'.repeat(3 * MB)))),
  },
  'content-digit-token': {
    aims: 'contentText(): the number test backtracks across one huge token',
    build: () => pdfCase(onePage('', content(`${'1'.repeat(1 * MB)}x`))),
  },
  'content-operand-pileup': {
    aims: 'contentText(): operands pushed for ever with no operator',
    build: () => pdfCase(onePage('', content('1 '.repeat(3 * MB)))),
  },
  'html-open-angle': {
    aims: 'htmlToText(): "<" with no ">" under /<[^>]*>/g',
    build: () => text('<'.repeat(7 * MB)),
  },
  'html-unclosed-script': {
    aims: 'htmlToText(): an opener with no closer under the lazy block regex',
    build: () => text('<script '.repeat(800_000)),
  },
  'html-unclosed-comment': {
    aims: 'htmlToText(): "<!--" with no "-->"',
    build: () => text('<!--'.repeat(1_800_000)),
  },
  'html-br-run': {
    aims: 'htmlToText(): "<br" followed by non-">" characters',
    build: () => text('<br'.repeat(2_300_000)),
  },
  'html-spaces': {
    aims: 'htmlToText(): the whitespace clean-up regexes against one long run of spaces',
    build: () => text(' '.repeat(7 * MB)),
  },
  'docx-open-tags': {
    aims: 'wordXmlToText(): "<w:t " with no ">" under a lazy [^>]*?',
    build: () => {
      const xml = Buffer.from('<w:t '.repeat(6_000_000))
      return {
        bytes: zip([{ name: 'word/document.xml', data: xml }]),
        mime: DOCX_MIME,
        name: 'hostile.docx',
      }
    },
  },
  'docx-three-parts': {
    aims: 'DOCX reads three parts, each up to the per-stream cap: no aggregate across parts',
    build: () => {
      const big = Buffer.from(`<w:p><w:t>${'A'.repeat(39 * MB)}</w:t></w:p>`)
      return {
        bytes: zip([
          { name: 'word/document.xml', data: big },
          { name: 'word/footnotes.xml', data: big },
          { name: 'word/endnotes.xml', data: big },
        ]),
        mime: DOCX_MIME,
        name: 'hostile.docx',
      }
    },
  },
}

/** The builders, for tests that need a document of their own with a limit of their own. */
export { CATALOG, FONT, L, obj, onePage, PAGE, PAGES, rlBomb, wrap, zerosFlate, zip }
