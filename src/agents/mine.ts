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

import { calendarDateIn } from './due.ts'
import { withoutOpeningAffirmation } from './intent.ts'
import { mentionsWithoutAsking } from './not-a-request.ts'
import { localDay, localIsoDay, OPERATOR_TIMEZONE, wallClock, weekdayOf } from './office-time.ts'
import { type Recurrence, recurrenceOf, withoutTheRepeat } from './recurrence.ts'
import {
  clockOf,
  defaultReminderAt,
  REMIND_TIME_WORDS,
  remindAtFor,
  spokenToDigits,
} from './remind-at.ts'
import { DANGLING_AFTER_A_DATE, PROJECT_ADJUNCT } from './request.ts'
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
import { sentencesOf } from './sentences.ts'

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
/*
  `remember to` is invisible between the modal and the `to`.

  "Oh — I must remember to renew the domain before it lapses" is the same
  sentence as "I must renew the domain", and the adjacency this pattern relies
  on made it a miss: `must` has to be followed by `to`, and here it is followed
  by `remember`. Found in the independent acceptance pass. The alternative goes
  BEFORE the bare `to` so that "I need to remember to X" matches the longer
  form and the whole framing — not just "I need to" — comes off the title.
*/
const I_MUST = new RegExp(
  `\\bi\\s+(?:need|have|want|ought|must|should|gotta|meant)\\s*` +
    `(?:remember\\s+to|to\\s+remember\\s+to|to|${APOS}ve\\s+got\\s+to)\\b` +
    `|\\bi${APOS}(?:m\\s+going\\s+to|ll)\\s+(?:need\\s+to|have\\s+to)\\b`,
  'i',
)

/*
  A QUESTION ABOUT WHAT HE MUST DO IS NOT A COMMITMENT TO DO IT.

  "When do I have to pay the venue deposit, and how much is it?" matched `I_MUST` and was filed as a task titled
  "When do pay the venue deposit, and how much is it?" - found by the first controlled real-model run, in one of five
  ways of asking the same question. The same shape is every natural question about an obligation: "Do I need to call the
  accountant?", "What do I need to bring on Friday?", "Why do I have to renew the licence?". A task nobody asked for sits
  on the list he is supposed to trust, so this is the expensive direction.

  The mark of the question is the auxiliary in front of the "I" (do I, should I, must I, will I, can I): a statement of
  need ("I need to call the accountant") never has one. Read per SENTENCE, so a question and a real commitment in one
  message ("When do I need to be there? Also I need to call Kevin tomorrow.") still files the second.
*/
const ASKING_WHETHER_I_MUST =
  /\b(?:do|does|did|should|shall|must|will|would|can|could|am|have|had)\s+(?:i|we)\s+(?:really\s+|actually\s+|also\s+)?(?:need|have|want|ought|must|gotta|meant|remember)\b/i
const isMust = (sentence: string): boolean =>
  I_MUST.test(sentence) && !ASKING_WHETHER_I_MUST.test(sentence)

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

/*
  ASKING FOR A TASK OUTRIGHT, which neither rule above could hear.

  "Right, set aside a task to renew the insurance" and "Anyway, put a task on
  my list to review the pricing" are not reminders and are not first-person
  commitments — they are Grant naming the mechanism. `REMIND_ME` wants the word
  remind and `I_MUST` wants "I <verb> to", so both missed them entirely and the
  sentence fell through to the office's own work.

  Deliberately requires the NOUN. "Add the figures" is not a request for a task
  and "make the deck" is work for the team; what distinguishes these is that he
  said the word task, to-do or reminder.
*/
/*
  "to" followed by a VERB, not by a noun phrase.

  The discriminator that lets `note`, `item`, `entry` and `line` into the
  to-do class at all: a note TO DO something is an action, a note OF
  something is a record.

  The first version tested `to` followed by any lower-case letter, and
  "add a line ABOUT THE DISCOUNT TO THE DRAFT" matched on a PREPOSITION -
  it would have filed a task called "The draft" from a request to edit a
  document. Excluding the determiners and pronouns is what makes it an
  infinitive test rather than a "to" test, and it was a negative control
  that caught it rather than the corpus.
*/
const BARE_INFINITIVE =
  '(?!(?:the|a|an|my|our|your|his|her|its|this|that|these|those|it|them|him|me|us)\\b)[a-z]'

const MAKE_A_TASK =
  /\b(?:set\s+aside|put|add|create|make|stick|note)\s+(?:me\s+)?(?:a|an|another)\s+(?:task|to-?do|reminder)\b/i

/*
  THE SAME REQUEST WITH A WORD THAT ALSO MEANS SOMETHING ELSE.

  "Make me a note to ring Kevin back" is the mission's own example of
  indirect future-action intent, and it filed nothing: the verb list above
  contains `note` and the NOUN list does not, so the one construction where
  `note` is unmistakably a to-do fell through. `item`, `entry` and `line`
  were missing the same way - the class is "a thing on my list" and only
  three of its words were in it.

  They are not in the list above because they are polysemous. "Make a note
  OF the price" is a record and must stay out, and so must "I made a note
  about that yesterday".

  The INFINITIVE is what separates them, and it is structural rather than
  lexical: a note TO DO something is an action, a note OF something is a
  record. That also means this generalises to phrasings nobody listed -
  "leave me a note to...", "drop an item on to..." - while "note of",
  "note about" and "note on the pricing" are excluded by grammar rather
  than by being enumerated.
*/
const MAKE_AN_ITEM_TO = new RegExp(
  `\\b(?:set\\s+aside|put|add|create|make|stick|leave|drop|chuck|bung)\\s+(?:me\\s+)?` +
    `(?:a|an|another)\\s+(?:note|item|entry|line|memo)\\b[^.?!]{0,20}?\\bto\\s+${BARE_INFINITIVE}`,
  'i',
)

/*
  And the self-commitment that does not start with "I".

  "So, make sure I call the accountant on Friday" has the same subject as
  "I need to call the accountant" and none of its shape. `I_MUST` anchors on
  "i <verb> to" and cannot see it.
*/
const MAKE_SURE_I = /\bmake\s+sure\s+(?:that\s+)?i\b/i

/*
  THE SAME MECHANISM NAMED WITHOUT THE NOUN.

  "Stick 'call the accountant' on my list for Tuesday" and "put chasing the
  invoice on my to-do list" name the list rather than the word task, so
  `MAKE_A_TASK` — which deliberately requires the noun — could not hear either.
  `stripFraming` had been taking "on my list" out of titles since it was
  written, which is the tell: the phrase was already understood as framing by
  everything except the rule that decides.

  A PUTTING VERB is required, and it is what keeps the question out. "What is
  on my list for today?" has the phrase and no verb, so it stays the office's
  work, which is the reading that answers him. The span between the two is
  bounded and may not cross a sentence end, because a title is not a paragraph.
*/
const ON_MY_LIST =
  /\b(?:set\s+aside|put|add|stick|chuck|bung|note|shove)\b[^.?!]{2,100}?\bon\s+my\s+(?:to-?do(?:\s+list)?|list|plate)\b/i

