/**
 * "Ask the finance specialist to summarise the budget" is, to the finance specialist, "summarise the budget".
 *
 * The instruction a specialist receives is the person's words, and when those words are addressed TO that same specialist
 * ("ask Daniel to ...", "have the finance director check ...") the specialist read them as a request to go and ask somebody.
 * Driven through the real worker the Sample was answered "Let me know which finance specialist you want to handle this" by the
 * finance director, and "I can reach out to the finance director, but I need to know which person to contact" by the chief of
 * staff, with the budget documents in the prompt both times. The delegation was done and the work was handed on as a
 * sentence about delegating.
 *
 * This removes ONLY a leading "ask|have|get|tell|let <the speaker> (to)" and only when the person named IS the one answering.
 * It changes what the model reads as the request. It does not change what he asked for: every reader that decides to DO
 * something reads his own words (`turn.kept`, #313), never this. So it can make an answer better and cannot start work.
 *
 *   - Another person named ("ask Emma to ...") is left alone: that is a request to convene Emma.
 *   - A reference that matches no word of the speaker's name or title is left alone.
 *   - Nothing is stripped when no task follows ("ask the finance director"), which is a request to talk to her.
 *   - A question left behind ("which savings account ...") is given its verb back ("Tell me which ...") so it reads as a request.
 */

export interface Speaking {
  readonly slug: string
  readonly name: string
  readonly title: string
}

const NOISE = new Set(['and', 'the', 'of', 'director', 'lead', 'chief', 'head', 'manager'])
const ROLE_NOUN = '(?:specialist|director|lead|team|person|colleague|expert|agent|analyst|manager)'
const INTERROGATIVE = /^(?:which|what|who|whom|whose|how|when|where|why|whether|if)\b/i

/** The words that can stand for this person: a first name, and the subject words of the title and slug. */
const references = (who: Speaking): string[] => {
  const words = new Set<string>()
  const first = who.name.trim().split(/\s+/)[0]?.toLowerCase()
  if (first !== undefined && first !== '') words.add(first)
  for (const w of `${who.title} ${who.slug.replace(/-/g, ' ')}`.toLowerCase().match(/[a-z]{3,}/g) ??
    []) {
    if (!NOISE.has(w)) words.add(w)
  }
  return [...words]
}

const reEscape = (v: string): string => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/*
  NOBODY IN PARTICULAR IS ALSO ADDRESSED TO WHOEVER WAS CHOSEN (#408 closure).

  "Ask the appropriate person on the team to review our launch preparation" names no one, so the office chose the quality director,
  and she was handed that sentence whole and answered "Who's the best person to review our launch prep?": the delegation was done
  and the work reached her as a question about delegating. A frame that names a kind of person ("the appropriate / right / best /
  relevant person") is addressed to whoever answers. Not for the chief of staff, for whom it is exactly the request to convene
  somebody.
*/
const ANYONE = new RegExp(
  `^\\s*(?:please\\s+|can you\\s+|could you\\s+)?(?:ask|have|get|tell|let)\\s+(?:the\\s+)?` +
    `(?:appropriate|right|best|relevant|correct|suitable|proper|responsible|most suitable)\\s+${ROLE_NOUN}` +
    `(?:\\s+(?:on|in|from)\\s+(?:the|our|my)\\s+(?:team|office))?\\s*(?:to\\s+|if\\s+(?:she|he|they)\\s+can\\s+|whether\\s+|:\\s*)?`,
  'i',
)

export function ownTask(instruction: string, who: Speaking): string {
  const text = String(instruction ?? '')
  if (who.slug !== 'chief-of-staff') {
    const open = ANYONE.exec(text)
    if (open !== null) {
      const rest = text.slice(open[0].length).replace(/^\s+/, '')
      // Same rules as below: a task has to follow, and somebody else being named is a request to convene them.
      if (
        rest.split(/\s+/).filter(Boolean).length >= 3 &&
        !/^(?:and|&|,|then\b|plus\b)/i.test(rest)
      )
        return INTERROGATIVE.test(rest)
          ? `Tell me ${rest}`
          : rest.charAt(0).toUpperCase() + rest.slice(1)
    }
  }
  const refs = references(who)
  if (refs.length === 0) return text
  const named = refs.map(reEscape).join('|')
  const lead = new RegExp(
    `^\\s*(?:please\\s+|can you\\s+|could you\\s+)?(?:ask|have|get|tell|let)\\s+` +
      `(?:the\\s+)?(?:(?:${named})(?:\\s+(?:and\\s+)?(?:${named}))*)\\b(?:\\s+${ROLE_NOUN})?(?:'s\\s+${ROLE_NOUN})?` +
      `\\s*(?:to\\s+|if\\s+(?:she|he|they)\\s+can\\s+|whether\\s+|:\\s*)?`,
    'i',
  )
  const m = lead.exec(text)
  if (m === null) return text
  const rest = text.slice(m[0].length).replace(/^\s+/, '')
  // Nothing (or nearly nothing) after it is a request to talk to her, not a task.
  if (rest.split(/\s+/).filter(Boolean).length < 3) return text
  // "ask Daniel and Emma to ..." has somebody else in it: that is a request to convene Emma, and is left whole.
  if (/^(?:and|&|,|then\b|plus\b)/i.test(rest)) return text
  // The reference must have been the WHOLE subject: "ask Daniel and Emma to" names somebody else as well.
  const subject = text.slice(0, m[0].length).toLowerCase()
  const mentions = subject.match(/\b[a-z]{3,}\b/g) ?? []
  const allKnown = mentions.every(
    (w) =>
      [
        'please',
        'can',
        'you',
        'could',
        'ask',
        'have',
        'get',
        'tell',
        'let',
        'the',
        'and',
        'she',
        'he',
        'they',
        'if',
        'whether',
      ].includes(w) ||
      refs.includes(w) ||
      new RegExp(`^${ROLE_NOUN}$`).test(w),
  )
  if (!allKnown) return text
  const body = rest.charAt(0).toUpperCase() + rest.slice(1)
  return INTERROGATIVE.test(rest) ? `Tell me ${rest}` : body
}
