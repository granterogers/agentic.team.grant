/**
 * Is this something GRANT has to do, or something the office has to do?
 *
 * #259's routing paragraph, in its own words:
 *
 *   > `Remind me Friday to review the dashboard` → Personal Task.
 *   > `I need to send those documents tomorrow` → Personal Task.
 *   > `Research WhatsApp integration` → Agent Job.
 *
 * and the instruction that shapes how: *"distinguish ordinary human work from
 * agent work semantically rather than through brittle phrase lists."*
 *
 * ## The discriminator is grammatical, not lexical
 *
 * A list of trigger words is exactly the brittle thing the Issue warns against,
 * and this repository has the evidence: CLAUDE.md records a whitelist of source
 * schemes that refused a perfectly good address nobody had thought to write
 * down, and the rule that came out of it — **prefer a property over an
 * enumeration wherever the enumeration is of things a future change will add
 * to.**
 *
 * The property here is **who performs the verb**:
 *
 * | shape | subject | whose work |
 * |---|---|---|
 * | "remind me on Friday to ring them" | the office reminds, GRANT rings | his |
 * | "I need to send those documents" | I | his |
 * | "don't let me forget the invoice" | me | his |
 * | "research WhatsApp integration" | (imperative: you) | the office's |
 * | "I need YOU to find the hold-up" | you | the office's |
 *
 * Two rules, both about the grammatical subject, and one negative rule that
 * exists because the two families overlap in one place: *"I need you to…"* is
 * first person AND agent work, and `classifyIntent` already has a
 * `direct_command` rule by that name. Getting that one wrong turns every
 * delegation into a to-do.
 *
 * ## What this is NOT, said plainly
 *
 * It is not semantic. There is no model call here, and a sentence that means
 * "I have to do this" without saying so in the first person will be read as
 * agent work. That is the cheap direction: the cost of a miss is that the
 * office does the thinking and Grant gets an answer, which is the product he
 * already has. The cost of a false positive is a to-do item he did not ask for
 * and work he expected that never happened — so the rules are narrow on
 * purpose and every widening below is argued for.
 */

/*
  The office reminding him. The verb is "remind" and the object is HIM, which
  is what separates it from "remind the team" — a different request that this
  must not claim.
*/
/*
  BOTH apostrophes. iOS, macOS and every voice transcription this office
  receives produce U+2019, not U+0027 — so a rule written with a straight quote
  is a rule that does not fire on anything Grant dictates, which is most of
  what he sends. The corpus caught it on its first run.
*/
const APOS = "['\u2019\u02bc]?"
const REMIND_ME = new RegExp(
  `\\b(?:remind|nudge|ping|prompt)\\s+me\\b` +
    `|\\b(?:don${APOS}t|do\\s+not)\\s+(?:let\\s+me\\s+forget|forget\\s+to\\s+remind\\s+me)\\b`,
  'i',
)

/*
  A commitment in the first person: I need to, I have to, I must, I should,
  I've got to, I want to. The subject is I and the verb is his.

  `\s+to\b` matters: "I need the figures" is a request TO the office and "I
  need to send the figures" is a thing he is going to do. One word apart, and
  the wrong reading of the first is the expensive one.
*/
const I_MUST = new RegExp(
  `\\bi\\s+(?:need|have|want|ought|must|should|gotta|meant)\\s*(?:to|${APOS}ve\\s+got\\s+to)\\b` +
    `|\\bi${APOS}(?:m\\s+going\\s+to|ll)\\s+(?:need\\s+to|have\\s+to)\\b`,
  'i',
)

