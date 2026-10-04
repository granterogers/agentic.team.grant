/**
 * The links a page offers, and which of them are safe to follow (web research).
 *
 * Following a link is a GET, and a GET is not automatically harmless: a page can link to `/logout`,
 * `/unsubscribe?id=...`, `/cart/add/9` or `/orders/42/cancel`, and a crawler that follows them acts on the
 * person's behalf. The browser tier's whole premise is that it reads and does not act, so the filter
 * here is part of that boundary rather than a nicety: a link whose address or words name an act is not
 * followed, and "unknown" is treated as "act" only where the verb is in the list below.
 */

import type { PageLink } from './adapter.ts'
import { isPrivateHost } from './fetched.ts'

export type { PageLink }

/** Words that, in a path, a query or the link's own text, say the link DOES something rather than shows something. */
const ACTING =
  /\b(log[-_ ]?out|sign[-_ ]?out|log[-_ ]?in|sign[-_ ]?in|sign[-_ ]?up|register|unsubscribe|subscribe|delete|remove|cancel|checkout|check[-_ ]?out|add[-_ ]?to[-_ ]?(?:cart|basket)|cart|basket|buy|purchase|order|pay|payment|donate|book(?:ing)?|reserve|confirm|approve|reject|unlock|reset|download[-_ ]?now|submit|send|post|publish|share|like|follow|vote|apply)\b/i

/** Addresses that are never a page worth reading. */
const NOT_A_PAGE = /^(mailto|tel|javascript|data|file|ftp|sms|blob):/i

const decode = (s: string): string =>
  s
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')

/** One address, comparable: no fragment, no tracking parameters, no trailing slash on a bare path. */
export function normalise(url: string): string {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return url
  }
  u.hash = ''
  for (const k of [...u.searchParams.keys()]) {
    if (/^(utm_|fbclid$|gclid$|mc_|ref$|ref_src$|igshid$)/i.test(k)) u.searchParams.delete(k)
  }
  const s = u.toString()
  return s.endsWith('/') && u.pathname === '/' && u.search === '' ? s.slice(0, -1) : s
}

/** Every `<a href>` on a page, resolved against the page's own address, http(s) only, deduplicated. */
export function linksOf(html: string, base: string): readonly PageLink[] {
  let baseUrl: URL
  try {
    baseUrl = new URL(base)
  } catch {
    return []
  }
  const seen = new Set<string>()
  const out: PageLink[] = []
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi
  for (const m of html.matchAll(re)) {
    const attrs = m[1] ?? ''
    const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs)
    const raw = decode((href?.[1] ?? href?.[2] ?? href?.[3] ?? '').trim())
    if (raw === '' || raw.startsWith('#') || NOT_A_PAGE.test(raw)) continue
    // A link marked nofollow or one that downloads/targets a form is not offered either way; rel is advisory only.
    let target: URL
    try {
      target = new URL(raw, baseUrl)
    } catch {
      continue
    }
    if (target.protocol !== 'https:' && target.protocol !== 'http:') continue
    if (isPrivateHost(target.hostname)) continue
    const key = normalise(target.toString())
    if (seen.has(key)) continue
    seen.add(key)
    const text = decode((m[2] ?? '').replace(/<[^>]*>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200)
    out.push({ text, url: key })
  }
  return out
}

/** Why this link is not followed, or null when it may be. */
export function whyNotFollowed(link: PageLink): string | null {
  let u: URL
  try {
    u = new URL(link.url)
  } catch {
    return 'not an address'
  }
  const where = `${decodeURIComponent(u.pathname.replace(/%(?![0-9a-f]{2})/gi, ''))} ${u.search}`
  if (ACTING.test(where)) return 'the address names an act, not a page'
  if (ACTING.test(link.text)) return 'the link text names an act, not a page'
  // Anything whose query names a state change is a command dressed as a link.
  if (/[?&](action|do|cmd|command|op|method)=/i.test(u.search)) {
    return 'the query asks the site to do something'
  }
  return null
}

const STOP = new Set(
  'about above after again also been being between both could does doing down during each from further have having here into itself more most other over same should some such than that their them then there these they this those through under until very were what when where which while will with would your the and for are but not you all any can had her his how its our out own too was who why'.split(
    ' ',
  ),
)

/** The words of a question that mean something, lower-cased and de-duplicated. */
export function termsOf(question: string): readonly string[] {
  const words = question.toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) ?? []
  return [...new Set(words.filter((w) => !STOP.has(w)))]
}

/** How many of the question's terms a piece of text contains. */
export function overlap(terms: readonly string[], text: string): number {
  const t = text.toLowerCase()
  return terms.filter((w) => t.includes(w)).length
}
