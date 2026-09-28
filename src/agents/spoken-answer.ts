/**
 * "Yes, go ahead" as the ANSWER to the question the office asked (ledger R33).
 *
 * A plan parked for approval raises a blocker with options ("Yes, do it" /
 * "No, leave it"), and at `suggest` - every one of Grant's projects - that is
 * common. Replying "Yes, go ahead." in the same chat was answered as a new
 * message: the job failed four times on an unrelated gate and the blocker
 * stayed open, so the plan he had just approved never ran. The only way to
 * answer was a button on the dashboard.
 *
 * This reads a SHORT, unambiguous yes or no and nothing else. It never picks
 * a question: the handler acts only when this conversation's own work has
 * exactly one open question, and maps the reading onto that question's own
 * options by their first word, never by guessing - an option list with no
 * "yes"-shaped answer is not answered.
 */
export type SpokenAnswer = 'yes' | 'no'

const YES =
  /^(?:yes|yeah|yep|yup|ok(?:ay)?|sure|go\s+ahead|do\s+it|go\s+for\s+it|please\s+do|approved?|sounds\s+good|fine|that'?s\s+fine|crack\s+on)(?:[\s,.!]+(?:yes|please|go\s+ahead|do\s+it|thanks?|thank\s+you|ta|then|now))*[\s.!]*$/i
const NO =
  /^(?:no|nope|nah|don'?t|do\s+not|leave\s+it|not\s+now|hold\s+off|no\s+thanks?|skip\s+it)(?:[\s,.!]+(?:thanks?|thank\s+you|leave\s+it|not\s+now|for\s+now))*[\s.!]*$/i

export function spokenAnswer(text: string): SpokenAnswer | null {
  const said = String(text ?? '').trim()
  if (said === '' || said.length > 40) return null
  if (YES.test(said)) return 'yes'
  if (NO.test(said)) return 'no'
  return null
}

/** The option a yes or a no chooses, by the option's own first word, or null. */
export function optionFor(answer: SpokenAnswer, options: readonly string[]): string | null {
  const fits = options.filter((o) =>
    answer === 'yes'
      ? /^\s*(?:yes|approve|go\s+ahead|do\s+it|ok(?:ay)?)\b/i.test(o)
      : /^\s*(?:no|decline|don'?t|leave\s+it|not\s+now)\b/i.test(o),
  )
  return fits.length === 1 ? (fits[0] ?? null) : null
}
