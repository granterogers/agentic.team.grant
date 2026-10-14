/**
 * The file policy: what may be stored, the checksum, the link lifetime and the read rule (#469, B2).
 * Each refusal is asserted by its reason, so a refusal for the wrong reason cannot pass.
 */
import { describe, expect, it } from 'vitest'
import {
  canReadObject,
  checkUpload,
  linkTtlSeconds,
  MAX_OBJECT_BYTES,
  sha256Hex,
} from '../../src/files/policy.ts'

const enc = (s: string) => new TextEncoder().encode(s)
const PDF = enc('%PDF-1.7\n%âã\n')

describe('checkUpload', () => {
  it('accepts a PDF whose name, declared type and first bytes agree', () => {
    expect(checkUpload({ name: 'quote.pdf', mime: 'application/pdf', bytes: PDF })).toEqual({
      ok: true,
    })
  })

  it('refuses an empty file', () => {
    expect(
      checkUpload({ name: 'a.pdf', mime: 'application/pdf', bytes: new Uint8Array(0) }),
    ).toEqual({
      ok: false,
      reason: 'empty',
    })
  })

  it('refuses a file over the 100 MiB limit without reading it', () => {
    const huge = { byteLength: MAX_OBJECT_BYTES + 1 } as unknown as Uint8Array
    expect(checkUpload({ name: 'a.pdf', mime: 'application/pdf', bytes: huge })).toEqual({
      ok: false,
      reason: 'too large',
    })
  })

  it('refuses a type that is not on the allowlist', () => {
    expect(checkUpload({ name: 'page.html', mime: 'text/html', bytes: enc('<p>x</p>') })).toEqual({
      ok: false,
      reason: 'type not allowed',
    })
  })

  it('refuses a name whose extension does not match the declared type', () => {
    expect(checkUpload({ name: 'quote.exe', mime: 'application/pdf', bytes: PDF })).toEqual({
      ok: false,
      reason: 'extension does not match the declared type',
    })
  })

  it('refuses a PDF name whose contents are HTML: the declared type is not trusted on its own', () => {
    expect(
      checkUpload({ name: 'report.pdf', mime: 'application/pdf', bytes: enc('<html>hi</html>') }),
    ).toEqual({
      ok: false,
      reason: 'contents do not match the declared type',
    })
  })

  it('accepts UTF-8 text and refuses bytes that are not valid text', () => {
    expect(
      checkUpload({ name: 'notes.txt', mime: 'text/plain', bytes: enc('café — fine') }),
    ).toEqual({ ok: true })
    expect(
      checkUpload({
        name: 'notes.txt',
        mime: 'text/plain',
        bytes: new Uint8Array([0x61, 0xff, 0xfe]),
      }),
    ).toEqual({ ok: false, reason: 'contents do not match the declared type' })
    expect(
      checkUpload({ name: 'notes.txt', mime: 'text/plain', bytes: new Uint8Array([0x61, 0x00]) }),
    ).toEqual({
      ok: false,
      reason: 'contents do not match the declared type',
    })
  })

  it('requires the zip signature for an Office document', () => {
    const docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    expect(
      checkUpload({
        name: 'plan.docx',
        mime: docx,
        bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]),
      }),
    ).toEqual({
      ok: true,
    })
    expect(checkUpload({ name: 'plan.docx', mime: docx, bytes: enc('not a zip') })).toEqual({
      ok: false,
      reason: 'contents do not match the declared type',
    })
  })

  it('accepts a PNG only with the PNG signature', () => {
    expect(
      checkUpload({
        name: 'a.png',
        mime: 'image/png',
        bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1]),
      }),
    ).toEqual({
      ok: true,
    })
    expect(checkUpload({ name: 'a.png', mime: 'image/png', bytes: enc('GIF89a') })).toEqual({
      ok: false,
      reason: 'contents do not match the declared type',
    })
  })
})

