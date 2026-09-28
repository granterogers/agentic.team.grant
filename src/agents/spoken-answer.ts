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
 * This reads a SHORT reply and nothing else. It never picks a question: the
 * handler acts only when this conversation's own work has exactly one open
 * question, and maps the reading onto that question's own options by their
 * first word, never by guessing - an option list with no "yes"-shaped answer
 * is not answered.
 *
 * AN ACKNOWLEDGEMENT IS NOT AN AUTHORISATION (#374, 28 September 2026).
 * Since R46 the question reaches his chat, where "ok", "thanks" and a thumbs
 * up are how people say "I have seen this". The first version read `ok`,
 * `fine` and `sure, thanks` as a yes, so a reflexive "ok thanks" approved the
 * one open question — including a step the autonomy policy had stopped to ask
 * about because it was consequential. Grant's decision: a bare acknowledgement
 * must never by itself authorise anything, and a reply that is genuinely
 * unclear leaves the question open and is asked about.
 *
 * So the reply is read as PHRASES, each one an authorisation, a decline, an
 * acknowledgement or filler. Anything else left over means it is not a bare
 * answer at all (null). The strongest phrase decides: "ok, go ahead" is a
 * yes because it contains one, "ok thanks" is only an acknowledgement
 * ('unclear'), and "no, yes" contradicts itself ('unclear').
 */
export type SpokenAnswer = 'yes' | 'no'
/** A short reply that answers nothing: acknowledged, not authorised. */
export type SpokenReading = SpokenAnswer | 'unclear'

/* Longest first within each list, so "no worries" is read before "no". */
const AUTHORISE = [
  'yes please',
  'go ahead',
  'go for it',
  'please do',
  'do it',
  'do that',
  'send it',
  'crack on',
  'i approve',
  'approved',
  'approve',
  'proceed',
  'confirmed',
  'confirm',
  'absolutely',
  'definitely',
  'of course',
  'yes',
  'yeah',
  'yep',
  'yup',
  'sure',
]
const DECLINE = [
  'no thank you',
  'dont do it',
  'do not',
  'leave it',
  'not now',
  'hold off',
  'skip it',
  'dont',
  'cancel',
  'nope',
  'nah',
  'no',
]
const ACKNOWLEDGE = [
  'no worries',
  'no problem',
  'thank you',
  'thanks',
  'thx',
  'cheers',
  'ta',
  'okay',
  'ok',
  'k',
  'kk',
  'got it',
  'noted',
  'understood',
  'right',
  'alright',
  'all right',
  'fine',
  'thats fine',
  'sounds good',
  'all good',
  'good',
  'great',
  'cool',
  'nice',
  'lovely',
  'perfect',
  'brilliant',
  'thats it',
  'thats all',
  'will do',
  'see you',
]
const FILLER = ['please', 'then', 'now', 'and', 'so', 'just', 'mate']

type Kind = 'authorise' | 'decline' | 'acknowledge' | 'filler'
const PHRASES: { words: string[]; kind: Kind }[] = [
  ...AUTHORISE.map((p) => ({ words: p.split(' '), kind: 'authorise' as const })),
  ...DECLINE.map((p) => ({ words: p.split(' '), kind: 'decline' as const })),
  ...ACKNOWLEDGE.map((p) => ({ words: p.split(' '), kind: 'acknowledge' as const })),
  ...FILLER.map((p) => ({ words: p.split(' '), kind: 'filler' as const })),
].sort((a, b) => b.words.length - a.words.length)

/** Pictographs: a thumbs up, a tick, a smile. Never an authorisation. */
const PICTOGRAPH = /\p{Extended_Pictographic}/u

export function spokenAnswer(text: string): SpokenReading | null {
  const said = String(text ?? '').trim()
  if (said === '' || said.length > 40) return null
  const hadPictograph = PICTOGRAPH.test(said)
  const words = said
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z\s]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w !== '')
  if (words.length === 0) return hadPictograph ? 'unclear' : null

  const seen = new Set<Kind>()
  let i = 0
  while (i < words.length) {
    const hit = PHRASES.find((p) => p.words.every((w, k) => words[i + k] === w))
    if (hit === undefined) return null // something that is not a bare answer
    seen.add(hit.kind)
    i += hit.words.length
  }
  if (seen.has('authorise') && seen.has('decline')) return 'unclear'
  if (seen.has('decline')) return 'no'
  if (seen.has('authorise')) return 'yes'
  if (seen.has('acknowledge') || hadPictograph) return 'unclear'
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
