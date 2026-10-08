/**
 * Does a message to the Chief of Staff call for the team, or does she simply answer?
 *
 * Owner decisions, 7 and 8 October 2026: selective delegation, on EVERY interface (Telegram, Slack, Team HQ, the call).
 * Claire handles routine requests directly; an explicit request for the team, a colleague named as the doer, or work that
 * genuinely needs specialist expertise or several independent workstreams may convene specialists. Without it every
 * message went through the roster: a subject lookup, up to two semantic-reading model calls, and a child job (one more
 * model call, one more answer) per specialist convened, for turns like "what is on this week" that nobody needed a
 * specialist for.
 *
 * Pure and cheap by construction: it reads his words (never a model's rewrite of them, never pasted material), so deciding
 * "routine" costs no database round trip and no model call. The decision turns on WHAT IS BEING ASKED, never on how long
 * the message is: a long pasted document may need only a summary, and four words can need a real investigation.
 *
 *   team      he named the team, or a colleague, as the doer. An instruction about who: never overridden.
 *   complex   a request (not a question) that is investigative by its nature, or that weighs options towards a
 *             recommendation, or that holds several independent workstreams.
 *   routine   everything else: questions, lookups, status, reminders, task changes, drafts, summaries, remarks.
 *
 * Biased on purpose: routine when in doubt, because Claire can always answer and "ask the team" is one sentence away,
 * while a wrongly convened team costs jobs, messages and free-tier quota. It does not choose WHO: that stays with
 * `pickRoster` once the answer here is "team" or "complex".
 */
import { type Classification, INTENT_COST } from './intent.ts'
import { withoutQuotedMaterial } from './quoted-material.ts'

export type DelegationScope = 'routine' | 'team' | 'complex'

/**
 * He asked for the team, or for people, as the doers. Whole-phrase and verb-led so that "the team's budget" or
 * "our team meeting on Friday" (a subject) is not read as an instruction to convene.
 */
const ASKS_FOR_TEAM: readonly RegExp[] = [
  /\b(?:ask|get|have|tell|brief|consult|involve|loop\s+in|bring\s+in|check\s+with|run\s+(?:this|it|that)\s+(?:by|past))\s+(?:the\s+|our\s+|all\s+(?:of\s+)?(?:the\s+|our\s+)?)?(?:team|specialists?|directors?|experts?|everyone|everybody)\b/i,
  /\b(?:i\s+want|i'?d\s+like|i\s+need|can\s+we\s+(?:get|have)|let'?s\s+get)\s+(?:the\s+|our\s+)?(?:team|specialists?|directors?|everyone)\b/i,
  /\b(?:each|all|every\s+one)\s+of\s+(?:you|the\s+(?:team|directors?|specialists?))\b/i,
  /\bteam\s+(?:input|view|opinion|take|review|meeting\s+on\s+this)\b/i,
]

const FRAME = String.raw`(?:ask|get|have|tell|brief|consult|involve|loop\s+in|bring\s+in|check\s+with|run\s+(?:this|it|that)\s+(?:by|past))`

/**
 * A colleague named, by first name or full name, as the one to ask: "Ask Emma to ...", "Get Daniel and Emma to ...".
 * Over the whole sentence because a list of names ("Daniel and Emma") is split in two by the clause reader and neither
 * half carries the frame. `names` are the active roster's display names, so a new specialist is covered the day they join.
 */