/*
  THE OVERLAP, and why there is no guard for it.

  "I need you to find the hold-up" is first person AND the office's work —
  `classifyIntent` already calls it `i-need-you-to`. A personal-task rule that
  swallowed it would turn every delegation Grant phrases politely into an item
  on his own list, and the work would simply not happen.

  It is excluded by the ADJACENCY in `I_MUST`: `need` must be followed
  immediately by `to`, so "need YOU to" does not match. That is a property of
  the pattern rather than a second rule, and the test corpus names it as one,
  so widening `I_MUST` breaks a test rather than quietly reopening the hole.

  A separate `ASKING_SOMEBODY` guard was written first and was worse than
  useless: deliberately removing it changed NOTHING across the whole corpus —
  a control that cannot fail is not a control — and it also refused
  **"I need you to remind me about the invoice"**, which is a reminder and
  belongs on his list. It caught nothing and cost a real case.
*/

/*
  A reminder that names somebody else is not his.
*/
const REMIND_SOMEBODY_ELSE = /\b(?:remind|nudge|ping)\s+(?!me\b)\w+/i

export interface PersonalTask {
  /** What he has to do, with the framing stripped. */
  readonly title: string
  /** A date, when the sentence carried one. ISO, or null. */
  readonly due: string | null
  /** Which rule matched, so a caller can say why and a test can assert it. */
  readonly because: 'reminder' | 'commitment'
}

/*
  When. Deliberately small: today, tomorrow, a weekday, "next week", and an
  explicit day-of-month.

  A date parser that tries harder is a date parser that files things on the
  wrong day, and the failure is silent — a task due Friday that landed on
  Monday looks like a task he forgot. Anything not recognised leaves `due`
  null, which puts it in the Inbox, which is the bucket for "sort this out".
*/
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

const iso = (d: Date): string => d.toISOString().slice(0, 10)

export function whenFor(said: string, now: Date = new Date()): string | null {
  const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  if (/\btoday\b|\bthis\s+evening\b|\btonight\b/i.test(said)) return iso(base)
  if (/\btomorrow\b/i.test(said)) {
    base.setUTCDate(base.getUTCDate() + 1)
    return iso(base)
  }
  const weekday = /\b(?:on\s+|next\s+|this\s+)?(sun|mon|tues?|wednes?|thurs?|fri|satur)day\b/i.exec(
    said,
  )
  if (weekday !== null) {
    const stem = String(weekday[1] ?? '')
      .toLowerCase()
      .slice(0, 3)
    const want = DAYS.findIndex((d) => d.startsWith(stem))
    if (want >= 0) {
      // The NEXT one, never today: "remind me on Friday" said on a Friday means
      // the Friday coming, not the one that is nearly over.
      let ahead = (want - base.getUTCDay() + 7) % 7
      if (ahead === 0) ahead = 7
      if (/\bnext\s/i.test(said) && ahead < 7) ahead += 7
      base.setUTCDate(base.getUTCDate() + ahead)
      return iso(base)
    }
  }
  if (/\bnext\s+week\b/i.test(said)) {
    base.setUTCDate(base.getUTCDate() + 7)
    return iso(base)
  }
  const dayOfMonth = /\bon\s+the\s+(\d{1,2})(?:st|nd|rd|th)?\b/i.exec(said)
  if (dayOfMonth !== null) {
    const day = Number(dayOfMonth[1])
    if (day >= 1 && day <= 31) {
      const here = new Date(base)
      here.setUTCDate(day)
      // A day already past means next month. "On the 3rd" said on the 20th is
      // not three weeks ago.
      if (here < base) here.setUTCMonth(here.getUTCMonth() + 1)
      // And a month that has no such day rolls, which is the one case where
      // saying nothing beats guessing.
      return here.getUTCDate() === day ? iso(here) : null
    }
  }
  return null
}

