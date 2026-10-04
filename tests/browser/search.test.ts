/**
 * The search port, proved against fixtures only: no test here reaches a network.
 *
 * The fixture markup is written from the shape the no-JavaScript DuckDuckGo results page is documented to have. It has NOT
 * been compared with a live response from this repository, so a pass here proves the parser's logic and nothing about the
 * live service. Every positive has a negative control beside it.
 */
import { describe, expect, it } from 'vitest'
import {
  DuckDuckGoHtmlSearch,
  looksLikeAChallenge,
  parseDuckDuckGoHtml,
  unwrapResultUrl,
} from '../../src/browser/search.ts'

const wrapped = (target: string): string =>
  `//duckduckgo.com/l/?uddg=${encodeURIComponent(target)}&amp;rut=abc123`

const result = (target: string, title: string, snippet: string): string => `
  <div class="result results_links results_links_deep web-result">
    <h2 class="result__title"><a rel="nofollow" class="result__a" href="${wrapped(target)}">${title}</a></h2>
    <a class="result__snippet" href="${wrapped(target)}">${snippet}</a>
  </div>`

const PAGE = `<html><body>
  <div class="result result--ad"><a class="result__a" href="https://duckduckgo.com/y.js?ad_provider=x&amp;u3=1">Buy now</a></div>
  ${result('https://example.org/guide?utm_source=x', 'The <b>Guide</b> to widgets', 'Widgets are <b>small</b> things &amp; useful.')}
  ${result('https://example.net/two', 'Second', 'Another page')}
  ${result('https://example.org/guide', 'Duplicate of the first', 'same page')}
  ${result('http://127.0.0.1/admin', 'Private', 'must never surface')}
  ${result('https://example.com/three', 'Third', '')}
</body></html>`

describe('unwrapResultUrl', () => {
  it('recovers the real target from the engine redirector', () => {
    expect(unwrapResultUrl(wrapped('https://example.org/a?b=1'))).toBe('https://example.org/a?b=1')
  })
  it('refuses an advertisement, a private address and a non-web scheme', () => {
    expect(unwrapResultUrl('https://duckduckgo.com/y.js?ad=1')).toBeNull()
    expect(unwrapResultUrl(wrapped('http://169.254.169.254/latest/meta-data'))).toBeNull()
    expect(unwrapResultUrl(wrapped('javascript:alert(1)'))).toBeNull()
    expect(unwrapResultUrl('')).toBeNull()
  })
})

describe('parseDuckDuckGoHtml', () => {
  const got = parseDuckDuckGoHtml(PAGE)
  it('reads titles, snippets and ranks, strips markup and entities', () => {
    expect(got[0]).toEqual({
      rank: 1,
      snippet: 'Widgets are small things & useful.',
      title: 'The Guide to widgets',
      url: 'https://example.org/guide',
    })
    expect(got.map((r) => r.rank)).toEqual([1, 2, 3])
  })
  it('drops ads, duplicates (after tracking parameters are removed) and private addresses', () => {
    expect(got.map((r) => r.url)).toEqual([
      'https://example.org/guide',
      'https://example.net/two',
      'https://example.com/three',
    ])
    expect(got.some((r) => r.url.includes('127.0.0.1'))).toBe(false)
  })
  it('honours the limit, and a page with no results parses to nothing rather than throwing', () => {
    expect(parseDuckDuckGoHtml(PAGE, 2)).toHaveLength(2)
    expect(parseDuckDuckGoHtml('<html></html>')).toEqual([])
  })
})

const reply = (body: string, status = 200): typeof fetch =>
  (async () => new Response(body, { status })) as unknown as typeof fetch

describe('DuckDuckGoHtmlSearch', () => {
  it('returns results from an injected fetch and asks only the engine, with GET and no cookie', async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = []
    const search = new DuckDuckGoHtmlSearch({
      fetchImpl: (async (url: string, init?: RequestInit) => {
        calls.push({ init, url })
        return new Response(PAGE)
      }) as unknown as typeof fetch,
    })
    const out = await search.search('widget guide', 5)
    expect(out.ok).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://html.duckduckgo.com/html/?q=widget%20guide')
    expect(calls[0]?.init?.method ?? 'GET').toBe('GET')
    expect(JSON.stringify(calls[0]?.init?.headers ?? {}).toLowerCase()).not.toContain('cookie')
  })

  it('says a challenge is a challenge, never an empty answer', async () => {
    const out = await new DuckDuckGoHtmlSearch({
      fetchImpl: reply(
        '<div class="anomaly-modal__title">Unfortunately, bots use DuckDuckGo too</div>',
      ),
    }).search('x', 5)
    expect(out.ok).toBe(false)
    expect(looksLikeAChallenge('<div class="anomaly-modal">')).toBe(true)
    // control: an ordinary results page is not a challenge
    expect(looksLikeAChallenge(PAGE)).toBe(false)
  })

  it('does not read unrecognised markup as "there are no results"', async () => {
    const out = await new DuckDuckGoHtmlSearch({
      fetchImpl: reply('<html><body>redesigned</body></html>'),
    }).search('x', 5)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.detail).toMatch(/cannot say there are none/)
    // control: a page that says so IS an empty answer
    const none = await new DuckDuckGoHtmlSearch({
      fetchImpl: reply('<div class="no-results">No results.</div>'),
    }).search('x', 5)
    expect(none.ok).toBe(true)
  })

  it('reports rate limits, server errors, timeouts and thrown errors as reasons', async () => {
    expect((await new DuckDuckGoHtmlSearch({ fetchImpl: reply('', 429) }).search('x', 5)).ok).toBe(
      false,
    )
    expect((await new DuckDuckGoHtmlSearch({ fetchImpl: reply('', 500) }).search('x', 5)).ok).toBe(
      false,
    )
    const boom = (async () => {
      throw new Error('socket hang up')
    }) as unknown as typeof fetch
    const out = await new DuckDuckGoHtmlSearch({ fetchImpl: boom }).search('x', 5)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.detail).toContain('socket hang up')
  })

  it('refuses an empty question without calling the engine', async () => {
    let called = false
    const out = await new DuckDuckGoHtmlSearch({
      fetchImpl: (async () => {
        called = true
        return new Response('')
      }) as unknown as typeof fetch,
    }).search('   ', 5)
    expect(out.ok).toBe(false)
    expect(called).toBe(false)
  })
})
