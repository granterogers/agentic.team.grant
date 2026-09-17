/**
 * The gather tier's pure halves (#135, #16).
 *
 * Every case here has a negative control beside it, because most of these
 * functions decide whether something is TRUE and a detector that says yes to
 * everything scores perfectly on a corpus of yeses.
 */

import { describe, expect, it } from 'vitest'
import { UnavailableBrowserAdapter } from '../../src/browser/adapter.ts'
import { CloudflareBrowser, looksSignedOut, textOf, titleOf } from '../../src/browser/cloudflare.ts'
import { cookiesFrom, hostOf } from '../../src/handlers/browser-gather.ts'

describe('hostOf', () => {
  it('takes the host out of a URL', () => {
    expect(hostOf('https://example.com/prices?a=1')).toBe('example.com')
    expect(hostOf('http://Shop.Example.CO.UK:8080/x')).toBe('shop.example.co.uk')
  })

  it('refuses what is not a web address', () => {
    // The negative control. A matcher that accepted these would let the
    // handler open a `file:` URL or a bare word.
    expect(hostOf('file:///etc/passwd')).toBe(null)
    expect(hostOf('javascript:alert(1)')).toBe(null)
    expect(hostOf('not a url')).toBe(null)
    expect(hostOf('https://localhost/x')).toBe(null)
  })
})

describe('textOf', () => {
  it('turns markup into words', () => {
    const out = textOf(
      '<html><head><style>b{color:red}</style></head><body><h1>Prices</h1><p>Widget A is &pound;40.</p><script>x()</script></body></html>',
    )
    expect(out).toMatch(/Prices/)
    expect(out).toMatch(/Widget A is/)
  })

  it('leaves no script or style text behind', () => {
    const out = textOf('<style>.a{color:red}</style><script>stealCookies()</script><p>hello</p>')
    expect(out.includes('stealCookies')).toBe(false)
    expect(out.includes('color:red')).toBe(false)
    expect(out).toMatch(/hello/)
  })

  it('keeps block boundaries as newlines rather than running words together', () => {
    // #209's lesson: a body that runs together is not the same content.
    expect(textOf('<p>one</p><p>two</p>').split('\n').filter(Boolean).length).toBe(2)
  })
})

describe('titleOf', () => {
  it('reads a title', () => {
    expect(titleOf('<html><title> Supplier  prices </title>')).toBe('Supplier prices')
  })

  it('returns null rather than an empty string when there is none', () => {
    expect(titleOf('<html><body>no title</body></html>')).toBe(null)
    expect(titleOf('<title>   </title>')).toBe(null)
  })
})

describe('looksSignedOut', () => {
  it('believes the status code', () => {
    expect(looksSignedOut(401, 'anything')).toBe(true)
    expect(looksSignedOut(403, 'anything')).toBe(true)
  })

  it('recognises a short sign-in wall', () => {
    expect(looksSignedOut(200, 'Sign in\nEmail address\nPassword\nForgot?')).toBe(true)
  })

  it('does not call a long page about passwords a sign-in wall', () => {
    /*
      The control that matters most. A false positive asks Grant to
      re-authenticate a session that is perfectly good, which is the
      annoying direction, and an article about password policy is exactly
      the page a naive detector fires on.
    */
    const article = `${'Our password policy requires users to log in with an email address. '.repeat(120)}`
    expect(looksSignedOut(200, article)).toBe(false)
  })

  it('does not fire on a page that merely mentions signing in', () => {
    expect(looksSignedOut(200, 'Welcome back. Your orders are below. Sign in help is here.')).toBe(
      false,
    )
  })
})

describe('cookiesFrom', () => {
  it('accepts a bare array', () => {
    const got = cookiesFrom('[{"name":"s","value":"x","domain":"example.com"}]')
    expect(got.cookies.length).toBe(1)
    expect(got.problem).toBe(null)
  })

  it("accepts Playwright's storageState envelope, which is the shape a person exports", () => {
    const got = cookiesFrom(
      '{"cookies":[{"name":"s","value":"x","domain":"example.com"}],"origins":[]}',
    )
    expect(got.cookies.length).toBe(1)
    expect(got.problem).toBe(null)
  })

  it('says what is wrong rather than pretending there were none', () => {
    expect(cookiesFrom('not json').problem).toBe('the stored session is not readable as JSON')
    expect(cookiesFrom('{"origins":[]}').problem).toBe('the stored session holds no cookies')
  })

  it('treats no session at all as no cookies and no problem', () => {
    const got = cookiesFrom(null)
    expect(got).toEqual({ cookies: [], problem: null })
  })
})

