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
