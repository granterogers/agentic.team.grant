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
  // And nor is a request for a report the office should write (#258). Same
  // rule, one artifact later: making outranks enumerating.
  if (asksForAFile(instruction.trim())) return null
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

/*
  Asking for a finished document, rather than for an answer (#258).

  Grant: *"Read the X document, research the subject properly, create a
  beautifully illustrated PDF report with the relevant information, and send it
  to me here."* The office said it had no means, and the first thing that has
  to work is recognising that this is not a question.

  The distinction that matters is between a REQUEST FOR A FILE and a request
  for prose. "Tell me where the coaching course has got to" wants three
  paragraphs on Telegram; "write me a report on where the coaching course has
  got to" wants something he can open, print and forward. Both are legitimate
  and the expensive direction here is the opposite of #260's: producing a file
  nobody asked for is a minute of compute and a document in his project, while
  answering a request for a report with a paragraph is the refusal that opened
  this Issue.

  So the match requires a FORMAT NOUN or an explicit "report" — never a bare
  verb like "write" or "produce", which govern half the things he asks for.
*/

/*
  The words for a thing you can open, as opposed to a thing you can read.

  `document` on its own is here now, behind an article (#327). It was admitted
  only as `document for`, so "write me a DOCUMENT ON where the venue thing has
  got to" — the plainest way there is to ask — matched nothing, the turn fell
  through to prose, and the office answered "I understood what you want and
  could not carry it out". A bare `document` is safe in a way a bare `summary`
  is not, and deliberately: a document IS a file, whereas "give me a summary of
  what Emma said" asks for a sentence, and answering that with a PDF would be
  the worse error in the pair.

  What keeps "the document you sent me" out is not this list — it is the
  request verb below and the you-already-made-it exclusion in `asksForAFile`.
*/
const ARTIFACT_NOUN =
  /\b(pdf|report|white\s?paper|whitepaper|one[-\s]?pager|brief(?:ing)?\s+document|document\s+for|briefing\s+note|dossier|(?:a|an|the|your|this)\s+(?:short\s+|brief\s+|quick\s+|written\s+)?(?:write[-\s]?up|document))\b/i

/** Asking for it to be MADE, as opposed to asking about one that exists. */
const MAKE_IT =
  /\b(write|create|produce|draft|generate|put\s+together|prepare|make|compile|pull\s+together)\b/i

