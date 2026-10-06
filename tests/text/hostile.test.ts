/**
 * B-01: a document is hostile input, and reading one must cost a bounded amount of time and memory whatever it names.
 *
 * Two layers, because each finds what the other cannot:
 *   1. Every hostile document in hostile-inputs.ts is read in a CHILD PROCESS under a hard heap limit, and the test asserts
 *      what it cost (wall time, peak RSS) and what the reader answered. A reader that is not bounded dies or hangs there, so
 *      the failure is a red test and not a stuck runner. Measured against the unfixed reader these were: a 2 MB run-length
 *      stream out of memory, an 8 MB run of digits, a font map and a handful of lazy patterns each past forty seconds.
 *   2. In-process, with small limits passed in, the aggregate and per-stage bounds are asserted as behaviour, each beside a
 *      positive control (the same document under the real limits still reads), so a guard that refuses everything fails too.
 */
import { execFile } from 'node:child_process'
import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { FILE_TEXT_LIMITS, type FileTextLimits, fileText } from '../../src/text/file-text.ts'
import {
  DOCX_MIME,
  HOSTILE,
  L,
  MB,
  obj,
  onePage,
  rlBomb,
  wrap,
  zerosFlate,
  zip,
} from './hostile-inputs.ts'

interface ChildReport {
  case: string
  ms: number
  maxRssMb: number
  text: string | null
  why?: string
}

const SCRUBBED = [
  'SUPABASE_ACCESS_TOKEN',
  'SUPABASE_PROJECT_REF',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_DB_URL',
]

/** Reads one case in its own process with a hard old-space limit; the result is what the process printed, or a failure. */
function inChild(name: string): Promise<{ report: ChildReport | null; detail: string }> {
  const env = { ...process.env }
  for (const k of SCRUBBED) delete env[k]
  const args = ['--import', 'tsx', '--max-old-space-size=256', 'tests/text/hostile-child.ts', name]
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      args,
      { env, timeout: 45_000, maxBuffer: 1 << 20, cwd: process.cwd() },
      (error, stdout, stderr) => {
        const line = stdout.trim().split('\n').pop() ?? ''
        try {
          resolve({ report: JSON.parse(line) as ChildReport, detail: '' })
        } catch {
          const how = error === null ? 'bad output' : error.killed ? 'killed after 45s' : 'crashed'
          resolve({ report: null, detail: `${name}: no report (${how}) ${stderr.slice(0, 160)}` })
        }
      },
    )
  })
}

/** Cases whose answer must be the distinct "too large or too complex" one, not "nothing here" and not a read. */
const REFUSED = [
  'runlength-2mb',
  'runlength-8mb',
  'flate-many-content-streams',
  'objstm-many-streams',
  'objstm-many-objects',
  'many-tiny-objects',
  'kids-chain',
  'page-fanout-cmap',
  'contents-repeat',
  'cmap-range-bomb',
  'cmap-long-destination',
  'content-operand-pileup',
  'docx-three-parts',
]

describe('hostile documents cost a bounded amount (each read in its own process, heap limited to 256 MB)', () => {
  it('the set is not empty and every refused case names a case that exists', () => {
    expect(Object.keys(HOSTILE).length).toBeGreaterThanOrEqual(29)
    for (const name of REFUSED) expect(HOSTILE[name], name).toBeDefined()
  })

  for (const [name, c] of Object.entries(HOSTILE)) {
    const run = async (): Promise<void> => {
      const { report, detail } = await inChild(name)
      expect(report, detail).not.toBeNull()
      const r = report as ChildReport
      // Bounded in time and in memory. The unfixed reader needed minutes or died; the fixed one needs seconds.
      expect(r.ms, `${name} took ${String(r.ms)} ms`).toBeLessThan(15_000)
      expect(r.maxRssMb, `${name} peaked at ${String(r.maxRssMb)} MB`).toBeLessThan(450)
      // The wall clock is a backstop for what the counters did not foresee. A case that ends on it was NOT bounded by the
      // thing it aims at: it merely ran out of patience, ten seconds later. Every case must be settled by a counter.
      expect(r.why ?? '', `${name} ended on the wall clock`).not.toMatch(/too long/)
      if (REFUSED.includes(name)) {
        expect(r.text).toBeNull()
        // A limit of this reader, said as one: it must not read as "there is nothing here" (a scan) or as damage.
        expect(r.why).toMatch(/too large or too complex to read safely/)
        expect(r.why).not.toMatch(/no text in it|scan|damaged|could not be read/)
      }
    }
    it.concurrent(`${name}: ${c.aims}`, run, 60_000)
  }
})

