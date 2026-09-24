/**
 * Calendar dates that FOLLOW from what the office was given.
 *
 * `fabricatedWhen` refuses a date that appears nowhere in the grounding,
 * because a date cannot be reasoned to. Its own header says the property is
 * DERIVABILITY, not appearance — and a date CAN be reasoned to when the
 * grounding names it relatively. Measured on 24 September 2026:
 *
 *     Grant:   "Add a task to renew the public liability insurance by the
 *               30th, another to send the Brightwell invoice next week…"
 *     office:  "…renewal due 30 Sept…"
 *
 * refused as "30 Sept appears nowhere in the request" on all four attempts.
 * The job failed, he got an apology instead of an answer, and each attempt had
 * already written the task — four copies on his list. Resolving "the 30th"
 * against today is exactly the arithmetic the office is supposed to do.
 *
 * So the check asks a narrower question than before: not "does this string
 * occur" but "does this DATE occur", where the dates in the grounding include
 * every one its relative expressions resolve to. The resolver is `whenFor`,
 * the same deterministic reader that files due dates, so the gate and the
 * writer cannot come to disagree about what "Friday" meant.
 *
 * Narrow in the direction that matters. A clock time is still never derivable
 * (nothing here resolves one), and a date that no expression in the grounding
 * resolves to is still refused — the bait answer's "Fri Oct 18" stays
 * invented, because nothing he said lands on the 18th of October.
 */

import { whenFor } from './mine.ts'

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/**
 * A month, as a WHOLE word: its name or a standard abbreviation.
 *
 * Shared with `fabricatedWhen` so the gate and the resolver cannot disagree
 * about what a month is. A prefix match made "margin" March.
 */
export const MONTH_WORD =
  'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?'

const isoOf = (y: number, m: number, d: number): string | null => {
  const dt = new Date(Date.UTC(y, m, d))
  // A round trip, because Date.parse('2026-02-31') is a perfectly good number.
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m || dt.getUTCDate() !== d) return null
  return dt.toISOString().slice(0, 10)
}

/**
 * The ISO day a month-and-day mention most plausibly names, or null.
 *
 * With no year, the nearest occurrence to `now` within six months either side
 * — "30 Sept" said in late September is this year, "5 Jan" said in December
 * is next year.
 */
export const isoForMention = (mention: string, now: Date = new Date()): string | null => {
  const text = mention.toLowerCase()
  const isoHit = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text)
  if (isoHit !== null) return isoOf(Number(isoHit[1]), Number(isoHit[2]) - 1, Number(isoHit[3]))
  const month = MONTHS.findIndex((m) => new RegExp(`\\b${m}`).test(text))
  const day = /\b(\d{1,2})(?:st|nd|rd|th)?\b/.exec(text)
  if (month < 0 || day === null) return null
  const d = Number(day[1])
  const candidates = [-1, 0, 1]
    .map((dy) => isoOf(now.getUTCFullYear() + dy, month, d))
    .filter((v): v is string => v !== null)
  let best: string | null = null
  let gap = Number.POSITIVE_INFINITY
  for (const c of candidates) {
    const g = Math.abs(Date.parse(c) - now.getTime())
    if (g < gap) {
      gap = g
      best = c
    }
  }
  return gap <= 183 * 86_400_000 ? best : null
}

/*
  The relative expressions worth resolving. Each is a phrase `whenFor` already
  reads, or one normalised into a phrase it reads ("by the 30th" becomes "on
  the 30th", because the resolver only takes the ordinal after "on").
*/
const RELATIVE: readonly RegExp[] = [
  /\b(?:today|tonight|this\s+evening|tomorrow)\b/gi,
  /\b(?:next\s+|this\s+|on\s+)?(?:sun|mon|tues?|wednes?|thurs?|fri|satur)day\b/gi,
  /\bnext\s+(?:week|month)\b/gi,
  /\bin\s+(?:\d{1,3}|a|an|one|two|three|four|five|six|seven)\s+(?:day|week|month|fortnight)s?\b/gi,
  /\b(?:on|by|before|until|for|from)?\s*the\s+\d{1,2}(?:st|nd|rd|th)\b/gi,
]

/**
 * Every ISO date the grounding names, directly or relatively.
 */
export const datesIn = (grounding: string, now: Date = new Date()): ReadonlySet<string> => {
  const out = new Set<string>()
  const text = String(grounding ?? '')
  for (const re of RELATIVE) {
    for (const hit of text.matchAll(re)) {
      const phrase = hit[0].replace(/^\s*(?:by|before|until|for|from)?\s*the\s+/i, 'on the ')
      const on = whenFor(phrase, now)
      if (on !== null) out.add(on)
    }
  }
  const MONTH = MONTH_WORD
  const absolute = [
    new RegExp(String.raw`\b(?:${MONTH})\.?\s+\d{1,2}(?:st|nd|rd|th)?\b`, 'gi'),
    new RegExp(String.raw`\b\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?(?:${MONTH})\b`, 'gi'),
    /\b\d{4}-\d{2}-\d{2}\b/g,
  ]
  for (const re of absolute) {
    for (const hit of text.matchAll(re)) {
      const on = isoForMention(hit[0].replace(/\bof\b/i, ' '), now)
      if (on !== null) out.add(on)
    }
  }
  return out
}
