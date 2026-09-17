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

/*
  Plurals matter more than they look.

  Every phrase below takes an optional `s`, because #260's questions are almost
  always plural — "all the mind maps", "the study guides" — and `\bmind\s*map\b`
  does not match "mind maps": the boundary after "map" fails against the "s".
  It cost one test on the first run of `artifactListing`, and it was equally
  true of the generation matcher the whole time ("make me some mind maps" named
  nothing).
*/
const PATTERNS: readonly Pattern[] = [
  {
    kind: 'audio',
    phrases: [/\baudio\s+(overview|summary)s?\b/, /\bpodcasts?\b/, /\baudio\b/],
    needsNotebook: false,
  },
  {
    kind: 'slides',
    phrases: [/\bslide\s*decks?\b/, /\bslide[s]?\b/, /\bpresentations?\b/, /\bdecks?\b/],
    needsNotebook: false,
  },
  { kind: 'video', phrases: [/\bvideo\s+overviews?\b/, /\bvideos?\b/], needsNotebook: false },
  { kind: 'mindmap', phrases: [/\bmind\s*maps?\b/], needsNotebook: false },
  { kind: 'flashcards', phrases: [/\bflash\s*cards?\b/], needsNotebook: true },
  { kind: 'study_guide', phrases: [/\bstudy\s+guides?\b/], needsNotebook: true },
  { kind: 'infographic', phrases: [/\binfographics?\b/], needsNotebook: true },
  { kind: 'quiz', phrases: [/\bquiz(?:zes)?\b/], needsNotebook: true },
  { kind: 'report', phrases: [/\breports?\b/], needsNotebook: true },
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
const AS_AN_EXAMPLE =
  /(?:\(|\bsuch as\b|\blike\b|\bincluding\b|\be\.g\.|\bfor example\b|\bany\b)[^)]{0,60}$/i

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

/*
  Asking what a notebook HAS, rather than asking for a new one (#260).

  Grant's example: *"Give me all the audio overviews in the Money Mastery
  notebook."*

  `notebookRequest` above deliberately answers null to that — `ASKING_ABOUT`
  and the absence of a MAKE verb both rule it out, and they are right to: it
  would be alarming if asking what exists generated something. But nothing then
  handled it, so the question fell through to an ordinary conversation turn and
  was answered from whatever the model happened to believe.

  This is the other half. It is deliberately NOT the inverse of the generation
  matcher: a listing request has its own verbs, and the overlap — "can you get
  me the audio overview" — is read as a listing, because listing is the
  reversible one. Listing something that was not there says "there are none";
  generating something that was only asked about spends a quota and puts a file
  in his notebook.
*/

/** Asking to see what is there. */
const LISTING =
  /\b(list|show|give\s+me|send\s+me|fetch|find|what|which|are\s+there|do\s+we\s+have|have\s+we\s+got|any)\b/i

/**
 * Plural or otherwise asking for a SET.
 *
 * "the audio overview" is one thing, probably the one just made; "the audio
 * overviews" is the library. Both are answered by enumerating, so this is not
 * a gate — it is recorded so a caller can phrase the reply in the right
 * number.
 */
const ASKS_FOR_MANY = /\b(all|every|each|list|overviews|decks|maps|reports|guides|sets)\b/i

export interface ArtifactListingRequest {
  /** The kinds asked about. Empty means every kind — "what has it generated?" */
  readonly kinds: readonly RequestedKind[]
  /** True when the phrasing asks for a set rather than one thing. */
  readonly many: boolean
}

/**
 * What a listing question is asking for, or null when it is not one.
 *
 * Null far more often than not: a generation request, a definition question
 * and an ordinary sentence all come back null, and each has its own control in
 * the tests.
 */
export function artifactListing(instruction: string): ArtifactListingRequest | null {
  const text = instruction.toLowerCase()

  // A request to MAKE one is not a request to see them, whatever else it says.
  if (notebookRequest(instruction) !== null) return null
  if (!LISTING.test(text)) return null
  // A brief is not a question. Same guard, same reason as above.
  if (looksLikeABrief(instruction)) return null

  /*
    A definition question is not a listing.

    "What IS an audio overview?" asks what the thing is; "What audio overviews
    are there?" asks which exist. The tell is the verb immediately after the
    interrogative, and getting it wrong in this direction costs a list nobody
    wanted in answer to a question about a word.
  */
  if (/\bwhat\s+(is|are)\s+(an?|the)\b/i.test(instruction)) return null

  const found: { kind: RequestedKind; at: number }[] = []
  for (const pattern of PATTERNS) {
    for (const phrase of pattern.phrases) {
      const m = phrase.exec(text)
      if (m === null) continue
      if (mentionedNotAsked(text, m.index)) continue
      found.push({ kind: pattern.kind, at: m.index })
      break
    }
  }

  /*
    No kind named, and the notebook named: "what has the notebook generated?"
    is a legitimate listing of everything, and answering it with nothing
    because no type word appeared would be the literal-matcher failure this
    repository keeps paying for.
  */
  if (found.length === 0) {
    return NOTEBOOK.test(text) && /\b(generated|made|produced|artefacts?|artifacts?)\b/i.test(text)
      ? { kinds: [], many: true }
      : null
  }

  return {
    kinds: [...new Set(found.sort((a, b) => a.at - b.at).map((f) => f.kind))],
    many: ASKS_FOR_MANY.test(text),
  }
}
