/**
 * A colleague named as the one to do the work (behavioural remediation,
 * 24 September 2026, ledger R21).
 *
 * "Right, can you ask Emma to pull together everything we have on the
 * Holloway Barn booking" was routed by SUBJECT to the quality director —
 * "risky" is in her expertise — and Emma was never convened. Nothing read the
 * name. The office then promised to "create a task for Emma", the promise was
 * refused as unbacked, and Grant received a bare "I have not done this".
 *
 * A name is the strongest routing signal a sentence can carry, stronger than
 * any subject word, because it is Grant choosing the person himself. But only
 * in a DELEGATION FRAME: "ask Emma to", "get Daniel to", "have Oliver draft",
 * "Emma, can you…". "Emma said the deposit was high" names her as a source,
 * not as the one to do the work, and is left to the subject reading.
 *
 * The names are the roster's own, read from `public.staff`, so this needs no
 * word list and follows the roster when it changes.
 */

export interface Colleague {
  readonly slug: string
  readonly name: string
}

const VERBS = String.raw`(?:ask|get|have|let|tell|put|send|give|pass\s+(?:it|this|that)\s+to|hand\s+(?:it|this|that)\s+(?:over\s+)?to|loop\s+in|bring\s+in)`

const ROLE_NOUN = '(?:specialist|director|lead|team|person|expert|colleague|analyst|manager|agent)'

export function namedColleague(clause: string, staff: readonly Colleague[]): string | null {
  const text = String(clause ?? '')
  for (const s of staff) {
    const name = s.name.trim()
    if (!/^[A-Za-z]{2,}$/.test(name)) continue
    const delegated = new RegExp(String.raw`\b${VERBS}\s+${name}\b`, 'i')
    // Vocative at the start: "Emma, can you…", "Emma - have a look at…".
    const vocative = new RegExp(
      String.raw`^\s*(?:(?:ok|right|so|and)\s*,?\s*)?${name}\s*[,:—-]\s*\S`,
      'i',
    )
    if (delegated.test(text) || vocative.test(text)) return s.slug
  }
  /*
    A ROLE IS A NAME TOO (#408). "Ask the finance director to review the outstanding work" names the finance director as
    plainly as "ask Daniel" does, and nothing read it: the request was classified a question, routed by SUBJECT to the quality
    and strategy directors ("outstanding work", "attention"), and the finance director - the one he chose - was never convened.
    The role word is the first word of the slug (`finance-director` -> finance), so it follows the roster the same way the first
    names do. It must be a delegation frame AND either end in a role noun ("the finance director", "the research specialist") or
    be followed by "to": "ask finance questions" names nobody.
  */
  const roles = new Map<string, string[]>()
  for (const s of staff) {
    const role = s.slug.split('-')[0] ?? ''
    if (role.length < 4 || role === 'chief') continue
    roles.set(role, [...(roles.get(role) ?? []), s.slug])
  }
  for (const [role, slugs] of roles) {
    if (slugs.length !== 1) continue // two people share the word: that names nobody in particular
    const framed = new RegExp(
      String.raw`\b${VERBS}\s+(?:the\s+)?${role}(?:\s+${ROLE_NOUN}\b|\s+to\b)`,
      'i',
    )
    if (framed.test(text)) return slugs[0] ?? null
  }
  return null
}

/**
 * Is this clause the REPORT of the work the clause before it handed to somebody (#408)?
 *
 * "Ask the finance director to review the outstanding work and tell me what needs attention first" is one delegation: the
 * second clause is what the finance director is to hand back, and read alone ("what needs attention") it matches the
 * strategy director by subject, who then answers a question nobody put to them. A clause that opens by asking for a finding
 * - tell me, let me know, report back, identify, list, summarise, flag, recommend - has no work of its own to route. A clause
 * that asks for something NEW to be made (draft, write, create) is a different piece of work and keeps its own subject.
 */
const REPORTS = String.raw`^\s*(?:(?:and|then|also)\s+)*(?:(?:please\s+)?(?:tell|let|show|give|send)\s+me\b|report\s+back\b|come\s+back\b|(?:please\s+)?(?:identify|list|summari[sz]e|flag|highlight|recommend|advise|prioriti[sz]e|rank)\b)`

export function reportsBackOn(clause: string): boolean {
  return new RegExp(REPORTS, 'i').test(String(clause ?? ''))
}

/**
 * Is a new task's title grounded in what he actually said this turn?
 *
 * Behavioural remediation, 24 September 2026 (ledger R4b). "And put it down
 * as mine." was rewritten by the thread resolver into a sentence that CREATES
 * — "put the Pemberton renewal review on my list" — and a second copy of the
 * task he had just made was filed. The creation readers take the model's
 * decomposed intent texts as well as his words, which is right for splitting
 * several requests out of one message and wrong when the "request" exists only
 * in the paraphrase. A split clause is his words; a resolved referent is not.
 *
 * So: at least half of the title's content words must appear in what he said.
 * Measured by word, not by string, so dictation typos in the ordinary case
 * (title and message from the same text) cannot fail it.
 */
export function groundedIn(title: string, said: string): boolean {
  const words = (t: string) =>
    t
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4 && !STOP.has(w))
  const his = new Set(words(said).map((w) => w.slice(0, 5)))
  const content = words(title)
  if (content.length === 0) return true
  const found = content.filter((w) => his.has(w.slice(0, 5))).length
  return found * 2 >= content.length
}

const STOP = new Set([
  'that',
  'this',
  'with',
  'from',
  'into',
  'about',
  'task',
  'tasks',
  'list',
  'have',
  'there',
  'their',
  'them',
  'they',
  'your',
  'mine',
  'make',
  'need',
  'please',
])
