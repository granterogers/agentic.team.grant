/**
 * The text inside a file a person drops in (#419): plain text, Markdown, HTML, DOCX and PDF.
 *
 * Pure and dependency-free on purpose. It runs in the gateway (Deno) at the one moment the bytes are in hand, and in the
 * worker (Node) for files fetched from a connector, using only web-standard APIs (`DecompressionStream`, `TextDecoder`).
 *
 * HONEST ABOUT WHAT IT CANNOT READ. A scanned PDF is a picture of text, not text, and no amount of parsing makes it
 * searchable without an OCR engine this function does not have. The result then carries `text: null` and a reason a person
 * can read, never an empty string (0207: null means "not read", and empty would claim "read, and there was nothing").
 * A PDF whose fonts have no way back to Unicode extracts as noise, so the result is checked for being language before it
 * is accepted: noise is refused rather than indexed, because an index of noise answers questions with confident nonsense.
 */

export type FileText =
  | { readonly text: string; readonly kind: 'text' | 'html' | 'docx' | 'pdf' }
  | { readonly text: null; readonly why: string }

/** Decompressed output is bounded: a small file that inflates to gigabytes is an attack, not a document. */
const MAX_INFLATED = 40 * 1024 * 1024

export async function fileText(bytes: Uint8Array, mime: string, name: string): Promise<FileText> {
  const ext = (name.split('.').pop() ?? '').toLowerCase()
  try {
    if (mime === 'application/pdf' || ext === 'pdf' || startsWith(bytes, '%PDF-')) {
      return await pdfText(bytes)
    }
    if (
      mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      ext === 'docx'
    ) {
      return await docxText(bytes)
    }
    if (
      mime === 'text/html' ||
      mime === 'application/xhtml+xml' ||
      ['html', 'htm', 'xhtml'].includes(ext)
    ) {
      return accept(htmlToText(decodeUtf8(bytes)), 'html')
    }
    if (
      mime.startsWith('text/') ||
      mime === 'application/json' ||
      ['txt', 'md', 'markdown', 'csv', 'tsv', 'json'].includes(ext)
    ) {
      return accept(decodeUtf8(bytes), 'text')
    }
  } catch (error) {
    return {
      text: null,
      why: `this file could not be read (${String((error as Error).message).slice(0, 120)})`,
    }
  }
  return {
    text: null,
    why: 'this kind of file is stored and can be opened, but its text is not searchable',
  }
}

const startsWith = (bytes: Uint8Array, s: string): boolean => {
  for (let i = 0; i < s.length; i += 1) if (bytes[i] !== s.charCodeAt(i)) return false
  return true
}

const decodeUtf8 = (bytes: Uint8Array): string =>
  // A NUL cannot be stored in a text value, so it is dropped here rather than refused later.
  new TextDecoder('utf-8', { fatal: false }).decode(bytes).split(String.fromCharCode(0)).join('')

const accept = (text: string, kind: 'text' | 'html' | 'docx' | 'pdf'): FileText => {
  if (text.trim() === '') return { text: null, why: 'there was no text in it' }
  return { text, kind }
}

// ---------------------------------------------------------------------------------------------------------------- HTML

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  pound: '£',
  euro: '€',
  copy: '©',
}

