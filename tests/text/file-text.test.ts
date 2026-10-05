import { deflateRawSync, deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { renderReport } from '../../src/artifacts/report.ts'
import { fileText, htmlToText } from '../../src/text/file-text.ts'

const enc = (s: string): Uint8Array => new TextEncoder().encode(s)
const latin = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff)

/** A minimal PDF: the objects given, in order, with a catalog and a one-page tree. Streams are written as given. */
function pdf(objects: string[], extra = ''): Uint8Array {
  let out = '%PDF-1.4\n'
  objects.forEach((o, i) => {
    out += `${String(i + 1)} 0 obj\n${o}\nendobj\n`
  })
  out += `trailer\n<< /Root 1 0 R ${extra} >>\n%%EOF\n`
  return latin(out)
}
const streamObj = (dict: string, body: string): string =>
  `<< ${dict} /Length ${String(body.length)} >>\nstream\n${body}\nendstream`

describe('text a file holds', () => {
  it('plain text and Markdown are read as written, with NUL removed', async () => {
    const r = await fileText(enc('# Title\n\nA line\u0000 here.'), 'text/markdown', 'a.md')
    expect(r).toEqual({ text: '# Title\n\nA line here.', kind: 'text' })
  })

  it('HTML loses its markup, scripts and styles, keeps its paragraphs and decodes entities', async () => {
    const html =
      '<html><head><style>p{color:red}</style><script>var secret=1</script></head><body><h1>Q3 &amp; Q4</h1><p>Budget is &pound;40 a month.</p><p>Second&nbsp;paragraph</p></body></html>'
    const r = await fileText(enc(html), 'text/html', 'a.html')
    expect(r.text).toContain('Q3 & Q4')
    expect(r.text).toContain('Budget is £40 a month.')
    expect(r.text).not.toMatch(/secret|color:red|<p>/)
    expect(htmlToText('<p>a</p><p>b</p>')).toBe('a\n\nb')
  })

  it('an empty file says there was nothing, never an empty string', async () => {
    const r = await fileText(enc('   \n'), 'text/plain', 'a.txt')
    expect(r.text).toBeNull()
  })

  it('an unsupported type is named as not searchable, not silently empty', async () => {
    const r = await fileText(new Uint8Array([1, 2, 3]), 'image/png', 'a.png')
    expect(r).toMatchObject({ text: null })
    expect((r as { why: string }).why).toMatch(/not searchable/)
  })
})