describe('UnavailableBrowserAdapter', () => {
  it('answers rather than throwing, so the degradation path is the default path', async () => {
    const got = await new UnavailableBrowserAdapter('no credential').gather({
      url: 'https://example.com',
      verbs: ['read'],
    })
    expect(got.ok).toBe(false)
    expect(got.text).toBe(null)
    expect(got.signedOut).toBe(false)
    expect(got.detail).toBe('no credential')
  })
})

describe('CloudflareBrowser', () => {
  const account = 'acct'
  const token = 'cf-secret-token-value'

  it('reads a page and never puts the credential in what it reports', async () => {
    const adapter = new CloudflareBrowser({
      accountId: account,
      apiToken: token,
      fetchImpl: (async () =>
        new Response(JSON.stringify({ result: '<title>Prices</title><p>Widget A</p>' }), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        })) as unknown as typeof fetch,
    })
    const got = await adapter.gather({ url: 'https://example.com', verbs: ['read'] })
    expect(got.ok).toBe(true)
    expect(got.title).toBe('Prices')
    expect(got.text ?? '').toMatch(/Widget A/)
    expect(got.detail.includes(token)).toBe(false)
  })

  it('does not put a credential Cloudflare echoes back into the detail either', async () => {
    /*
      The control for the redaction, not for the code that avoids interpolating
      the token: a 403 body is written by somebody else.
    */
    const adapter = new CloudflareBrowser({
      accountId: account,
      apiToken: token,
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({ errors: [{ message: `bad token sk-ant-api03-${'a'.repeat(40)}` }] }),
          { headers: { 'content-type': 'application/json' }, status: 403 },
        )) as unknown as typeof fetch,
    })
    const got = await adapter.gather({ url: 'https://example.com', verbs: ['read'] })
    expect(got.ok).toBe(false)
    expect(got.signedOut).toBe(true)
    expect(/sk-ant-api03-a{40}/.test(got.detail)).toBe(false)
  })

  it('stops between verbs when asked, and does not take the photograph', async () => {
    let calls = 0
    const adapter = new CloudflareBrowser({
      accountId: account,
      apiToken: token,
      fetchImpl: (async () => {
        calls += 1
        return new Response(JSON.stringify({ result: '<title>t</title><p>words</p>' }), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        })
      }) as unknown as typeof fetch,
    })
    const got = await adapter.gather({
      stopped: () => true,
      url: 'https://example.com',
      verbs: ['read', 'shot'],
    })
    expect(got.stopped).toBe(true)
    expect(calls).toBe(1)
    expect(got.shot).toBe(null)
  })

  it('keeps the words when only the screenshot fails', async () => {
    let n = 0
    const adapter = new CloudflareBrowser({
      accountId: account,
      apiToken: token,
      fetchImpl: (async () => {
        n += 1
        return n === 1
          ? new Response(JSON.stringify({ result: '<title>t</title><p>words</p>' }), {
              headers: { 'content-type': 'application/json' },
              status: 200,
            })
          : new Response(JSON.stringify({ errors: [{ message: 'too big' }] }), {
              headers: { 'content-type': 'application/json' },
              status: 500,
            })
      }) as unknown as typeof fetch,
    })
    const got = await adapter.gather({ url: 'https://example.com', verbs: ['read', 'shot'] })
    expect(got.ok).toBe(true)
    expect(got.shot).toBe(null)
    expect(got.text ?? '').toMatch(/words/)
    expect(got.detail).toMatch(/screenshot/)
  })

  it('has no way to press anything', () => {
    const acting = (o: object): string[] =>
      Object.getOwnPropertyNames(Object.getPrototypeOf(o)).filter((m) =>
        /^(click|press|tap|type|fill|submit|select|upload|download|navigate|goto|evaluate)$/.test(
          m,
        ),
      )
    const adapter = new CloudflareBrowser({ accountId: account, apiToken: token })
    expect(acting(adapter)).toEqual([])
    expect(typeof adapter.gather).toBe('function')

    /*
      The control. Without it this assertion passes on any object at all --
      §10's rule, and #268's substring check is the instance of it that got
      committed.
    */
    class Acting {
      click(): void {}
      gather(): void {}
    }
    expect(acting(new Acting())).toEqual(['click'])
  })
})
