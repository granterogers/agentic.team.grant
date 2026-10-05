/**
 * Which document does "the latest customer research report" mean?
 *
 * "Find the latest customer research report and turn it into a beautiful PDF" names a SOURCE by description. The
 * office used to search the whole project for the sentence and write from whatever matched; this resolves the one
 * document, deterministically, and says so when it cannot - because picking the wrong "latest report" and making it
 * beautiful is a confident wrong answer, and asking which one is a sentence.
 *
 * ## Over logical items, never over rows
 *
 * The candidates are `app.hq_project_documents` - one item per LOGICAL document. A superseded version is not in that
 * list (its head is), an archived or unapproved one is not in it, and another project's document is not in it, so the
 * three negative controls are properties of the list this reads, and the database proof drives them against real rows.
 * Nothing here reads a document's text and nothing spends a model call.
 *
 * ## The rule, in order
 *
 *   1. Every content word of the phrase must be looked for in the title (3 points) and the tags (2). A document that
 *      matches no content word is not a candidate at all: recency alone never picks a document.
 *   2. A document type (pdf, doc, a Google document, a note) is preferred to audio, images and the rest, and a title
 *      carrying the type word the phrase named ("report") beats one that does not.
 *   3. Recency decides only among documents that matched equally - and only when the phrase asked for the latest.
 *   4. Two within a margin, with nothing to separate them, is AMBIGUOUS and the caller asks.
 */

import type { SqlExecutor } from '../db/executor.ts'

export interface SourceItem {
  readonly id: string
  readonly title: string
  readonly kind: string
  readonly origin: string
  readonly mime: string | null
  readonly tags: readonly string[]
  readonly modifiedAt: string | null
  readonly addedAt: string | null
}

export interface Candidate {
  readonly id: string
  readonly title: string
  readonly score: number
  readonly modifiedAt: string | null
}

export type Resolution =
  | {
      readonly status: 'resolved'
      readonly document: Candidate
      readonly others: readonly Candidate[]
    }
  | { readonly status: 'ambiguous'; readonly candidates: readonly Candidate[] }
  | { readonly status: 'none'; readonly candidates: readonly Candidate[] }

const STOP = new Set([
  'a',
  'an',
  'the',
  'my',
  'our',
  'your',
  'this',
  'that',
  'those',
  'these',
  'of',
  'for',
  'and',
  'on',
  'in',
  'to',
  'latest',
  'newest',
  'recent',
  'most',
  'last',
  'current',
  'new',
  'one',
  'version',
])
const RECENT = /\b(latest|newest|most\s+recent|last|current|newly)\b/i
/** The words that name a KIND of document: they prefer a title carrying them, but never match on their own. */
const TYPE_WORDS = new Set([
  'report',
  'document',
  'doc',
  'paper',
  'brief',
  'study',
  'analysis',
  'summary',
  'memo',
  'proposal',
  'plan',
  'survey',
  'findings',
  'writeup',
  'notes',
  'deck',
])
/** Kinds worth reading from: a person's "report" is never a recording. */
const READABLE = new Set([
  'pdf',
  'doc',
  'google-doc',
  'note',
  'sheet',
  'slides',
  'text',
  'markdown',
])

const stem = (w: string): string => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w)

export const wordsOf = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/write[-\s]?up/g, 'writeup')
    .split(/[^a-z0-9]+/)
    .filter((w) => w !== '')
    .map(stem)

/** The margin (in points) inside which two documents are indistinguishable by their words. */
export const MARGIN = 0.75
/** Recency separates two equal matches only when one is at least this much newer. */
export const RECENCY_GAP_MS = 60 * 60 * 1000

const stamp = (i: SourceItem): number => {
  const t = Date.parse(i.modifiedAt ?? i.addedAt ?? '')
  return Number.isFinite(t) ? t : 0
}

export interface Ranked extends Candidate {
  readonly matched: number
}

