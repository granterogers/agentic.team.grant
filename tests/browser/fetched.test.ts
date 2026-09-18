/**
 * The adapter that needs no credential, and the limits it must state.
 *
 * `runtimeFor` resolved two Vault entries, found neither, and handed back
 * `UnavailableBrowserAdapter` — so the office could not open ANY page,
 * including a plain public one that never needed a browser. The Cloudflare
 * account blocks a login and a JavaScript-rendered page. It does not block
 * fetching HTML.
 *
 * Every assertion here is about HONESTY rather than capability: the three
 * things this runtime cannot do must come back as a refusal with a reason,
 * never as an empty success. An office that reports "the page says nothing"
 * about a page it could not render is the false-absence defect #257 exists
 * about, arriving through a new door.
 */
import { describe, expect, it } from 'vitest'
import {
  FetchedBrowser,
  isPrivateHost,
  looksLikeAShell,
  SHELL_BYTES,
  TOO_THIN,
} from '../../src/browser/fetched.ts'

const page = (body: string, status = 200): typeof fetch =>
  (async () =>
    new Response(`<html><head><title>A Title</title></head><body>${body}</body></html>`, {
      status,
    })) as unknown as typeof fetch

const LONG = 'This is a real sentence of page content. '.repeat(20)

describe('the fetched browser', () => {
  it('reads a public page', async () => {
    const r = await new FetchedBrowser({ fetchImpl: page(LONG) }).gather({
      url: 'https://example.com/a',
      verbs: ['read'],
    })
    expect(r.ok).toBe(true)
    expect(r.title).toBe('A Title')
    expect(r.text).toContain('a real sentence')
  })

  it('refuses a screenshot in words rather than returning an empty success', async () => {
    const r = await new FetchedBrowser({ fetchImpl: page(LONG) }).gather({
      url: 'https://example.com/a',
      verbs: ['shot'],
    })
    expect(r.ok).toBe(false)
    expect(r.shot).toBeNull()
    expect(r.detail).toContain('cannot take a screenshot')
  })

  it('calls a shell a LIMIT, never an empty page', async () => {
    // The app-shell shape: a full 200, tens of kilobytes of script, and a div.
    const shell = `<div id="root"></div><script>${'/*x*/'.repeat(3000)}</script>`
    const r = await new FetchedBrowser({ fetchImpl: page(shell) }).gather({
      url: 'https://example.com/app',
      verbs: ['read'],
    })
    expect(r.ok).toBe(false)
    expect(r.detail).toContain('JavaScript')
    /*
      The assertion that matters. `ok: false` alone would let a caller record
      a failure; what must never happen is `ok: true` with empty text, which a
      handler would write down as "we looked and there was nothing".
    */
    expect(r.detail).toContain('nothing here is evidence')
  })

  it('and a page just over the floor is still read', async () => {
    const justOver = 'x'.repeat(TOO_THIN + 50)
    const r = await new FetchedBrowser({ fetchImpl: page(justOver) }).gather({
      url: 'https://example.com/a',
      verbs: ['read'],
    })
    expect(r.ok).toBe(true)
  })

  it('reads a SHORT honest page — example.com is 144 characters', async () => {
    /*
      The regression for the defect the real network found and every fixture
      here missed. The first version refused anything under 400 characters,
      which rejected a complete server-rendered page as "probably JavaScript".
      A guard that refuses a good page teaches the office to distrust a
      runtime that was right.
    */
    const r = await new FetchedBrowser({
      fetchImpl: page(
        '<h1>Example Domain</h1><p>This domain is for use in illustrative examples in ' +
          'documents. You may use this domain in literature without prior coordination ' +
          'or asking for permission.</p>',
      ),
    }).gather({ url: 'https://example.com/', verbs: ['read'] })
    expect(r.ok).toBe(true)
    expect(r.text?.length ?? 0).toBeLessThan(TOO_THIN)
  })

  it('and the discriminator is markup weight, not text length', () => {
    const short = 'x'.repeat(100)
    expect(looksLikeAShell(short, '<html>tiny</html>')).toBe(false)
    expect(looksLikeAShell(short, 'y'.repeat(SHELL_BYTES + 1))).toBe(true)
    // CONTROL: plenty of text is never a shell, however heavy the page.
    expect(looksLikeAShell('z'.repeat(TOO_THIN + 1), 'y'.repeat(SHELL_BYTES * 10))).toBe(false)
  })

  it('reports a sign-in as signedOut, not as an outage', async () => {
    // The two need opposite responses — ask Grant versus wait — which is why
    // `adapter.ts` keeps them apart.
    const r = await new FetchedBrowser({
      fetchImpl: page('Please sign in to continue', 401),
    }).gather({ url: 'https://example.com/a', verbs: ['read'] })
    expect(r.signedOut).toBe(true)
    expect(r.ok).toBe(false)
  })

  it('refuses a private address, because a gather url is not trusted', async () => {
    // The one that matters: cloud instance metadata answers with credentials,
    // and no blocklist of hostnames would catch it.
    for (const url of [
      'http://169.254.169.254/latest/meta-data/',
      'http://127.0.0.1:8000/',
      'http://10.0.0.5/',
      'http://192.168.1.1/',
      'http://172.16.0.1/',
      'http://localhost/',
    ]) {
      const r = await new FetchedBrowser({
        fetchImpl: (() => {
          throw new Error('the guard let a private address through')
        }) as unknown as typeof fetch,
      }).gather({ url, verbs: ['read'] })
      expect(r.ok, url).toBe(false)
      expect(r.detail, url).toContain('private network')
    }
  })

  it('refuses a non-web scheme', async () => {
    const r = await new FetchedBrowser({
      fetchImpl: (() => {
        throw new Error('the guard let file:// through')
      }) as unknown as typeof fetch,
    }).gather({ url: 'file:///etc/passwd', verbs: ['read'] })
    expect(r.ok).toBe(false)
    expect(r.detail).toContain('not a web address')
  })

  it('CONTROL: the private-address guard still lets a real address through', () => {
    // Without this the test above is satisfied by a guard that refuses
    // everything — the found-nothing shape, on a security check.
    expect(isPrivateHost('example.com')).toBe(false)
    expect(isPrivateHost('11.0.0.1')).toBe(false)
    expect(isPrivateHost('172.32.0.1')).toBe(false)
    expect(isPrivateHost('169.253.0.1')).toBe(false)
  })

  it('stops between verbs when asked', async () => {
    const r = await new FetchedBrowser({ fetchImpl: page(LONG) }).gather({
      stopped: () => true,
      url: 'https://example.com/a',
      verbs: ['read'],
    })
    expect(r.stopped).toBe(true)
    expect(r.ok).toBe(false)
  })

  it('never puts a cookie in the detail it returns', async () => {
    const r = await new FetchedBrowser({ fetchImpl: page(LONG) }).gather({
      cookies: [{ domain: 'example.com', name: 'session', value: 'SUPERSECRETVALUE' }],
      url: 'https://example.com/a',
      verbs: ['read'],
    })
    expect(JSON.stringify(r)).not.toContain('SUPERSECRETVALUE')
  })
})