const PDF = 'application/pdf'
/** What the reader said it could not do, or '' when it read something. */
const whyOf = async (bytes: Uint8Array, limits?: Partial<FileTextLimits>): Promise<string> => {
  const r = await fileText(bytes, PDF, 'a.pdf', limits)
  return r.text === null ? r.why : ''
}
const textOf = async (bytes: Uint8Array, limits?: Partial<FileTextLimits>): Promise<string> => {
  const r = await fileText(bytes, PDF, 'a.pdf', limits)
  return r.text ?? `(no text: ${r.why})`
}
const COMPLEX = /too large or too complex/

describe('the bounds, asserted in-process with small limits (and a positive control beside each)', () => {
  const SAY =
    'BT /F1 12 Tf 72 700 Td (The December balance is 41,250 pounds across all three accounts.) Tj ET\n'
  const page = (streams: Buffer[], contents: number[]): Uint8Array =>
    wrap([
      obj(1, '<< /Type /Catalog /Pages 2 0 R >>'),
      obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
      obj(
        3,
        `<< /Type /Page /Parent 2 0 R /Contents [${contents.map((n) => `${String(n)} 0 R`).join(' ')}] /Resources << /Font << /F1 5 0 R >> >> >>`,
      ),
      obj(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
      ...streams,
    ])
  // a content stream of real text followed by a long comment, so each is a genuine stream that decodes to a known size
  const padded = (kb: number): Buffer =>
    deflateSync(Buffer.from(`${SAY}%${'x'.repeat(kb * 1024)}\n`))

  it('AGGREGATE: streams each under the per-stream cap are refused once their total passes the file budget', async () => {
    const five = [10, 11, 12, 13, 14]
    const pdf = page(
      five.map((n) => obj(n, '/Filter /FlateDecode', padded(3000))),
      five,
    )
    const tight = { perStream: 4 * MB, decoded: 8 * MB }
    expect(await whyOf(pdf, tight)).toMatch(COMPLEX)
    // positive control: the same file under the real limits reads, so the refusal above was the budget and not the file
    expect(await textOf(pdf)).toContain('The December balance is 41,250 pounds')
    // and one stream alone fits the tight budget: the cap is on the TOTAL, not on any stream
    const one = page([obj(10, '/Filter /FlateDecode', padded(3000))], [10])
    expect(await textOf(one, tight)).toContain('The December balance')
  })

  it('PER-STAGE: a run-length stream is stopped inside the decoder, at the per-stream cap', async () => {
    const pdf = onePage('/Filter /RunLengthDecode', rlBomb(200_000)) // 400 KB naming 25 MB
    expect(await whyOf(pdf, { perStream: 1 * MB })).toMatch(COMPLEX)
    // positive control: under the real cap the same bomb is allowed to finish (25 MB is inside 32 MB) and is just not text
    expect(await whyOf(pdf)).not.toMatch(COMPLEX)
  })

  it('PER-STAGE: ASCII85 and ASCIIHex stop at their caps too, and a chain is charged at every stage', async () => {
    const z = onePage('/Filter /ASCII85Decode', Buffer.alloc(600_000, 'z')) // 600 KB naming 2.4 MB
    expect(await whyOf(z, { perStream: 1 * MB })).toMatch(COMPLEX)
    expect(await whyOf(z)).not.toMatch(COMPLEX)
    // letters break the digits up, so this stays about the hex stage and not about the object-marker pattern
    const hex = onePage('/Filter /ASCIIHexDecode', Buffer.alloc(3 * MB, 'a4'))
    expect(await whyOf(hex, { perStream: 1 * MB })).toMatch(COMPLEX)
    // a chain: Flate of a run-length bomb. The Flate stage is tiny, the run-length stage is not, and it is the stage capped.
    const chained = onePage('/Filter [/FlateDecode /RunLengthDecode]', deflateSync(rlBomb(100_000)))
    expect(await whyOf(chained, { perStream: 1 * MB })).toMatch(COMPLEX)
  })

  it('FLATE: the inflate loop stops at the cap, and DOCX parts share one budget', async () => {
    const flate = onePage('/Filter /FlateDecode', zerosFlate(6 * MB))
    expect(await whyOf(flate, { perStream: 1 * MB })).toMatch(COMPLEX)
    const part = Buffer.from(`<w:p><w:t>${'A'.repeat(2 * MB)}</w:t></w:p>`)
    const docx = zip([
      { name: 'word/document.xml', data: part },
      { name: 'word/footnotes.xml', data: part },
      { name: 'word/endnotes.xml', data: part },
    ])
    const tight = { perStream: 4 * MB, decoded: 5 * MB }
    const refused = await fileText(docx, DOCX_MIME, 'a.docx', tight)
    expect(refused.text === null ? refused.why : '').toMatch(COMPLEX)
    const ok = await fileText(docx, DOCX_MIME, 'a.docx')
    expect(ok.text?.length).toBeGreaterThan(6 * MB - 100)
  })

  it('OBJECTS, PAGES, TEXT and FONT ENTRIES are each counted, each with its own distinct answer', async () => {
    const many = new Uint8Array(Buffer.from(`%PDF-1.4\n${'1 0 obj\n'.repeat(500)}`))
    expect(await whyOf(many, { objects: 100 })).toMatch(/more objects than a document should/)
    expect(await whyOf(many)).not.toMatch(COMPLEX)

    const kids = Array.from({ length: 50 }, (_, i) => `${String(20 + i)} 0 R`).join(' ')
    const leaf =
      '<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>'
    const pages = wrap([
      obj(1, '<< /Type /Catalog /Pages 2 0 R >>'),
      obj(2, `<< /Type /Pages /Kids [${kids}] /Count 50 >>`),
      obj(4, '', L(SAY)),
      obj(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
      ...Array.from({ length: 50 }, (_, i) => obj(20 + i, leaf)),
    ])
    expect(await whyOf(pages, { pages: 10 })).toMatch(/page tree is larger/)
    // positive control: all fifty pages, in order
    expect((await textOf(pages)).split('The December balance').length).toBe(51)
    expect(await whyOf(pages, { text: 500 })).toMatch(/more text than a document should/)

    const cmap =
      'begincmap 1 begincodespacerange <00> <FF> endcodespacerange 1 beginbfrange <00> <FF> <0041> endbfrange endcmap'
    const mapped = onePage('', L('BT /F1 12 Tf <41> Tj ET'), '/ToUnicode 6 0 R', [
      obj(6, '', L(cmap)),
    ])
    expect(await whyOf(mapped, { cmapEntries: 100 })).toMatch(
      /map more characters than a document should/,
    )
  })

  it('WALL CLOCK is a backstop: a spent clock refuses, and says so as a limit', async () => {
    const pdf = page([obj(10, '', L(SAY))], [10])
    expect(await whyOf(pdf, { ms: -1 })).toMatch(/too long/)
  })

  it('INPUT size is refused before anything is parsed', async () => {
    expect(await whyOf(new Uint8Array(2000), { input: 1000 })).toMatch(COMPLEX)
  })

  it('the refusals are a different answer from "nothing here": a picture-only PDF still says so', async () => {
    const why = await whyOf(onePage('/Filter /DCTDecode', Buffer.from('not really a jpeg')))
    expect(why).toMatch(/no text in it that can be read/)
    expect(why).not.toMatch(COMPLEX)
  })

  it('the shipped limits are the ones this file was measured against (a raised default must be a decision)', () => {
    expect(FILE_TEXT_LIMITS).toMatchObject({
      perStream: 32 * MB,
      decoded: 64 * MB,
      objects: 250_000,
      pages: 20_000,
      text: 8 * MB,
    })
  })
})

describe('legitimate documents read exactly as before (positive controls for every rewritten pattern)', () => {
  it('HTML: comments, blocks, breaks, cells, entities and trailing spaces behave as the patterns they replaced', async () => {
    const html =
      '<html><head><style>p{color:red}</style><!-- note --><script>var secret=1</script></head><body>' +
      '<h1>Q3 &amp; Q4</h1><p>Budget is &pound;40 a month.   </p><p>Second&nbsp;paragraph<br>next line<BR/>and more</p>' +
      '<table><tr><td>A</td><td>B</td></tr></table><svg><path d="x"/></svg><noscript>no</noscript>tail</body></html>'
    const r = await fileText(new TextEncoder().encode(html), 'text/html', 'a.html')
    expect(r.text).toBe(
      'Q3 & Q4\n\nBudget is £40 a month.\n\nSecond paragraph\nnext line\nand more\n\nA\tB\t\n\n tail',
    )
    // an element with no closer is left, as it always was, and the text before it is kept
    const open = new TextEncoder().encode('<p>before</p><style>never closed <p>after</p>')
    expect((await fileText(open, 'text/html', 'a.html')).text).toContain('before')
  })

  it('PDF: a font map with ranges and arrays reads as it did', async () => {
    const cmap =
      '/CIDInit begin begincmap 1 begincodespacerange <0000> <FFFF> endcodespacerange ' +
      '4 beginbfchar <0001> <0054> <0002> <0068> <0003> <0065> <0020> <0020> endbfchar ' +
      '2 beginbfrange <0010> <0013> <0061> <0030> <0032> [<0078> <0079> <007A>] endbfrange endcmap'
    const unit = '<0001000200030020001000110012001300200030003100320020> Tj '
    const pdf = onePage(
      '',
      L(`BT /F1 12 Tf ${unit.repeat(6)} ET`),
      '/Subtype /Type0 /ToUnicode 6 0 R',
      [obj(6, '', L(cmap))],
    )
    expect(await textOf(pdf)).toContain('The abcd xyz The abcd xyz')
  })

  it('PDF: a chained filter stack and objects inside an object stream still read', async () => {
    const TEXT = 'BT /F1 12 Tf 72 700 Td (The December balance is 41,250 pounds.) Tj ET'
    const hex = L(`${deflateSync(Buffer.from(TEXT)).toString('hex')}>`)
    const chained = onePage('/Filter [/ASCIIHexDecode /FlateDecode]', hex)
    expect(await textOf(chained)).toContain('The December balance is 41,250 pounds.')
    const inner =
      '<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> ' +
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
    const head = `3 0 5 ${String(inner.indexOf('<< /Type /Font'))} `
    const words = 'Object streams hold the page and the font for this document.'
    const viaStream = wrap([
      obj(1, '<< /Type /Catalog /Pages 2 0 R >>'),
      obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
      obj(
        10,
        `/Type /ObjStm /N 2 /First ${String(head.length)} /Filter /FlateDecode`,
        deflateSync(Buffer.from(head + inner)),
      ),
      obj(4, '', L(`BT /F1 12 Tf (${words}) Tj ET`)),
    ])
    expect(await textOf(viaStream)).toContain(words)
  })

  it('DOCX: unaffected by the tighter tag pattern', async () => {
    const xml =
      '<w:document><w:body><w:p><w:r><w:t xml:space="preserve">Rent is </w:t></w:r><w:r><w:t>&#163;1,200 &amp; rising.</w:t></w:r></w:p>' +
      '<w:p><w:r><w:br/><w:t>second</w:t></w:r></w:p></w:body></w:document>'
    const docx = zip([{ name: 'word/document.xml', data: Buffer.from(xml) }])
    expect((await fileText(docx, DOCX_MIME, 'a.docx')).text).toBe(
      'Rent is £1,200 & rising.\n\nsecond',
    )
  })
})
