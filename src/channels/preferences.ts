/**
 * Turning what Grant said into a structured preference.
 *
 * §12: *"Natural-language instructions ('leave me alone today', 'only
 * important things') become **structured persistent preferences**."*
 *
 * This is the parse. It is deliberately a rule layer, not a model call, and the
 * reason is not cost:
 *
 *   - A preference decides whether Grant is told about things. A misparse is
 *     silent by construction — the symptom is an absence of notifications,
 *     which is exactly what a correct mute looks like. There is no feedback
 *     signal to notice it by.
 *   - §10 forbids free-form input reaching a tool call. A model's free-text
 *     output deciding a mute window is that, one indirection removed.
 *
 * So the rules handle what they recognise and *say so* when they do not.
 * `not_understood` is a first-class result, not a fallback: an instruction that
 * silently did nothing is worse than one that reported it could not be applied,
 * because Grant would believe he had been muted when he had not.
 *
 * A model-assisted path can be added later, and if it is, it must produce this
 * same `ParsedPreference` shape and be recorded with `interpretedBy` naming the
 * model — the audit table has the column for exactly that reason.
 */

export type NotifySeverity = 'trivial' | 'routine' | 'important' | 'urgent' | 'blocker'

export type DigestMode = 'immediate' | 'hourly' | 'daily' | 'off'

export const CHANNELS = ['slack', 'telegram', 'voice', 'teamhq'] as const
export type Channel = (typeof CHANNELS)[number]

/**
 * The structured result. Every field optional: an instruction sets what it
 * sets. "Only important things" says nothing about muting, and inventing a
 * value for the fields it did not mention would be the parser making decisions
 * Grant did not.
 */
export interface ParsedPreference {
  readonly minSeverity?: NotifySeverity
  /** Milliseconds from now. Converted to a timestamp by the caller, once. */
  readonly quietForMs?: number
  readonly mutedChannels?: readonly Channel[]
  readonly digestMode?: DigestMode
  /**
   * Only ever set to `false` by an instruction that explicitly asks for total
   * silence. Never set to `false` implicitly: see the comment on the rule.
   */
  readonly blockersAlways?: boolean
}

export interface ParseResult {
  readonly preference: ParsedPreference
  /** Null when understood. Otherwise what could not be applied, for Grant. */
  readonly notUnderstood: string | null
  /** Which rule matched, for the audit trail. */
  readonly matched: readonly string[]
}

const HOUR = 60 * 60 * 1000

/**
 * Rules, in order. First match per *effect* wins, and a single instruction may
 * match several rules with different effects — "leave me alone today, only
 * important things after that" sets both a window and a floor.
 *
 * Patterns are anchored on words rather than substrings: `/\bmute\b/` and not
 * `/mute/`, so "commuter" does not mute anything. That sounds pedantic until
 * the effect is silence.
 */
interface Rule {
  readonly name: string
  readonly pattern: RegExp
  readonly effect: (match: RegExpMatchArray) => ParsedPreference
}

const SEVERITY_RULES: readonly Rule[] = [
  {
    name: 'only-blockers',
    // "only things I have to act on" is a floor at blocker, which is the
    // narrowest a preference can be without turning notifications off.
    pattern: /\bonly\b.{0,20}\b(blockers?|things i (have to|need to) (act|decide))\b/i,
    effect: () => ({ minSeverity: 'blocker' }),
  },
  {
    name: 'only-urgent',
    pattern: /\bonly\b.{0,20}\b(urgent|critical|emergenc\w+)\b/i,
    effect: () => ({ minSeverity: 'urgent' }),
  },
  {
    name: 'only-important',
    pattern: /\bonly\b.{0,20}\b(important|significant|major|the big stuff)\b/i,
    effect: () => ({ minSeverity: 'important' }),
  },
  {
    name: 'everything',
    pattern: /\b(tell me everything|all of it|everything again|unmute|no filter)\b/i,
    effect: () => ({ minSeverity: 'trivial' }),
  },
]