/** Score the items against a phrase. Pure; items with no matched content word are returned with matched 0. */
export function rankDocuments(items: readonly SourceItem[], phrase: string): readonly Ranked[] {
  const all = wordsOf(phrase).filter((w) => !STOP.has(w))
  const content = all.filter((w) => !TYPE_WORDS.has(w))
  const types = all.filter((w) => TYPE_WORDS.has(w))
  return items
    .map((item): Ranked => {
      const title = new Set(wordsOf(item.title))
      const tags = new Set(item.tags.flatMap((t) => wordsOf(t)))
      let score = 0
      let matched = 0
      for (const w of content) {
        if (title.has(w)) {
          score += 3
          matched += 1
        } else if (tags.has(w)) {
          score += 2
          matched += 1
        }
      }
      // A phrase that is ONLY a type word ("the report") matches on the type itself.
      if (content.length === 0) {
        for (const w of types) {
          if (title.has(w)) {
            score += 3
            matched += 1
          }
        }
      }
      if (matched > 0) {
        if (READABLE.has(item.kind)) score += 1
        else if (['audio', 'video', 'image'].includes(item.kind)) score -= 1
        for (const w of types) if (title.has(w)) score += 1
        if (item.origin === 'made') score -= 0.5 // the office's own earlier output is a last resort as a SOURCE
      }
      return { id: item.id, matched, modifiedAt: item.modifiedAt, score, title: item.title }
    })
    .sort((a, b) => b.score - a.score || stampOf(b, items) - stampOf(a, items))
}

const stampOf = (c: Candidate, items: readonly SourceItem[]): number => {
  const i = items.find((x) => x.id === c.id)
  return i === undefined ? 0 : stamp(i)
}

const plain = (r: Ranked): Candidate => ({
  id: r.id,
  modifiedAt: r.modifiedAt,
  score: r.score,
  title: r.title,
})

/** Decide among the ranked items. Pure. */
export function decide(items: readonly SourceItem[], phrase: string): Resolution {
  const ranked = rankDocuments(items, phrase)
  const hits = ranked.filter((r) => r.matched > 0)
  if (hits.length === 0) {
    // Nothing matched: offer what the project holds that could be a report, so the question has something in it.
    const offer = items
      .filter((i) => READABLE.has(i.kind) && i.origin !== 'made')
      .sort((a, b) => stamp(b) - stamp(a))
      .slice(0, 5)
      .map((i) => ({ id: i.id, modifiedAt: i.modifiedAt, score: 0, title: i.title }))
    return { candidates: offer, status: 'none' }
  }
  const top = hits[0] as Ranked
  const tied = hits.filter((h) => top.score - h.score <= MARGIN)
  if (tied.length === 1) {
    return { document: plain(top), others: hits.slice(1, 4).map(plain), status: 'resolved' }
  }
  if (RECENT.test(phrase)) {
    const byTime = [...tied].sort((a, b) => stampOf(b, items) - stampOf(a, items))
    const newest = byTime[0] as Ranked
    const next = byTime[1] as Ranked
    if (stampOf(newest, items) - stampOf(next, items) >= RECENCY_GAP_MS) {
      return {
        document: plain(newest),
        others: hits
          .filter((h) => h.id !== newest.id)
          .slice(0, 3)
          .map(plain),
        status: 'resolved',
      }
    }
  }
  return { candidates: tied.slice(0, 5).map(plain), status: 'ambiguous' }
}

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

const asItem = (raw: Record<string, unknown>): SourceItem | null => {
  if (typeof raw.id !== 'string' || typeof raw.title !== 'string') return null
  return {
    addedAt: typeof raw.added_at === 'string' ? raw.added_at : null,
    id: raw.id,
    kind: typeof raw.kind === 'string' ? raw.kind : 'other',
    mime: typeof raw.mime === 'string' ? raw.mime : null,
    modifiedAt: typeof raw.modified_at === 'string' ? raw.modified_at : null,
    origin: typeof raw.origin === 'string' ? raw.origin : 'source',
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === 'string') : [],
    title: raw.title,
  }
}

