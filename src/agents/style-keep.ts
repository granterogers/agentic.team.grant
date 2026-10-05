/**
 * "Use this report's style for this project." (HQ-STYLE-018)
 *
 * The press exists (0970, `app.style_adopt_from_document`, the viewer's button). This is the other door onto the SAME
 * move: a person says it, and the conversation works out which report is meant. Two decisions live here and both are
 * pure so they can be tested without a database:
 *
 *   1. `styleKeepRequest` - did he ask for a report's style to be kept as the project's? It permits a write, so it
 *      takes `HumanWords` and is reached only through `entitled` (a forwarded message is silent, and the model's
 *      paraphrase of his words does not compile as an argument).
 *   2. `chooseStyleSource` - which report does "this one" mean? Never guessed: one plausible report is used, several
 *      are ASKED about, none is said.
 *
 * ## Why it is narrow, and in which direction
 *
 * A false positive here is not destructive - replacing a project's existing style still asks first - but it would
 * answer a request for something else ("save this as a PDF", "use a different style") with a style saved, which is
 * the wrong thing done confidently. A miss costs him one sentence. So the reader wants three things at once: a verb
 * that keeps or uses, a style word (style, design, look, format, layout, template), and a SOURCE that is a report
 * he is pointing at (this, that, or one he names) - and for the verbs that also mean other things ("use", "make",
 * "set") it wants the project or the future named as well. Anything that changes, compares or negates is refused.
 */

import { sentencesOf } from './sentences.ts'
import type { HumanWords } from './turn.ts'

export interface StyleKeep {
  /** Words that name one particular report ("pricing" from "the pricing report's style"), or null for "this one". */
  readonly hint: string | null
  /** The whole message was this request. When false the rest of it is NOT done and the reply must say so. */
  readonly onlyThat: boolean
}

const STYLE = String.raw`(?:style|design|look|format|layout|template)`
const LEAD = String.raw`^(?:(?:ok|okay|right|so|now|and|also|then|please|thanks|thank you|great|lovely|perfect)[, ]+)*(?:(?:(?:can|could|would|will) you|you (?:should|can|could)|i(?:'d| would) like you to|i want you to|let's)\s+(?:please\s+)?|please\s+)?`
const SAFE_VERB = String.raw`(?:save|keep|adopt|remember|store)`
const NEEDS_SCOPE_VERB = String.raw`(?:use|make|set)`
// Where the style comes from: this/that report, or one he names.
const O1 = String.raw`(?:this|that)(?: (?:report|document|pdf|one))?(?:'s)? ${STYLE}\b`
const O2 = String.raw`the ${STYLE} (?:of|from|used (?:in|for|on)) (?:this|that|the ([a-z0-9' -]{1,50}?)) ?(?:report|document|pdf)?\b`
const O3 = String.raw`the ([a-z0-9' -]{1,50}?) (?:report|document|pdf)(?:'s)? ${STYLE}\b`
const O4 = String.raw`(?:this|that|it)(?: report)? (?:as |the |our |my )(?:the |our |my )?(?:project|default)\b(?: report)?(?: ${STYLE})?`
const SOURCE = String.raw`(?:${O1}|${O2}|${O3}|${O4})`
const SCOPE = String.raw`(?:(?:for|in|on|across|to) (?:this|the|our|my) project\b|(?:for|in|on) (?:all |any |every )?(?:future|new|upcoming|later|next|further|my|our)\b[a-z ]{0,12}?\breports?\b|(?:as )?the (?:project|default)(?: report)? ${STYLE}\b|(?:as )?(?:the )?default\b|going forward|from now on)`

const RE_SAFE = new RegExp(`${LEAD}${SAFE_VERB}\\b.*?\\b${SOURCE}`)
const RE_SCOPED = new RegExp(`${LEAD}${NEEDS_SCOPE_VERB}\\b.*?\\b${SOURCE}`)
const RE_SCOPE = new RegExp(SCOPE)
const RE_LIKE = new RegExp(
  String.raw`^(?:(?:ok|okay|so|and|also|right|well)[, ]+)*(?:i )?(?:really |quite |do )?(?:like|love|prefer|want)(?: how| what)? (?:this|that|the)\b.{0,50}?\b${STYLE}\b`,
)
const RE_USE_IT = new RegExp(
  `${LEAD}(?:use|keep|save|adopt|apply) (?:it|this|that|them)\\b.*${SCOPE}`,
)

