/**
 * A correction, and the standing rule hiding inside it (#147).
 *
 * Grant's first pick from #136, and his reason for it: *"There are dozens of
 * corrections already on record. This turns work he has already done into
 * permanent improvement, which no other item on the list does."*
 *
 * The gap, in his words: *"When a reply is wrong Grant says so and the next
 * reply is better. NOTHING GENERALISES."*
 *
 * ## Cheap signals first, exactly as the issue asks
 *
 * A correction is recognised by three things that cost nothing: it FOLLOWS an
 * answer, it is SHORT, and it is corrective in FORM. No model call decides
 * whether something is a correction, because the expensive direction of being
 * wrong here is a false positive — offering to make a standing rule out of an
 * ordinary instruction is the office being obtuse in a way Grant will notice
 * every time.
 *
 * ## Why the draft is deterministic too
 *
 * The issue requires the drafted rule to be *"visible verbatim before
 * acceptance"*, which means Grant reads the exact text that will be stored.
 * Once that is true, a slightly stiff sentence he can edit or decline is
 * strictly better than a fluent one he has to trust: the model could write a
 * nicer rule and could also write a rule that says something he did not.
 *
 * So this strips the rejection and keeps HIS words as the instruction. The
 * office's contribution is the framing — "From now on" — not the content.
 */

/** What a correction, once recognised, would become. */
export interface Correction {
  /** His words with the rejection removed — the substance of the rule. */
  readonly fragment: string
  /** The rule as it will be stored, and as he will read it before pressing. */
  readonly rule: string
  /** Which of the signals fired, so a report can say why this was offered. */
  readonly because: readonly string[]
}

/*
  The forms a correction takes.

  Anchored at the start, because "no" in the middle of a sentence is usually
  part of the content ("there is no entry for that") and this must not read an
  answer as a rejection of itself. `teaching.ts` already learned the anchoring
  lesson from the other side and its note is worth repeating: a complement
  clause is not a condition.
*/
const OPENS = [
  /^no[,.! ]+/i,
  /^nope[,.! ]+/i,
  /^not (?:like )?(?:that|this)[,.! ]*/i,
  /^wrong[,.! ]+/i,
  /^that'?s (?:not|wrong)\b[^,.]*[,.]?\s*/i,
  /^actually[,. ]+/i,
  /^i said\b[^,.]*[,.]?\s*/i,
  /^don'?t\b/i,
  /^stop\b/i,
  /^please (?:don'?t|stop)\b/i,
]

/*
  And the forms that are corrective without opening with a rejection.

  "at the end, not after every bullet" is a correction; so is "shorter than
  that". They are recognised by carrying a contrast the previous answer is one
  side of.
*/
const CONTRASTS = [/\bnot after\b/i, /\brather than\b/i, /\binstead of\b/i, /\bnot\b.+\bbut\b/i]

/*
  Long enough to be a new request rather than a correction of the last one.

  Two ceilings, because the two branches below are not equally good evidence.
  An opening rejection is POSITIONAL — "no," at the front of a message can
  hardly be anything else — so it can carry a couple of sentences after it. A
  contrast word cannot: "rather than" is ordinary English and appears in the
  middle of perfectly ordinary long requests, so when the contrast is the ONLY
  evidence, shortness has to do the discriminating. That is the issue's own
  signal ("it is short"), applied at the strength each branch has earned.

  The alternative would be a list of verbs that open a request — and a list of
  permitted values fails by refusing to speak, which is the expensive
  direction here as it is everywhere else in this repository.
*/
const TOO_LONG = 220
const CONTRAST_TOO_LONG = 90

/**
 * Read a message as a correction, or decide it is not one.
 *
 * `hadAnswer` is whether the office said something immediately before this. A
 * correction with nothing to correct is a new instruction that happens to start
 * with "no", and treating it as a correction would offer to make a standing
 * rule out of the first thing anybody says.
 */
export function readCorrection(instruction: string, hadAnswer: boolean): Correction | null {
  const said = String(instruction ?? '').trim()
  if (!hadAnswer) return null
  if (said === '' || said.length > TOO_LONG) return null

  const because: string[] = ['it followed an answer', 'it is short']
  let rest = said
  let opened = false
  for (const re of OPENS) {
    if (re.test(rest)) {
      rest = rest.replace(re, '').trim()
      opened = true
      because.push('it opens with a rejection')
      break
    }
  }
  if (!opened) {
    if (said.length > CONTRAST_TOO_LONG) return null
    const contrast = CONTRASTS.some((re) => re.test(rest))
    if (!contrast) return null
    because.push('it contrasts with what was done')
  }

  /*
    What is left has to be a rule and not a shrug.

    "No." and "no, wrong" carry no instruction — there is nothing to store, and
    offering to make a standing rule out of them would be the office asking a
    question it cannot act on. #237's lesson about contentless rejections, in
    the place where it would do the most damage.
  */
  const fragment = rest.replace(/^[,.\s]+/, '').trim()
  if (fragment.length < 8 || !/[a-z]{3}/i.test(fragment)) return null

  return { fragment, rule: asRule(fragment), because }
}

/*
  His words, framed as a standing instruction.

  Deliberately not a rewrite. "From now on" is the office's contribution and the
  rest is his, so what he approves is what he said — and the one thing a drafted
  rule must never do is claim he asked for something he did not.
*/
function asRule(fragment: string): string {
  const trimmed = fragment.replace(/\s+/g, ' ').trim()
  const already = /^(from now on|always|never|when |if )/i.test(trimmed)
  const body = already
    ? trimmed
    : `From now on, ${trimmed.charAt(0).toLowerCase()}${trimmed.slice(1)}`
  const capped = body.charAt(0).toUpperCase() + body.slice(1)
  return /[.!?]$/.test(capped) ? capped : `${capped}.`
}