/*
  And the shape a person types when they are in a hurry: "Add: buy a present".

  The COLON is doing all the work. `add` on its own is far too broad — "add the
  figures to the deck" is work for the team — but nobody writes "Add:" at the
  start of a line meaning anything other than put this on the list.
*/
const ADD_COLON = /^\s*(?:add|to-?do|todo|task)\s*:\s*\S/i

/*
  ASKING WHETHER IT IS ALREADY THERE.

  "Did I ever add a task about the domain?" said the word task and created one
  — called *"Did I ever about the domain?"*, because the framing strip took the
  verb out of the middle of his question. Two costs in one sentence: a row he
  never asked for on the list he is supposed to trust, and the question
  swallowed.

  Adjacency again, for the reason `REMIND_ME_A_QUESTION` gives: the
  interrogative opener has to be directly in front of the putting verb. That
  leaves "Can you add a task to review the Q4 numbers" alone — a polite request
  rather than a question about the past — and it cannot be defeated by a
  question mark somewhere else in the message.
*/
const ASKING_WHETHER_IT_EXISTS =
  /\b(?:did|do|does|have|has|was|were)\s+(?:i|we|you)\s+(?:ever\s+|already\s+|actually\s+)?(?:add|create|put|make|set|stick|note)\b/i

/*
  The guard that keeps all of this on HIS list.

  "Add a task for Emma to research the pricing" says the word task and is the
  office's work — the same distinction `REMIND_SOMEBODY_ELSE` draws for
  reminders, drawn again because a rule that recognises the noun has to be
  told who it is for.
*/
const A_TASK_FOR_SOMEBODY_ELSE = /\b(?:task|to-?do|reminder)\s+for\s+(?!me\b|myself\b|us\b)\w+/i

export interface PersonalTask {
  /** What he has to do, with the framing stripped. */
  readonly title: string
  /** A date, when the sentence carried one. ISO, or null. */
  readonly due: string | null
  /** Which rule matched, so a caller can say why and a test can assert it. */
  readonly because: 'reminder' | 'commitment'
  /**
   * The instant to remind him, when he said a time (ledger R24). ISO, or
   * null. Optional so every older reader of this shape is unchanged.
   */
  readonly remindAt?: string | null
  /**
   * The reminder time is the office's default (nine, office time) because he
   * asked to be reminded on a day and named no time (R1). Optional like
   * `remindAt`; absent means he said a time, or there is no reminder.
   */
  readonly remindDefaulted?: boolean
  /** The default time had already passed today, so the reminder is for now (R1). */
  readonly remindImmediate?: boolean
  /** The repeat he asked for and the office can keep, when he asked for one (R3). */
  readonly repeat?: Recurrence | null
  /** The words of a repeat he asked for that the office cannot keep, so the reply can say so (R3). */
  readonly repeatUnsupported?: string | null
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

/** The calendar day an instant falls on in the office's zone. */
const localIso = (instant: string, timeZone = OPERATOR_TIMEZONE): string =>
  localIsoDay(new Date(instant), timeZone)

const SMALL: Readonly<Record<string, number>> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
}

/** Calendar months, clamped: the 31st plus one month is the 30th. */
const addMonths = (from: Date, n: number): Date => {
  const want = from.getUTCDate()
  const out = new Date(from)
  out.setUTCDate(1)
  out.setUTCMonth(out.getUTCMonth() + n)
  const last = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate()
  out.setUTCDate(Math.min(want, last))
  return out
}