const REFUSED_SHAPES: readonly RegExp[] = [
  // a negation or a withdrawal
  /\b(?:don'?t|do not|never|stop|without|no longer|not|cancel)\b/,
  // a change to the style, a comparison, or a different one - not keeping this one
  /\b(?:but|except|unless|different|another|other|instead|change|swap|replace|tweak|edit|redo|redesign|bigger|larger|smaller|bolder|darker|lighter|brighter|shorter|longer|compare|versus|vs)\b/,
  // making a NEW style is not keeping this one
  new RegExp(String.raw`\bnew ${STYLE}\b`),
  // a question about how, not a request
  /^(?:how|what|why|where|when|which|who|does|do|is|are|should|can i|could i|will it|would it)\b/,
]
const POLITE = /^(?:(?:ok|okay|so|and|also|please)[, ]+)*(?:can|could|would|will) you\b/

const straighten = (s: string): string =>
  s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase()

const refusedClause = (clause: string, raw: string): boolean => {
  if (/\?\s*$/.test(raw) && !POLITE.test(clause)) return true
  return REFUSED_SHAPES.some((re) => re.test(clause))
}

const FILLER =
  /^(?:(?:ok|okay|yes|thanks|thank you|please|great|lovely|perfect|cheers|brilliant)[ ,!]*)+$/

const NOT_A_NAME = new Set([
  'this',
  'that',
  'last',
  'latest',
  'previous',
  'recent',
  'new',
  'pdf',
  'current',
  'same',
  'first',
  'one',
  'other',
  'a',
  'an',
  'the',
  'my',
  'our',
])

const hintFrom = (name: string | undefined): string | null => {
  if (name === undefined) return null
  const words = name
    .split(/\s+/)
    .map((w) => w.replace(/^'+|'+$/g, ''))
    .filter((w) => w !== '' && !NOT_A_NAME.has(w))
  return words.length === 0 ? null : words.join(' ')
}

/** Did he ask for a report's style to be kept as the project's? Reached only through `entitled`. */
export function styleKeepRequest(words: HumanWords): StyleKeep | null {
  const rawClauses = sentencesOf(words).flatMap((s) => s.split(/\s[—–-]{1,2}\s|;\s+/))
  let hint: string | null = null
  let found = false
  let other = false
  let liked = false

  for (const raw of rawClauses) {
    const clause = straighten(raw).replace(/[.!?]+$/, '')
    if (clause === '') continue
    if (RE_LIKE.test(clause) && !refusedClause(clause, raw)) {
      liked = true
      continue
    }
    if (refusedClause(clause, raw)) {
      other = true
      continue
    }
    const safe = RE_SAFE.exec(clause)
    const scoped = RE_SCOPED.exec(clause)
    const hit =
      safe !== null
        ? safe
        : scoped !== null && (RE_SCOPE.test(clause) || new RegExp(O4).test(clause))
          ? scoped
          : null
    if (hit !== null) {
      found = true
      // The named report, from whichever source form carried a group.
      hint = hint ?? hintFrom(hit[1]) ?? hintFrom(hit[2])
      // "...for this project and create tasks for the venue": something else was asked in the same breath.
      const after = clause
        .slice(hit.index + hit[0].length)
        .replace(new RegExp(SCOPE, 'g'), ' ')
        .trim()
      if (/\b(?:and|then|also|plus|while)\b\s+\S/.test(after)) other = true
      continue
    }
    // "I like this design - use it for future reports in this project": the second clause names no style itself.
    if (liked || rawClauses.some((c) => RE_LIKE.test(straighten(c)))) {
      for (const part of clause.split(/,\s+/)) {
        if (RE_USE_IT.test(part) && !refusedClause(part, raw)) {
          found = true
          break
        }
      }
      if (found) continue
    }
    if (!FILLER.test(clause)) other = true
  }

  // "I like this design, use it for future reports" in a single clause (a comma, no dash).
  if (!found) {
    for (const raw of rawClauses) {
      const parts = straighten(raw).split(/,\s+/)
      if (parts.length > 1 && RE_LIKE.test(parts[0] ?? '')) {
        const rest = parts.slice(1).join(', ')
        if (RE_USE_IT.test(rest) && !refusedClause(rest, raw)) {
          found = true
          other = rawClauses.length > 1 && other
        }
      }
    }
  }
  return found ? { hint, onlyThat: !other } : null
}

// ---------------------------------------------------------------------------------------------------------------------
// which report?
// ---------------------------------------------------------------------------------------------------------------------

export interface StyleSourceCandidate {
  readonly documentId: string
  readonly title: string
  readonly createdAt: string
  /** This conversation produced it. */
  readonly inThread: boolean
  /** A style was recorded when it was made (0970); one made before that has nothing to save. */
  readonly hasSnapshot: boolean
}

export type StyleSourceChoice =
  | { readonly kind: 'one'; readonly candidate: StyleSourceCandidate }
  | {
      readonly kind: 'ask'
      readonly candidates: readonly StyleSourceCandidate[]
      readonly why: 'several_in_thread' | 'several_in_project' | 'hint_matches_several'
    }
  | { readonly kind: 'none'; readonly why: 'no_reports' | 'hint_matches_none' }

const tokens = (s: string): string[] =>
  straighten(s)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1)

/**
 * "This report" is the made report this conversation produced; failing that, the only report the project has.
 * A name narrows. Two or more plausible reports are ASKED about, never chosen: the cost of asking is one sentence,
 * and the cost of choosing wrongly is a project whose reports are all set in the wrong style.
 */
export function chooseStyleSource(
  candidates: readonly StyleSourceCandidate[],
  hint: string | null,
): StyleSourceChoice {
  const seen = new Set<string>()
  const all = candidates.filter((c) => (seen.has(c.documentId) ? false : !!seen.add(c.documentId)))
  if (all.length === 0) return { kind: 'none', why: 'no_reports' }

  if (hint !== null) {
    const want = tokens(hint)
    const matched = all.filter((c) => {
      const have = new Set(tokens(c.title))
      return want.length > 0 && want.every((t) => have.has(t))
    })
    if (matched.length === 0) return { kind: 'none', why: 'hint_matches_none' }
    const only = matched[0]
    if (matched.length === 1 && only !== undefined) return { kind: 'one', candidate: only }
    return { kind: 'ask', candidates: matched, why: 'hint_matches_several' }
  }

  const here = all.filter((c) => c.inThread)
  const firstHere = here[0]
  if (here.length === 1 && firstHere !== undefined) return { kind: 'one', candidate: firstHere }
  if (here.length > 1) return { kind: 'ask', candidates: here, why: 'several_in_thread' }
  const first = all[0]
  if (all.length === 1 && first !== undefined) return { kind: 'one', candidate: first }
  return { kind: 'ask', candidates: all, why: 'several_in_project' }
}
