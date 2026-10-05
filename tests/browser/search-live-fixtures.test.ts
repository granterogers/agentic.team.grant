/**
 * The search parser against REAL DuckDuckGo responses, captured 2026-10-05 from html.duckduckgo.com through the build
 * sandbox's outbound proxy (a public search of a public service; nothing about this office). They are kept whole under
 * `fixtures/ddg-live/`. No test here reaches a network.
 *
 *   results-wikipedia.html               a real results page for the query "wikipedia", http 200
 *   results-rust-book-with-ads.html      a real results page that carries sponsored results, http 200
 *   challenge-202-node.html              the real answer to "node.js release schedule", http 202 (bot challenge)
 *   challenge-202-nonsense-query.html    the real answer to a nonsense query, http 202 (the same challenge)
 *
 * NOT captured: a genuine "no results" page. The service answered the nonsense query with its challenge, and later requests
 * were reset by the proxy, so the zero-results branch is still proved only by a hand-written page.
 *
 * What the real markup exposed: a sponsored result is wrapped in the SAME redirector as an organic one
 * (`//duckduckgo.com/l/?uddg=<encoded https://duckduckgo.com/y.js?...>`), so unwrapping it once produced the engine's own
 * ad-click address as the first "result" of a real page. The hand-written fixtures had the ad as a bare /y.js link.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  DuckDuckGoHtmlSearch,
  looksLikeAChallenge,
  parseDuckDuckGoHtml,
  unwrapResultUrl,
} from '../../src/browser/search.ts'

const load = (name: string): string =>
  readFileSync(new URL(`./fixtures/ddg-live/${name}`, import.meta.url), 'utf8')
const WIKI = load('results-wikipedia.html')
const RUST = load('results-rust-book-with-ads.html')
const CHALLENGES = [load('challenge-202-node.html'), load('challenge-202-nonsense-query.html')]

const answering = (body: string, status: number): typeof fetch =>
  (async () => new Response(body, { status })) as unknown as typeof fetch

describe('a real results page', () => {
  const got = parseDuckDuckGoHtml(WIKI, 20)
  it('yields real, public, unwrapped, ranked results with titles and snippets', () => {
    expect(got.length).toBeGreaterThanOrEqual(5)
    expect(got.map((r) => r.rank)).toEqual(got.map((_, i) => i + 1))
    expect(got[0]?.url).toBe('https://www.wikipedia.org')
    expect(got[0]?.title).toBe('Wikipedia')
    expect(got[0]?.snippet).toMatch(/free online encyclopedia/)
    for (const r of got) {
      expect(r.url).toMatch(/^https:\/\//)
      expect(r.url).not.toMatch(/duckduckgo\.com/)
      expect(r.title).not.toBe('')
      expect(r.title).not.toMatch(/[<>]/)
      expect(r.snippet).not.toMatch(/<\/?b>|&amp;|&#x27;/)
    }
  })
  it('is not mistaken for a challenge', () => {
    expect(looksLikeAChallenge(WIKI)).toBe(false)
    expect(looksLikeAChallenge(RUST)).toBe(false)
  })
})

describe('a real results page with sponsored results', () => {
  const got = parseDuckDuckGoHtml(RUST, 20)
  it('never returns an advertisement, however the engine wrapped it', () => {
    expect(got.length).toBeGreaterThanOrEqual(5)
    expect(got.some((r) => /duckduckgo\.com|y\.js|bing\.com\/aclick/.test(r.url))).toBe(false)
    expect(got[0]?.url).toBe('https://doc.rust-lang.org/stable/book/')
  })
  it('control: the ads really are in the page, so the filter had something to refuse', () => {
    expect(RUST).toMatch(/result--ad/)
    expect((RUST.match(/y\.js/g) ?? []).length).toBeGreaterThan(0)
    // The first anchor in the page is the advertisement.
    const firstHref = /class="result__a" href="([^"]*)"/.exec(RUST)?.[1] ?? ''
    expect(decodeURIComponent(firstHref)).toMatch(/y\.js/)
    expect(unwrapResultUrl(firstHref)).toBeNull()
  })
})

describe('the real challenge page', () => {
  it('is recognised as a challenge and parses to no results', () => {
    for (const page of CHALLENGES) {
      expect(looksLikeAChallenge(page)).toBe(true)
      expect(parseDuckDuckGoHtml(page)).toEqual([])
    }
  })
  it('is an honest "search unavailable", never an empty "no results", at the real status (202) and at 200', async () => {
    for (const status of [202, 200]) {
      const out = await new DuckDuckGoHtmlSearch({
        fetchImpl: answering(CHALLENGES[0] ?? '', status),
      }).search('node.js release schedule', 5)
      expect(out.ok).toBe(false)
      if (!out.ok) expect(out.detail).toMatch(/slow down|challenge/)
    }
  })
  it('control: the same search over a real results page succeeds', async () => {
    const out = await new DuckDuckGoHtmlSearch({ fetchImpl: answering(WIKI, 200) }).search(
      'wikipedia',
      5,
    )
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.results).toHaveLength(5)
  })
})