export function whenFor(
  said: string,
  now: Date = new Date(),
  timeZone = OPERATOR_TIMEZONE,
): string | null {
  /*
    TODAY is the office's calendar day, not the server's (Z1). At 23:30 UTC it is
    already tomorrow in Athens and already today in New York, and a "tomorrow"
    read off the UTC date was a day out for one of them. `base` is a bare
    calendar date from here on, so the arithmetic below is plain UTC date maths
    on a day that was chosen in the right zone.
  */
  const local = localDay(now, timeZone)
  const base = new Date(Date.UTC(local.y, local.m, local.d))
  if (/\btoday\b|\bthis\s+evening\b|\btonight\b/i.test(said)) return iso(base)
  if (/\btomorrow\b/i.test(said)) {
    base.setUTCDate(base.getUTCDate() + 1)
    return iso(base)
  }
  /*
    A date written out: "on 15 October", "October 15th", "2026-10-15". The same
    reader `dueOn` uses, so "by 15 October" and "remind me on 15 October" agree.
    Before the weekday, because "Friday 16 October" is the 16th and the next
    Friday is a different day when they disagree. A date that does not exist
    (31 February) is NOT a date: null, and the words stay in the title.
  */
  const written = calendarDateIn(said, now, timeZone)
  if (written === null) return null
  if (written !== undefined) return written.on
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
  /*
    "Next month" and "in three weeks" were both misses in the independent
    acceptance pass — "that can wait until next month" recognised nothing at
    all and left the follow-up unanswered.

    A month is added by CALENDAR month and then clamped: the 31st plus one
    month is the 30th, not the 1st of the month after. The day-of-month branch
    below returns null on a roll rather than guessing, and that is right there
    — "on the 31st" names a specific day and February has none — but "next
    month" names a DISTANCE, so the nearest real day is what it meant.
  */
  if (/\bnext\s+month\b/i.test(said)) return iso(addMonths(base, 1))
  const inN =
    /\bin\s+(\d{1,3}|a|an|one|two|three|four|five|six|seven)\s+(day|week|month|fortnight)s?\b/i.exec(
      said,
    )
  if (inN !== null) {
    const word = String(inN[1] ?? '').toLowerCase()
    const n = /^\d+$/.test(word) ? Number(word) : (SMALL[word] ?? 1)
    const unit = String(inN[2] ?? '').toLowerCase()
    if (n >= 1 && n <= 365) {
      if (unit === 'month') return iso(addMonths(base, n))
      base.setUTCDate(base.getUTCDate() + n * (unit === 'week' ? 7 : unit === 'fortnight' ? 14 : 1))
      return iso(base)
    }
  }
  const dayOfMonth = /\b(?:on|by|before|until)\s+the\s+(\d{1,2})(?:st|nd|rd|th)?\b/i.exec(said)
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
  /*
    The conversational opener comes off FIRST, and from the shared helper.

    "Fine, remind me tomorrow to chase the printers" was becoming a task called
    *"Fine, to chase the printers"* — the framing word kept and the sentence
    left as a fragment, on the list this function exists to make scannable.
    Six of the ten phrasings in Grant's own brief did it.

    `withoutOpeningAffirmation` already knows every one of those openers,
    because `classifyIntent` needed the same thing for the same reason last
    week. A second list here would be two places for "Anyway" to be forgotten.
  */
  withoutOpeningAffirmation(spokenToDigits(said))
    /*
      "Put down THAT I need to send the insurers the claim form" (ledger R38):
      a commitment introduced by "that" is the object of whatever came before
      it — put down, note down, make a note, just so you know — so that part
      is framing, however it is worded. Only when "that" is directly followed
      by his first-person commitment, so a "that" inside the work is untouched.
    */
    .replace(
      /^[^.?!]{0,60}?\bthat\s+(?=i(?:\s+|['\u2019])(?:need|have|want|ought|must|should|gotta|meant|ve|m|ll)\b)/i,
      '',
    )
    // The time of day comes out with the date (ledger R24): it is in remind_at.
    .replace(REMIND_TIME_WORDS, ' ')
    .replace(REMIND_ME, ' ')
    .replace(I_MUST, ' ')
    /*
      The infinitive belongs to the framing, not to the title.

      "Put a to-do ON TO check the numbers" was titling itself "On to check
      the numbers" - a pre-existing defect in this older path, the same
      shape as the one below and worth fixing with it rather than leaving
      one of two identical bugs standing.
    */
    .replace(new RegExp(`${MAKE_A_TASK.source}\\b[^.?!]{0,12}?\\b(?:on\\s+)?to\\s+`, 'i'), ' ')
    /*
      "Create a task called PAY NOW" is a task called "PAY NOW", not one called "Called PAY NOW": the naming word is part
      of the frame. Found by the first controlled real-model run, in a sentence a person can type in plain English.
    */
    .replace(
      new RegExp(`${MAKE_A_TASK.source}\\s*(?:called|named|titled|entitled)\\b\\s*:?\\s*`, 'i'),
      ' ',
    )
    .replace(MAKE_A_TASK, ' ')
    /*
      "Make me a note to ring Kevin" is a task called "Ring Kevin".

      The whole framing comes off - verb, article, artifact noun and the
      infinitive "to" - leaving the action. Stripping only the noun would
      title it "Make me to ring Kevin"; leaving the framing on titles it
      with the request rather than the work, which is what the list is for.

      The `to` is consumed here rather than by the leading-word pass below,
      because that pass runs once and there are two of them in "put an
      entry ON TO email the officer".
    */
    .replace(
      new RegExp(
        `\\b(?:set\\s+aside|put|add|create|make|stick|leave|drop|chuck|bung)\\s+(?:me\\s+)?` +
          `(?:a|an|another)\\s+(?:note|item|entry|line|memo)\\b[^.?!]{0,20}?\\bto\\s+(?=${BARE_INFINITIVE})`,
        'i',
      ),
      ' ',
    )
    /*
      "Stick X on my list" keeps X and loses everything around it.

      A plain strip of the phrase would leave "Stick chasing the invoice", and
      a strip of the leading verb as well would be a rule that fires on every
      title beginning with `add` — including the perfectly good
      "remind me to add the figures to the deck". Capturing what sits BETWEEN
      the verb and the phrase is the only version that cannot reach a title it
      was not called about.
    */
    .replace(
      /\b(?:set\s+aside|put|add|stick|chuck|bung|note|shove)\s+(?:the\s+)?(.{2,100}?)\s+on\s+my\s+(?:to-?do(?:\s+list)?|list|plate)\b/i,
      (_m, kept: string) => ` ${String(kept)} `,
    )
    .replace(/\bon\s+my\s+(?:to-?do(?:\s+list)?|list|plate)\b/gi, ' ')
    .replace(/^\s*(?:add|to-?do|todo|task)\s*:\s*/i, ' ')
    .replace(MAKE_SURE_I, ' ')
    .replace(
      /\b(?:for\s+|by\s+|until\s+|before\s+|on\s+|next\s+|this\s+)?(?:today|tomorrow|tonight|this\s+evening|next\s+week|next\s+month|in\s+(?:\d{1,3}|a|an|one|two|three|four|five|six|seven)\s+(?:day|week|month|fortnight)s?|(?:sun|mon|tues?|wednes?|thurs?|fri|satur)day|(?:on|by|before|until)\s+the\s+\d{1,2}(?:st|nd|rd|th)?)\b/gi,
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
    /*
      The word left dangling at the front.

      This list already existed for `to`, `that`, `about` and `and` — the
      leftovers of the reminder framing. The conversational openers leave their
      own: "ok but remind me…" became *"But to check the refund policy"* and
      "Sorry, one more — I need to…" became *"One more — email the landlord"*.
      Widened rather than given a second pass of its own, because two lists of
      leading words are two places for the next one to be missed.
    */
    /*
      The project this is FOR is not what it is called.

      From the shared class in `request.ts`, because `tasks.ts` needs exactly
      the same one and #307 was fixed in that one alone - the very next live
      session wrote "On coaching to book the venue, end of" through THIS
      path. Two titlings, one list.

      Placed ABOVE the leading-word passes deliberately: it leaves the "to"
      of "on coaching TO book the venue", and those passes already exist to
      take it. A second strip here would be the second list this file's own
      comment warns about.
    */
    .replace(/^\s+/, '')
    .replace(PROJECT_ADJUNCT, '')
    .replace(/^\s*(?:to|that|about|and|but|so|then|also|right|well|now|one\s+more)\b/gi, ' ')
    .replace(/^[\s,.:;—–-]+/g, ' ')
    .replace(/^\s*(?:to|that|about|and)\b/i, ' ')
    .replace(/\s{2,}/g, ' ')
    /*
      And the preposition a removed date leaves behind: this path strips
      "next week" and left "…, end of". Same shared class the project task
      writer uses after its own resolver has run.
    */
    .replace(DANGLING_AFTER_A_DATE, '')
    .replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, '')
    /*
      The quotes come off LAST and only in a matched pair, so a title that
      genuinely contains one ("the 6\" spacer") keeps it.
    */
    .replace(/^(['\u2018\u201c"])(.+)\1$/u, (_m, _q: string, inner: string) => String(inner))
    .replace(/^[\u2018\u201c](.+)[\u2019\u201d]$/u, (_m, inner: string) => String(inner))

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
 * `how` joined them in the independent acceptance pass: *"Remind me how the
 * pricing works"* created a task called **"How the pricing works"** and
 * swallowed the question. It belongs with `why` rather than with `when` for
 * the reason that paragraph gives — there is no reminder reading of "remind me
 * how", where "remind me when the deadline approaches" has an obvious one.
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
const REMIND_ME_A_QUESTION = /\bremind\s+me\s+(?:again\s+)?(?:why|what|who|whether|how)\b/i

/** The sentences that carry a personal-task request frame, when the message has other sentences too; else null. */
const requestSentences = (said: string): string | null => {
  const sentences = sentencesOf(said)
  if (sentences.length < 2) return null
  const carriers = sentences.filter(
    (x) =>
      (REMIND_ME.test(x) && !REMIND_SOMEBODY_ELSE.test(x)) ||
      isMust(x) ||
      ADD_COLON.test(x) ||
      ((MAKE_A_TASK.test(x) ||
        MAKE_AN_ITEM_TO.test(x) ||
        MAKE_SURE_I.test(x) ||
        ON_MY_LIST.test(x)) &&
        !A_TASK_FOR_SOMEBODY_ELSE.test(x)),
  )
  return carriers.length === 0 || carriers.length === sentences.length ? null : carriers.join(' ')
}

export function personalTaskRequest(
  text: string,
  now: Date = new Date(),
  timeZone = OPERATOR_TIMEZONE,
): PersonalTask | null {
  const said = text.trim()
  if (said === '') return null
  if (REMIND_ME_A_QUESTION.test(said)) return null
  if (ASKING_WHETHER_IT_EXISTS.test(said)) return null
  // A prohibition, an advice question or somebody else's words (ledger R34).
  if (mentionsWithoutAsking(said)) return null
  const remind = REMIND_ME.test(said) && !REMIND_SOMEBODY_ELSE.test(said)
  const commit =
    sentencesOf(said).some(isMust) ||
    ADD_COLON.test(said) ||
    ((MAKE_A_TASK.test(said) ||
      MAKE_AN_ITEM_TO.test(said) ||
      MAKE_SURE_I.test(said) ||
      ON_MY_LIST.test(said)) &&
      !A_TASK_FOR_SOMEBODY_ELSE.test(said))
  if (!remind && !commit) return null

  /*
    THE TASK IS THE SENTENCE THAT ASKED FOR IT (final audit, invariant 4).

    A message with a rule and a question around a reminder filed the WHOLE message as the title:
    "From now on give me the conclusion first. Also to call Kevin. And what is the status of the venue?". The other
    clauses have their own readers (the rule is stored, the question is answered), so a title that swallows them is
    one clause performed twice and the task unreadable. Only when a sentence of its own carries the request frame;
    a one-sentence message, and one whose frame straddles sentences, read exactly as before.
  */
  const carried = requestSentences(said)
  const asked = carried === null ? said : carried
  /*
    A REPEAT is read from the sentence that asked, and its words leave the
    title only when the office can keep it (R3). One it cannot keep ("every
    month") stays in the title, where he can read it, and is reported back so
    the reply can say it was not recorded rather than dropping it.
  */
  const repeating = recurrenceOf(asked)
  const rec = repeating !== null && 'every' in repeating ? repeating : null
  const unsupported =
    repeating !== null && 'unsupported' in repeating ? repeating.unsupported : null
  /*
    A date written out ("on 15 October") is in the due column once `whenFor`
    has read it, so its words leave the title the way "on Friday" does; the
    reader that resolves it is the one that says which words they were.
  */
  /*
    A repeat the office cannot keep is neither a date nor part of the work: the
    weekday inside "every first Monday" must not become a due date, and its
    words must not mangle the title ("Every first to run the report"). So it is
    read out of the text the dates come from, and put back on the END of the
    title in brackets, where he can read what he asked for and the reply says
    it was not recorded.
  */
  const unsaid = (text: string): string =>
    unsupported === null ? text : text.replace(unsupported, ' ').replace(/\s{2,}/g, ' ')
  const dateSaid = unsaid(said)
  const askedSans = unsaid(asked)
  const written = rec === null ? calendarDateIn(askedSans, now, timeZone) : undefined
  const escaped = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const titled =
    rec !== null
      ? withoutTheRepeat(asked, rec)
      : written
        ? askedSans.replace(
            new RegExp(`(?:\\b(?:on|by|before|until|for)\\s+)?${escaped(written.from)}`, 'i'),
            ' ',
          )
        : askedSans
  const base = stripFraming(titled.replace(/^(?:also|and|then|plus)[,\s]+/i, ''))
  const title = unsupported === null || base.length < 3 ? base : `${base} (${unsupported})`
  /*
    A title of nothing is not a task. "Remind me" on its own is a sentence with
    no work in it, and filing an empty row would be the placeholder this
    repository keeps refusing to ship — CLAUDE.md's card with nothing in it.
  */
  if (base.length < 3) return null

  /*
    The time, when he said one (ledger R24), and the day it lands on when he
    gave a time and no day: "remind me at 3pm" is a reminder TODAY, and a task
    with no date sits in the Inbox where a reminder is the wrong place for it.
  */
  const cased = title.charAt(0).toUpperCase() + title.slice(1)
  if (rec !== null) {
    const first = firstOccurrence(rec, clockOf(said), now, timeZone)
    const said_a_time = clockOf(said) !== null
    /*
      Two shapes, by what he asked for. "Remind me every Monday to X" is a REMINDER SERIES: a reminder time and a repeat
      and NO due date, one row that moves to its next occurrence when it is delivered and that ticking off ENDS.
      A repeating COMMITMENT ("I need to review the books every Monday") is a repeating TASK: it has a due date and
      ticking it off makes the next occurrence. A due date invented for the series would turn it into the second kind.
    */
    return {
      title: cased,
      due: remind ? null : localIsoDay(first, timeZone),
      because: remind ? 'reminder' : 'commitment',
      // A repeating COMMITMENT with no time said is a dated, repeating to-do, not a reminder.
      remindAt: remind || said_a_time ? first.toISOString() : null,
      remindDefaulted: remind && !said_a_time,
      repeat: rec,
      repeatUnsupported: null,
    }
  }
  const day = whenFor(dateSaid, now, timeZone)
  let remindAt = remindAtFor(dateSaid, day, now, timeZone)
  /*
    R1. "Remind me on Friday to ring the venue" gave a due date and no remind_at,
    so the duty that sends reminders had nothing to read and the reminder he
    asked for never arrived. When he asks to be REMINDED, and names a day and no
    time, the time is nine in the morning, office time. Not for a commitment:
    "I need to send the form by Friday" is a due date and nothing else, and a
    time he did not ask for would make the duty announce it.
  */
  let defaulted = false
  let immediate = false
  if (remind && remindAt === null && day !== null) {
    const d = defaultReminderAt(day, now, timeZone)
    remindAt = d.at
    defaulted = true
    immediate = d.immediate
  }
  return {
    title: cased,
    due: day ?? (remindAt === null ? null : localIso(remindAt, timeZone)),
    because: remind ? 'reminder' : 'commitment',
    remindAt,
    remindDefaulted: defaulted,
    remindImmediate: immediate,
    repeat: null,
    repeatUnsupported: unsupported,
  }
}

/**
 * The first time a repeating reminder is for: the next moment that is on the
 * named weekday (if one was named) at the time of day he said, else at nine.
 *
 * "Every Monday at 4pm" said on Monday at 17:00 is next Monday; said at 10:00 it
 * is today. A repeat with no weekday and a period of a week or more ("weekly",
 * "every 2 weeks") starts one period from today, because there is no day to
 * land on and "today" would be the one day he cannot have meant. Everything is
 * worked out on the office's wall clock, so a daily nine o'clock stays nine
 * across a change of clocks.
 */
const firstOccurrence = (
  rec: Recurrence,
  clock: { hh: number; mm: number } | null,
  now: Date,
  timeZone: string,
): Date => {
  const hh = clock?.hh ?? 9
  const mm = clock?.mm ?? 0
  const today = localDay(now, timeZone)
  if (rec.weekday === null && rec.days >= 7) {
    return wallClock(today.y, today.m, today.d + rec.days, hh, mm, timeZone)
  }
  for (let ahead = 0; ahead <= 14; ahead++) {
    if (rec.weekday !== null && weekdayOf(today.y, today.m, today.d + ahead) !== rec.weekday)
      continue
    const at = wallClock(today.y, today.m, today.d + ahead, hh, mm, timeZone)
    if (at.getTime() > now.getTime()) return at
  }
  return wallClock(today.y, today.m, today.d + 1, hh, mm, timeZone)
}

/* ------------------------------------------------------- changing your mind */

/**
 * What a follow-up asks to CHANGE about the task just made (#259).
 *
 * "Remind me Friday to ring the venue" worked. *"Actually make that Monday"*
 * did nothing at all — the office had no way to change a personal task from a
 * conversation, only from the screen. Grant's brief for this run names it:
 * *"follow-ups changing due date, priority, project or wording"*.
 *
 * ## Both halves are required, and that is the safety
 *
 * A REFERENT — that, it, the task, that one — **and** a CHANGE. Either alone is
 * dangerous in a different direction:
 *
 * - A change with no referent is an ordinary sentence. "Friday is going to be
 *   busy" would move a task nobody mentioned.
 * - A referent with no change is a remark. "That is fine" would rewrite
 *   something to nothing.
 *
 * The referent also has to be BARE. "Make that pricing document urgent" names
 * a subject, so it is not this — it is work for the office, and stealing it
 * would be the delegation-captured-as-a-personal-task failure that
 * `A_TASK_FOR_SOMEBODY_ELSE` exists to prevent one rule along.
 *
 * ## What it deliberately cannot do
 *
 * Choose WHICH task. This returns the change and nothing else; the handler
 * resolves the subject as the most recent open personal task and SAYS which
 * one it changed. A recogniser that also guessed the target from a fuzzy title
 * match would be one bad match away from editing the wrong row, and the whole
 * point of a to-do list is that it says what you put in it.
 */
export interface PersonalTaskChange {
  /** An ISO date, when the follow-up moved it. */
  readonly due: string | null
  /** 10 urgent · 20 important · 50 normal · 100 whenever, matching the column. */
  readonly priority: number | null
  /** A new title, when the follow-up renamed it. */
  readonly title: string | null
  /** Which words matched, so a caller can say why and a test can assert it. */
  readonly matched: readonly string[]
  /**
   * The task NAMED rather than pointed at - "move the Hartley one to Monday"
   * (ledger R29). Null for a bare referent, which is the older, conversation-
   * scoped case. Optional so older readers of this shape are unchanged.
   */
  readonly name?: string | null
}

/*
  A bare referent. `\b(that|it|this)\b` NOT followed by a noun — "make that
  Friday" yes, "make that document urgent" no. `one` is included because "move
  that one to Monday" is how people actually say it.
*/
/*
  The date vocabulary, as one pattern. The same words `stripFraming` takes out
  of a title, kept here so the residue test and the title strip cannot come to
  disagree about what counts as a date.
*/
const WHEN_WORDS =
  /\b(?:on\s+|next\s+|this\s+|to\s+|until\s+|by\s+|for\s+|before\s+)?(?:today|tomorrow|tonight|this\s+evening|next\s+week|next\s+month|in\s+(?:\d{1,3}|a|an|one|two|three|four|five|six|seven)\s+(?:day|week|month|fortnight)s?|(?:sun|mon|tues?|wednes?|thurs?|fri|satur)day|(?:on|by|before|until)\s+the\s+\d{1,2}(?:st|nd|rd|th)?)\b/gi

const BARE_REFERENT =
  /\b(?:that|this|it|that\s+one|the\s+task|the\s+reminder)\b(?!\s+[a-z]{3,}(?:\s|$))|\b(?:that|this|it)\b\s*$/i

/* Explicitly changing the subject of the previous turn, in the ways people do. */
const CHANGING =
  /\b(?:actually|instead|rather|make|move|change|rename|push|bump|call|set|sorry|no|can\s+wait|hold\s+off)\b/i

/*
  Ordered least-greedy FIRST, and the loop takes the first match.

  The original had `priorit(y|ise|ize)` in the "important" row, so "change it to
  LOW priority" matched `priority` and came back as 20 — the opposite of what
  was asked. A list of patterns where an earlier one can swallow a later one's
  phrase is a list whose order is load-bearing, so the specific two-word
  phrases are checked before the single words that appear inside them.
*/
const URGENCY: ReadonlyArray<readonly [RegExp, number]> = [
  /*
    "down the list" and "up the list" say the same thing as low and high, and
    they were both misses in the independent acceptance pass. They match the
    PHRASE and not the referent in front of it: "bump that up the list" has to
    leave "that" behind, because the residue is what proves the sentence is
    about the last task rather than about a new subject.
  */
  [
    /\b(?:down\s+the\s+list|less\s+important|can\s+wait|no\s+hurry|whenever|low\s+priority|no\s+rush|not\s+urgent|deprioriti[sz]e)\b/i,
    100,
  ],
  [/\b(?:normal|medium|ordinary)\s+priority\b/i, 50],
  [/\b(?:urgent|top\s+priority|drop\s+everything|asap)\b/i, 10],
  [/\b(?:up\s+the\s+list|more\s+important|important|high\s+priority|priorit(?:y|ise|ize))\b/i, 20],
]

/*
  The rename shapes, and why there are now six of them.

  The first version knew "call it X", "rename it to X" and "make it called X",
  which is what somebody writes when they are already thinking about the field.
  In the independent acceptance pass, *"rename that to …"* and *"change the
  wording to …"* both did nothing at all — the first because it says `that`
  rather than `it`, which is a difference of one word and no meaning, and the
  second because it names the thing being changed instead of the task.

  The referent alternatives (`it|that|this`) come from the same family
  `BARE_REFERENT` protects, so widening them cannot reach a sentence with a
  subject in it. The quotes people put round a dictated title come off here for
  the reason they come off a new task's title: the marks are how you say "these
  exact words out loud", not part of them.
*/
const RENAME =
  /\b(?:call\s+(?:it|that|this)|rename\s+(?:it|that|this|the\s+[a-z0-9'’ -]{2,40}?\s+(?:one|task|to-?do|reminder))(?:\s+to)?|make\s+(?:it|that|this)\s+called|change\s+(?:the\s+)?(?:wording|title|name)(?:\s+of\s+(?:it|that|this))?\s+to)\s+(.{2,120}?)\s*$/i

/** The quotes round a dictated title, in a matched pair only. */
const unquote = (t: string): string =>
  /^(['\u2018\u201c"])(.+)\1$/u.test(t)
    ? t.slice(1, -1)
    : /^[\u2018\u201c](.+)[\u2019\u201d]$/u.test(t)
      ? t.slice(1, -1)
      : t

export function personalTaskChange(
  text: string,
  now: Date = new Date(),
  timeZone = OPERATOR_TIMEZONE,
): PersonalTaskChange | null {
  const said = text.trim()
  if (said === '') return null
  /*
    A sentence that is itself a new task is not a change to the last one. This
    order matters: "actually, remind me Monday to ring them" carries both a
    referent-ish word and a date, and it is plainly a NEW task.
  */
  if (personalTaskRequest(said, now, timeZone) !== null) return null
  if (!CHANGING.test(said)) return null

  const matched: string[] = []
  /*
    The CHANGE is read first, and then the referent is tested against what is
    LEFT.

    Asking for a bare referent up front cannot work: "make that Monday" and
    "make that urgent" both have a word after `that`, and a lookahead cannot
    tell Monday from a subject without knowing what a change looks like. So
    each recognised change is removed and the residue is what decides — the
    strip-and-count method this file already uses for titles, and the reason
    "make that pricing document urgent" is still refused: with `urgent` gone
    the residue is "make that pricing document", and `that` is not bare.
  */
  let residue = said

  const due = whenFor(said, now, timeZone)
  if (due !== null) {
    matched.push('a new date')
    residue = residue.replace(WHEN_WORDS, ' ')
  }

  let priority: number | null = null
  for (const [re, n] of URGENCY) {
    if (re.test(said)) {
      priority = n
      matched.push('how important it is')
      residue = residue.replace(re, ' ')
      break
    }
  }

  const rename = RENAME.exec(said)
  const title = rename === null ? null : unquote((rename[1] ?? '').replace(/[\s.!?]+$/, ''))
  /*
    A rename names its own referent, and the residue test cannot see it.

    "rename that to X" puts `that` INSIDE the phrase this strip removes, so by
    the time the guard runs there is nothing left to prove the sentence is
    about the last task — and the follow-up was refused. The phrase itself is
    the evidence: if the words that matched contain a bare referent, the guard
    is already satisfied.

    "change the wording to X" names NO referent and stays refused, which is the
    conservative half of the same rule: with nothing pointing at the last task,
    a rename could be about anything on the screen.
  */
  let namedReferent = false
  if (title !== null && title !== '') {
    matched.push('a new name')
    namedReferent = /\b(?:it|that|this)\b/i.test(String(rename?.[0] ?? '').replace(title, ' '))
    residue = residue.replace(RENAME, (_m, p1: string) => String(_m).replace(p1, ' '))
  }

  /*
    And the changing words come out too, for the same reason the date did.

    "Move it to Friday INSTEAD" left "Move it instead", and `it` followed by a
    word is not bare — so a perfectly ordinary follow-up was refused by the
    guard rather than by the product. Every word in `CHANGING` is framing, so
    none of them can be the subject the guard is protecting against.
  */
  residue = residue.replace(new RegExp(CHANGING.source, 'gi'), ' ')
  /*
    Or a task NAMED: "the Hartley one", "the insurance task" (ledger R29). The
    handler resolves the name among his tasks and asks when it is not exactly
    one, so a name is safe where an open noun phrase would not be.
  */
  const namedTask = /\bthe\s+([a-z0-9'’ -]{2,40}?)\s+(?:one|task|to-?do|reminder)\b/i.exec(residue)
  const taskName = namedTask === null ? null : String(namedTask[1]).trim().toLowerCase()
  if (!namedReferent && !BARE_REFERENT.test(residue) && taskName === null) return null

  /*
    Nothing recognised is nothing to do. Returning an empty change would make
    the handler say it had changed something when it had not — the claim the
    coherence gate exists to catch, arriving from the one place that could
    make it true by accident.
  */
  if (matched.length === 0) return null
  return { due, priority, title: title === '' ? null : title, matched, name: taskName }
}

/**
 * "Mark it done", "bin the minibus one" — a task completed or called off.
 *
 * Behavioural remediation, 24 September 2026 (ledger R3). The conversation
 * could rename and re-date a task and could not finish or cancel one, so
 * "Mark the Hartley one done" was answered "…is now marked as done" over a
 * row still reading `todo`. This is the missing reading; the handler resolves
 * WHICH task among the ones this conversation made, and only acts when exactly
 * one fits.
 *
 * The object must be a REFERENT — "it", "that", "that one", or "the X one /
 * the X task / the X reminder" — never an open noun phrase, so "delete the
 * email", "remove the paragraph about pricing" and "cancel the booking" are
 * not read as touching a to-do at all. That restriction is the whole safety
 * argument: a wrong completion looks exactly like a right one.
 *
 * Cancelled rather than deleted for "bin" and friends: `hq_task_state` records
 * an undo offer, and a to-do list you cannot take a mistaken removal back from
 * is one he will stop dictating to.
 */
export interface TaskStateChange {
  readonly state: 'done' | 'cancelled'
  /** The distinguishing words ("hartley", "minibus"), or null for a bare referent. */
  readonly name: string | null
}

const REFERENT_OBJECT = String.raw`(?:(?:it|that|this|that\s+one|this\s+one|the\s+last\s+one)|the\s+(?<name>[a-z0-9'’ -]{2,60}?)\s+(?:one|task|to-?do|reminder|item))`
const DONE_FORMS: readonly RegExp[] = [
  new RegExp(
    String.raw`\b(?:mark|tick|cross|check|set)\s+${REFERENT_OBJECT}\s+(?:as\s+)?(?:done|complete|completed|finished|off)\b`,
    'i',
  ),
  new RegExp(String.raw`\b(?:tick|cross|check)\s+off\s+${REFERENT_OBJECT}(?=[\s.,!;]|$)`, 'i'),
  new RegExp(String.raw`\b(?:complete|finish|close)\s+${REFERENT_OBJECT}(?=[\s.,!;]|$)`, 'i'),
  /*
    "Tick off roofer." (R2). The tick-list idiom carries its own object, with no
    "task" or "one" after it. Last, so a pronoun or a "the X one" is read by the
    forms above and only a bare name reaches here; `pickByName` still has to
    find exactly one open task by every word of it, and the reply says so when
    it finds none, so a name that matches nothing changes nothing.
  */
  /\b(?:tick|cross)\s+off\s+(?:the\s+)?(?<name>[a-z0-9'’ -]{2,60}?)(?=[\s]*[.,!;]|\s*$)/i,
]
const CANCEL_FORMS: readonly RegExp[] = [
  new RegExp(
    String.raw`\b(?:bin|delete|remove|scrap|drop|cancel|ditch|kill|lose|get\s+rid\s+of|take\s+off)\s+${REFERENT_OBJECT}(?=[\s.,!;]|$)`,
    'i',
  ),
  /*
    "Actually, forget the printers one too" (ledger R42). Only with a NAMED
    referent: a bare "forget it" withdraws what he is asking for right now,
    and reading it as "cancel my last task" would delete something he wants.
  */
  /\bforget(?:\s+about)?\s+the\s+(?<name>[a-z0-9'’ -]{2,60}?)\s+(?:one|task|to-?do|reminder|item)(?=[\s.,!;]|$)/i,
]

const CREATES_A_TASK =
  /\b(?:add|create|make|put|raise|log|set\s+up|open|file|stick)\s+(?:me\s+|us\s+)?(?:a|an|another|new|one\s+more)\s+(?:[a-z-]+\s+){0,2}?(?:task|to-?do|reminder)s?\b/i

export function taskStateChange(text: string): TaskStateChange | null {
  const said = withoutOpeningAffirmation(String(text ?? '').trim())
  if (said === '') return null
  // A question about it is not a request — unless it is the polite imperative.
  if (said.endsWith('?') && !/^(?:can|could|would|will)\s+you\b/i.test(said)) return null
  // A prohibition is not a request: "don't delete that one yet", "can you not
  // delete that one" (ledger R34).
  if (/\b(?:don'?t|do\s+not|never|not\s+yet|no\s+need\s+to|not)\b/i.test(said)) return null
  /*
    A sentence that is itself a request for a NEW task or reminder is not a
    state change, whatever verb is inside its object (R2): "add a task to
    cancel the venue task" and "remind me to cross off the roofer" CREATE a
    task whose title mentions one. The same order `personalTaskChange` keeps
    ("a sentence that is itself a new task is not a change"), stated once here
    so the create readers and this one cannot both claim a sentence. The
    indefinite noun is what separates "add a task to X" from "mark the X task
    done", which names a task that already exists.
  */
  if (personalTaskRequest(said) !== null || CREATES_A_TASK.test(said)) return null
  for (const [forms, state] of [
    [DONE_FORMS, 'done'],
    [CANCEL_FORMS, 'cancelled'],
  ] as const) {
    for (const re of forms) {
      const hit = re.exec(said)
      if (hit === null) continue
      /*
        Taken back in the same breath: "mark the Hartley one done, actually
        no, leave it" (ledger R34). A change of mind AFTER the request
        withdraws it, whatever the retraction reader makes of the rest.
      */
      const after = said.slice(hit.index + hit[0].length)
      if (
        /^[\s,.;:\u2014-]*(?:actually|no|wait|hang\s+on|on\s+second\s+thoughts?|scratch\s+that|forget\s+(?:it|that))\b/i.test(
          after,
        )
      ) {
        return null
      }
      const name = hit.groups?.name?.trim().toLowerCase() ?? null
      return { state, name: name === '' ? null : name }
    }
  }
  return null
}

/**
 * Which candidate a name picks, or null when it picks none or several.
 *
 * Every distinguishing word must appear in the title. Deliberately strict:
 * "the minibus one" picks "Book the minibus for the away day" and nothing
 * else; a name matching two titles is asked about, never guessed.
 */
export function pickByName<T extends { readonly title: string }>(
  name: string,
  candidates: readonly T[],
): T | null {
  const words = name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !['the', 'and', 'for', 'one'].includes(w))
  if (words.length === 0) return null
  const fits = candidates.filter((c) => {
    const title = c.title.toLowerCase()
    return words.every((w) => title.includes(w))
  })
  return fits.length === 1 ? (fits[0] ?? null) : null
}

/**
 * "Stop the Monday finance reminder", "cancel the recurring reminder to review my finances", "end that recurring
 * reminder", "stop reminding me about the finances every Monday": a RECURRING REMINDER ended on purpose.
 *
 * Owner decision, 7 October 2026: ticking a recurring reminder completes THAT TIME only, so the series needs its own
 * explicit way to stop, said in his own words. It is read from his words (never a paraphrase) and the handler resolves WHICH
 * series; this reading only says that a series is being ended and what distinguishes it.
 *
 * Which verbs, and why they differ. `stop`, `end` and `turn off` have no other reading beside the noun "reminder" here
 * (`taskStateChange` never read them), so they claim the sentence. `cancel`, `delete`, `remove`, `drop` and `scrap` already
 * cancel a task by name through `taskStateChange`, and a one-off reminder is still cancelled there: they claim a sentence
 * only when it SAYS the reminder repeats ("recurring", "repeating", "standing", "every Monday"), so this does not take
 * "cancel the roofer reminder" away from the reader that handles it.
 */
export interface SeriesStopRequest {
  /** What distinguishes the series ("monday finance", "review my finances"), or null for a bare referent. */
  readonly name: string | null
}

const SERIES_REPEATING =
  /\b(?:recurring|repeating|repeats?|regular|standing|ongoing|weekly|daily|fortnightly|every|each)\b/i
const SERIES_STOP_HARD = String.raw`(?:stop|end|turn\s+off|switch\s+off|discontinue)`
const SERIES_STOP_SOFT = '(?:cancel|delete|remove|drop|scrap|kill|ditch|bin)'
const SERIES_REMINDER_OBJECT = new RegExp(
  String.raw`\b(${SERIES_STOP_HARD}|${SERIES_STOP_SOFT})\s+(?!(?:by|at|in|over|up|out)\b)(?<rest>[^.!?;]{0,100}?\breminders?\b[^.!?;]{0,100})`,
  'i',
)
const SERIES_NAGGING = new RegExp(
  String.raw`\b${SERIES_STOP_HARD}\s+(?:reminding|nagging|pinging|prompting|messaging|texting|bugging)\s+me\s+(?<rest>(?:every|each|about|to|of|that|on)\b[^.!?;]{2,120})`,
  'i',
)
// Words that carry the schedule or the sentence's frame, not the series' name.
const SERIES_NOISE: ReadonlySet<string> = new Set(
  (
    'the my our that this those these all one it last a an to about for of on and please ' +
    'reminder reminders recurring repeating repeats repeat regular standing ongoing weekly daily ' +
    'fortnightly every each me week day other morning afternoon evening from now anymore any more again'
  ).split(' '),
)

export function seriesStopRequest(text: string): SeriesStopRequest | null {
  const said = withoutOpeningAffirmation(String(text ?? '').trim())
  if (said === '') return null
  if (said.endsWith('?') && !/^(?:can|could|would|will)\s+you\b/i.test(said)) return null
  if (/\b(?:don'?t|do\s+not|never|not\s+yet|no\s+need\s+to|not)\b/i.test(said)) return null
  // A request for a NEW reminder or task ("remind me every Monday to stop the printers") is not this.
  if (personalTaskRequest(said) !== null || CREATES_A_TASK.test(said)) return null
  const nagging = SERIES_NAGGING.exec(said)
  const object = nagging === null ? SERIES_REMINDER_OBJECT.exec(said) : null
  const hit = nagging ?? object
  if (hit === null) return null
  const rest = String(hit.groups?.rest ?? '')
  if (object !== null) {
    const verb = String(object[1]).toLowerCase()
    const hard = new RegExp(`^${SERIES_STOP_HARD}$`, 'i').test(verb.replace(/\s+/g, ' '))
    if (
      !hard &&
      !SERIES_REPEATING.test(rest) &&
      !/\b(?:mon|tues?|wednes|thurs?|fri|satur|sun)day\b/i.test(rest)
    ) {
      return null
    }
  }
  // Taken back in the same breath: "stop the Monday reminder, actually no".
  const after = said.slice((hit.index ?? 0) + hit[0].length)
  if (
    /(?:^|[,;:—-])\s*(?:actually|no|wait|hang\s+on|on\s+second\s+thoughts?|scratch\s+that|forget\s+(?:it|that))\b/i.test(
      `${rest} ${after}`,
    )
  ) {
    return null
  }
  const words = rest
    .toLowerCase()
    .replace(/[^a-z0-9'’ -]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w !== '' && !SERIES_NOISE.has(w))
  return { name: words.length === 0 ? null : words.join(' ') }
}

/** One of the series on his list that a name picks: exactly one, or none, or several (never a guess). */
export interface SeriesCandidate {
  readonly id: string
  readonly title: string
  readonly every?: string
  readonly weekday?: string | null
}
export function pickSeries<T extends SeriesCandidate>(
  name: string | null,
  list: readonly T[],
): { readonly one: T | null; readonly many: readonly T[] } {
  if (name === null)
    return list.length === 1 ? { one: list[0] ?? null, many: list } : { one: null, many: list }
  const words = name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2)
  if (words.length === 0) return { one: list.length === 1 ? (list[0] ?? null) : null, many: list }
  const fits = list.filter((c) => {
    const hay = `${c.title} ${c.weekday ?? ''}`.toLowerCase()
    return words.every((w) => hay.includes(w))
  })
  return { one: fits.length === 1 ? (fits[0] ?? null) : null, many: fits }
}

/**
 * "Add checking the figures as a subtask under it" (ledger R6).
 *
 * The conversation had no subtask reading, so that sentence filed a flat
 * task titled "checking the figures as a subtask under the 'Review the
 * Hartley proposal'" — his whole sentence as a name, and no parent. The
 * writer has taken a parent all along (`my_task_add(p_parent)`).
 *
 * Two shapes, both explicit about the word "subtask" (or "sub-task", "sub
 * item"), because a relationship guessed from word order is a filing error
 * that looks deliberate:
 *
 *   add X as a subtask (under|of|to|on) PARENT
 *   add a subtask (under|to|on|for) PARENT (to|:) X
 *
 * PARENT is a referent ("it", "that", "that one") or "the NAME one/task"; the
 * handler resolves it among the tasks this conversation made, exactly as a
 * completion is resolved, and asks when that is not exactly one.
 */
export interface SubtaskRequest {
  readonly title: string
  /** Distinguishing words of the parent, or null for a bare referent. */
  readonly parentName: string | null
}

const SUB = String.raw`sub-?\s?(?:task|item|to-?do)`
const PARENT = String.raw`(?:it|that|this|that\s+one|this\s+one|the\s+last\s+one|the\s+(?<pname>[a-z0-9'’ -]{2,60}?)(?:\s+(?:one|task|to-?do|item))?)`
const SUB_AFTER = new RegExp(
  String.raw`\b(?:add|put|make|create|stick|include)\s+(?<title>.{3,120}?)\s+as\s+(?:a\s+|another\s+)?${SUB}\s+(?:under|of|to|on|for|beneath)\s+${PARENT}\s*[.!]?\s*$`,
  'i',
)
const SUB_BEFORE = new RegExp(
  String.raw`\b(?:add|put|make|create|stick)\s+(?:a\s+|another\s+)?${SUB}\s+(?:under|to|on|for|beneath)\s+${PARENT}\s*(?::|—|-|to|for|called|,)\s*(?<title>.{3,120}?)\s*[.!]?\s*$`,
  'i',
)

export function subtaskRequest(text: string): SubtaskRequest | null {
  const said = withoutOpeningAffirmation(String(text ?? '').trim())
  if (said === '' || said.endsWith('?')) return null
  for (const re of [SUB_AFTER, SUB_BEFORE]) {
    const hit = re.exec(said)
    if (hit === null) continue
    const raw = (hit.groups?.title ?? '').trim().replace(/^(?:the\s+)?(?:job\s+of\s+)?/i, '')
    if (raw.length < 3) continue
    const title = raw.charAt(0).toUpperCase() + raw.slice(1)
    const pname = hit.groups?.pname?.trim().toLowerCase() ?? null
    return { title, parentName: pname === '' ? null : pname }
  }
  return null
}
