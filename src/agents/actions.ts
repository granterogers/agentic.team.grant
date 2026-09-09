/**
 * Reading an instruction as a thing to DO rather than a thing to answer.
 *
 * Grant, in Telegram, to the Chief of Staff: *"Generate an audio overview in
 * our Google notebook for this project."* He got a paragraph describing what an
 * audio overview might contain. Everything worked except the part he asked for:
 * `office.instruction` could talk and could not act, because nothing turned an
 * English sentence into the `notebook.generate` job that already existed.
 *
 * This is that turn, and it is deliberately deterministic.
 *
 * ## Why not ask a model
 *
 * A second inference call would classify better on the tail and worse where it
 * matters. Starting an artifact is a real side effect in Grant's notebook: the
 * failure mode of a model deciding is a slide deck nobody asked for, appearing
 * because a sentence mentioned a presentation. The failure mode of a table is
 * that an unusual phrasing gets a prose answer — the behaviour we already have,
 * which is recoverable by rephrasing.
 *
 * A table is also testable. Every line below is a case in
 * `tests/agents/actions.test.ts`, which is not true of a prompt.
 *
 * ## The ambiguity that made this two lists
 *
 * "Make a report on Q3" is ordinary office work. "Make an audio overview" can
 * only mean the notebook — nothing else here produces audio. So kinds whose
 * noun is also a normal deliverable (report, quiz, study guide, flashcards,
 * infographic) require the notebook to be named; kinds that are unmistakably
 * notebook artifacts do not. Getting this wrong in the permissive direction
 * would have the team quietly stop writing reports and start generating them.
 */

/** The artifact kinds `notebook.generate` accepts. Literals, not an import: */
/** §7 keeps operational code free of the notebook module, and this is a table */
/** of words, not a dependency on an adapter. */
export type RequestedKind =
  | 'audio'
  | 'slides'
  | 'video'
  | 'mindmap'
  | 'report'
  | 'infographic'
  | 'quiz'
  | 'flashcards'
  | 'study_guide'

interface Pattern {
  readonly kind: RequestedKind
  readonly phrases: readonly RegExp[]
  /** True when the noun is also ordinary office work (see the header). */
  readonly needsNotebook: boolean
}

const PATTERNS: readonly Pattern[] = [
  {
    kind: 'audio',
    phrases: [/\baudio\s+(overview|summary)\b/, /\bpodcast\b/, /\baudio\b/],
    needsNotebook: false,
  },
  {
    kind: 'slides',
    phrases: [/\bslide\s*deck\b/, /\bslide[s]?\b/, /\bpresentation\b/, /\bdeck\b/],
    needsNotebook: false,
  },
  { kind: 'video', phrases: [/\bvideo\s+overview\b/, /\bvideo\b/], needsNotebook: false },
  { kind: 'mindmap', phrases: [/\bmind\s*map\b/], needsNotebook: false },
  { kind: 'flashcards', phrases: [/\bflash\s*cards?\b/], needsNotebook: true },
  { kind: 'study_guide', phrases: [/\bstudy\s+guide\b/], needsNotebook: true },
  { kind: 'infographic', phrases: [/\binfographic\b/], needsNotebook: true },
  { kind: 'quiz', phrases: [/\bquiz\b/], needsNotebook: true },
  { kind: 'report', phrases: [/\breport\b/], needsNotebook: true },
]

/** Asking for something to be made, rather than asking about it. */
const MAKE =
  /\b(generate|create|make|produce|build|record|put\s+together|prepare|draft|knock\s+up|whip\s+up|spin\s+up)\b/

/** Naming the notebook. Google's own product name, and what Grant calls it. */
const NOTEBOOK = /\b(notebook\s*lm|notebooklm|google\s+notebook|the\s+notebook|our\s+notebook)\b/

/**
 * A question about an artifact is not a request for one.
 *
 * "Can you make an audio overview?" is the awkward case and is treated as a
 * request: it is how people ask colleagues to do things. "What is an audio
 * overview?" and "did you make the slide deck?" are not.
 */
