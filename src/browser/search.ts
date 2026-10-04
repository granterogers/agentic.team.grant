/**
 * Searching the public web, behind a port (web research).
 *
 * The office depends on `SearchProvider`, never on whichever engine answers this month, for the reason
 * `adapter.ts` gives about the browser runtime: the provider is swappable only if nothing above this file knows which
 * one it is.
 *
 * ## The one concrete provider, and what is NOT verified about it
 *
 * `DuckDuckGoHtmlSearch` asks DuckDuckGo's no-JavaScript results page. It needs no key, no account and no money, which is
 * the cost constraint this repository starts from. It is also an UNDOCUMENTED interface: the markup it parses is not a
 * contract, and an engine may answer a datacentre address with a challenge page instead of results. Both are handled
 * HONESTLY (a challenge is `ok: false` with a reason, never an empty list read as "nothing exists"), and both are why the
 * parser is tested only against fixtures written from the markup as documented by its users. **It has never been run
 * against the live service from this repository** (no outbound calls are made by tests). Treat the first live run as the
 * verification, and expect the parser to need adjusting.
 *
 * ## What a search does and does not do
 *
 * It sends the QUESTION to a third party. That is the unavoidable cost of searching and is why a harness job never calls it
 * (the handler refuses before it gets here). It reads results and nothing else: no click, no form, no cookie.
 */

import { isPrivateHost } from './fetched.ts'
import { normalise } from './links.ts'

export interface SearchResult {
  readonly url: string
  readonly title: string
  readonly snippet: string
  /** 1-based position the engine gave it. */
  readonly rank: number
}

export type SearchOutcome =
  | { readonly ok: true; readonly results: readonly SearchResult[]; readonly provider: string }
  | { readonly ok: false; readonly detail: string; readonly provider: string }

export interface SearchProvider {
  readonly name: string
  /** The address the query is sent to, for the ledger that records every outward request. */
  urlFor(query: string): string
  search(query: string, limit: number): Promise<SearchOutcome>
}

const decode = (s: string): string =>
  s
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;|&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')

const plain = (html: string): string =>
  decode(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()

/**
 * The address a result really points at.
 *
 * DuckDuckGo wraps every result in its own redirector (`//duckduckgo.com/l/?uddg=<encoded target>`). Following the wrapper
 * would send the click through the engine; the target is in the query string. A result with no recoverable target, and an
 * advertisement (`/y.js`), return null.
 */
export function unwrapResultUrl(href: string): string | null {
  const raw = decode(href.trim())
  if (raw === '') return null
  let u: URL
  try {
    u = new URL(raw.startsWith('//') ? `https:${raw}` : raw)
  } catch {
    return null
  }
  const host = u.hostname.toLowerCase()
  if (host === 'duckduckgo.com' || host.endsWith('.duckduckgo.com')) {
    if (u.pathname.startsWith('/y.js')) return null
    const target = u.searchParams.get('uddg')
    if (target === null) return null
    try {
      u = new URL(target)
    } catch {
      return null
    }
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  if (isPrivateHost(u.hostname)) return null
  return normalise(u.toString())
}

/** True when the page is the engine's challenge rather than results. */
export function looksLikeAChallenge(html: string): boolean {
  return /anomaly-modal|g-recaptcha|unusual traffic|verify you are a human|are you a robot/i.test(
    html,
  )
}

/** Results out of the DuckDuckGo HTML page. Exported for the fixture tests. */
export function parseDuckDuckGoHtml(html: string, limit = 10): readonly SearchResult[] {
  const out: SearchResult[] = []
  const seen = new Set<string>()
  // Each result's title link carries class result__a; its snippet is the next result__snippet before the next title.
  const anchors = [
    ...html.matchAll(/<a\b[^>]*class="[^"]*\bresult__a\b[^"]*"[^>]*>[\s\S]*?<\/a>/gi),
  ]
  for (const [index, m] of anchors.entries()) {
    const tag = m[0]
    const href = /\bhref\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? ''
    const url = unwrapResultUrl(href)
    if (url === null || seen.has(url)) continue
    const start = (m.index ?? 0) + tag.length
    const end = anchors[index + 1]?.index ?? html.length
    const between = html.slice(start, end)
    const snip = /<a\b[^>]*class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(
      between,
    )
    seen.add(url)
    out.push({
      rank: out.length + 1,
      snippet: snip === null ? '' : plain(snip[1] ?? '').slice(0, 400),
      title: plain(tag).slice(0, 200),
      url,
    })
    if (out.length >= limit) break
  }
  return out
}

export interface DuckDuckGoDeps {
  /** Injected so nothing in a test reaches a network. */
  readonly fetchImpl?: typeof fetch
  readonly timeoutMs?: number
}

export class DuckDuckGoHtmlSearch implements SearchProvider {
  readonly name = 'duckduckgo-html'

  private readonly fetchImpl: typeof fetch

  private readonly timeoutMs: number

  constructor(deps: DuckDuckGoDeps = {}) {
    this.fetchImpl = deps.fetchImpl ?? fetch
    this.timeoutMs = deps.timeoutMs ?? 15_000
  }

  urlFor(query: string): string {
    return `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query.replace(/\s+/g, ' ').trim().slice(0, 300))}`
  }

  async search(query: string, limit: number): Promise<SearchOutcome> {
    const q = query.replace(/\s+/g, ' ').trim().slice(0, 300)
    if (q === '')
      return { detail: 'there was nothing to search for', ok: false, provider: this.name }
    const control = new AbortController()
    const timer = setTimeout(() => control.abort(), this.timeoutMs)
    try {
      const response = await this.fetchImpl(this.urlFor(q), {
        headers: {
          accept: 'text/html',
          // Named honestly, as the fetched browser does.
          'user-agent': 'AgenticTeam/1.0 (+https://ai-team-hq.vercel.app)',
        },
        redirect: 'error',
        signal: control.signal,
      })
      if (response.status === 202 || response.status === 429) {
        return {
          detail: `the search engine asked me to slow down (http ${String(response.status)})`,
          ok: false,
          provider: this.name,
        }
      }
      if (!response.ok) {
        return {
          detail: `the search engine answered http ${String(response.status)}`,
          ok: false,
          provider: this.name,
        }
      }
      const html = await response.text()
      if (looksLikeAChallenge(html)) {
        return {
          detail: 'the search engine put up a challenge instead of results',
          ok: false,
          provider: this.name,
        }
      }
      const results = parseDuckDuckGoHtml(html, Math.max(1, Math.min(limit, 20)))
      // An empty list is a real answer ONLY when the page looks like a results page; otherwise the markup changed.
      if (results.length === 0 && !/no results|result--no-result|did not match any/i.test(html)) {
        return {
          detail: 'the results page was not in a shape I recognise, so I cannot say there are none',
          ok: false,
          provider: this.name,
        }
      }
      return { ok: true, provider: this.name, results }
    } catch (error) {
      const aborted = (error as Error)?.name === 'AbortError'
      return {
        detail: aborted
          ? 'the search timed out'
          : `the search failed: ${String((error as Error).message).slice(0, 120)}`,
        ok: false,
        provider: this.name,
      }
    } finally {
      clearTimeout(timer)
    }
  }
}

/** The provider that ships. A function so a suite can see which one without constructing it. */
export const defaultSearchProvider = (deps: DuckDuckGoDeps = {}): SearchProvider =>
  new DuckDuckGoHtmlSearch(deps)
