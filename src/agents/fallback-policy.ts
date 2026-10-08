/**
 * A backup model's answer is admitted on evidence, not on fluency (#444).
 *
 * When the first model in the allow-list's measured order cannot answer, the router tries the next. That keeps the office
 * answering, and a real-model run showed what it can cost: with the primary refused, 3 of 7 answers to a plain deposit question
 * were off-target ("I can't schedule the payment reminder yet" - nobody asked for one) or added an inference nothing supported
 * ("I infer the contract is not signed yet, because the insurance certificate is still outstanding"), or narrated the office's
 * own routing ("I'm not convening anyone because simple fact-checking isn't a meeting"). Every one was fluent. None claimed an
 * action, so no existing gate looked at it.
 *
 * ## What is checked, and why it does not depend on the model's name
 *
 * The router's order is MEASURED (`app.model_order`), so "a fallback" means only "not the first of the order today". Whether an
 * answer is acceptable is decided by what can be checked WITHOUT a model, against what the turn actually held:
 *
 *   1. it must use the evidence it was handed: a factual question over retrieved text is answered with the facts in that text (or
 *      by honestly saying there is nothing), not with an offer to do something else;
 *   2. it must not offer a change nobody asked for in place of an answer;
 *   3. an inference it draws must rest on words the turn held;
 *   4. a figure must be in the evidence or follow from it by arithmetic (a derived figure is not an invented one);
 *   5. it must not narrate the office's own routing to the person.
 *
 * Every check can only REFUSE an answer; none can write one, and each fails open when its input is empty (no evidence: nothing to
 * ignore; no inference marker: nothing to support). A refused fallback answer is asked once more of a DIFFERENT model if the budget
 * allows, and otherwise becomes an honest limitation built from the evidence itself (`limitationAnswer`), never a fluent guess.
 *
 * The authority half is separate and does not read words at all: an action a fallback-served turn would take on its own is asked
 * about instead (`degradeForFallback`, applied inside `mayAct`).
 */

/** Why a fallback answer was not admitted. Codes, so a test and a trace can name them; the person never sees these. */
export type Inadequacy =
  | 'ignores_evidence'
  | 'offers_unasked_action'
  | 'unsupported_inference'
  | 'ungrounded_figure'
  | 'process_narration'
  | 'denies_held_evidence'

export interface AdmissionInput {
  /** What he asked, in his own words. */
  readonly asked: string
  /** The model's answer, after scrubbing. */
  readonly answer: string
  /** Every passage the turn actually held (retrieved documents, the project's own records). Empty means nothing was held. */
  readonly retrieved: readonly string[]
  /** Everything the answer is entitled to rest on: his words, what he said earlier, and the retrieved passages. */
  readonly established: string
  /** True when what he asked was a question or a request for findings, with nothing to be changed, created or sent. */
  readonly readOnly: boolean
}

export type Admission =
  | { readonly ok: true }
  | { readonly ok: false; readonly reasons: Inadequacy[] }

const STOP = new Set(
  (
    'the a an and or but if then than that this these those there here is are was were be been being have has had do does did ' +
    'will would can could should may might must shall of to in on at by for with from as into about over after before ' +
    'it its it’s i me my we our you your they them their he she his her not no yes so very just also only too ' +
    'what which who when where why how all any some more most such own same other another each both few'
  ).split(/\s+/),
)