/*
  The title, with the framing removed.

  "Remind me on Friday to ring the venue" is a task called "ring the venue",
  not one called "remind me on Friday to ring the venue" — a list of reminders
  that all begin "remind me" is a list you cannot scan. The date words come out
  too, because they are in the due column now and saying them twice is how a
  task ends up contradicting its own date after he moves it.
*/
const stripFraming = (said: string): string =>
  said
    .replace(REMIND_ME, ' ')
    .replace(I_MUST, ' ')
    .replace(
      /\b(?:on\s+|next\s+|this\s+)?(?:today|tomorrow|tonight|this\s+evening|next\s+week|(?:sun|mon|tues?|wednes?|thurs?|fri|satur)day|on\s+the\s+\d{1,2}(?:st|nd|rd|th)?)\b/gi,
      ' ',
    )
    /*
      "I need you to remind me about the invoice" is a reminder, and its title
      is "the invoice" — not "I need you to about the invoice", which is what
      stripping only the reminder framing leaves behind.
    */
    .replace(
      new RegExp(
        `^\\s*(?:so\\s+)?(?:i\\s+(?:need|want|would\\s+like)\\s+(?:you|the\\s+team)\\s+to|` +
          `can\\s+you|could\\s+you|please)\\b`,
        'i',
      ),
      ' ',
    )
    .replace(/^\s*(?:to|that|about|and)\b/i, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, '')

/**
 * Grant's own work, or null.
 *
 * Null is the ordinary answer and the safe one: everything the office already
 * did with an instruction, it still does.
 */
/**
 * "Remind me WHY we decided X" is a question, not a reminder.
 *
 * Found by attacking the office with a false premise. Asked *"Remind me why we
 * decided to drop the Tuesday cohort"* — a decision that never happened — it
 * created a **personal task on Grant's real list** called "Why we decided to
 * drop the cohort", due in four days, and answered:
 *
 *     That is on your list for 2026-09-22.
 *     [evidence: verified · confidence: high]
 *
 * Verified and high confidence, because by then the task genuinely existed:
 * the office had made it. The false premise went unchallenged and the answer
 * looked authoritative, which is the worst available combination — a
 * fabrication laundered through a row the office created itself.
 *
 * The expensive direction here is the false POSITIVE, unusually. Missing a
 * real reminder costs him retyping one sentence; inventing a task from a
 * question puts something he never asked for on the list he is supposed to
 * trust, AND swallows the question.
 *
 * ## Why only these four words
 *
 * `why`, `what`, `who` and `whether` after "remind me" are almost never a
 * reminder framing — they ask to be TOLD something now.
 *
 * `when` and `where` are deliberately NOT in the list: *"remind me when the
 * deadline approaches"* is a perfectly good reminder and means the opposite of
 * *"remind me when the deadline is"*. Guessing between them would trade a
 * defect for a coin flip, so they keep today's behaviour.
 *
 * ADJACENCY is what separates them, not the presence of "to" somewhere in the
 * sentence. The first version used a negative lookahead for "to" across the
 * whole string and was defeated by its own example: *"remind me why we
 * decided TO DROP the cohort"* contains one, so the guard did not fire on the
 * very sentence it was written for. The question word has to follow "remind
 * me" directly — which also leaves *"remind me to ask what the price is"*
 * alone, because there "to" comes first.
 */
const REMIND_ME_A_QUESTION = /\bremind\s+me\s+(?:again\s+)?(?:why|what|who|whether)\b/i

export function personalTaskRequest(text: string, now: Date = new Date()): PersonalTask | null {
  const said = text.trim()
  if (said === '') return null
  if (REMIND_ME_A_QUESTION.test(said)) return null
  const remind = REMIND_ME.test(said) && !REMIND_SOMEBODY_ELSE.test(said)
  const commit = I_MUST.test(said)
  if (!remind && !commit) return null

  const title = stripFraming(said)
  /*
    A title of nothing is not a task. "Remind me" on its own is a sentence with
    no work in it, and filing an empty row would be the placeholder this
    repository keeps refusing to ship — CLAUDE.md's card with nothing in it.
  */
  if (title.length < 3) return null

  return {
    title: title.charAt(0).toUpperCase() + title.slice(1),
    due: whenFor(said, now),
    because: remind ? 'reminder' : 'commitment',
  }
}