const ASKING_ABOUT =
  /^\s*(what|which|why|when|where|who|how\s+(do|does|did)|is\s+there|are\s+there|did|do\s+(we|you)|have\s+you|has\s+anyone)\b/i

export interface NotebookRequest {
  readonly kinds: readonly RequestedKind[]
  /** Passed to the generator verbatim, so the artifact reflects the ask. */
  readonly instructions: string
}

/**
 * The notebook artifacts an instruction asks for, in the order named.
 *
 * Empty when it asks for none — which is the common case and must stay cheap:
 * every message to every bot passes through here.
 */
/**
 * A brief is not a request for one artifact.
 *
 * Grant sent a twenty-five-line instruction about populating a Notion teamspace
 * from a notebook. It contained the word "create" and, inside a parenthesis
 * listing things to fetch, the phrase "audio overviews". Both patterns matched,
 * and the whole brief became a single request to generate an audio overview —
 * in the wrong project.
 *
 * The table below is a good way to read *"make an audio overview"*. It has no
 * way to tell whether the phrase is the request or one clause of twenty, and
 * that is what these two guards are for.
 *
 * Counted rather than judged: bullet lines and sentences are things a regex can
 * be wrong about in only one direction, and a long instruction misread as a
 * conversation is recoverable — it gets planned or answered — while a long
 * instruction misread as one artifact starts something nobody asked for.
 */
const looksLikeABrief = (instruction: string): boolean => {
  const bullets = (instruction.match(/^\s*(?:[-*•]|\d+[.)])\s+\S/gm) ?? []).length
  const sentences = (instruction.match(/[.!?](?:\s|$)/g) ?? []).length
  const lines = instruction.split('\n').filter((l) => l.trim() !== '').length
  return bullets >= 3 || sentences >= 6 || lines >= 8
}

/**
 * Named as an example rather than asked for.
 *
 * *"pull the files it has generated (audio overviews and the like)"* mentions
 * an audio overview; it does not ask for one. The tell is the company the
 * phrase keeps — a parenthesis, or one of the words English uses to introduce
 * an example.
 *
 * Only the 60 characters before the phrase are examined. A "such as" four
 * sentences earlier is about something else.
 */
const AS_AN_EXAMPLE = /(?:\(|\bsuch as\b|\blike\b|\bincluding\b|\be\.g\.|\bfor example\b|\bany\b)[^)]{0,60}$/i

const mentionedNotAsked = (text: string, at: number): boolean =>
  AS_AN_EXAMPLE.test(text.slice(Math.max(0, at - 60), at))

export function notebookRequest(instruction: string): NotebookRequest | null {
  const text = instruction.toLowerCase()
  if (ASKING_ABOUT.test(instruction)) return null
  if (!MAKE.test(text)) return null
  // A brief goes to planning or to a person, never to the artifact table.
  if (looksLikeABrief(instruction)) return null

  const named = NOTEBOOK.test(text)
  const found: { kind: RequestedKind; at: number }[] = []
  for (const pattern of PATTERNS) {
    if (pattern.needsNotebook && !named) continue
    for (const phrase of pattern.phrases) {
      const match = phrase.exec(text)
      if (match !== null) {
        if (mentionedNotAsked(text, match.index)) continue
        found.push({ kind: pattern.kind, at: match.index })
        break
      }
    }
  }
  if (found.length === 0) return null

  // Ordered as Grant said them: *"generate an audio overview… and a slide
  // deck"* should start the audio first, and the confirmation should read in
  // the order he asked.
  found.sort((a, b) => a.at - b.at)
  return { kinds: found.map((f) => f.kind), instructions: instruction.trim() }
}

/** What to call a kind in a sentence to a person. */
export const KIND_LABEL: Record<RequestedKind, string> = {
  audio: 'audio overview',
  slides: 'slide deck',
  video: 'video overview',
  mindmap: 'mind map',
  report: 'report',
  infographic: 'infographic',
  quiz: 'quiz',
  flashcards: 'flashcard set',
  study_guide: 'study guide',
}
