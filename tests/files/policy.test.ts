/**
 * The file policy: what may be stored, the checksum, the link lifetime and the read rule (#469, B2).
 * Each refusal is asserted by its reason, so a refusal for the wrong reason cannot pass.
 *
 * Any type is accepted (the owner's decision, 15 October 2026). The only refusals are an empty file and one above the limit.
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

describe('checkUpload: any type is stored as it arrived; only empty and oversize files are refused', () => {
  it('accepts a PDF whose name, declared type and contents agree', () => {
    expect(checkUpload({ name: 'quote.pdf', mime: 'application/pdf', bytes: PDF })).toEqual({
      ok: true,
    })
  })

  it('refuses an empty file, by its reason', () => {
    expect(
      checkUpload({ name: 'a.pdf', mime: 'application/pdf', bytes: new Uint8Array(0) }),
    ).toEqual({ ok: false, reason: 'empty' })
  })

  it('refuses a file over the object limit without reading it', () => {
    const huge = { byteLength: MAX_OBJECT_BYTES + 1 } as unknown as Uint8Array
    expect(checkUpload({ name: 'a.pdf', mime: 'application/pdf', bytes: huge })).toEqual({
      ok: false,
      reason: 'too large',
    })
  })

  it.each([
    ['an HTML page', 'page.html', 'text/html', enc('<script>x()</script>')],
    ['an XHTML page', 'page.xhtml', 'application/xhtml+xml', enc('<html/>')],
    ['an SVG image with script', 'logo.svg', 'image/svg+xml', enc('<svg onload="x()"/>')],
    ['a JavaScript file', 'run.js', 'application/javascript', enc('alert(1)')],
    ['a Windows program', 'setup.exe', 'application/x-msdownload', Uint8Array.from([0x4d, 0x5a])],
    ['an unknown type with no extension', 'blob', 'application/x-something', enc('anything')],
  ])('accepts %s', (_, name, mime, bytes) => {
    expect(checkUpload({ name, mime, bytes })).toEqual({ ok: true })
  })

  it('accepts a PDF name whose contents are HTML: the contents are stored as they are', () => {
    expect(
      checkUpload({ name: 'report.pdf', mime: 'application/pdf', bytes: enc('<html>hi</html>') }),
    ).toEqual({ ok: true })
  })

  it('accepts a file whose name and declared type disagree', () => {
    expect(checkUpload({ name: 'quote.exe', mime: 'application/pdf', bytes: PDF })).toEqual({
      ok: true,
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