export const decodeEntities = (s: string): string =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const n = Number.parseInt(body.slice(2), 16)
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole
    }
    if (body.startsWith('#')) {
      const n = Number.parseInt(body.slice(1), 10)
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole
    }
    return ENTITIES[body.toLowerCase()] ?? whole
  })

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1\s*>/gi, ' ')
      .replace(
        /<\/(p|div|section|article|header|footer|li|tr|h[1-6]|blockquote|pre|table|ul|ol)\s*>/gi,
        '\n\n',
      )
      .replace(/<(br|hr)\b[^>]*>/gi, '\n')
      .replace(/<\/(td|th)\s*>/gi, '\t')
      .replace(/<[^>]*>/g, ''),
  )
    .replace(/[  ]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ----------------------------------------------------------------------------------------------------------------- ZIP

async function inflate(data: Uint8Array, format: 'deflate' | 'deflate-raw'): Promise<Uint8Array> {
  const stream = new Blob([data.slice()]).stream().pipeThrough(new DecompressionStream(format))
  const reader = stream.getReader()
  const parts: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > MAX_INFLATED) {
      await reader.cancel()
      throw new Error('it expands to more than a document should')
    }
    parts.push(value)
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

const u16 = (b: Uint8Array, at: number): number => (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8)
const u32 = (b: Uint8Array, at: number): number =>
  ((b[at] ?? 0) | ((b[at + 1] ?? 0) << 8) | ((b[at + 2] ?? 0) << 16) | ((b[at + 3] ?? 0) << 24)) >>>
  0

interface ZipEntry {
  readonly name: string
  readonly method: number
  readonly compressedSize: number
  readonly offset: number
}

function zipEntries(b: Uint8Array): ZipEntry[] {
  let end = -1
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i -= 1) {
    if (u32(b, i) === 0x06054b50) {
      end = i
      break
    }
  }
  if (end < 0) throw new Error('not a zip container')
  const count = u16(b, end + 10)
  let at = u32(b, end + 16)
  const out: ZipEntry[] = []
  for (let n = 0; n < count && u32(b, at) === 0x02014b50; n += 1) {
    const nameLen = u16(b, at + 28)
    const extraLen = u16(b, at + 30)
    const commentLen = u16(b, at + 32)
    out.push({
      name: new TextDecoder().decode(b.subarray(at + 46, at + 46 + nameLen)),
      method: u16(b, at + 10),
      compressedSize: u32(b, at + 20),
      offset: u32(b, at + 42),
    })
    at += 46 + nameLen + extraLen + commentLen
  }
  return out
}

async function zipRead(b: Uint8Array, e: ZipEntry): Promise<Uint8Array> {
  if (u32(b, e.offset) !== 0x04034b50) throw new Error('damaged zip entry')
  const start = e.offset + 30 + u16(b, e.offset + 26) + u16(b, e.offset + 28)
  const data = b.subarray(start, start + e.compressedSize)
  if (e.method === 0) return data
  if (e.method === 8) return await inflate(data, 'deflate-raw')
  throw new Error('unsupported compression')
}

// ---------------------------------------------------------------------------------------------------------------- DOCX

async function docxText(bytes: Uint8Array): Promise<FileText> {
  const entries = zipEntries(bytes)
  const main = entries.find((e) => e.name === 'word/document.xml')
  if (main === undefined)
    return { text: null, why: 'this is not a Word document (no document body in it)' }
  const parts = [main, ...entries.filter((e) => /^word\/(footnotes|endnotes)\.xml$/.test(e.name))]
  const chunks: string[] = []
  for (const e of parts) {
    const xml = new TextDecoder('utf-8').decode(await zipRead(bytes, e))
    chunks.push(wordXmlToText(xml))
  }
  return accept(
    chunks
      .join('\n\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
    'docx',
  )
}

function wordXmlToText(xml: string): string {
  let out = ''
  const token = /<w:(t|tab|br|cr|p|tc|tr)\b[^>]*?(\/?)>([^<]*)|<\/w:(p|tc|tr)>/g
  for (const m of xml.matchAll(token)) {
    const tag = m[1]
    if (m[4] !== undefined) {
      out += m[4] === 'p' ? '\n' : m[4] === 'tc' ? '\t' : '\n'
    } else if (tag === 't') {
      out += decodeEntities(m[3] ?? '')
    } else if (tag === 'tab') {
      out += '\t'
    } else if (tag === 'br' || tag === 'cr') {
      out += '\n'
    } else if (tag === 'p' && m[2] !== '/' && (m[3] ?? '') !== '') {
      // text can directly follow an opening paragraph tag only in malformed files; keep it
      out += decodeEntities(m[3] ?? '')
    }
  }
  return out.replace(/[ \t]+\n/g, '\n')
}

// ------------------------------------------------------------------------------------------------------------------ PDF

interface PdfObject {
  dict: string
  stream: Uint8Array | null
}

const latin1 = (b: Uint8Array): string => {
  let s = ''
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192))
  return s
}