const QUIET_RULES: readonly Rule[] = [
  {
    name: 'quiet-for-n-hours',
    pattern: /\b(?:for|next)\s+(\d{1,2})\s*(?:h|hr|hrs|hours?)\b/i,
    effect: (m) => ({ quietForMs: Number(m[1]) * HOUR }),
  },
  {
    name: 'quiet-rest-of-day',
    // §12's own example. "Today" is treated as 24 hours rather than as
    // midnight-local: the timezone is not known here, and a mute that expires
    // at an hour Grant did not intend is worse than one that lasts a day.
    pattern:
      /\b(leave me alone|not now|later|quiet|silence|do not disturb|dnd)\b.{0,20}\b(today|for (?:the )?(?:rest of the )?day|tonight)\b|\b(leave me alone|quiet)\b(?!.{0,20}\b\d)/i,
    effect: () => ({ quietForMs: 24 * HOUR }),
  },
  {
    name: 'mute-24h',
    // The button. Its own rule so the button and the sentence produce an
    // identical preference row — two paths to one effect, one definition.
    pattern: /^mute_24h$/,
    effect: () => ({ quietForMs: 24 * HOUR }),
  },
]

const DIGEST_RULES: readonly Rule[] = [
  {
    name: 'digest-daily',
    pattern: /\b(once a day|daily (?:digest|summary|round-?up)|end of (?:the )?day)\b/i,
    effect: () => ({ digestMode: 'daily' }),
  },
  {
    name: 'digest-hourly',
    pattern: /\b(hourly|once an hour|every hour)\b/i,
    effect: () => ({ digestMode: 'hourly' }),
  },
  {
    name: 'digest-immediate',
    pattern: /\b(as (?:it|they) happens?|straight away|immediately|real ?time)\b/i,
    effect: () => ({ digestMode: 'immediate' }),
  },
]

const CHANNEL_RULES: readonly Rule[] = [
  {
    name: 'mute-channel',
    pattern: /\b(?:no|stop|mute|nothing (?:on|in))\s+(slack|telegram|voice)\b/i,
    effect: (m) => ({ mutedChannels: [String(m[1]).toLowerCase() as Channel] }),
  },
]

/**
 * The one rule that can suppress a blocker, kept apart from the others.
 *
 * §12 gives Grant blockers because he is the only one who can clear them, so a
 * preference silencing them is a deadlock in waiting. It requires an
 * instruction that is unambiguous about wanting *total* silence — "absolutely
 * nothing", "not even blockers". "Leave me alone today" does not qualify and
 * must not, or the common case would quietly become the dangerous one.
 */
const TOTAL_SILENCE: Rule = {
  name: 'total-silence',
  pattern: /\b(absolutely nothing|not even blockers?|nothing at all|complete silence)\b/i,
  effect: () => ({ blockersAlways: false }),
}

const GROUPS: readonly (readonly Rule[])[] = [
  SEVERITY_RULES,
  QUIET_RULES,
  DIGEST_RULES,
  CHANNEL_RULES,
  [TOTAL_SILENCE],
]

/**
 * Parse an instruction.
 *
 * Returns `notUnderstood` rather than throwing, because the caller has to
 * record the attempt either way — an instruction that could not be applied is
 * exactly the thing worth keeping in the audit table.
 */
export const parseInstruction = (instruction: string): ParseResult => {
  const text = instruction.trim()
  if (text === '') {
    return { preference: {}, notUnderstood: 'the instruction was empty', matched: [] }
  }

  let preference: ParsedPreference = {}
  const matched: string[] = []

  for (const group of GROUPS) {
    for (const rule of group) {
      const m = text.match(rule.pattern)
      if (m === null) continue
      preference = { ...preference, ...rule.effect(m) }
      matched.push(rule.name)
      // One effect per group: within a group the rules are alternatives, and
      // ordering them by specificity means the narrowest match is taken.
      break
    }
  }

  if (matched.length === 0) {
    return {
      preference: {},
      // Quoting it back is the point: Grant sees which words were not
      // recognised, rather than a generic apology, and the audit row carries
      // the same text so a pattern of misses is visible.
      notUnderstood: `no notification preference was recognised in ${JSON.stringify(text.slice(0, 120))}`,
      matched: [],
    }
  }

  return { preference, notUnderstood: null, matched }
}

/**
 * Is this instruction *about* notification preferences at all?
 *
 * Separate from parsing because the router needs to know whether to route a
 * message here before parsing it, and "I could not parse this preference" and
 * "this was not a preference" are different things to tell Grant.
 */
export const looksLikeAPreference = (instruction: string): boolean =>
  /\b(notif\w+|tell me|leave me alone|quiet|mute|silence|digest|only|disturb|dnd|unmute)\b/i.test(
    instruction,
  )
