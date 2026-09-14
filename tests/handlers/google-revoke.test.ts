/**
 * Revoking a Google grant at Google (#109).
 *
 * The part worth pinning is not the HTTP call — it is what an `invalid_token`
 * MEANS. Google returns it when the grant is already dead, and calling that a
 * failure would send Grant to revoke something that does not exist.
 */
import { describe, expect, it } from 'vitest'
import { GOOGLE_REVOKE_URL, revokeAtGoogle } from '../../src/handlers/google-revoke.ts'

const reply = (status: number, body: unknown = {}): typeof fetch =>
  (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch

describe('what Google says, and what it means', () => {
  it('posts the token to the revoke endpoint, as a form body', async () => {
    let sawUrl = ''
    let sawBody = ''
    const spy = (async (url: string, init: RequestInit) => {
      sawUrl = String(url)
      sawBody = String(init.body)
      return new Response('', { status: 200 })
    }) as unknown as typeof fetch

    await revokeAtGoogle('1//refresh-token', spy)
    expect(sawUrl).toBe(GOOGLE_REVOKE_URL)
    // URL-encoded, so the slashes are escaped. Asserting the parsed value
    // rather than the encoding, which is the property that matters.
    expect(new URLSearchParams(sawBody).get('token')).toBe('1//refresh-token')
  })

  it('200 is revoked', async () => {
    const r = await revokeAtGoogle('t', reply(200))
    expect(r.revoked).toBe(true)
  })

  /*
    The decision this file exists for.

    `invalid_token` means the grant is already gone — revoked elsewhere, or
    expired because the OAuth app is in testing mode (§20). The end state is
    the one Grant wanted, so reporting a failure would tell him to go and kill
    something that does not exist.
  */
  it('400 invalid_token is ALSO revoked — already dead is still dead', async () => {
    const r = await revokeAtGoogle('t', reply(400, { error: 'invalid_token' }))
    expect(r.revoked).toBe(true)
    expect(r.detail).toContain('already gone')
  })

  it('any other refusal is NOT revoked, and quotes Google', async () => {
    const r = await revokeAtGoogle(
      '1//a-realistic-length-refresh-token',
      reply(400, { error: 'invalid_request' }),
    )
    expect(r.revoked).toBe(false)
    expect(r.detail).toContain('invalid_request')
  })

  it('a 500 is not revoked', async () => {
    expect((await revokeAtGoogle('t', reply(500))).revoked).toBe(false)
  })

  it('a network failure is not revoked, and says so in words', async () => {
    const dead = (async () => {
      throw new Error('ECONNRESET')
    }) as unknown as typeof fetch
    const r = await revokeAtGoogle('1//a-realistic-length-refresh-token', dead)
    expect(r.revoked).toBe(false)
    expect(r.detail).toContain('could not reach Google')
  })

  /*
    Never rethrown with the credential in it. A revoke failure that printed the
    token would be worse than the token surviving, and it is the kind of thing
    a `${error}` template adds without anybody deciding to.
  */
  it('never puts the token in what it reports', async () => {
    const TOKEN = '1//super-secret-refresh-token'
    const dead = (async () => {
      throw new Error(`connect failed for ${TOKEN}`)
    }) as unknown as typeof fetch
    for (const r of [
      await revokeAtGoogle(TOKEN, reply(400, { error: 'invalid_request' })),
      await revokeAtGoogle(TOKEN, reply(500)),
      await revokeAtGoogle(TOKEN, dead),
    ]) {
      expect(r.detail).not.toContain(TOKEN)
      expect(r.detail).not.toContain('super-secret')
    }
  })

  it('nothing parked is not a revoke, and does not call Google', async () => {
    let called = 0
    const spy = (async () => {
      called++
      return new Response('', { status: 200 })
    }) as unknown as typeof fetch
    const r = await revokeAtGoogle('   ', spy)
    expect(r.revoked).toBe(false)
    expect(called).toBe(0)
  })
})

/*
  The redaction must not eat the sentence.

  The first version stripped the token by value with no length floor, so a
  short one turned the scrubber into a find-and-replace on a single letter and
  the reason came back as a smear. Nothing leaked; the message was destroyed,
  which on a real failure is what Grant would be left holding.
*/
describe('the redaction is surgical, not scorched earth', () => {
  it('a short value is not treated as a credential', async () => {
    const r = await revokeAtGoogle('t', reply(400, { error: 'invalid_request' }))
    expect(r.detail).toContain('invalid_request')
    expect(r.detail).not.toContain('redacted')
  })

  it('and a real one is removed without taking the reason with it', async () => {
    const TOKEN = `1//${'x'.repeat(90)}`
    const dead = (async () => {
      throw new Error(`connect failed for ${TOKEN} after 30s`)
    }) as unknown as typeof fetch
    const r = await revokeAtGoogle(TOKEN, dead)
    expect(r.detail).not.toContain(TOKEN)
    expect(r.detail).toContain('could not reach Google')
    expect(r.detail).toContain('connect failed for')
  })
})