const bytesOf = (s: string): Uint8Array => {
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i) & 0xff
  return out
}

/** Only the filters that carry text and that this reader can undo; a picture filter means there is nothing to read here. */
async function decodeStream(dict: string, raw: Uint8Array): Promise<Uint8Array | null> {
  const filters = [
    ...dict.matchAll(
      /\/(FlateDecode|Fl|ASCIIHexDecode|ASCII85Decode|LZWDecode|DCTDecode|CCITTFaxDecode|JBIG2Decode|JPXDecode|RunLengthDecode)\b/g,
    ),
  ].map((m) => m[1])
  // Applied in the order the dictionary lists them: ReportLab writes [ /ASCII85Decode /FlateDecode ], which is the commonest
  // chain on the web and was read as "no text" (a scan) until a real file said otherwise.
  let data = raw
  for (const f of filters) {
    try {
      if (f === 'FlateDecode' || f === 'Fl') data = await inflate(data, 'deflate')
      else if (f === 'ASCII85Decode') data = ascii85(data)
      else if (f === 'ASCIIHexDecode') data = asciiHex(data)
      else if (f === 'RunLengthDecode') data = runLength(data)
      else return null // a picture or an LZW stream: nothing here this reader can undo
    } catch {
      return null
    }
  }
  return data
}

function ascii85(data: Uint8Array): Uint8Array {
  const out: number[] = []
  const group: number[] = []
  const flush = (n: number): void => {
    // a short final group of n characters is padded with 'u' and yields n - 1 bytes
    while (group.length < 5) group.push(84)
    let v = 0
    for (const g of group) v = v * 85 + g
    const bytes = [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]
    out.push(...bytes.slice(0, n - 1))
    group.length = 0
  }
  for (let i = 0; i < data.length; i += 1) {
    const c = data[i] as number
    if (c === 0x7e) break // the end marker '~>'
    if (c <= 32) continue
    if (c === 0x7a && group.length === 0) {
      out.push(0, 0, 0, 0)
      continue
    }
    if (c < 33 || c > 117) throw new Error('not ASCII85')
    group.push(c - 33)
    if (group.length === 5) flush(5)
  }
  if (group.length > 1) flush(group.length)
  return Uint8Array.from(out)
}

function asciiHex(data: Uint8Array): Uint8Array {
  const out: number[] = []
  let hi = -1
  for (const c of data) {
    if (c === 0x3e) break
    const v =
      c >= 48 && c <= 57 ? c - 48 : c >= 65 && c <= 70 ? c - 55 : c >= 97 && c <= 102 ? c - 87 : -1
    if (v < 0) continue
    if (hi < 0) hi = v
    else {
      out.push(hi * 16 + v)
      hi = -1
    }
  }
  if (hi >= 0) out.push(hi * 16)
  return Uint8Array.from(out)
}

function runLength(data: Uint8Array): Uint8Array {
  const out: number[] = []
  for (let i = 0; i < data.length; ) {
    const n = data[i] as number
    if (n === 128) break
    if (n < 128) {
      for (let k = 1; k <= n + 1 && i + k < data.length; k += 1) out.push(data[i + k] as number)
      i += n + 2
    } else {
      const b = data[i + 1] as number
      for (let k = 0; k < 257 - n; k += 1) out.push(b)
      i += 2
    }
  }
  return Uint8Array.from(out)
}

