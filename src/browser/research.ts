/**
 * The pure halves of web research: which results to read, which links to follow, what to pull out, how to say it.
 *
 * Kept free of the database and the network so every decision a research run makes can be proved with plain data.
 */

import { looksLikeAFile } from './download.ts'
import { whyRefused } from './fetched.ts'
import { normalise, overlap, type PageLink, whyNotFollowed } from './links.ts'
import type { SearchResult } from './search.ts'

/** Hard ceilings. The question may ask for fewer; nothing may ask for more. */
export const LIMITS = {
  /** Pages fetched in all: search results read plus links followed. */
  maxPages: 8,
  /** Search results read. */
  maxResults: 6,
  /** Links followed, one hop only. There is no depth to configure: a followed page's own links are never followed. */
  maxFollow: 3,
  maxDownloads: 1,
} as const

export interface ResearchBudget {
  readonly results: number
  readonly follow: number
  readonly pages: number
  readonly downloads: number
}

const clamp = (v: unknown, fallback: number, ceiling: number): number => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), ceiling) : fallback
}

/** What the job's payload asked for, held under the ceilings. */
export function budgetFrom(config: Record<string, unknown>): ResearchBudget {
  const pages = clamp(config.max_pages, 6, LIMITS.maxPages)
  return {
    downloads: clamp(config.max_downloads, 1, LIMITS.maxDownloads),
    follow: clamp(config.follow, 2, LIMITS.maxFollow),
    pages,
    results: Math.min(clamp(config.max_results, 4, LIMITS.maxResults), pages),
  }
}

/**
 * Which search results to read.
 *
 * Refuses an address the browser tier would refuse, a file (those are downloads and are decided separately), a repeat of a
 * page already read, and more than two from one host, so one site cannot be the whole of a research run.
 */
export function pickResults(
  results: readonly SearchResult[],
  max: number,
  alreadyRead: ReadonlySet<string> = new Set(),
): readonly SearchResult[] {
  const out: SearchResult[] = []
  const perHost = new Map<string, number>()
  const taken = new Set<string>()
  for (const r of results) {
    if (out.length >= max) break
    let u: URL
    try {
      u = new URL(r.url)
    } catch {
      continue
    }
    if (whyRefused(u) !== null) continue
    const key = normalise(r.url)
    if (alreadyRead.has(key) || taken.has(key) || looksLikeAFile(key)) continue
    taken.add(key)
    const host = u.hostname.toLowerCase()
    if ((perHost.get(host) ?? 0) >= 2) continue
    perHost.set(host, (perHost.get(host) ?? 0) + 1)
    out.push(r)
  }
  return out
}

export interface Followable {
  readonly link: PageLink
  /** `read` for a page, `download` for a file the question's words appear in. */
  readonly how: 'read' | 'download'
  readonly score: number
  readonly from: string
}

/**
 * Which of a page's links are worth one hop.
 *
 * A link is followed only when it is relevant (its words or address share a term with the question), is not an act
 * (`whyNotFollowed`: logout, cart, unsubscribe, a query asking the site to do something), has not been read, and is a
 * public address. "Relevant" is deliberately the bar: crawling everything a page links to is how a research run becomes a
 * crawl, and a request to crawl a site should reach a person.
 */
export function chooseLinks(
  pages: readonly { readonly url: string; readonly links: readonly PageLink[] }[],
  terms: readonly string[],
  max: number,
  alreadyRead: ReadonlySet<string>,
): readonly Followable[] {
  const scored: Followable[] = []
  const seen = new Set<string>(alreadyRead)
  for (const page of pages) {
    for (const link of page.links) {
      const key = normalise(link.url)
      if (seen.has(key)) continue
      let u: URL
      try {
        u = new URL(key)
      } catch {
        continue
      }
      if (whyRefused(u) !== null) continue
      if (whyNotFollowed(link) !== null) continue
      const score = overlap(terms, `${link.text} ${decodeURIComponent(u.pathname)}`)
      if (score === 0) continue
      seen.add(key)
      scored.push({
        from: page.url,
        how: looksLikeAFile(key) ? 'download' : 'read',
        link: { text: link.text, url: key },
        score,
      })
    }
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, max)
}

/** The sentences of a text that say the most about the question: pulled out, never paraphrased. */
export function extractPassages(
  text: string,
  terms: readonly string[],
  count = 2,
  maxChars = 320,
): readonly string[] {
  // Block boundaries first (textOf keeps them as newlines): a menu of links is a run of short lines, never one sentence.
  const sentences = text
    .split(/\n+/)
    .flatMap((line) =>
      line
        .replace(/\s+/g, ' ')
        .trim()
        .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/),
    )
    .map((s) => s.trim())
    .filter((s) => s.length >= 40)
  const ranked = sentences
    .map((s, i) => ({ i, s, score: overlap(terms, s) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, count)
    .sort((a, b) => a.i - b.i)
  return ranked.map((x) =>
    x.s.length > maxChars ? `${x.s.slice(0, maxChars - 1).trimEnd()}…` : x.s,
  )
}

export interface FoundPage {
  readonly documentId: string
  readonly url: string
  readonly title: string
  readonly retrievedOn: string
  readonly passages: readonly string[]
  readonly how: 'search' | 'link' | 'download'
}

/** The citation a page carries into any output: the SAVED ROW, then its words and where it is. */
export const pageSource = (p: Pick<FoundPage, 'documentId' | 'title' | 'url'>): string =>
  `browser:${p.documentId} ${p.title} (${p.url})`

/**
 * What the run says. A cited summary INPUT, not a conclusion: every claim is a passage lifted from a page that is named,
 * dated and cited, and the opening line says plainly how much was and was not read.
 */
export function composeFindings(
  question: string,
  pages: readonly FoundPage[],
  notes: readonly string[],
): string {
  if (pages.length === 0) {
    return (
      `I searched for “${question.slice(0, 160)}” and have nothing to report: ${notes.join(' ') || 'no page was readable.'} ` +
      'I have kept nothing, and I did not press anything.'
    )
  }
  const lines = pages.map((p, i) => {
    const said =
      p.passages.length === 0
        ? 'Nothing on it answered the question directly, but it is kept as a source.'
        : p.passages.map((x) => `“${x}”`).join(' ')
    return `${String(i + 1)}. ${p.title} - ${p.url} (read ${p.retrievedOn}) [browser:${p.documentId}]\n${said}`
  })
  const tail = notes.length === 0 ? '' : `\n\nNot done: ${notes.join(' ')}`
  return (
    `I looked into “${question.slice(0, 160)}” and kept ${String(pages.length)} page${pages.length === 1 ? '' : 's'} with this project. ` +
    'These are passages taken from each page as written, not my conclusions:\n\n' +
    `${lines.join('\n\n')}${tail}\n\nI only read and saved; I did not press, submit or send anything.`
  )
}
