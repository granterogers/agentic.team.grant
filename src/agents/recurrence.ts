/**
 * "Every Monday", "every day", "weekly": the repeats this office can keep.
 *
 * Deep systems audit, 6 October 2026 (R3). `personalTaskRequest` did not read a
 * repeat at all, so "remind me to ring the venue every Monday" became a
 * one-off titled "Ring the venue every" and the recurrence was dropped without
 * a word. The writer has stored a repeat since 0482 (`tasks.repeat_every`, an
 * interval, and a trigger that makes the next occurrence when one is ticked
 * off); only the reader was missing.
 *
 * ## A small language, and an honest refusal
 *
 * What a repeat can be here is a whole number of days: `repeat_every` is an
 * interval and the next occurrence is made by adding it on the office's wall
 * clock. So the readable patterns are exactly the ones that ARE that:
 *
 *   every day · daily · every morning/afternoon/evening   -> 1 day
 *   every <weekday> · every week · weekly                 -> 7 days
 *   every other day/week/<weekday> · fortnightly          -> 2 / 14 days
 *   every N days / weeks                                  -> N or 7N days
 *
 * Everything else that LOOKS like a repeat (every month, every weekday, every
 * first Monday, hourly, annually, "every 3 months") is returned as
 * `unsupported` with the words it came from, and the caller says so in its
 * reply. A repeat the product cannot keep must be refused out loud: the cheap
 * outcome is a one-off reminder he is told is a one-off, the expensive one is
 * the thing this file replaces, a recurrence dropped in silence.
 *
 * `every` followed by something that is not a unit of time ("every receipt",
 * "check every invoice") is not a repeat and reads as `null`.
 */

export interface Recurrence {
  /** A Postgres interval literal: '1 day', '7 days', '14 days'. */
  readonly every: string
  readonly days: number
  /** 0 = Sunday .. 6 = Saturday, when the sentence named a day of the week. */
  readonly weekday: number | null
  /** The words that said it, so a title can lose them and a reply can quote them. */
  readonly phrase: string
  /** How to say it back: "every Monday", "every day", "every 2 weeks". */
  readonly label: string
}

export interface UnsupportedRecurrence {
  readonly unsupported: string
}

const WEEKDAY_INDEX: Readonly<Record<string, number>> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
}
const WEEKDAY_NAME = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const

const WEEKDAY_WORDS =
  'sunday|sun|monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat'

const COUNT: Readonly<Record<string, number>> = {
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  twelve: 12,
}

/*
  "every" or "each", an optional multiplier (other / alternate / a number /
  an ordinal), then a unit. The units are listed longest first with a word
  boundary at both ends, so "mon" cannot match the opening of "month".
*/
const EVERY = new RegExp(
  String.raw`\b(?:every|each)\s+(?:(other|alternate|first|second|third|fourth|fifth|last)\s+|(\d{1,3}|${Object.keys(COUNT).join('|')})\s+)?` +
    String.raw`(weekdays?|weekends?|days?|weeks?|fortnights?|months?|years?|hours?|minutes?|mornings?|afternoons?|evenings?|${WEEKDAY_WORDS})\b`,
  'i',
)
const ADVERB = /\b(daily|weekly|fortnightly|biweekly|bi-weekly|monthly|yearly|annually|hourly)\b/i

const NAMED_DAY = new RegExp(String.raw`\b(?:on\s+)?(${WEEKDAY_WORDS})\b`, 'i')

const weekdayFrom = (said: string): number | null => {
  const hit = NAMED_DAY.exec(said)
  return hit === null ? null : (WEEKDAY_INDEX[String(hit[1]).toLowerCase()] ?? null)
}

const build = (days: number, weekday: number | null, phrase: string, label: string): Recurrence => ({
  every: `${String(days)} ${days === 1 ? 'day' : 'days'}`,
  days,
  weekday,
  phrase,
  // "weekly ... on Friday" is said back as what it is: every Friday.
  label: days === 7 && weekday !== null ? `every ${WEEKDAY_NAME[weekday]}` : label,
})

/**
 * The repeat a sentence asks for: a `Recurrence`, an `unsupported` (it asks for
 * one this office cannot keep, and says which), or null (it asks for none).
 */
export function recurrenceOf(text: string): Recurrence | UnsupportedRecurrence | null {
  const said = String(text ?? '')
  const every = EVERY.exec(said)
  if (every !== null) {
    const phrase = every[0]
    const modifier = (every[1] ?? '').toLowerCase()
    const countRaw = (every[2] ?? '').toLowerCase()
    const unit = String(every[3]).toLowerCase().replace(/s$/, '')
    // "every first Monday", "every last Friday": a place in a month, not an interval.
    if (modifier !== '' && modifier !== 'other' && modifier !== 'alternate') {
      return { unsupported: phrase }
    }
    const count = countRaw === '' ? 1 : (COUNT[countRaw] ?? Number(countRaw))
    const times = modifier === 'other' || modifier === 'alternate' ? 2 : count
    if (!Number.isInteger(times) || times < 1 || times > 60) return { unsupported: phrase }
    if (unit in WEEKDAY_INDEX) {
      // "every 2 Mondays" says nothing a person means; only a bare or "other" weekday is a repeat.
      if (countRaw !== '') return { unsupported: phrase }
      const wd = WEEKDAY_INDEX[unit] ?? 0
      return build(7 * times, wd, phrase, `every ${times === 1 ? '' : 'other '}${WEEKDAY_NAME[wd]}`)
    }
    if (unit === 'day') {
      return build(times, null, phrase, times === 1 ? 'every day' : `every ${String(times)} days`)
    }
    if (unit === 'week') {
      return build(
        7 * times,
        weekdayFrom(said),
        phrase,
        times === 1 ? 'every week' : `every ${String(times)} weeks`,
      )
    }
    if (unit === 'fortnight') {
      return build(14 * times, weekdayFrom(said), phrase, 'every fortnight')
    }
    if (unit === 'morning' || unit === 'afternoon' || unit === 'evening') {
      if (modifier !== '' || countRaw !== '') return { unsupported: phrase }
      return build(1, null, phrase, `every ${unit}`)
    }
    // month, year, weekday, weekend, hour, minute
    return { unsupported: phrase }
  }
  const adverb = ADVERB.exec(said)
  if (adverb !== null) {
    const phrase = adverb[0]
    const word = phrase.toLowerCase()
    if (word === 'daily') return build(1, null, phrase, 'every day')
    if (word === 'weekly') return build(7, weekdayFrom(said), phrase, 'every week')
    if (word === 'fortnightly') return build(14, weekdayFrom(said), phrase, 'every fortnight')
    // monthly, yearly, annually, hourly, and "biweekly", which means twice a week as often as every two.
    return { unsupported: phrase }
  }
  return null
}

/** The text with the repeat's own words taken out (and the "on" that led into a weekday). */
export const withoutTheRepeat = (text: string, rec: Recurrence): string =>
  text.replace(rec.phrase, ' ').replace(/\s{2,}/g, ' ')
