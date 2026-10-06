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

/**
 * What reading one file may cost (B-01). A document is hostile input: a small file can name gigabytes of output, millions of
 * objects, or a scan that never finishes, and this reader runs inline in the gateway for any signed-in person (an 8 MB
 * upload) as well as in the worker. Every bound below is enforced BEFORE or INSIDE the work it limits, never after it, and
 * tripping one gives a distinct answer ("too large or too complex to read safely") rather than the "there is nothing here"
 * a picture of a page gets: the first is a limit of this reader, the second is a fact about the file.
 */
export interface FileTextLimits {
  /** One decoded stream, in bytes. */
  readonly perStream: number
  /** Every stream decoded for one file, in bytes: the aggregate no single cap can give. */
  readonly decoded: number
  /** "n g obj" markers plus objects inside object streams. */
  readonly objects: number
  /** Page-tree nodes visited, and pages read. */
  readonly nodes: number
  readonly pages: number
  /** Characters of dictionary, stream and CMap text the parser may scan, over every pattern it runs. */
  readonly scanned: number
  /** Characters of extracted text, counted as they are produced (a font map can turn one code into thousands). */
  readonly text: number
  /** ToUnicode entries over every font. */
  readonly cmapEntries: number
  /** Wall clock, a backstop for anything the counters above did not foresee. */
  readonly ms: number
  /** The file itself. */
  readonly input: number
}

const MB = 1024 * 1024
export const FILE_TEXT_LIMITS: FileTextLimits = {
  perStream: 32 * MB,
  decoded: 64 * MB,
  objects: 250_000,
  nodes: 50_000,
  pages: 20_000,
  scanned: 256 * MB,
  text: 8 * MB,
  cmapEntries: 1_000_000,
  ms: 10_000,
  input: 64 * MB,
}

/** A bound tripped. Internal: `fileText` turns it into an honest, distinct answer. */
class TooComplex extends Error {}

/** The running cost of one file. One per `fileText` call, so a limit is a limit on THIS file and not on the process. */
class Budget {
  decodedBytes = 0
  scannedChars = 0
  textChars = 0
  entries = 0
  private readonly deadline: number
  constructor(readonly limits: FileTextLimits) {
    this.deadline = Date.now() + limits.ms
  }
  /** Throws once the wall clock is spent. Called from loops, every few thousand iterations. */
  tick(): void {
    if (Date.now() > this.deadline) throw new TooComplex('reading it would take too long')
  }
  /** How many more bytes one stream stage may produce. */
  room(): number {
    return Math.min(this.limits.perStream, this.limits.decoded - this.decodedBytes)
  }
  decode(n: number): void {
    this.decodedBytes += n
    if (this.decodedBytes > this.limits.decoded)
      throw new TooComplex('it expands to more than a document should')
  }
  /** Charge before running a pattern over `n` characters. */
  scan(n: number): void {
    this.scannedChars += n
    if (this.scannedChars > this.limits.scanned)
      throw new TooComplex('it needs more work to read than a document should')
    this.tick()
  }
  emit(n: number): void {
    this.textChars += n
    if (this.textChars > this.limits.text)
      throw new TooComplex('it holds more text than a document should')
  }
  entry(n: number): void {
    this.entries += n
    if (this.entries > this.limits.cmapEntries)
      throw new TooComplex('its fonts map more characters than a document should')
  }
}

/** A growable byte buffer that refuses to grow past `limit`: the cap lives INSIDE the decoder loop, not after it. */
class Sink {
  private buf: Uint8Array
  n = 0
  constructor(private readonly limit: number) {
    this.buf = new Uint8Array(Math.min(1024, Math.max(0, limit)))
  }
  private room(extra: number): void {
    const need = this.n + extra
    if (need > this.limit) throw new TooComplex('it expands to more than a document should')
    if (need > this.buf.length) {
      const grown = new Uint8Array(Math.min(Math.max(need, this.buf.length * 2), this.limit))
      grown.set(this.buf.subarray(0, this.n))
      this.buf = grown
    }
  }
  push(b: number): void {
    if (this.n >= this.buf.length) this.room(1)
    this.buf[this.n] = b
    this.n += 1
  }
  fill(b: number, count: number): void {
    this.room(count)
    this.buf.fill(b, this.n, this.n + count)
    this.n += count
  }
  bytes(): Uint8Array {
    return this.buf.subarray(0, this.n)
  }
}

const TICK = 65536