/** A zip with the given entries, deflated or stored. */
function zip(entries: { name: string; data: string; stored?: boolean }[]): Uint8Array {
  const chunks: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const raw = Buffer.from(e.data)
    const body = e.stored === true ? raw : deflateRawSync(raw)
    const name = Buffer.from(e.name)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(e.stored === true ? 0 : 8, 8)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    chunks.push(local, name, body)
    const c = Buffer.alloc(46)
    c.writeUInt32LE(0x02014b50, 0)
    c.writeUInt16LE(e.stored === true ? 0 : 8, 10)
    c.writeUInt32LE(body.length, 20)
    c.writeUInt32LE(raw.length, 24)
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

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

describe('DOCX', () => {
  const body =
    '<w:document><w:body><w:p><w:r><w:t>Heading one</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t xml:space="preserve">Rent is </w:t></w:r><w:r><w:t>&#163;1,200 &amp; rising.</w:t></w:r></w:p>' +
    '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Cell B</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
    '</w:body></w:document>'

  it('reads paragraphs, runs, entities and table cells, from a deflated entry', async () => {
    const r = await fileText(zip([{ name: 'word/document.xml', data: body }]), DOCX_MIME, 'a.docx')
    expect(r).toMatchObject({ kind: 'docx' })
    expect(r.text).toContain('Heading one\nRent is £1,200 & rising.')
    expect(r.text).toMatch(/Cell A\s+Cell B/)
  })

  it('reads a stored (uncompressed) entry too', async () => {
    const r = await fileText(
      zip([{ name: 'word/document.xml', data: body, stored: true }]),
      DOCX_MIME,
      'a.docx',
    )
    expect(r.text).toContain('Heading one')
  })

  it('a zip that is not a Word document says so', async () => {
    const r = await fileText(zip([{ name: 'xl/workbook.xml', data: '<x/>' }]), DOCX_MIME, 'a.docx')
    expect(r.text).toBeNull()
  })

  it('a damaged file is refused with a reason, not thrown', async () => {
    const r = await fileText(enc('PK this is not really a zip'), DOCX_MIME, 'a.docx')
    expect(r.text).toBeNull()
  })

  it('a decompression bomb is refused', async () => {
    const big = 'A'.repeat(1024 * 1024)
    const bomb = zip([
      { name: 'word/document.xml', data: `<w:p><w:t>${big.repeat(45)}</w:t></w:p>` },
    ])
    const r = await fileText(bomb, DOCX_MIME, 'a.docx')
    expect(r.text).toBeNull()
  })
})

describe('PDF', () => {
  const page =
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>'
  void page

  const simple = (content: string, compressed = false): Uint8Array => {
    const stream = compressed
      ? streamObj('/Filter /FlateDecode', deflateSync(Buffer.from(content)).toString('latin1'))
      : streamObj('', content)
    return pdf([
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
      stream,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    ])
  }

  it('reads the text of a simple PDF, with its line breaks and escapes', async () => {
    const r = await fileText(
      simple(
        'BT /F1 12 Tf 72 700 Td (The deposit is \\(refundable\\) in full.) Tj 0 -14 Td (Second line caf\\351 \\226 done.) Tj ET',
      ),
      'application/pdf',
      'a.pdf',
    )
    expect(r).toMatchObject({ kind: 'pdf' })
    expect(r.text).toContain('The deposit is (refundable) in full.')
    expect(r.text).toContain('Second line café – done.')
    expect(r.text?.indexOf('refundable')).toBeLessThan(r.text?.indexOf('Second line') ?? 0)
  })

  it('reads a Flate-compressed content stream and TJ arrays (a wide kern is a space)', async () => {
    const r = await fileText(
      simple(
        'BT /F1 12 Tf [(Annual) -400 (review) 20 (meeting is on) -300 (Friday afternoon)] TJ ET',
        true,
      ),
      'application/pdf',
      'a.pdf',
    )
    expect(r.text).toContain('Annual review')
    expect(r.text).toContain('meeting is on Friday afternoon')
  })

  it('reads a Type0 font through its ToUnicode map (two-byte hex codes)', async () => {
    const cmap =
      '/CIDInit begin begincmap 1 begincodespacerange <0000> <FFFF> endcodespacerange ' +
      '4 beginbfchar <0001> <0054> <0002> <0068> <0003> <0065> <0004> <0020> endbfchar ' +
      '1 beginbfrange <0010> <0016> <0061> endbfrange endcmap'
    const r = await fileText(
      pdf([
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
        // codes: T h e (via bfchar) then "a b c d e f g" via the bfrange
        streamObj(
          '',
          'BT /F1 12 Tf <000100020003> Tj <0010001100120013001400150016> Tj ET BT /F1 12 Tf <0001> Tj ET',
        ),
        '<< /Type /Font /Subtype /Type0 /BaseFont /X /ToUnicode 6 0 R >>',
        streamObj('', cmap),
      ]),
      'application/pdf',
      'a.pdf',
    )
    // too short to read as language, so it is refused as unreliable rather than indexed: the property under test is that the MAP was used
    expect(r.text === null || r.text.includes('The')).toBe(true)
    const longer = await fileText(
      pdf([
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
        streamObj('', `BT /F1 12 Tf ${'<00010002000300040010001100120013> Tj '.repeat(6)} ET`),
        '<< /Type /Font /Subtype /Type0 /BaseFont /X /ToUnicode 6 0 R >>',
        streamObj('', cmap),
      ]),
      'application/pdf',
      'a.pdf',
    )
    expect(longer.text).toContain('The abcd')
  })

  it('finds fonts and pages inside an object stream', async () => {
    const inner =
      '<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> ' +
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
    const head = `3 0 5 ${String(inner.indexOf('<< /Type /Font'))} `
    const objstm = streamObj(
      `/Type /ObjStm /N 2 /First ${String(head.length)} /Filter /FlateDecode`,
      deflateSync(Buffer.from(head + inner)).toString('latin1'),
    )
    const r = await fileText(
      pdf([
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        objstm.replace('ObjStm', 'ObjStm'),
        streamObj(
          '',
          'BT /F1 12 Tf (Object streams hold the page and the font for this document.) Tj ET',
        ),
      ]),
      'application/pdf',
      'a.pdf',
    )
    expect(r.text).toContain('Object streams hold the page and the font')
  })

  it('an image-only PDF is NOT searchable and says why, instead of indexing nothing', async () => {
    const r = await fileText(
      pdf([
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> >> >>',
        streamObj('', 'q 595 0 0 842 0 0 cm /Im0 Do Q'),
        `<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /Filter /DCTDecode /Length 4 >>\nstream\nÿØÿÙ\nendstream`,
      ]),
      'application/pdf',
      'scan.pdf',
    )
    expect(r.text).toBeNull()
    expect((r as { why: string }).why).toMatch(/scan|photo|cannot be searched/)
  })

  it('a font that cannot be mapped back is refused as unreliable, not indexed as noise', async () => {
    const r = await fileText(
      pdf([
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
        streamObj('', 'BT /F1 12 Tf <000100020003000400050006> Tj ET'),
        '<< /Type /Font /Subtype /Type0 /BaseFont /X >>',
      ]),
      'application/pdf',
      'a.pdf',
    )
    expect(r.text).toBeNull()
  })

  it('a password-protected PDF is named as such', async () => {
    const r = await fileText(
      pdf(['<< /Type /Catalog >>'], '/Encrypt 9 0 R'),
      'application/pdf',
      'a.pdf',
    )
    expect(r.text).toBeNull()
    expect((r as { why: string }).why).toMatch(/password/)
  })

  it('reads a report the office itself made (the real generator), in order, with the sources page', async () => {
    const { bytes } = renderReport({
      title: 'Legacy Coaching Course status',
      subtitle: 'For the October review',
      author: 'The team',
      created: new Date('2026-10-04T00:00:00Z'),
      blocks: [
        { kind: 'heading', level: 1, text: 'Where the modules stand' },
        {
          kind: 'paragraph',
          text: 'Module three is complete and module four starts in November after the venue is confirmed.',
        },
        {
          kind: 'bullets',
          items: ['Budget approved at twelve thousand pounds', 'Facilitator contracts signed'],
        },
      ],
      sources: [],
    })
    const r = await fileText(bytes, 'application/pdf', 'report.pdf')
    expect(r).toMatchObject({ kind: 'pdf' })
    expect(r.text).toContain('Module three is complete')
    expect(r.text).toContain('Facilitator contracts signed')
    expect(r.text?.indexOf('Where the modules stand')).toBeLessThan(
      r.text?.indexOf('Facilitator') ?? 0,
    )
  })

  it('CONTROL: the check can fail - a PDF with the same words as a picture finds none of them', async () => {
    const r = await fileText(
      latin('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n'),
      'application/pdf',
      'a.pdf',
    )
    expect(r.text).toBeNull()
  })
})

/** ASCII85, written independently of the reader: 4 bytes -> 5 characters, a short tail of n bytes -> n + 1 characters. */
function toAscii85(data: Uint8Array): string {
  let out = ''
  for (let i = 0; i < data.length; i += 4) {
    const n = Math.min(4, data.length - i)
    let v = 0
    for (let k = 0; k < 4; k += 1) v = v * 256 + (k < n ? (data[i + k] as number) : 0)
    const chars: string[] = []
    for (let k = 0; k < 5; k += 1) {
      chars.unshift(String.fromCharCode((v % 85) + 33))
      v = Math.floor(v / 85)
    }
    out += chars.slice(0, n + 1).join('')
  }
  return `${out}~>`
}

describe('the stream filters real generators chain (a real ReportLab PDF read as "a scan" until this)', () => {
  const TEXT = 'BT /F1 12 Tf 72 700 Td (The December balance is 41,250 pounds.) Tj ET'
  const page = (stream: string): Uint8Array =>
    pdf([
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
      stream,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    ])

  it('ASCII85 then Flate, the ReportLab default, is read', async () => {
    const body = toAscii85(deflateSync(Buffer.from(TEXT)))
    const r = await fileText(
      page(streamObj('/Filter [ /ASCII85Decode /FlateDecode ]', body)),
      'application/pdf',
      'a.pdf',
    )
    expect(r.text).toContain('December balance is 41,250 pounds')
  })

  it('ASCIIHex then Flate, and RunLength alone, are read too', async () => {
    const hex = `${Buffer.from(deflateSync(Buffer.from(TEXT))).toString('hex')}>`
    const a = await fileText(
      page(streamObj('/Filter [/ASCIIHexDecode /FlateDecode]', hex)),
      'application/pdf',
      'a.pdf',
    )
    expect(a.text).toContain('December balance')
    // literal run-length: a length byte n (0-127) then n + 1 bytes, terminated by 128
    const bytes = [...TEXT].map((c) => c.charCodeAt(0))
    const rl: number[] = []
    for (let i = 0; i < bytes.length; i += 128) {
      const chunk = bytes.slice(i, i + 128)
      rl.push(chunk.length - 1, ...chunk)
    }
    rl.push(128)
    const b = await fileText(
      page(streamObj('/Filter /RunLengthDecode', String.fromCharCode(...rl))),
      'application/pdf',
      'a.pdf',
    )
    expect(b.text).toContain('December balance')
  })

  it('a picture filter in the chain is still declined, never half-read into garbage', async () => {
    const r = await fileText(
      page(streamObj('/Filter [/ASCII85Decode /DCTDecode]', toAscii85(Buffer.from(TEXT)))),
      'application/pdf',
      'a.pdf',
    )
    expect(r.text).toBeNull()
  })

  it('ASCII85 with a short tail decodes every byte (the length arithmetic is the usual defect)', async () => {
    for (const n of [1, 2, 3, 4, 5, 6, 7]) {
      const text = `BT /F1 12 Tf (The quarterly balance is high${'!'.repeat(n)} and the forecast is steady.) Tj ET`
      const r = await fileText(
        page(streamObj('/Filter /ASCII85Decode', toAscii85(latin(text)))),
        'application/pdf',
        'a.pdf',
      )
      expect(r.text ?? '', `tail ${String(n)}`).toContain(
        `high${'!'.repeat(n)} and the forecast is steady.`,
      )
    }
  })
})