export function namesColleagueInFrame(instruction: string, names: readonly string[]): boolean {
  const firsts = names
    .map((n) => (n.trim().split(/\s+/)[0] ?? '').replace(/[^\p{L}'-]/gu, ''))
    .filter((n) => n.length >= 2)
  if (firsts.length === 0) return false
  const alt = firsts.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)).join('|')
  const re = new RegExp(
    String.raw`\b${FRAME}\s+(?:(?:${alt})\s*(?:,|\band\b|&)\s*)*(?:${alt})\b`,
    'i',
  )
  return re.test(instruction)
}

/** Investigative by its nature: the work IS finding out, and one person's quick answer is rarely the whole of it. */
const INVESTIGATIVE =
  /\b(?:research|investigate|analy[sz]e|audit|benchmark|due\s+diligence|feasibility(?:\s+study)?|stress[- ]test|root[- ]cause)\b/i

/** Weighing things up: investigative only when it is meant to end in a recommendation, or there is more than one ask. */
const WEIGHING =
  /\b(?:compare|assess|evaluate|look\s+(?:in)?to|dig\s+into|weigh\s+up|work\s+out\s+(?:what|which|how|whether|the\s+(?:best|options|alternatives))|figure\s+out\s+(?:what|which|how|whether|the\s+(?:best|options|alternatives)))\b/i

/** What a recommendation-seeking request asks to be handed back. */
const DELIVERABLE =
  /\b(?:recommend(?:ation)?s?|options|alternatives|proposal|a\s+plan|strategy|shortlist|comparison|business\s+case|what\s+(?:we|i)\s+should\s+do)\b/i

/** A workstream verb opening a clause: an independent piece of work, not a modifier of the first. */
const WORKSTREAM_OPENER =
  /^\s*(?:(?:and|then|also|plus)\s+)?(?:please\s+)?(?:research|investigate|analy[sz]e|evaluate|assess|audit|compare|draft|write|prepare|build|design|plan|review|model|forecast|summari[sz]e|find\s+out|look\s+(?:in)?to|look\s+at)\b/i

/** A sentence that asks a question rather than for work. "Can you research ..." is a request; "What is ..." is not. */
const QUESTION_OPENER =
  /^\s*(?:what|whats|what's|why|how|when|where|which|who|whom|whose|is|are|was|were|do|does|did|has|have|had|am|should|shall|will|would|could|can)\b/i
const POLITE_REQUEST =
  /^\s*(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?|please\s+|i\s+need\s+you\s+to\s+|i(?:'|’)d\s+like\s+you\s+to\s+)/i

/** Not a request for this work: a reminder or a note to himself, a negation, advice-seeking. */
const NOT_THE_WORK =
  /\b(?:remind\s+me|add\s+a\s+(?:task|to-?do)|note\s+to\s+self|put\s+(?:it|that)\s+on\s+my\s+list|don'?t|do\s+not|no\s+need\s+to|never)\b/i

const sentencesOf = (text: string): string[] =>
  text
    .split(/(?<=[.!?;])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean)

/** The sentences that ask for work (not a question, not a reminder, not a negation). */
function workRequests(text: string): string[] {
  return sentencesOf(text).filter((s) => {
    if (NOT_THE_WORK.test(s)) return false
    // "Can you research ...?" is a request in the shape of a question; "What is ...?" is a question.
    if (POLITE_REQUEST.test(s)) return true
    return !QUESTION_OPENER.test(s) && !/\?\s*$/.test(s)
  })
}

export interface ScopeInput {
  /** What he said, with nothing a model wrote. The caller passes `turn.kept`. */
  readonly instruction: string
  readonly classification: Classification
  /** How many separate asks the sentence splits into (`clauses.split`). */
  readonly asks: number
  /** A clause names a roster member in a delegation frame ("ask Emma to ..."). */
  readonly namesAColleague: boolean
}

export function delegationScope(input: ScopeInput): DelegationScope {
  // His own words, with anything he pasted taken out: an email that says "investigate" is not him asking.
  const said = withoutQuotedMaterial(input.instruction)
  if (input.namesAColleague) return 'team'
  if (ASKS_FOR_TEAM.some((re) => re.test(said))) return 'team'

  const c = input.classification
  // A deliberate remark ("fyi", "note to self") asks for nothing.
  if (c.recognised && c.intent === 'thought') return 'routine'

  const requests = workRequests(said)
  if (requests.length === 0) return 'routine'
  const body = requests.join(' ')

  if (INVESTIGATIVE.test(body)) return 'complex'
  if (WEIGHING.test(body) && (DELIVERABLE.test(body) || input.asks >= 2)) return 'complex'
  // Several independent workstreams: two or more clauses each opening with a work verb.
  const workstreams = requests
    .flatMap((s) => s.split(/\s*(?:,|;|\band\b|\bthen\b|\balso\b|\bplus\b)\s+(?=\S)/i))
    .filter((clause) => WORKSTREAM_OPENER.test(clause.replace(POLITE_REQUEST, '')))
  if (
    workstreams.length >= 2 &&
    c.confident &&
    INTENT_COST[c.intent] >= INTENT_COST.light_investigation
  )
    return 'complex'
  return 'routine'
}
