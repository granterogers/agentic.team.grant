/**
 * What the office tells Hermes before it starts (INTERFACE-CONTRACTS section 8.4), and the conversation it hands over.
 *
 * Pure: no database, no ambient scope. The caller reads the person's name, project, standing rules and conversation and passes them in,
 * so this file can be tested without a job and imported by the bridge host kit if it ever needs the same words.
 *
 * Two rules shape it. (1) The brief is the only place Hermes learns what it may and may not do in the office's name, and it is a request,
 * not a barrier: the barrier is the tool gate and the read-only list (M3), so nothing here is relied on for safety. (2) The person's
 * standing rules go in as written, never summarised: a paraphrase of somebody's own instruction read back at them is worse than nothing.
 *
 * No message in this file may carry an issue number or a section mark: a model reads these words and repeats them.
 */
import { LIMITS } from './timing.ts'

/** What Hermes can do in v1, in words. The office's read tools are the only door. */
export const CAN_DO: readonly string[] = [
  "look things up in the office's records with the read-only office tools: projects, tasks, documents, calendar, recent work",
  'reason over what those tools return and what you are told in this conversation',
]

/** What Hermes cannot do in v1. Said plainly so it says so, instead of pretending. */
export const CANNOT_DO: readonly string[] = [
  'create or change anything in the office (tasks, documents, projects, settings)',
  'contact anyone, send anything, or speak for the person to anybody else',
  'browse the web, run code, or read files on any computer',
]

export interface BriefInput {
  /** The person this office works for (`currentPerson().name`). */
  readonly person: string
  readonly project: { readonly name: string; readonly slug: string } | null
  /** `projectSpine(...)`: the open projects as one sentence. The first thing cut when the brief is long. */
  readonly projectSpine: string
  /** Standing rules the PERSON gave, as written. Rules a specialist inferred are beliefs, not orders, and are not passed. */
  readonly standingRules: readonly string[]
  /** `provenanceNote()`. */
  readonly provenanceNote: string
  readonly canDo: readonly string[]
  readonly cannotDo: readonly string[]
}

/** One rule is cut here; eight of them fit well inside the bound. */
const RULE_CHARS = 600
const MAX_RULES = 8

const cut = (text: string, limit: number): string => {
  if (text.length <= limit) return text
  if (limit <= 1) return ''
  const head = text.slice(0, limit - 1)
  const space = head.lastIndexOf(' ')
  return `${(space > limit * 0.6 ? head.slice(0, space) : head).trimEnd()}…`
}

/** The brief, at most `LIMITS.instructions` characters. The project spine is cut first, and entirely if there is no room for it. */
export function hermesBrief(input: BriefInput): string {
  const who =
    `You are answering ${input.person}, in a private chat, on behalf of the office that works for them. ` +
    'You are not a member of the office’s team and must not describe yourself as one or speak as one of them; ' +
    'you are an outside assistant the office has handed this message to.'
  const where =
    input.project === null
      ? 'No single project is in focus for this message.'
      : `The project in focus is ${input.project.name}. Read its records with the office tools when the question is about it.`
  const rules = input.standingRules
    .map((r) => r.trim())
    .filter((r) => r !== '')
    .slice(0, MAX_RULES)
  const rulesBlock =
    rules.length === 0
      ? ''
      : `${input.person} has given these standing instructions. Follow them exactly as written:\n${rules
          .map((r) => `- ${cut(r, RULE_CHARS)}`)
          .join('\n')}`
  const limits =
    `Here is what you can do: ${input.canDo.join('; ')}.\n` +
    `Here is what you cannot do: ${input.cannotDo.join('; ')}.\n` +
    'If the request needs something you cannot do, say so plainly and say what you would need. Do not pretend, and do not describe an action as done when it was not.'
  const style =
    'Reply in short paragraphs with no headings, the way a person would in a chat. Give the answer first. ' +
    'State what you looked at in plain words, never by the name of a tool, and say when you found nothing instead of guessing.'
  const fixed = [who, where, rulesBlock, limits, input.provenanceNote.trim(), style].filter(
    (p) => p !== '',
  )
  const without = fixed.join('\n\n')
  const room = LIMITS.instructions - without.length - 2
  const spine = input.projectSpine.trim()
  if (spine === '' || room < 80) return cut(without, LIMITS.instructions)
  const withSpine = [fixed[0], fixed[1], cut(spine, room), ...fixed.slice(2)].join('\n\n')
  return cut(withSpine, LIMITS.instructions)
}

/** One earlier exchange, as the office's reader gives it. */
export interface PriorTurn {
  readonly said: string
  readonly answered: string | null
}

export interface HistoryTurn {
  readonly role: 'user' | 'assistant'
  readonly content: string
}

/** One message is cut here so a single long answer cannot take the whole allowance. */
const TURN_CHARS = 2_000

/**
 * The earlier conversation in the shape Hermes takes: oldest first, newest kept, every item exactly `{role, content}`, at most 20 items
 * and 24,000 characters. The person's own words are `user`; what the office answered is `assistant`, which Hermes treats as context and
 * which the office does not treat as evidence (see `answeredBefore` in the answer's grounding).
 */
export function hermesHistory(turns: readonly PriorTurn[]): HistoryTurn[] {
  const messages: HistoryTurn[] = []
  for (const t of turns) {
    const said = t.said.trim()
    if (said === '') continue
    messages.push({ role: 'user', content: cut(said, TURN_CHARS) })
    const answered = t.answered?.trim() ?? ''
    if (answered !== '') messages.push({ role: 'assistant', content: cut(answered, TURN_CHARS) })
  }
  const kept: HistoryTurn[] = []
  let chars = 0
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i]
    if (m === undefined) continue
    if (kept.length >= LIMITS.historyTurns || chars + m.content.length > LIMITS.historyChars) break
    kept.push(m)
    chars += m.content.length
  }
  return kept.reverse()
}