async function pdfObjects(bytes: Uint8Array): Promise<Map<number, PdfObject>> {
  const src = latin1(bytes)
  const objects = new Map<number, PdfObject>()
  const re = /(\d+)\s+(\d+)\s+obj\b/g
  const marks: { num: number; at: number; bodyAt: number }[] = []
  for (let m = re.exec(src); m !== null; m = re.exec(src)) {
    marks.push({ num: Number(m[1]), at: m.index, bodyAt: m.index + m[0].length })
  }
  for (const [i, mark] of marks.entries()) {
    const limit = marks[i + 1]?.at ?? src.length
    const body = src.slice(mark.bodyAt, limit)
    const s = body.search(/\bstream\r?\n|\bstream\r(?!\n)/)
    if (s < 0) {
      objects.set(mark.num, { dict: body.replace(/\bendobj[\s\S]*$/, ''), stream: null })
      continue
    }
    const dict = body.slice(0, s)
    const after = body.indexOf('stream', s) + 6
    let dataStart = after
    if (body[dataStart] === '\r' && body[dataStart + 1] === '\n') dataStart += 2
    else if (body[dataStart] === '\n' || body[dataStart] === '\r') dataStart += 1
    let endAt = body.lastIndexOf('endstream')
    if (endAt < 0) endAt = body.length
    // The end-of-line before the keyword is not part of the data, and a strict inflate refuses trailing bytes.
    if (body[endAt - 1] === '\n') endAt -= 1
    if (body[endAt - 1] === '\r') endAt -= 1
    const rawStream = bytesOf(body.slice(dataStart, Math.max(dataStart, endAt)))
    const decoded = await decodeStream(dict, rawStream)
    objects.set(mark.num, { dict, stream: decoded })
    if (/\/Type\s*\/ObjStm\b/.test(dict) && decoded !== null) {
      const text = latin1(decoded)
      const n = Number(/\/N\s+(\d+)/.exec(dict)?.[1] ?? 0)
      const first = Number(/\/First\s+(\d+)/.exec(dict)?.[1] ?? 0)
      const head = text.slice(0, first).trim().split(/\s+/).map(Number)
      for (let k = 0; k < n; k += 1) {
        const num = head[k * 2]
        const off = head[k * 2 + 1]
        if (num === undefined || off === undefined || Number.isNaN(num) || Number.isNaN(off))
          continue
        const nextOff = head[(k + 1) * 2 + 1] ?? text.length - first
        objects.set(num, { dict: text.slice(first + off, first + nextOff), stream: null })
      }
    }
  }
  return objects
}

const refsIn = (s: string): number[] =>
  [...s.matchAll(/(\d+)\s+\d+\s+R\b/g)].map((m) => Number(m[1]))

/** A font's way back to text: a Unicode map for each code, and how many bytes a code is. */
interface FontMap {
  readonly width: 1 | 2
  readonly map: Map<number, string> | null
}

function parseCMap(cmap: string): FontMap {
  const map = new Map<number, string>()
  let width: 1 | 2 = 1
  const cs = /begincodespacerange([\s\S]*?)endcodespacerange/.exec(cmap)?.[1] ?? ''
  const first = /<([0-9a-fA-F]+)>/.exec(cs)?.[1]
  if (first !== undefined && first.length >= 4) width = 2
  const hexToStr = (h: string): string => {
    let s = ''
    for (let i = 0; i + 4 <= h.length; i += 4)
      s += String.fromCharCode(Number.parseInt(h.slice(i, i + 4), 16))
    if (h.length === 2) s = String.fromCharCode(Number.parseInt(h, 16))
    return s
  }
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of (block[1] ?? '').matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      map.set(Number.parseInt(m[1] ?? '0', 16), hexToStr(m[2] ?? ''))
    }
  }
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const body = block[1] ?? ''
    for (const m of body.matchAll(
      /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]+>|\[[^\]]*\])/g,
    )) {
      const lo = Number.parseInt(m[1] ?? '0', 16)
      const hi = Number.parseInt(m[2] ?? '0', 16)
      const dest = m[3] ?? ''
      if (dest.startsWith('[')) {
        const items = [...dest.matchAll(/<([0-9a-fA-F]+)>/g)].map((x) => x[1] ?? '')
        for (let c = lo; c <= hi && c - lo < items.length; c += 1)
          map.set(c, hexToStr(items[c - lo] ?? ''))
      } else {
        const base = Number.parseInt(dest.slice(1, -1).slice(-4), 16)
        const prefix = hexToStr(dest.slice(1, -1).slice(0, -4))
        for (let c = lo; c <= hi && c - lo < 65536; c += 1)
          map.set(c, prefix + String.fromCharCode(base + (c - lo)))
      }
    }
  }
  return { width, map }
}