const words = (text: string): string[] =>
  (text.toLowerCase().match(/[a-z][a-z'’-]{3,}/g) ?? []).filter((w) => !STOP.has(w))

/** A number as the answer writes it ("£2,000", "2 000", "10k" is left alone) reduced to a plain value. */
const NUMBER = /(?:£|\$|€)?\s?\d[\d,.   ]*\d|(?:£|\$|€)?\s?\d/g
const numbersIn = (text: string): number[] => {
  const out: number[] = []
  for (const hit of text.match(NUMBER) ?? []) {
    const plain = hit.replace(/[£$€\s  ,]/g, '')
    const value = Number(plain)
    if (Number.isFinite(value)) out.push(value)
  }
  return out
}

const MONTH =
  /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/gi
const monthsIn = (text: string): Set<string> =>
  new Set([...text.matchAll(MONTH)].map((m) => (m[1] ?? '').toLowerCase().slice(0, 3)))

/** The facts a passage holds that an answer to a question over it would repeat: figures of any size, and months. */
const anchorsOf = (text: string): { numbers: Set<number>; months: Set<string> } => ({
  numbers: new Set(numbersIn(text).filter((n) => n >= 10)),
  months: monthsIn(text),
})

const ACTION_OFFER =
  /\b(?:i (?:won['’]?t|will not|can['’]?t|cannot|can|could|would|will)|i['’]ll|let me|once you|tell me (?:which|when|the|what)|i (?:need|would need)|to (?:log|schedule|add|create|flag|track|set up|remind))\b[^.!?\n]{0,90}\b(?:task|reminder|schedule|calendar|dashboard|boards?|diary|flag|track|payment task|log)\b/i

/** An answer that opens by refusing or conditioning something he did not ask for: a blocker where there was a question. */
const BLOCKER_FRAMING =
  /\bi (?:can['\u2019]?t|cannot|won['\u2019]?t|will not) (?:schedule|add|log|create|flag|set up|track)\b|\bto proceed,? i (?:need|would need)\b|\bi (?:would |will |['\u2019]ll )?need (?:the following|you to|to know)\b|\bonce (?:you|i) (?:provide|confirm|have)\b|\bplease provide (?:the|these|those|more)\b|\bso i can proceed\b|\b(?:log|create|schedule)(?:ged)? (?:a|the) (?:payment |deposit )?task\b|\btell me which project\b/i

/**
 * The framings no honest answer to a plain question needs even when nothing relevant was held: a precondition to proceed,
 * a task nobody asked for, a request for something else first. "Tell me which project" is left out on purpose, because with
 * no project in scope that is a fair clarification.
 */
const UNCONDITIONAL_BLOCKER =
  /\bto proceed,? i (?:need|would need)\b|\bonce (?:you|i) (?:provide|confirm|have)\b|\bso i can proceed\b|\b(?:log|create|schedule)(?:ged)? (?:a|the) (?:payment |deposit )?task\b|\bi (?:will|['’]ll) add (?:the task|it|this|that|them) to\b|\b(?:specify|tell me|let me know) which project\b[^.!?\n]{0,60}\badd it\b/i

const NARRATION =
  /\bi['\u2019]?m (?:not )?(?:skipping|routing|convening|bringing in)\b|\bnot (?:convening|routing|bringing in) (?:anyone|anybody|this)\b|\bskipping the (?:team|review)\b|\bsimple (?:fact-?check|factual retriev)|\bi (?:won['\u2019]?t|will not) pull (?:anyone|anybody|the team) in\b|\bnothing (?:else )?to route\b|\bstraight (?:factual )?retriev|\b(?:i['\u2019]?m|we['\u2019]?re|i am|we are) not (?:going to )?(?:call(?:ing)?|post(?:ing)?|ping(?:ing)?|convening|raising|creating|logging|queu(?:e|ing))\b[^.!?\n]{0,70}\b(?:meeting|channel|ping|task|record|dashboard|reminder|anyone)\b|\bwe (?:won['\u2019]?t|will not) log (?:another|a) task\b|\bno further action (?:is )?needed\b|\bthe office is not going to do anything\b/i

const INFERENCE =
  /\b(?:i infer|inferring|infer that|this (?:suggests|implies)|which (?:suggests|implies)|probably|presumably|it (?:seems|appears) (?:that|to be)|so (?:the|it) (?:is|must be))\b/i

const ABSENCE =
  /\b(?:no record|nothing (?:on|in|about|here)|(?:don['’]?t|do not) (?:have|see|know)|can['’]?t (?:find|see)|cannot (?:find|see)|not on file|no (?:venue |such )?(?:contract|document|entry|note))\b/i

/** Does some figure or month in the answer come from the evidence? */
const usesAnAnchor = (answer: string, retrieved: readonly string[]): boolean => {
  const ev = anchorsOf(retrieved.join('\n'))
  if (ev.numbers.size === 0 && ev.months.size === 0) return true
  const mine = anchorsOf(answer)
  for (const n of mine.numbers) if (ev.numbers.has(n)) return true
  // A figure the answer works out from two of the held ones is the same fact, derived.
  const pool = [...ev.numbers]
  for (const n of mine.numbers) if (derivable(n, pool)) return true
  for (const m of mine.months) if (ev.months.has(m)) return true
  // A figure written out ("two thousand") is the same fact; so is one the answer derives from two of them.
  const spoken =
    /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand|million)\b/i.test(
      answer,
    )
  return spoken && ev.months.size > 0 ? [...mine.months].some((m) => ev.months.has(m)) : spoken
}

function derivable(value: number, pool: readonly number[]): boolean {
  const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.5, Math.abs(b) * 0.005)
  for (const x of pool) {
    for (const y of pool) {
      if (near(value, x + y) || near(value, Math.abs(x - y)) || near(value, x * y)) return true
      if (y !== 0 && (near(value, x / y) || near(value, (100 * x) / y))) return true
    }
  }
  return false
}

const hasMoneyOrPercent = (text: string, value: number): boolean => {
  const re = new RegExp(`(?:[£$€]\\s?${String(value)}\\b|\\b${String(value)}\\s?%)`)
  return re.test(text.replace(/[,   ]/g, ''))
}

/** Figures the answer states that the turn did not hold and that do not follow from what it held. */
const ungroundedFigures = (answer: string, established: string): number[] => {
  const held = new Set(numbersIn(established))
  const pool = [...held]
  const flat = answer.replace(/[,   ]/g, '')
  return numbersIn(answer).filter((n) => {
    if (held.has(n)) return false
    // Only a figure that reads as money or a percentage, or a large one: a day of the month or a count of two is not a claim.
    if (!(n >= 1000 || hasMoneyOrPercent(flat, n))) return false
    return !derivable(n, pool)
  })
}

const contentRatio = (sentence: string, established: string): number => {
  const mine = words(sentence)
  if (mine.length === 0) return 1
  const held = new Set(words(established))
  return mine.filter((w) => held.has(w)).length / mine.length
}

const sentences = (text: string): string[] =>
  text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s !== '')

/** Is this answer, from a model that was not the first choice, fit to go to a person? Pure; no model, no database. */
export const admitFallbackAnswer = (input: AdmissionInput): Admission => {
  const reasons: Inadequacy[] = []
  const { answer, retrieved, established, readOnly } = input
  // Held AND about what he asked: an honest "nothing on that" over documents about something else is the right answer.
  const held =
    retrieved.some((r) => r.trim() !== '') && contentRatio(input.asked, retrieved.join(' ')) >= 0.34
  const states_absence = ABSENCE.test(answer)
  const anchored = usesAnAnchor(answer, retrieved)

  if (NARRATION.test(answer)) reasons.push('process_narration')

  if (held && readOnly && !anchored) {
    // A read-only question over held text, answered with none of its facts.
    if (states_absence) reasons.push('denies_held_evidence')
    else if (ACTION_OFFER.test(answer)) reasons.push('offers_unasked_action')
    else reasons.push('ignores_evidence')
  }
  // Whatever else it says, a blocker raised against a plain question is not an answer to it.
  if (readOnly && ((held && BLOCKER_FRAMING.test(answer)) || UNCONDITIONAL_BLOCKER.test(answer)))
    reasons.push('offers_unasked_action')

  for (const s of sentences(answer)) {
    if (INFERENCE.test(s) && contentRatio(s, established) < 0.6) {
      reasons.push('unsupported_inference')
      break
    }
  }

  if (ungroundedFigures(answer, established).length > 0) reasons.push('ungrounded_figure')

  return reasons.length === 0 ? { ok: true } : { ok: false, reasons: [...new Set(reasons)] }
}

/**
 * What to say when no admitted answer exists: what could not be established, what the turn DID hold (quoted, so it is checkable
 * by him), and what he can do. Composed in code from the evidence, because the moment a model was unreliable is the wrong moment
 * to ask one for the apology.
 */
export const limitationAnswer = (input: {
  readonly retrieved: readonly string[]
  readonly sourceNames?: readonly string[]
}): string => {
  const quoted = input.retrieved
    .map((r) => r.trim())
    .filter((r) => r !== '')
    .slice(0, 2)
    .map((r, i) => {
      const name = input.sourceNames?.[i]
      const text = r.length > 320 ? `${r.slice(0, 320).replace(/\s+\S*$/, '')}...` : r
      return name === undefined || name === '' ? `"${text}"` : `${name}: "${text}"`
    })
  const held =
    quoted.length === 0
      ? 'I have nothing in the project that bears on it.'
      : `What I can see in the project:\n\n${quoted.join('\n\n')}`
  return (
    'I could not get a reliable answer to that just now: the model I would normally use was not available, and the one that stood in did not answer your question properly, so I am not going to guess.\n\n' +
    `${held}\n\n` +
    'Ask me again in a few minutes and I will try again.'
  )
}

/**
 * The authority half. A job that a backup model helped work out may not take a step on its own that changes anything: a decision to
 * `proceed` at an action level of 1 or more (anything that writes) becomes `ask`, unless he already said yes to exactly this
 * action. Reads (level 0) proceed. A refusal stays a refusal. Applied to the policy's answer, so it needs no new column and works
 * whichever version of the database answered.
 */
export interface PolicyAnswer {
  readonly verdict: 'proceed' | 'ask' | 'refuse'
  readonly actionLevel: number | null
  readonly approved: boolean
}
export const degradeForFallback = (
  answer: PolicyAnswer,
  fallbackServed: boolean,
): { readonly verdict: 'proceed' | 'ask' | 'refuse'; readonly degraded: boolean } => {
  if (
    fallbackServed &&
    answer.verdict === 'proceed' &&
    !answer.approved &&
    (answer.actionLevel === null || answer.actionLevel >= 1)
  )
    return { verdict: 'ask', degraded: true }
  return { verdict: answer.verdict, degraded: false }
}

export const FALLBACK_BECAUSE =
  'This was worked out by a backup model, which I do not let act on its own. Please confirm and I will go ahead.'
