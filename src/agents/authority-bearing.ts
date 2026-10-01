/**
 * When learning would become AUTHORITY (final policy closure, decision 5).
 *
 * Grant's policy: the office may learn ordinary preferences and context on its own; it may not let anything it learned
 * become a durable rule that grants permission, automates something, contacts people or causes an external effect
 * without his explicit confirmation. MEMORY / CONTEXT IS NOT AUTHORITY, and LEARNING IS NOT PERMISSION.
 *
 * ## Where the boundary actually is
 *
 * Two layers, and the first is the one that holds:
 *
 *   1. STRUCTURAL. Nothing that decides whether the office may act reads a learned sentence. `app.authorize_effect`
 *      and `app.may_act` read the tool registry, the dial, standing authorizations and recorded answers - never
 *      `lessons` or `skills`. The tables those live in (`standing_authorizations`, `staff_tools`, `autonomy_settings`,
 *      `responsibilities`, `autonomy_policy`) are written only by gateway actions that carry a verified person, and
 *      since 0642 a public key cannot reach them any other way. So a sentence the office learned cannot grant,
 *      automate or send anything however it is worded; `scripts/isolated/policy-learning.ts` proves it by storing the
 *      most permission-claiming rule it can and watching the verdicts not move.
 *
 *   2. AT THE WRITE. A standing rule is shown to every later prompt as Grant's own order. A rule that CLAIMS authority
 *      ("you may email my clients without asking") would then be read by a model as permission it was never given.
 *      So before `remember()` stores a rule or a procedure, this asks whether it is one the office can positively
 *      recognise as ordinary. Anything it cannot is not stored: it is put to Grant as an offer (the existing
 *      `propose_standing_rule`, whose only way in is a press), and the reply says nothing was changed.
 *
 * ## Why this is a recogniser and not a list of forbidden words
 *
 * It does not try to enumerate what is dangerous. It asks the questions whose "yes" is what authority IS - does the
 * sentence give permission (or concern when the office may act without asking), does it direct an effect at somebody
 * other than Grant, does it set something running on a schedule or a trigger - and a rule none of them touches (how
 * long an answer is, its form, a spelling, a tone) is ordinary and is learned on its own, as before. A miss costs
 * nothing that matters, because layer 1 does not read the sentence: a rule that slips through is still only prose.
 * A procedure is always offered: a procedure is exactly a standing way of acting.
 */

/** "Message me", "email us", "tell me": telling Grant is not contacting a person. Removed before the effect test. */
const TO_GRANT =
  /\b(?:send|email|e-?mail|mail|message|text|dm|call|phone|ring|ping|tell|notify|alert|remind|show|give|cc|bcc|copy)\s+(?:me|us|myself)\b/gi

const GRANTS_PERMISSION =
  /\b(?:you\s+(?:may|can|could|are\s+(?:allowed|permitted|free|authori[sz]ed)\s+to|have\s+(?:my\s+)?(?:permission|approval|authori[sz]ation)|(?:don'?t|do\s+not)\s+(?:need|have)\s+to)|go\s+ahead\s+and|feel\s+free\s+to|no\s+need\s+to\s+(?:ask|check|confirm|run\s+it\s+by)|without\s+(?:asking|checking|confirming|approval|permission|my\s+(?:say|ok|okay|approval))|on\s+my\s+behalf|in\s+my\s+name|(?:i\s+)?(?:authori[sz]e|permit|allow)\b|pre-?approved?|standing\s+(?:approval|permission|authori[sz]ation)|always\s+(?:say\s+yes|approve))/i

const DIRECTS_AN_EFFECT =
  /\b(?:send|email|e-?mail|mail|message|text|dm|call|phone|ring|post|publish|share|invite|book|schedule|reserve|pay|transfer|refund|invoice|delete|remove|cancel|forward|reply|respond|contact|notify|alert|order|buy|purchase|subscribe|submit|sign|approve|hire|fire|reach\s+out|follow\s+up|chase|ping|loop\s+in|cc|bcc|file|upload|push|deploy|merge)\b/i

const SETS_SOMETHING_RUNNING =
  /\b(?:every|each)\s+(?:day|morning|afternoon|evening|night|week|weekday|weekend|month|quarter|year|hour|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\b(?:daily|weekly|monthly|hourly|nightly|fortnightly|quarterly|annually)\b|\b(?:whenever|as\s+soon\s+as|automatically|on\s+a\s+schedule|recurring|on\s+repeat|each\s+time)\b/i

export interface AuthorityReading {
  /** True when the office must not store this as an order without his explicit yes. */
  readonly bearsAuthority: boolean
  /** Which question said so, for the Governance row's chips and the tests. */
  readonly because: readonly string[]
}

/**
 * Would storing this as a standing rule hand the office authority?
 *
 * `dimension` is `dimensionOf(body)`: passed in so this stays pure and so the two cannot disagree about it.
 */
export const readAuthority = (body: string, dimension: string | null): AuthorityReading => {
  const text = String(body ?? '')
  // Telling or showing Grant something is not reaching anybody else.
  const aboutOthers = text.replace(TO_GRANT, ' ')
  const because: string[] = []
  if (dimension === 'asking-first')
    because.push('it is about when the office may act without asking')
  if (GRANTS_PERMISSION.test(text)) because.push('it gives the office permission')
  if (DIRECTS_AN_EFFECT.test(aboutOthers)) because.push('it directs something outside the office')
  if (SETS_SOMETHING_RUNNING.test(text))
    because.push('it sets something running on a schedule or a trigger')
  return { bearsAuthority: because.length > 0, because }
}