const WIN_ANSI_HIGH: Record<number, string> = {
  0x80: '€',
  0x82: '‚',
  0x83: 'ƒ',
  0x84: '„',
  0x85: '…',
  0x86: '†',
  0x87: '‡',
  0x88: 'ˆ',
  0x89: '‰',
  0x8a: 'Š',
  0x8b: '‹',
  0x8c: 'Œ',
  0x8e: 'Ž',
  0x91: '‘',
  0x92: '’',
  0x93: '“',
  0x94: '”',
  0x95: '•',
  0x96: '–',
  0x97: '—',
  0x98: '˜',
  0x99: '™',
  0x9a: 'š',
  0x9b: '›',
  0x9c: 'œ',
  0x9e: 'ž',
  0x9f: 'Ÿ',
}

const decodeWithFont = (codes: number[], font: FontMap | undefined): string => {
  let out = ''
  if (font?.map !== null && font?.map !== undefined) {
    for (const c of codes) out += font.map.get(c) ?? ''
    return out
  }
  if (font?.width === 2) return '' // two-byte codes with no Unicode map: nothing honest to say
  for (const c of codes)
    out +=
      c >= 0x80 && c < 0xa0
        ? (WIN_ANSI_HIGH[c] ?? '')
        : c >= 0x20 || c === 10
          ? String.fromCharCode(c)
          : ''
  return out
}