const tooComplexWhy = (reason: string): string =>
  `this file is too large or too complex to read safely (${reason}), so it is stored and can be opened but its text is not searchable`

export async function fileText(
  bytes: Uint8Array,
  mime: string,
  name: string,
  limits: Partial<FileTextLimits> = {},
): Promise<FileText> {
  const ext = (name.split('.').pop() ?? '').toLowerCase()
  const budget = new Budget({ ...FILE_TEXT_LIMITS, ...limits })
  try {
    if (bytes.length > budget.limits.input)
      throw new TooComplex('the file is larger than can be read here')
    if (mime === 'application/pdf' || ext === 'pdf' || startsWith(bytes, '%PDF-')) {
      return await pdfText(bytes, budget)
    }
    if (
      mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      ext === 'docx'
    ) {
      return await docxText(bytes, budget)
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
    if (error instanceof TooComplex) return { text: null, why: tooComplexWhy(error.message) }
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

/*
  Every step below is linear in the input. The first version used lazy patterns such as <!--[\s\S]*?--> and <[^>]*>: an
  opener with no closer makes the engine scan to the end of the text from EVERY opener, so eight megabytes of "<" took
  minutes (B-01). A pattern that needs a closer asks for the closer with indexOf, and when there is none, no later opener of
  that kind can have one either, so the search stops instead of repeating.
*/

/** Replaces each `<!-- ... -->` with a space. An unclosed one is left as it was, as the pattern it replaces left it. */
function dropComments(s: string): string {
  let out = ''
  let pos = 0
  for (;;) {
    const a = s.indexOf('<!--', pos)
    if (a < 0) break
    const b = s.indexOf('-->', a + 4)
    if (b < 0) break
    out += `${s.slice(pos, a)} `
    pos = b + 3
  }
  return out + s.slice(pos)
}

/** Replaces each script, style, noscript, template or svg element, closer included, with a space. */
function dropBlocks(s: string): string {
  const opener = /<(script|style|noscript|template|svg)\b/gi
  const noCloser = new Set<string>()
  let out = ''
  let copyFrom = 0
  let scanFrom = 0
  for (;;) {
    opener.lastIndex = scanFrom
    const m = opener.exec(s)
    if (m === null) break
    const tag = (m[1] ?? '').toLowerCase()
    scanFrom = m.index + m[0].length
    if (noCloser.has(tag)) continue
    const closer = new RegExp(`<\\/${tag}\\s*>`, 'gi')
    closer.lastIndex = scanFrom
    const c = closer.exec(s)
    if (c === null) {
      noCloser.add(tag)
      continue
    }
    out += `${s.slice(copyFrom, m.index)} `
    copyFrom = c.index + c[0].length
    scanFrom = copyFrom
  }
  return out + s.slice(copyFrom)
}

/** Replaces each `<br ... >` or `<hr ... >` with a newline; one with no `>` after it ends the search. */
function breakTags(s: string): string {
  const opener = /<(?:br|hr)\b/gi
  let out = ''
  let pos = 0
  for (;;) {
    opener.lastIndex = pos
    const m = opener.exec(s)
    if (m === null) break
    const end = s.indexOf('>', m.index + m[0].length)
    if (end < 0) break
    out += `${s.slice(pos, m.index)}\n`
    pos = end + 1
  }
  return out + s.slice(pos)
}

/** Removes every `<` ... `>`; a `<` with no `>` after it, and so everything after it, is left as text. */
function stripTags(s: string): string {
  let out = ''
  let pos = 0
  for (;;) {
    const a = s.indexOf('<', pos)
    if (a < 0) break
    const b = s.indexOf('>', a + 1)
    if (b < 0) break
    out += s.slice(pos, a)
    pos = b + 1
  }
  return out + s.slice(pos)
}

export function htmlToText(html: string): string {
  const blocks = dropBlocks(dropComments(html)).replace(
    /<\/(p|div|section|article|header|footer|li|tr|h[1-6]|blockquote|pre|table|ul|ol)\s*>/gi,
    '\n\n',
  )
  const plain = decodeEntities(stripTags(breakTags(blocks).replace(/<\/(td|th)\s*>/gi, '\t')))
  // Trailing spaces before a newline go. The run is matched whole and judged by what follows it, because the obvious
  // pattern (spaces then a newline) retries from every space of a long run: a megabyte of spaces took minutes.
  return plain
    .replace(/[  ]+/g, (run, at: number, whole: string) =>
      whole[at + run.length] === '\n' ? '' : run,
    )
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ----------------------------------------------------------------------------------------------------------------- ZIP

/** Inflates `data`, and stops reading the moment the output passes `limit`: the cap is inside the loop, not after it. */
async function inflate(
  data: Uint8Array,
  format: 'deflate' | 'deflate-raw',
  limit: number,
  budget: Budget,
): Promise<Uint8Array> {
  if (limit <= 0) throw new TooComplex('it expands to more than a document should')
  const stream = new Blob([data.slice()]).stream().pipeThrough(new DecompressionStream(format))
  const reader = stream.getReader()
  const parts: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > limit) {
      await reader.cancel()
      throw new TooComplex('it expands to more than a document should')
    }
    budget.tick()
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

async function zipRead(b: Uint8Array, e: ZipEntry, budget: Budget): Promise<Uint8Array> {
  if (u32(b, e.offset) !== 0x04034b50) throw new Error('damaged zip entry')
  const start = e.offset + 30 + u16(b, e.offset + 26) + u16(b, e.offset + 28)
  const data = b.subarray(start, start + e.compressedSize)
  let out: Uint8Array
  if (e.method === 0) out = data
  else if (e.method === 8) out = await inflate(data, 'deflate-raw', budget.room(), budget)
  else throw new Error('unsupported compression')
  // The three parts a Word document is read from share one budget: each under the per-stream cap is not enough.
  budget.decode(out.length)
  return out
}

// ---------------------------------------------------------------------------------------------------------------- DOCX

async function docxText(bytes: Uint8Array, budget: Budget): Promise<FileText> {
  const entries = zipEntries(bytes)
  const main = entries.find((e) => e.name === 'word/document.xml')
  if (main === undefined)
    return { text: null, why: 'this is not a Word document (no document body in it)' }
  const parts = [main, ...entries.filter((e) => /^word\/(footnotes|endnotes)\.xml$/.test(e.name))]
  const chunks: string[] = []
  for (const e of parts) {
    const xml = new TextDecoder('utf-8').decode(await zipRead(bytes, e, budget))
    budget.scan(xml.length)
    const read = wordXmlToText(xml)
    budget.emit(read.length)
    chunks.push(read)
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
  // The tag body excludes "<" as well as ">": an XML attribute cannot hold a raw "<", and a body that could cross one made a
  // run of unclosed "<w:t " scan to the end from every opener.
  const token = /<w:(t|tab|br|cr|p|tc|tr)\b[^<>]*?(\/?)>([^<]*)|<\/w:(p|tc|tr)>/g
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

/**
 * An indirect object. A stream is kept as its RAW bytes (a view into the file, no copy) and decoded only when something
 * needs it: a content stream of a page being read, a ToUnicode map, an object stream. Decoding every stream up front, as the
 * first version did, spent the budget on images and font programs nobody reads, and retained all of them.
 */
interface PdfObject {
  dict: string
  raw: Uint8Array | null
}

const latin1 = (b: Uint8Array): string => {
  let s = ''
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192))
  return s
}

/** Only the filters that carry text and that this reader can undo; a picture filter means there is nothing to read here. */
const TEXT_FILTERS = new Set([
  'FlateDecode',
  'Fl',
  'ASCIIHexDecode',
  'ASCII85Decode',
  'RunLengthDecode',
])

/** A chain longer than this is not a generator's output: ReportLab, the commonest, writes two. */
const MAX_FILTERS = 8

/**
 * Undoes the filters on one stream. Each stage writes into a buffer capped at what the budget has left, so a run-length or
 * ASCII85 stream that names gigabytes stops at the cap instead of building them; a stage's output is charged to the budget.
 */
async function decodeStream(
  dict: string,
  raw: Uint8Array,
  budget: Budget,
): Promise<Uint8Array | null> {
  budget.scan(dict.length)
  const filters: string[] = []
  for (const m of dict.matchAll(
    /\/(FlateDecode|Fl|ASCIIHexDecode|ASCII85Decode|LZWDecode|DCTDecode|CCITTFaxDecode|JBIG2Decode|JPXDecode|RunLengthDecode)\b/g,
  )) {
    filters.push(m[1] ?? '')
    if (filters.length > MAX_FILTERS)
      throw new TooComplex('a stream is wrapped in more filters than a document needs')
  }
  // A picture or an LZW stream anywhere in the chain: nothing here this reader can undo, so none of it is attempted.
  if (filters.some((f) => !TEXT_FILTERS.has(f))) return null
  // Applied in the order the dictionary lists them: ReportLab writes [ /ASCII85Decode /FlateDecode ], which is the commonest
  // chain on the web and was read as "no text" (a scan) until a real file said otherwise.
  let data = raw
  for (const f of filters) {
    const room = budget.room()
    try {
      if (f === 'FlateDecode' || f === 'Fl') data = await inflate(data, 'deflate', room, budget)
      else if (f === 'ASCII85Decode') data = ascii85(data, new Sink(room), budget)
      else if (f === 'ASCIIHexDecode') data = asciiHex(data, new Sink(room), budget)
      else data = runLength(data, new Sink(room), budget)
    } catch (error) {
      // A bound tripping is not "this stream is damaged": it must reach the caller as its own answer.
      if (error instanceof TooComplex) throw error
      return null
    }
    budget.decode(data.length)
  }
  return data
}

function ascii85(data: Uint8Array, out: Sink, budget: Budget): Uint8Array {
  const group: number[] = []
  const flush = (n: number): void => {
    // a short final group of n characters is padded with 'u' and yields n - 1 bytes
    while (group.length < 5) group.push(84)
    let v = 0
    for (const g of group) v = v * 85 + g
    const bytes = [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]
    for (const b of bytes.slice(0, n - 1)) out.push(b)
    group.length = 0
  }
  for (let i = 0; i < data.length; i += 1) {
    if ((i & (TICK - 1)) === 0) budget.tick()
    const c = data[i] as number
    if (c === 0x7e) break // the end marker '~>'
    if (c <= 32) continue
    if (c === 0x7a && group.length === 0) {
      for (let k = 0; k < 4; k += 1) out.push(0)
      continue
    }
    if (c < 33 || c > 117) throw new Error('not ASCII85')
    group.push(c - 33)
    if (group.length === 5) flush(5)
  }
  if (group.length > 1) flush(group.length)
  return out.bytes()
}

function asciiHex(data: Uint8Array, out: Sink, budget: Budget): Uint8Array {
  let hi = -1
  for (let i = 0; i < data.length; i += 1) {
    if ((i & (TICK - 1)) === 0) budget.tick()
    const c = data[i] as number
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
  return out.bytes()
}

function runLength(data: Uint8Array, out: Sink, budget: Budget): Uint8Array {
  let steps = 0
  for (let i = 0; i < data.length; ) {
    steps += 1
    if ((steps & (TICK - 1)) === 0) budget.tick()
    const n = data[i] as number
    if (n === 128) break
    if (n < 128) {
      for (let k = 1; k <= n + 1 && i + k < data.length; k += 1) out.push(data[i + k] as number)
      i += n + 2
    } else {
      // two bytes can name 128 of output, so the sink's limit is what stops this, one run at a time
      out.fill(data[i + 1] ?? 0, 257 - n)
      i += 2
    }
  }
  return out.bytes()
}

async function pdfObjects(
  bytes: Uint8Array,
  src: string,
  budget: Budget,
): Promise<Map<number, PdfObject>> {
  budget.scan(src.length)
  const objects = new Map<number, PdfObject>()
  const tooMany = (): TooComplex => new TooComplex('it holds more objects than a document should')
  // The number is bounded and may not start inside a longer run of digits: with an unbounded \d+ one run of digits is
  // rescanned from every digit in it, and eight megabytes of "1" took minutes (B-01).
  const re = /(?<!\d)(\d{1,10})\s+(\d{1,10})\s+obj\b/g
  const marks: { num: number; at: number; bodyAt: number }[] = []
  for (let m = re.exec(src); m !== null; m = re.exec(src)) {
    if (marks.length >= budget.limits.objects) throw tooMany()
    marks.push({ num: Number(m[1]), at: m.index, bodyAt: m.index + m[0].length })
  }
  for (const [i, mark] of marks.entries()) {
    if ((i & 1023) === 0) budget.tick()
    const limit = marks[i + 1]?.at ?? src.length
    const body = src.slice(mark.bodyAt, limit)
    const s = body.search(/\bstream\r?\n|\bstream\r(?!\n)/)
    if (s < 0) {
      objects.set(mark.num, { dict: body.replace(/\bendobj[\s\S]*$/, ''), raw: null })
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
    // `src` is the file one character per byte, so a position in the body is a position in the file: a view, not a copy.
    const raw = bytes.subarray(mark.bodyAt + dataStart, mark.bodyAt + Math.max(dataStart, endAt))
    objects.set(mark.num, { dict, raw })
    if (/\/Type\s*\/ObjStm\b/.test(dict)) {
      const decoded = await decodeStream(dict, raw, budget)
      if (decoded === null) continue
      const text = latin1(decoded)
      const first = Number(/\/First\s+(\d+)/.exec(dict)?.[1] ?? 0)
      // N is read from the file and was a loop bound: a lie of four billion was four billion iterations. The header can
      // hold no more pairs than there are objects this reader will keep, so that is the bound.
      const n = Math.min(Number(/\/N\s+(\d+)/.exec(dict)?.[1] ?? 0), budget.limits.objects)
      const headEnd = Math.min(Number.isFinite(first) ? first : 0, text.length)
      budget.scan(headEnd)
      const head: number[] = []
      for (const t of text.slice(0, headEnd).matchAll(/\S+/g)) {
        head.push(Number(t[0]))
        if (head.length >= n * 2 + 2) break
      }
      for (let k = 0; k < n; k += 1) {
        if ((k & 1023) === 0) budget.tick()
        const num = head[k * 2]
        const off = head[k * 2 + 1]
        if (num === undefined || off === undefined || Number.isNaN(num) || Number.isNaN(off))
          continue
        const nextOff = head[(k + 1) * 2 + 1] ?? text.length - first
        // objects that all name the whole stream would each be a view of all of it: charge the span, not the object
        budget.scan(Math.max(0, nextOff - off))
        objects.set(num, { dict: text.slice(first + off, first + nextOff), raw: null })
        if (objects.size > budget.limits.objects) throw tooMany()
      }
    }
  }
  return objects
}

/** `n g R` references. The number may not start inside a longer run of digits (see pdfObjects). */
const refsIn = (s: string, budget: Budget): number[] => {
  budget.scan(s.length)
  return [...s.matchAll(/(?<!\d)(\d{1,10})\s+\d{1,10}\s+R\b/g)].map((m) => Number(m[1]))
}

/** A font's way back to text: a Unicode map for each code, and how many bytes a code is. */
interface FontMap {
  readonly width: 1 | 2
  readonly map: Map<number, string> | null
}

/**
 * The text between each `begin` and its `end`. Found with indexOf, one block after another: the lazy pattern this replaces
 * rescanned to the end of the map from every `begin` that had no `end`, so a map of repeated "beginbfchar" was quadratic.
 * A `begin` with no `end` ends the search, because no later one can have an end either.
 */
function* blocksOf(text: string, begin: string, end: string): Generator<string> {
  let at = 0
  for (;;) {
    const b = text.indexOf(begin, at)
    if (b < 0) return
    const from = b + begin.length
    const e = text.indexOf(end, from)
    if (e < 0) return
    yield text.slice(from, e)
    at = e + end.length
  }
}

function parseCMap(cmap: string, budget: Budget): FontMap {
  budget.scan(cmap.length)
  const map = new Map<number, string>()
  let width: 1 | 2 = 1
  const space = blocksOf(cmap, 'begincodespacerange', 'endcodespacerange').next()
  const cs = space.done === true ? '' : space.value
  const first = /<([0-9a-fA-F]+)>/.exec(cs)?.[1]
  if (first !== undefined && first.length >= 4) width = 2
  const hexToStr = (h: string): string => {
    budget.scan(h.length)
    let s = ''
    for (let i = 0; i + 4 <= h.length; i += 4)
      s += String.fromCharCode(Number.parseInt(h.slice(i, i + 4), 16))
    if (h.length === 2) s = String.fromCharCode(Number.parseInt(h, 16))
    return s
  }
  // One entry costs one, plus one for every 64 characters of what it maps to: a code mapped to a 200 KB string is not cheap.
  const set = (code: number, to: string): void => {
    budget.entry(1 + (to.length >>> 6))
    map.set(code, to)
  }
  // The entries of a block, found as a linear walk over its `<hex>` tokens. The first version matched a whole entry with one
  // pattern ending in an optional \[[^\]]*\] array, which rescans to the end of the block from every "[" that is never
  // closed. The walk keeps that pattern's meaning (an entry is tokens separated by whitespace only; an array runs to the
  // first "]"; a failed start retries from the next token) and remembers that no "]" is left once one search has failed.
  const MAX_TOKENS = 2_000_000
  const tokensOf = (body: string): { at: number[]; end: number[] } => {
    const at: number[] = []
    const end: number[] = []
    for (const m of body.matchAll(/<([0-9a-fA-F]+)>/g)) {
      at.push(m.index)
      end.push(m.index + m[0].length)
      if (at.length > MAX_TOKENS)
        throw new TooComplex('its fonts map more characters than a document should')
    }
    return { at, end }
  }
  const spaceBetween = (body: string, from: number, to: number): boolean =>
    /^\s*$/.test(body.slice(from, to))
  for (const body of blocksOf(cmap, 'beginbfchar', 'endbfchar')) {
    const t = tokensOf(body)
    const value = (i: number): string => body.slice((t.at[i] ?? 0) + 1, (t.end[i] ?? 1) - 1)
    for (let i = 0; i + 1 < t.at.length; ) {
      if (spaceBetween(body, t.end[i] ?? 0, t.at[i + 1] ?? 0)) {
        set(Number.parseInt(value(i), 16), hexToStr(value(i + 1)))
        i += 2
      } else i += 1
    }
  }
  for (const body of blocksOf(cmap, 'beginbfrange', 'endbfrange')) {
    const t = tokensOf(body)
    const value = (i: number): string => body.slice((t.at[i] ?? 0) + 1, (t.end[i] ?? 1) - 1)
    let noClose = false
    for (let i = 0; i + 1 < t.at.length; ) {
      if (!spaceBetween(body, t.end[i] ?? 0, t.at[i + 1] ?? 0)) {
        i += 1
        continue
      }
      let p = t.end[i + 1] ?? 0
      while (p < body.length && /\s/.test(body[p] as string)) p += 1
      const from = Number.parseInt(value(i), 16)
      const to = Number.parseInt(value(i + 1), 16)
      if (body[p] === '<' && t.at[i + 2] === p) {
        const dest = value(i + 2)
        const base = Number.parseInt(dest.slice(-4), 16)
        const prefix = hexToStr(dest.slice(0, -4))
        // the span is charged before it is walked: <0000> <FFFF> three hundred thousand times is not a map
        const span = Math.max(0, Math.min(to - from + 1, 65536))
        budget.entry((Number.isFinite(span) ? span : 0) * (1 + (prefix.length >>> 6)))
        for (let c = from; c <= to && c - from < 65536; c += 1)
          map.set(c, prefix + String.fromCharCode(base + (c - from)))
        i += 3
        continue
      }
      if (body[p] === '[' && !noClose) {
        const q = body.indexOf(']', p + 1)
        if (q < 0) noClose = true
        else {
          const items: string[] = []
          let j = i + 2
          while (j < t.at.length && (t.at[j] ?? 0) < q) {
            budget.entry(1)
            items.push(value(j))
            j += 1
          }
          for (let c = from; c <= to && c - from < items.length; c += 1)
            set(c, hexToStr(items[c - from] ?? ''))
          i = j
          continue
        }
      }
      i += 1
    }
  }
  return { width, map }
}

const WIN_ANSI_HIGH: Record<number, string> = {
  128: '€',
  130: '‚',
  131: 'ƒ',
  132: '„',
  133: '…',
  134: '†',
  135: '‡',
  136: 'ˆ',
  137: '‰',
  138: 'Š',
  139: '‹',
  140: 'Œ',
  142: 'Ž',
  145: '‘',
  146: '’',
  147: '“',
  148: '”',
  149: '•',
  150: '–',
  151: '—',
  152: '˜',
  153: '™',
  154: 'š',
  155: '›',
  156: 'œ',
  158: 'ž',
  159: 'Ÿ',
}

/** UTF-16 units to a string in slices, so the result is one flat string and not a rope with a node per character. */
const fromUnits = (units: number[]): string => {
  let out = ''
  for (let i = 0; i < units.length; i += 8192)
    out += String.fromCharCode(...units.slice(i, i + 8192))
  return out
}

const decodeWithFont = (codes: number[], font: FontMap | undefined, budget: Budget): string => {
  const units: number[] = []
  if (font?.map !== null && font?.map !== undefined) {
    // counted as it is produced: one code can map to thousands of characters, and a page can show that code a million times
    for (const c of codes) {
      const mapped = font.map.get(c) ?? ''
      budget.emit(mapped.length)
      for (let k = 0; k < mapped.length; k += 1) units.push(mapped.charCodeAt(k))
    }
    return fromUnits(units)
  }
  if (font?.width === 2) return '' // two-byte codes with no Unicode map: nothing honest to say
  budget.emit(codes.length)
  for (const c of codes) {
    if (c >= 0x80 && c < 0xa0) {
      const mapped = WIN_ANSI_HIGH[c] ?? ''
      for (let k = 0; k < mapped.length; k += 1) units.push(mapped.charCodeAt(k))
    } else if (c >= 0x20 || c === 10) units.push(c)
  }
  return fromUnits(units)
}

/** What `\s` matches among the characters a latin-1 string holds, by code: a regex test per character is most of the cost. */
const isSpace = (c: number): boolean => c === 32 || (c >= 9 && c <= 13) || c === 160

/** `[\s()<>[\]/%]` by code: the characters that end a token. */
const DELIMITERS = new Set([40, 41, 60, 62, 91, 93, 47, 37])
const isDelimiter = (c: number): boolean => isSpace(c) || DELIMITERS.has(c)

/** Reads the text-showing operators of one content stream, in order, with line breaks where the text moves down. */
function contentText(content: string, fonts: Map<string, FontMap>, budget: Budget): string {
  budget.scan(content.length)
  let out = ''
  let font: FontMap | undefined
  const stack: unknown[] = []
  // A page's pending operands are a handful; a stream that pushes millions without an operator is not a page.
  const MAX_OPERANDS = 200_000
  const push = (v: unknown): void => {
    stack.push(v)
    if (stack.length > MAX_OPERANDS)
      throw new TooComplex('a page holds more pending operands than a page should')
  }
  // The separators the operators add are at most one character per operator, so the scan charge above already bounds them;
  // only shown text, which a font map can multiply, is counted as it is produced (decodeWithFont).
  const n = content.length
  let i = 0
  const show = (codes: number[]): void => {
    out += decodeWithFont(codes, font, budget)
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
      push({ str: s, hex: false })
    } else if (ch === '<' && content[i + 1] !== '<') {
      const end = content.indexOf('>', i)
      push({ str: content.slice(i + 1, end < 0 ? n : end), hex: true })
      i = end < 0 ? n : end + 1
    } else if (ch === '[') {
      push('[')
      i += 1
    } else if (ch === ']') {
      const items: unknown[] = []
      while (stack.length > 0) {
        const top = stack.pop()
        if (top === '[') break
        items.push(top)
      }
      // popped last-first, so turned round once (unshift per item is a copy of the whole array each time)
      items.reverse()
      push({ arr: items })
      i += 1
    } else if (isSpace(content.charCodeAt(i))) {
      i += 1
    } else {
      let j = i
      while (j < n && !isDelimiter(content.charCodeAt(j))) j += 1
      if (ch === '/') {
        j = i + 1
        while (j < n && !isDelimiter(content.charCodeAt(j))) j += 1
        push({ name: content.slice(i + 1, j) })
        i = j
        continue
      }
      if (j === i) {
        i += 1
        continue
      }
      const tok = content.slice(i, j)
      i = j
      // A number is short. The pattern backtracks across a long token that is NOT one ("1111...x" a megabyte long took
      // minutes), so the length is checked first; a long token is just an operator nobody knows, and clears the operands.
      if (tok.length <= 32 && /^[+-]?\d*\.?\d+$/.test(tok)) {
        push(Number(tok))
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
  // A judgement of a ratio does not need sixteen million characters, and the per-character test below is not free.
  const sample = text
    .slice(0, 1 << 20)
    .replace(/\s+/g, ' ')
    .trim()
  if (sample.length < 20) return false
  let good = 0
  for (const c of sample) if (/[\p{L}\p{N} .,;:'"!?()\-–—‘’“”£$%&/@]/u.test(c)) good += 1
  const words = sample.split(' ').filter((w) => /\p{L}{2,}/u.test(w)).length
  return good / sample.length > 0.85 && words >= 4
}

async function pdfText(bytes: Uint8Array, budget: Budget): Promise<FileText> {
  if (/\/Encrypt\b/.test(latin1(bytes.subarray(Math.max(0, bytes.length - 2048))))) {
    return { text: null, why: 'this PDF is password-protected, so its text cannot be read' }
  }
  const objects = await pdfObjects(bytes, latin1(bytes), budget)
  if (objects.size === 0) return { text: null, why: 'this does not look like a readable PDF' }
  const limits = budget.limits

  /** A stream, decoded now and on demand. Nothing is retained: a page that names the same stream again pays for it again. */
  const streamOf = async (num: number): Promise<Uint8Array | null> => {
    const o = objects.get(num)
    if (o === undefined || o.raw === null) return null
    return await decodeStream(o.dict, o.raw, budget)
  }

  // A font is read once, however many pages use it (the first version parsed its map once per PAGE).
  const fontCache = new Map<number, FontMap | null>()
  const fontOf = async (ref: number): Promise<FontMap | null> => {
    const cached = fontCache.get(ref)
    if (cached !== undefined) return cached
    let found: FontMap | null = null
    const f = objects.get(ref)
    if (f !== undefined) {
      budget.scan(f.dict.length)
      const tu = /\/ToUnicode\s+(\d+)\s+\d+\s+R/.exec(f.dict)?.[1]
      const cm = tu === undefined ? null : await streamOf(Number(tu))
      found =
        cm !== null
          ? parseCMap(latin1(cm), budget)
          : { width: /\/Subtype\s*\/Type0/.test(f.dict) ? 2 : 1, map: null }
    }
    fontCache.set(ref, found)
    return found
  }

  // Pages in reading order: the tree from the root when it can be found, else object order. Walked with an explicit stack
  // (a chain of ninety thousand Pages nodes overflowed the call stack and read as "damaged") and counted: a tree larger than
  // a document has is refused, not followed.
  const pages: number[] = []
  const seen = new Set<number>()
  const tooBig = (): TooComplex => new TooComplex('its page tree is larger than can be read here')
  const walk = (root: number): void => {
    const stack = [root]
    for (let num = stack.pop(); num !== undefined; num = stack.pop()) {
      if (seen.has(num)) continue
      seen.add(num)
      if (seen.size > limits.nodes) throw tooBig()
      const o = objects.get(num)
      if (o === undefined) continue
      budget.scan(o.dict.length)
      if (/\/Type\s*\/Page\b(?!s)/.test(o.dict)) {
        pages.push(num)
        if (pages.length > limits.pages) throw tooBig()
      } else if (/\/Kids/.test(o.dict)) {
        const kids = /\/Kids\s*\[([^\]]*)\]/.exec(o.dict)?.[1] ?? ''
        const refs = refsIn(kids, budget)
        for (let k = refs.length - 1; k >= 0; k -= 1) stack.push(refs[k] as number)
      }
    }
  }
  for (const [num, o] of objects) {
    budget.scan(o.dict.length)
    if (/\/Type\s*\/Pages\b/.test(o.dict) && !/\/Parent\b/.test(o.dict)) walk(num)
  }
  if (pages.length === 0) {
    for (const [num, o] of objects) {
      budget.scan(o.dict.length)
      if (/\/Type\s*\/Page\b(?!s)/.test(o.dict)) {
        pages.push(num)
        if (pages.length > limits.pages) throw tooBig()
      }
    }
  }

  const inherited = (num: number, key: string): string | null => {
    let cur: number | undefined = num
    for (let hops = 0; cur !== undefined && hops < 12; hops += 1) {
      const o = objects.get(cur)
      if (o === undefined) return null
      budget.scan(o.dict.length)
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
      res = objects.get(refsIn(res, budget)[0] ?? -1)?.dict ?? ''
    budget.scan((res ?? '').length)
    const fontRegion = /\/Font\s*(<<[\s\S]*?>>|\d+\s+\d+\s+R)/.exec(res ?? '')?.[1] ?? ''
    const fontDict = /^\d+/.test(fontRegion.trim())
      ? (objects.get(refsIn(fontRegion, budget)[0] ?? -1)?.dict ?? '')
      : fontRegion
    budget.scan(fontDict.length)
    const fonts = new Map<string, FontMap>()
    for (const m of fontDict.matchAll(/\/([^\s/<>[\]]+)\s+(\d+)\s+\d+\s+R/g)) {
      const fm = await fontOf(Number(m[2]))
      if (fm !== null) fonts.set(m[1] ?? '', fm)
    }
    budget.scan(pageObj.dict.length)
    const contentsRaw = /\/Contents\s*(\[[^\]]*\]|\d+\s+\d+\s+R)/.exec(pageObj.dict)?.[1] ?? ''
    let text = ''
    for (const ref of refsIn(contentsRaw, budget)) {
      const s = await streamOf(ref)
      if (s !== null) text += `${contentText(latin1(s), fonts, budget)}\n`
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
