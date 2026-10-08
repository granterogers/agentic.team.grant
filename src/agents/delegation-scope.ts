/**
 * Does a message typed to the Chief of Staff on Telegram call for the team, or does she simply answer?
 *
 * Owner decision, 7 October 2026: selective delegation. Claire handles routine requests directly; an explicit request for
 * the team, or genuinely complex work, may convene specialists. Without it every message typed to the chief's bot went
 * through the roster: a subject lookup, up to two semantic-reading model calls, and a child job (one more model call, one
 * more answer) per specialist convened, for turns like "what is on this week" that nobody needed a specialist for.
 *
 * Pure and cheap by construction: it reads the words and the number of separate asks, nothing else, so deciding
 * "routine" costs no database round trip and no model call. A wrong call in either direction is recoverable and is
 * deliberately biased:
 *
 *   - routine when in doubt. Claire can always answer, and a specialist is one sentence away ("ask the team ...");
 *   - team when he NAMES the team or a colleague as the one to do it, because that is an instruction about who, and the
 *     one thing this decision must never do is override it.
 *
 * It does not choose WHO. That stays with `pickRoster` once the answer here is "team" or "complex".
 */
import { type Classification, INTENT_COST } from './intent.ts'

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

/** Long enough that one person's quick answer is unlikely to be the whole job. */
export const COMPLEX_MIN_CHARS = 240

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

export interface ScopeInput {
  readonly instruction: string
  readonly classification: Classification
  /** How many separate asks the sentence splits into (`clauses.split`). */
  readonly asks: number
  /** A clause names a roster member in a delegation frame ("ask Emma to ..."). */
  readonly namesAColleague: boolean
}

export function delegationScope(input: ScopeInput): DelegationScope {
  if (input.namesAColleague) return 'team'
  if (ASKS_FOR_TEAM.some((re) => re.test(input.instruction))) return 'team'
  const c = input.classification
  const worth = c.confident && INTENT_COST[c.intent] >= INTENT_COST.light_investigation
  if (worth && input.asks >= 2) return 'complex'
  // A long brief reads as contested more often than not (several verbs); it is still work, so recognition is enough here.
  // `pickRoster` still caps a contested reading at one specialist, so this widens who MAY be asked, never how many.
  const longWork =
    c.recognised &&
    INTENT_COST[c.intent] >= INTENT_COST.light_investigation &&
    input.instruction.length >= COMPLEX_MIN_CHARS
  if (longWork) return 'complex'
  return 'routine'
}