/*
  Asking for one WITHOUT a making verb, which is how people mostly ask.

  "I want a one-pager on the venue change" was declined although `one-pager` is
  in the list above: every request form the reader had was an imperative to
  MAKE something, and wanting is not making. Measured beside the noun defect in
  the same twelve-turn session, both ending in the same sentence — the office
  understood and did nothing.

  Narrower than MAKE_IT on purpose. It only ever combines with a noun that is
  already a FILE, so "I need the numbers" and "give me a summary" are untouched.
*/
const WANTS_ONE =
  /\b(?:I(?:'|\u2019)?(?:d| would)?\s+(?:want|need|would like)|can you do me|could I have|send me|give me)\b/i

/*
  Asking for it AGAIN, because the first attempt was not what he meant (#320).

  Every verb in `MAKE_IT` is a present-tense imperative, which is how a FRESH
  request is worded. A follow-up that restates an unmet request is in the past
  tense and has no imperative in it at all:

      Grant : Write me a PDF report on where the Legacy Coaching Course is
      office: (makes one)
      Grant : Okay, that's pretty good. But what I asked for was a proper
              beautifully illustrated PDF, not just a couple of small
              paragraphs.

  The second message fell through every recogniser, so the turn answered in
  prose -- and the model, whose brief did not mention `artifact.report` at all,
  filled the gap with "I can't create a PDF directly in Telegram" and offered
  him a Notion page to export by hand. The capability half is fixed in the
  registry; this is the half that decides whether anything gets MADE.

  Not a keyword for "illustrated". The shape is the restatement, which is how a
  person says "you did the thing, but not the thing I meant" -- and the
  exclusion below still holds, so "the report you wrote yesterday" is a request
  for DELIVERY and never makes a second one.
*/
const RESTATED =
  /\b(?:(?:what|all)\s+I\s+(?:asked\s+for|wanted|meant)\s+was|I\s+(?:asked\s+for|wanted|was\s+after)\s+(?:a|an|the|proper|something)|not\s+what\s+I\s+asked\s+for)\b/i

/**
 * A request for a file, and what it should be about.
 *
 * Returns null for anything that merely mentions a report — "did you see the
 * report Elena sent" names the noun and asks for nothing — because the verb
 * has to be there too, and for a request to LIST what exists, which #260
 * already owns.
 */
export interface ArtifactRequest {
  /** The whole instruction, which is the brief. */
  readonly brief: string
  /** The format asked for, where one was named. Only `pdf` is built. */
  readonly format: 'pdf'
}

/**
 * The predicate both matchers consult, so neither can claim the other’s
 * sentence.
 *
 * Pulled out rather than having `artifactRequest` defer to `artifactListing`,
 * which is how the first version was written and which got the precedence
 * exactly backwards. "Write me a PDF report on where the course has got to,
 * using what we hold on it" contains the word "what", LISTING counts that as a
 * listing signal wherever it appears, and "report" is one of the artifact
 * kinds — so the office answered a request for a document with "Looking
 * through the notebook for report — back shortly." and made nothing.
 *
 * A cycle is why the deference was there at all. A shared predicate has no
 * cycle and states the rule once: asking for something to be MADE outranks
 * asking to SEE what exists, because the second is answerable from the
 * first’s result and not the other way round.
 */
function asksForAFile(said: string): boolean {
  if (said === '') return false
  if (!ARTIFACT_NOUN.test(said)) return false
  if (!MAKE_IT.test(said) && !RESTATED.test(said) && !WANTS_ONE.test(said)) return false
  // "Send me the report you wrote yesterday" is a delivery request, not a
  // writing one, and answering it by writing a second report is the worst
  // available outcome.
  return !/\b(you\s+(already\s+)?(wrote|made|sent|produced)|from\s+(yesterday|last\s+week))\b/i.test(
    said,
  )
}

export function artifactRequest(text: string): ArtifactRequest | null {
  const said = text.trim()
  return asksForAFile(said) ? { brief: said, format: 'pdf' } : null
}

/**
 * Asking the office to READ A PAGE (#135, #16).
 *
 * ## The capability had no door
 *
 * `browser.gather` is a registered handler with an adapter behind it, an
 * append-only ledger, a project surface, sessions in the Vault, a budget and
 * a Stop. **Nothing enqueued one.** Every other job kind reaches Grant through
 * `app.enqueue_child` from this path or a duty; browsing reached him through
 * nothing at all, so the whole tier — five migrations, two runtimes, a tab —
 * was unreachable from any sentence he could say.
 *
 * #72's defect at the top of the stack, and invisible to the check written for
 * it: `check:callers` walks database functions, and a job kind nobody enqueues
 * is not a function.
 *
 * ## The rule, and why it is two signals rather than one
 *
 * A URL alone is not a request. Grant pastes links while talking about them —
 * "we should probably move off https://example.com/pricing eventually" is a
 * remark, and reading it would spend browser-minutes, file a document he did
 * not ask for, and put a page in the project's knowledge that nobody chose.
 *
 * A reading verb alone is not one either: "read the Q3 report" is about a
 * document this office already holds, and answering it by opening the internet
 * would be absurd.
 *
 * So both, with one exception that is not a third rule but the same one: a
 * message that is ESSENTIALLY JUST A URL is a request, because there is
 * nothing else in it for it to be about. That is how a link gets shared.
 */
export interface PageRequest {
  /** The address to open. Validated as http(s) here, guarded again by the runtime. */
  readonly url: string
  /** Why, in Grant's own words, for the ledger and the Browser tab. */
  readonly because: string
  /**
   * Whether he ASKED for it to be read, or simply pasted it.
   *
   * The distinction decides which of two existing behaviours the sentence
   * gets, so it cannot live in the caller. A bare link has meant "add this to
   * the project's notebook" since `linkRequest` was written — people paste a
   * link at a colleague meaning "deal with this" — and that is a good default
   * nobody asked to change. An explicit "read this and tell me what it says"
   * is a different request: he wants the words NOW, not a source indexed for
   * later.
   */
  readonly why: 'asked' | 'bare'
}

/** The first http(s) address in a message, if there is one. */
const FIRST_URL = /\bhttps?:\/\/[^\s<>"'`)\]]+/i

/**
 * Asking for a page to be opened.
 *
 * Deliberately not `fetch`, `scrape` or `crawl`: those are the words for doing
 * it at scale, and this tier opens one page. A sentence asking to crawl a site
 * should reach a person rather than quietly become a single read.
 */
const READ_IT =
  /\b(read|open|look\s+at|have\s+a\s+look|check|take\s+a\s+look|see\s+what|what\s+does|summari[sz]e|pull\s+(up|in)|grab)\b/i

export function pageRequest(text: string): PageRequest | null {
  const said = text.trim()
  if (said === '') return null

  const found = FIRST_URL.exec(said)
  if (found === null) return null
  const url = found[0].replace(/[.,;:!?]+$/, '')

  /*
    A url that is not a web address is not this path's business. The runtime
    refuses it again — the guard there is the one that matters, because a
    gather url can also arrive from a document — but refusing it here means the
    office says "that is not a page I can open" instead of queueing a job that
    exists only to fail.
  */
  if (!/^https?:\/\//i.test(url)) return null

  // A message that is essentially just the link. Punctuation and a word or two
  // of framing ("this:", "have a look —") still count.
  const rest = said.replace(found[0], '').replace(/[^a-z]/gi, '')

  /*
    AN EXPLICIT READING VERB BEATS THE LENGTH HEURISTIC, and only inside this
    branch (#359).

    The length test used to run first and return `bare` outright, so the two
    shortest ways of asking -- which are the two commonest -- were read as
    pastes and filed to the notebook instead of opened:

      "Read https://... for me"      rest = "Readforme"   =  9
      "Take a look at https://..."   rest = "Takealookat"  = 11

    Both carry a verb that is already in READ_IT. He asked for the words now
    and got a source indexed for later, with nothing saying so.

    The override is deliberately confined to the short branch. Letting the verb
    win everywhere would turn "<link> check this out later" -- sharing, not
    asking, and 17 letters of it -- into a gather that spends the browser
    budget, because READ_IT contains a bare `check`. The long branch is
    untouched: it still falls through to `linkRequest`, which files it.
  */
  if (rest.length <= 12) {
    return READ_IT.test(said)
      ? { because: said, url, why: 'asked' }
      : { because: said, url, why: 'bare' }
  }

  return READ_IT.test(said) ? { because: said, url, why: 'asked' } : null
}