/** Reads the text-showing operators of one content stream, in order, with line breaks where the text moves down. */
function contentText(content: string, fonts: Map<string, FontMap>): string {
  let out = ''
  let font: FontMap | undefined
  const stack: unknown[] = []
  const n = content.length
  let i = 0
  const show = (codes: number[]): void => {
    out += decodeWithFont(codes, font)
  }
  const toCodes = (str: string, hex: boolean): number[] => {
    const codes: number[] = []
    if (hex) {
      const h = str.replace(/\s+/g, '')
      const w = font?.width === 2 ? 4 : 2
      for (let k = 0; k < h.length; k += w)
        codes.push(Number.parseInt((h.slice(k, k + w) + '0'.repeat(w)).slice(0, w), 16))
    } else if (font?.width === 2) {
      for (let k = 0; k + 1 < str.length; k += 2)
        codes.push((str.charCodeAt(k) << 8) | str.charCodeAt(k + 1))
    } else for (let k = 0; k < str.length; k += 1) codes.push(str.charCodeAt(k))
    return codes
  }
  while (i < n) {
    const ch = content[i] as string
    if (ch === '%') {
      while (i < n && content[i] !== '\n' && content[i] !== '\r') i += 1
    } else if (ch === '(') {
      let depth = 1
      let s = ''
      i += 1
      while (i < n && depth > 0) {
        const c = content[i] as string
        if (c === '\\') {
          const nx = content[i + 1] ?? ''
          if (/[0-7]/.test(nx)) {
            const oct = /^[0-7]{1,3}/.exec(content.slice(i + 1, i + 4))?.[0] ?? '0'
            s += String.fromCharCode(Number.parseInt(oct, 8) & 0xff)
            i += 1 + oct.length
            continue
          }
          const map: Record<string, string> = {
            n: '\n',
            r: '\r',
            t: '\t',
            b: '\b',
            f: '\f',
            '(': '(',
            ')': ')',
            '\\': '\\',
          }
          if (nx === '\r' || nx === '\n') i += nx === '\r' && content[i + 2] === '\n' ? 3 : 2
          else {
            s += map[nx] ?? nx
            i += 2
          }
          continue
        }
        if (c === '(') depth += 1
        else if (c === ')') {
          depth -= 1
          if (depth === 0) break
        }
        s += c
        i += 1
      }
      i += 1
      stack.push({ str: s, hex: false })
    } else if (ch === '<' && content[i + 1] !== '<') {
      const end = content.indexOf('>', i)
      stack.push({ str: content.slice(i + 1, end < 0 ? n : end), hex: true })
      i = end < 0 ? n : end + 1
    } else if (ch === '[') {
      stack.push('[')
      i += 1
    } else if (ch === ']') {
      const items: unknown[] = []
      while (stack.length > 0) {
        const top = stack.pop()
        if (top === '[') break
        items.unshift(top)
      }
      stack.push({ arr: items })
      i += 1
    } else if (/[\s]/.test(ch)) {
      i += 1
    } else {
      let j = i
      while (j < n && !/[\s()<>[\]/%]/.test(content[j] as string)) j += 1
      if (ch === '/') {
        j = i + 1
        while (j < n && !/[\s()<>[\]/%]/.test(content[j] as string)) j += 1
        stack.push({ name: content.slice(i + 1, j) })
        i = j
        continue
      }
      if (j === i) {
        i += 1
        continue
      }
      const tok = content.slice(i, j)
      i = j
      if (/^[+-]?\d*\.?\d+$/.test(tok)) {
        stack.push(Number(tok))
        continue
      }
      switch (tok) {
        case 'Tf': {
          const name = stack[stack.length - 2] as { name?: string } | undefined
          font = fonts.get(name?.name ?? '')
          break
        }
        case 'Tj':
        case "'":
        case '"': {
          if (tok !== 'Tj') out += '\n'
          const top = stack[stack.length - 1] as { str?: string; hex?: boolean } | undefined
          if (top?.str !== undefined) show(toCodes(top.str, top.hex === true))
          break
        }
        case 'TJ': {
          const top = stack[stack.length - 1] as { arr?: unknown[] } | undefined
          for (const item of top?.arr ?? []) {
            if (typeof item === 'number') {
              if (item < -250) out += ' '
            } else {
              const s = item as { str?: string; hex?: boolean }
              if (s.str !== undefined) show(toCodes(s.str, s.hex === true))
            }
          }
          break
        }
        case 'Td':
        case 'TD': {
          const dy = stack[stack.length - 1]
          if (typeof dy === 'number' && Math.abs(dy) > 0.01) out += '\n'
          else out += ' '
          break
        }
        case 'T*':
        case 'ET':
          out += '\n'
          break
        case 'Tm':
          out += '\n'
          break
        default:
      }
      stack.length = 0
    }
  }
  return out
}