describe('sha256Hex', () => {
  it('matches the published SHA-256 of "abc"', async () => {
    expect(await sha256Hex(enc('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('changes when one byte changes', async () => {
    expect(await sha256Hex(enc('abc'))).not.toBe(await sha256Hex(enc('abd')))
  })
})

describe('linkTtlSeconds', () => {
  it('defaults to ten minutes, the longest allowed', () => {
    expect(linkTtlSeconds(undefined)).toBe(600)
    expect(linkTtlSeconds(null)).toBe(600)
    expect(linkTtlSeconds(Number.NaN)).toBe(600)
  })

  it('clamps a request to between one minute and ten', () => {
    expect(linkTtlSeconds(1)).toBe(60)
    expect(linkTtlSeconds(9_999)).toBe(600)
    expect(linkTtlSeconds(300.9)).toBe(300)
  })
})

describe('canReadObject: the same office AND the same project', () => {
  const object = { office: 'office-a', project: 'proj-1' }

  it('lets a member of the office and of the project read it', () => {
    expect(canReadObject(object, { office: 'office-a', projects: ['proj-1', 'proj-2'] })).toBe(true)
  })

  it('refuses a member of the office who is not on the project: being in the office is not enough', () => {
    expect(canReadObject(object, { office: 'office-a', projects: ['proj-2'] })).toBe(false)
  })

  it('refuses a member of another office, even if they are on a project with the same id', () => {
    expect(canReadObject(object, { office: 'office-b', projects: ['proj-1'] })).toBe(false)
  })

  it('refuses a person with no office, and an object with no owner, rather than sharing them', () => {
    expect(canReadObject(object, { office: null, projects: ['proj-1'] })).toBe(false)
    expect(
      canReadObject(
        { office: null, project: 'proj-1' },
        { office: 'office-a', projects: ['proj-1'] },
      ),
    ).toBe(false)
    expect(
      canReadObject(
        { office: 'office-a', project: null },
        { office: 'office-a', projects: ['proj-1'] },
      ),
    ).toBe(false)
  })
})

/*
  THE ALLOWLIST AGAINST WHAT THE PRODUCT ACCEPTED (#471 audit, 14 October 2026). Formats the product took before this list
  are accepted again, under every declared type a browser or an operating system sends for them. The formats that run
  script when a stored file is opened from a signed link stay refused, and each refusal is asserted by its reason.
*/
describe('checkUpload: what is accepted, under every type a browser sends', () => {
  const XLS_OLE = Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0])
  const ODT_ZIP = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0])
  const RTF = enc('{\\rtf1\\ansi Hello}')
  const CSV = enc('task,owner\nCall the venue,Priya\n')

  it.each([
    ['a CSV sent as text/csv', 'venue.csv', 'text/csv', CSV],
    ['a CSV sent as Excel (Windows)', 'venue.csv', 'application/vnd.ms-excel', CSV],
    ['a CSV sent as plain text', 'venue.csv', 'text/plain', CSV],
    ['a TSV', 'venue.tsv', 'text/tab-separated-values', enc('a\tb\n1\t2\n')],
    ['a JSON file', 'data.json', 'application/json', enc('{"a":1}')],
    ['a Markdown file under the x- type', 'notes.md', 'text/x-markdown', enc('# Notes\n')],
    ['a legacy Word document', 'brief.doc', 'application/msword', XLS_OLE],
    ['a legacy Excel workbook', 'budget.xls', 'application/vnd.ms-excel', XLS_OLE],
    ['a legacy PowerPoint deck', 'deck.ppt', 'application/vnd.ms-powerpoint', XLS_OLE],
    ['an OpenDocument text', 'brief.odt', 'application/vnd.oasis.opendocument.text', ODT_ZIP],
    ['an RTF document', 'letter.rtf', 'application/rtf', RTF],
  ])('accepts %s', (_, name, mime, bytes) => {
    expect(checkUpload({ name, mime, bytes })).toEqual({ ok: true })
  })

  it('resolves a shared Excel type by the extension: an XLS named as Excel is judged as an XLS', () => {
    // Excel's type is shared by the CSV and the XLS. An XLS (OLE) named .xls passes; the same type with text bytes fails.
    expect(
      checkUpload({ name: 'budget.xls', mime: 'application/vnd.ms-excel', bytes: XLS_OLE }),
    ).toEqual({ ok: true })
    expect(
      checkUpload({ name: 'budget.xls', mime: 'application/vnd.ms-excel', bytes: CSV }),
    ).toEqual({
      ok: false,
      reason: 'contents do not match the declared type',
    })
  })

  it.each([
    [
      'HTML, which runs script when opened from a link',
      'page.html',
      'text/html',
      enc('<script>x()</script>'),
      'type not allowed',
    ],
    ['XHTML', 'page.xhtml', 'application/xhtml+xml', enc('<html/>'), 'type not allowed'],
    [
      'SVG, which can carry script',
      'logo.svg',
      'image/svg+xml',
      enc('<svg onload="x()"/>'),
      'type not allowed',
    ],
    ['JavaScript', 'run.js', 'application/javascript', enc('alert(1)'), 'type not allowed'],
    [
      'a Windows program',
      'setup.exe',
      'application/x-msdownload',
      Uint8Array.from([0x4d, 0x5a, 0x90, 0]),
      'type not allowed',
    ],
  ])('refuses %s, by its reason', (_, name, mime, bytes, reason) => {
    expect(checkUpload({ name, mime, bytes })).toEqual({ ok: false, reason })
  })

  it('refuses a CSV whose contents are binary: a NUL byte is not text', () => {
    expect(
      checkUpload({ name: 'data.csv', mime: 'text/csv', bytes: Uint8Array.from([0x61, 0, 0x62]) }),
    ).toEqual({
      ok: false,
      reason: 'contents do not match the declared type',
    })
  })

  it('refuses a JSON name sent as CSV: the extension must belong to the declared kind', () => {
    expect(checkUpload({ name: 'data.json', mime: 'text/csv', bytes: CSV })).toEqual({
      ok: false,
      reason: 'extension does not match the declared type',
    })
  })

  it('refuses a legacy Word name whose bytes are not an OLE2 file', () => {
    expect(checkUpload({ name: 'brief.doc', mime: 'application/msword', bytes: CSV })).toEqual({
      ok: false,
      reason: 'contents do not match the declared type',
    })
  })

  it('still refuses what the earlier list refused on purpose: a PDF name carrying HTML', () => {
    expect(
      checkUpload({ name: 'report.pdf', mime: 'application/pdf', bytes: enc('<html>x</html>') }),
    ).toEqual({
      ok: false,
      reason: 'contents do not match the declared type',
    })
  })
})