/** The project's logical documents, as the Documents module lists them. Throws on a refusal: a caller decides. */
export async function projectItems(
  db: SqlExecutor,
  where: { readonly office: string; readonly project: string },
): Promise<readonly SourceItem[]> {
  const { rows } = await db.execute(
    `select app.hq_project_documents(${lit(where.office)}::uuid, ${lit(where.project)}) as r`,
  )
  const raw = rows[0]?.r
  const parsed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as {
    documents?: unknown
    error?: unknown
  } | null
  if (parsed === null || typeof parsed !== 'object' || !Array.isArray(parsed.documents)) {
    throw new Error(
      typeof parsed?.error === 'string' ? parsed.error : 'the document list could not be read',
    )
  }
  return (parsed.documents as Record<string, unknown>[])
    .map(asItem)
    .filter((i): i is SourceItem => i !== null)
}

export async function resolveSourceDocument(
  db: SqlExecutor,
  where: { readonly office: string; readonly project: string; readonly phrase: string },
): Promise<Resolution> {
  return decide(await projectItems(db, where), where.phrase)
}

// --- recognising a named source in a request ----------------------------------------------------------------------

const DOC_NOUN =
  /\b(report|document|doc|paper|brief|study|analysis|summary|memo|proposal|plan|survey|findings|write[-\s]?up|notes|deck|research)\b/i

const clean = (v: string): string =>
  v
    .replace(
      /\s+(?:into|as|in|to|for|so|which|that)\s+(?:a|an|the)?\s*(?:\w+\s+){0,3}(?:pdf|report|document|one[-\s]?pager)\b.*$/i,
      '',
    )
    .replace(/[.,;:!?]+$/, '')
    .trim()

/**
 * The description of the document a request names, or null when it names none.
 *
 * "Make a beautiful PDF of the latest customer research report" names one; "write me a report on where the course has
 * got to" names a TOPIC, and answering it by hunting for a document called that would be the wrong reading. So a phrase
 * counts as a source only when it carries a document noun or an explicit "latest", and null falls through to the
 * ordinary retrieve-and-write path.
 */
export function sourcePhrase(text: string): string | null {
  const said = text.replace(/\s+/g, ' ').trim()
  const attempts: RegExp[] = [
    /\b(?:find|get|fetch|open|read|grab|locate|take|use|pull\s+up)\s+(.{3,120}?)\s+(?:and|then)\s+(?:turn|make|convert|put|write|create|produce|render|save)\b/i,
    /\b(?:turn|convert|make|put|render|rework|redo)\s+(.{3,120}?)\s+(?:into|as)\s+(?:a|an)\s/i,
    /\b(?:pdf|report|version|write[-\s]?up|document)\s+(?:of|from|for)\s+(.{3,120})$/i,
    /\b(?:based\s+on|using|from)\s+(.{3,120})$/i,
  ]
  for (const re of attempts) {
    const m = re.exec(said)
    const phrase = m?.[1] === undefined ? '' : clean(m[1])
    if (phrase === '') continue
    const content = wordsOf(phrase).filter((w) => !STOP.has(w))
    if (content.length === 0) continue
    if (DOC_NOUN.test(phrase) || RECENT.test(phrase)) return phrase
  }
  return null
}

/**
 * Whether a request is asking for an EARLIER artifact to be done again (a new version), as opposed to a first one.
 * Only unambiguous verbs: "update the report" can be "tell me about the report".
 */
export const REVISES =
  /\b(revise|redo|re-?do|rework|redesign|regenerate|remake|another\s+(?:version|go|pass)|new\s+version|second\s+version|version\s+(?:2|two|3|three))\b/i

export const revisesEarlier = (text: string): boolean => REVISES.test(text)