/** Does this read as language, or as the debris of a font nothing could decode? */
function readsAsLanguage(text: string): boolean {
  const sample = text.replace(/\s+/g, ' ').trim()
  if (sample.length < 20) return false
  let good = 0
  for (const c of sample) if (/[\p{L}\p{N} .,;:'"!?()\-–—‘’“”£$%&/@]/u.test(c)) good += 1
  const words = sample.split(' ').filter((w) => /\p{L}{2,}/u.test(w)).length
  return good / sample.length > 0.85 && words >= 4
}

async function pdfText(bytes: Uint8Array): Promise<FileText> {
  if (/\/Encrypt\b/.test(latin1(bytes.subarray(Math.max(0, bytes.length - 2048))))) {
    return { text: null, why: 'this PDF is password-protected, so its text cannot be read' }
  }
  const objects = await pdfObjects(bytes)
  if (objects.size === 0) return { text: null, why: 'this does not look like a readable PDF' }

  const fontOf = (ref: number): FontMap | null => {
    const f = objects.get(ref)
    if (f === undefined) return null
    const tu = /\/ToUnicode\s+(\d+)\s+\d+\s+R/.exec(f.dict)?.[1]
    if (tu !== undefined) {
      const cm = objects.get(Number(tu))?.stream
      if (cm !== null && cm !== undefined) return parseCMap(latin1(cm))
    }
    const type0 = /\/Subtype\s*\/Type0/.test(f.dict)
    return { width: type0 ? 2 : 1, map: null }
  }

  // Pages in reading order: the tree from the root when it can be found, else object order.
  const pages: number[] = []
  const seen = new Set<number>()
  const walk = (num: number): void => {
    if (seen.has(num)) return
    seen.add(num)
    const o = objects.get(num)
    if (o === undefined) return
    if (/\/Type\s*\/Page\b(?!s)/.test(o.dict)) pages.push(num)
    else if (/\/Kids/.test(o.dict)) {
      const kids = /\/Kids\s*\[([^\]]*)\]/.exec(o.dict)?.[1] ?? ''
      for (const k of refsIn(kids)) walk(k)
    }
  }
  for (const [num, o] of objects) {
    if (/\/Type\s*\/Pages\b/.test(o.dict) && !/\/Parent\b/.test(o.dict)) walk(num)
  }
  if (pages.length === 0) {
    for (const [num, o] of objects) if (/\/Type\s*\/Page\b(?!s)/.test(o.dict)) pages.push(num)
  }

  const inherited = (num: number, key: string): string | null => {
    let cur: number | undefined = num
    for (let hops = 0; cur !== undefined && hops < 12; hops += 1) {
      const o = objects.get(cur)
      if (o === undefined) return null
      const m = new RegExp(`/${key}\\s*(<<[\\s\\S]*?>>|\\d+\\s+\\d+\\s+R)`).exec(o.dict)
      if (m !== null) return m[1] ?? null
      const parent = /\/Parent\s+(\d+)\s+\d+\s+R/.exec(o.dict)?.[1]
      cur = parent === undefined ? undefined : Number(parent)
    }
    return null
  }

  const out: string[] = []
  for (const page of pages) {
    const pageObj = objects.get(page)
    if (pageObj === undefined) continue
    let res = inherited(page, 'Resources')
    if (res !== null && /^\d+\s+\d+\s+R$/.test(res.trim()))
      res = objects.get(refsIn(res)[0] ?? -1)?.dict ?? ''
    const fontRegion = /\/Font\s*(<<[\s\S]*?>>|\d+\s+\d+\s+R)/.exec(res ?? '')?.[1] ?? ''
    const fontDict = /^\d+/.test(fontRegion.trim())
      ? (objects.get(refsIn(fontRegion)[0] ?? -1)?.dict ?? '')
      : fontRegion
    const fonts = new Map<string, FontMap>()
    for (const m of fontDict.matchAll(/\/([^\s/<>[\]]+)\s+(\d+)\s+\d+\s+R/g)) {
      const fm = fontOf(Number(m[2]))
      if (fm !== null) fonts.set(m[1] ?? '', fm)
    }
    const contentsRaw = /\/Contents\s*(\[[^\]]*\]|\d+\s+\d+\s+R)/.exec(pageObj.dict)?.[1] ?? ''
    let text = ''
    for (const ref of refsIn(contentsRaw)) {
      const s = objects.get(ref)?.stream
      if (s !== null && s !== undefined) text += `${contentText(latin1(s), fonts)}\n`
    }
    out.push(text)
  }
  const joined = out
    .map((t) =>
      t
        .replace(/[ \t]+/g, ' ')
        .replace(/ ?\n ?/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim(),
    )
    .filter((t) => t !== '')
    .join('\n\n')
  if (joined === '') {
    return {
      text: null,
      why: 'this PDF has no text in it that can be read (it may be a scan or a photo of a page), so it cannot be searched',
    }
  }
  if (!readsAsLanguage(joined)) {
    return {
      text: null,
      why: 'this PDF stores its text in a way that cannot be read back reliably, so it is not searchable',
    }
  }
  return { text: joined, kind: 'pdf' }
}
