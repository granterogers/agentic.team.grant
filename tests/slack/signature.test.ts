/**
 * The signature check is the whole of the events endpoint's authentication, so
 * these tests are about the ways such a check is normally wrong rather than
 * about the happy path.
 */
import { describe, expect, it } from 'vitest'
import {
  computeSignature,
  constantTimeEquals,
  MAX_SKEW_SECONDS,
  verifySlackRequest,
} from '../../src/slack/signature.ts'

// Not a real secret: 32 chars of fixed text, so the expected signatures below
// are reproducible. secret-scan:allow-shape
const SECRET = 'abcdef0123456789abcdef0123456789'
const NOW = 1_770_000_000
const BODY = '{"type":"event_callback","event":{"type":"message","text":"hello"}}'

const signed = async (body = BODY, ts = String(NOW)): Promise<string> =>
  computeSignature(SECRET, ts, body)

describe('verifySlackRequest', () => {
  it('accepts a correctly signed request', async () => {
    const r = await verifySlackRequest(
      SECRET,
      { signature: await signed(), timestamp: String(NOW) },
      BODY,
      NOW,
    )
    expect(r).toEqual({ ok: true, reason: null })
  })

  it('refuses a request with no signature, and says which header is missing', async () => {
    expect(
      (await verifySlackRequest(SECRET, { signature: null, timestamp: String(NOW) }, BODY, NOW))
        .reason,
    ).toBe('missing_signature')
    expect(
      (await verifySlackRequest(SECRET, { signature: 'v0=abc', timestamp: null }, BODY, NOW))
        .reason,
    ).toBe('missing_timestamp')
  })

  it('refuses an unknown signature version rather than trying to verify it', async () => {
    const r = await verifySlackRequest(
      SECRET,
      { signature: `v1=${(await signed()).slice(3)}`, timestamp: String(NOW) },
      BODY,
      NOW,
    )
    expect(r.reason).toBe('unsupported_version')
  })

  it('refuses a body that differs from the one signed, by a single character', async () => {
    const r = await verifySlackRequest(
      SECRET,
      { signature: await signed(), timestamp: String(NOW) },
      `${BODY.slice(0, -1)} `,
      NOW,
    )
    expect(r.reason).toBe('signature_mismatch')
  })

  it('refuses a re-serialised body — the raw bytes are what is signed', async () => {
    // This is the mistake that looks like it works: a handler that parses the
    // body, then verifies `JSON.stringify(parsed)`, passes any test that uses
    // the same serialiser on both sides and fails on every real request,
    // because Slack's spacing and key order are not ours to reproduce.
    const reserialised = JSON.stringify(JSON.parse(BODY))
    const spaced = JSON.stringify(JSON.parse(BODY), null, 1)
    expect(reserialised).not.toBe(spaced)
    const r = await verifySlackRequest(
      SECRET,
      { signature: await signed(BODY), timestamp: String(NOW) },
      spaced,
      NOW,
    )
    expect(r.reason).toBe('signature_mismatch')
  })

  it('refuses a signature made with a different secret', async () => {
    const other = await computeSignature('0'.repeat(32), String(NOW), BODY)
    const r = await verifySlackRequest(
      SECRET,
      { signature: other, timestamp: String(NOW) },
      BODY,
      NOW,
    )
    expect(r.reason).toBe('signature_mismatch')
  })
})

describe('the replay window', () => {
  it('refuses a request older than the window', async () => {
    const old = NOW - MAX_SKEW_SECONDS - 1
    const r = await verifySlackRequest(
      SECRET,
      { signature: await signed(BODY, String(old)), timestamp: String(old) },
      BODY,
      NOW,
    )
    // The signature is valid. Without a replay window a captured request would
    // be valid forever, so validity is not sufficient.
    expect(r.reason).toBe('stale_timestamp')
  })

  it('refuses a far-future timestamp too, not only an old one', async () => {
    const future = NOW + MAX_SKEW_SECONDS + 1
    const r = await verifySlackRequest(
      SECRET,
      { signature: await signed(BODY, String(future)), timestamp: String(future) },
      BODY,
      NOW,
    )
    expect(r.reason).toBe('stale_timestamp')
  })

  it('accepts a request at the edge of the window', async () => {
    const edge = NOW - MAX_SKEW_SECONDS
    const r = await verifySlackRequest(
      SECRET,
      { signature: await signed(BODY, String(edge)), timestamp: String(edge) },
      BODY,
      NOW,
    )
    expect(r.ok).toBe(true)
  })

  it.each(['', 'not-a-number', '17700000000000000000', '123abc', '-1', '1.5'])(
    'refuses the malformed timestamp %s',
    async (ts) => {
      const r = await verifySlackRequest(SECRET, { signature: 'v0=x', timestamp: ts }, BODY, NOW)
      // Number('') is 0 and Number('123abc') is NaN. Both would sail past a
      // check written as `if (!timestamp)` or `if (isNaN(n))` respectively.
      expect(r.ok).toBe(false)
      expect(['missing_timestamp', 'malformed_timestamp']).toContain(r.reason)
    },
  )
})

describe('constantTimeEquals', () => {
  it('is true only for identical strings', () => {
    expect(constantTimeEquals('abc', 'abc')).toBe(true)
    expect(constantTimeEquals('abc', 'abd')).toBe(false)
  })

  it('handles unequal lengths without throwing', () => {
    // Node's timingSafeEqual throws on unequal lengths, which turns a hostile
    // request into a 500 and leaks the same fact a length check would.
    expect(() => constantTimeEquals('abc', 'abcdef')).not.toThrow()
    expect(constantTimeEquals('abc', 'abcdef')).toBe(false)
    expect(constantTimeEquals('', 'a')).toBe(false)
    expect(constantTimeEquals('', '')).toBe(true)
  })

  it('does not treat a prefix as a match', () => {
    expect(constantTimeEquals('v0=abcd', 'v0=abcdef')).toBe(false)
  })
})

describe('runtime portability', () => {
  it('uses only APIs present in both Node and Deno', async () => {
    // The Telegram webhook shipped with Buffer.from() and passed 31 unit tests
    // under Node while throwing on every production request under Deno. This
    // asserts the intersection rather than trusting a comment about it.
    //
    // Comments are stripped first. The first version of this test failed
    // against the *comment* explaining the Buffer mistake, which is the test
    // policing prose rather than code — and a test that can be satisfied by
    // rewording a comment is not testing anything.
    const raw = await import('node:fs/promises').then(async (fs) =>
      fs.readFile('src/slack/signature.ts', 'utf8'),
    )
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

    expect(code).not.toMatch(/\bBuffer\b/)
    expect(code).not.toMatch(/require\(/)
    expect(code).not.toMatch(/from 'node:/)
    expect(code).toMatch(/crypto\.subtle/)
    // And the comment stripper actually removed something, or the assertions
    // above would be checking an empty string.
    expect(code.length).toBeLessThan(raw.length)
    expect(code).toContain('export const verifySlackRequest')
  })
})
