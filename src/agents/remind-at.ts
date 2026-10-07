/**
 * The TIME a reminder is for, when he said one.
 *
 * Behavioural remediation, 24 September 2026 (ledger R24). `remind_at` has
 * been on `public.tasks` since 0482 and the reminders duty sends from it, and
 * nothing in the conversation ever set it:
 *
 *     "remind me at 3pm to call Sarah back"
 *        -> a task titled "At 3pm to call Sarah back", no date, no remind_at
 *     "remind me in 20 minutes to check the oven"
 *        -> "In 20 minutes to check the oven", nothing will ever fire
 *     "nudge me on Friday morning about the insurance"
 *        -> "Morning about the insurance"
 *
 * The office then said "That is on your list", which is true, and he would
 * wait for a reminder that nothing was going to send.
 *
 * ## Deliberately narrow, for the reason `whenFor` gives
 *
 * A reminder at the wrong time is worse than no time: it looks right. So only
 * the shapes that have one reading are read — an explicit clock time, a
 * relative "in N minutes/hours", and four named parts of the day. A bare hour
 * with no am/pm is read the way a person in an office means it: 7-11 is the
 * morning, 12 is noon, 1-6 is the afternoon. Anything else leaves the time
 * null, which is what happened before.
 *
 * Times are in the OFFICE's zone (`public.offices.timezone`, read once by
 * `officeTimezone` in `office-time.ts`), passed in, so the whole thing is a pure
 * function a test can drive. The default argument is the operator office's
 * documented zone and is only what a caller that has none to pass gets; every
 * caller in `src/handlers` passes the office's.
 */
import { DEFAULT_REMINDER_HOUR, localDay, OPERATOR_TIMEZONE, wallClock } from './office-time.ts'

const PARTS_OF_DAY: Readonly<Record<string, readonly [number, number]>> = {
  morning: [9, 0],
  lunchtime: [12, 30],
  afternoon: [14, 0],
  evening: [18, 0],
  tonight: [19, 0],
}

/** The phrases this reads, so a title can have them taken out. */
/*
  Spoken clock times, said as words (ledger R24): "at three", "at half past
  four", "at quarter to nine", "at ten o'clock". Rewritten to digits before the
  clock is read, and taken out of the title with the rest.
*/
const HOUR_WORDS: Readonly<Record<string, number>> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
}
const HOUR_WORD = Object.keys(HOUR_WORDS).join('|')
const SPOKEN = new RegExp(
  String.raw`\bat\s+(?:(half|quarter)\s+(past|to)\s+)?(${HOUR_WORD})(?:\s+o'?clock)?\b`,
  'i',
)
export const spokenToDigits = (text: string): string =>
  text.replace(SPOKEN, (_m, part: string | undefined, dir: string | undefined, w: string) => {
    const h = HOUR_WORDS[w.toLowerCase()] ?? 0
    if (part === undefined) return `at ${String(h)}`
    const minutes = part.toLowerCase() === 'half' ? 30 : 15
    if ((dir ?? '').toLowerCase() === 'past') return `at ${String(h)}:${String(minutes)}`
    const before = h === 1 ? 12 : h - 1
    return `at ${String(before)}:${String(60 - minutes)}`
  })

export const REMIND_TIME_WORDS =
  /\b(?:at\s+(?:[01]?\d|2[0-3])(?:[:.][0-5]\d)?\s*(?:am|pm|a\.m\.|p\.m\.)?(?!\s*(?:%|percent|quid|pounds?|people|tickets))|in\s+(?:\d{1,3}|a|an|one|two|three|five|ten|fifteen|twenty|thirty|forty-?five)\s+(?:minutes?|mins?|hours?|hrs?)|(?:in\s+the\s+|this\s+|tomorrow\s+|on\s+\w+day\s+)?(?:morning|lunchtime|afternoon|evening)|tonight)\b/gi

const NUMBER: Readonly<Record<string, number>> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  five: 5,
  ten: 10,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  fortyfive: 45,
  'forty-five': 45,
}

/**
 * The time of day a sentence names, or null: an explicit clock time ("at 3pm",
 * "at half past four") or one of the named parts of the day. Not the relative
 * "in 20 minutes", which is an instant and has no time of day.
 */
export function clockOf(said: string): { hh: number; mm: number } | null {
  const text = spokenToDigits(String(said ?? '')).toLowerCase()
  const clock =
    /\bat\s+([01]?\d|2[0-3])(?:[:.]([0-5]\d))?\s*(am|pm|a\.m\.|p\.m\.)?(?!\s*(?:%|percent|quid|pounds?|people|tickets))\b/.exec(
      text,
    )
  if (clock !== null) {
    let h = Number(clock[1])
    const mm = clock[2] === undefined ? 0 : Number(clock[2])
    const meridiem = clock[3]?.replace(/\./g, '')
    if (meridiem === 'pm' && h < 12) h += 12
    else if (meridiem === 'am' && h === 12) h = 0
    // No am/pm and no leading zero: 1-6 is the afternoon, as an office means it.
    else if (meridiem === undefined && !String(clock[1]).startsWith('0') && h >= 1 && h <= 6)
      h += 12
    return { hh: h, mm }
  }
  for (const [word, [h, m]] of Object.entries(PARTS_OF_DAY)) {
    if (new RegExp(`\\b${word}\\b`).test(text)) return { hh: h, mm: m }
  }
  return null
}

/**
 * The time a reminder is for when somebody asked to be REMINDED on a day and
 * said no time (R1): nine in the morning, office time, on that day.
 *
 * Only for a reminder. A task that merely has a due date has none of this: it
 * is a date, and giving it a time would make the reminders duty announce
 * something nobody asked to be told about. When today's nine has already
 * passed the reminder is for now, so it goes out on the next tick instead of
 * being filed in the past or silently moved to tomorrow, and `immediate` says
 * so, because the confirmation must not promise a time that has gone.
 */
export function defaultReminderAt(
  onDay: string,
  now: Date,
  timeZone: string,
  hour: number = DEFAULT_REMINDER_HOUR,
): { at: string; immediate: boolean } {
  const [y, m, d] = onDay.split('-').map(Number)
  const at = wallClock(Number(y), Number(m) - 1, Number(d), hour, 0, timeZone)
  return at.getTime() <= now.getTime()
    ? { at: now.toISOString(), immediate: true }
    : { at: at.toISOString(), immediate: false }
}

/**
 * When to remind him, as an ISO instant, or null.
 *
 * `onDay` is the ISO date the sentence's date words already resolved to
 * (`whenFor`), or null for "no day given", in which case a clock time that has
 * already passed today means tomorrow.
 */
export function remindAtFor(
  said: string,
  onDay: string | null,
  now: Date = new Date(),
  timeZone = OPERATOR_TIMEZONE,
): string | null {
  const text = spokenToDigits(String(said ?? '')).toLowerCase()

  const inN =
    /\bin\s+(\d{1,3}|a|an|one|two|three|five|ten|fifteen|twenty|thirty|forty-?five)\s+(minutes?|mins?|hours?|hrs?)\b/.exec(
      text,
    )
  if (inN !== null) {
    const word = String(inN[1])
    const n = /^\d+$/.test(word)
      ? Number(word)
      : (NUMBER[word.replace('-', '')] ?? NUMBER[word] ?? 0)
    const minutes = /^h/.test(String(inN[2])) ? n * 60 : n
    if (minutes < 1 || minutes > 24 * 60) return null
    return new Date(now.getTime() + minutes * 60_000).toISOString()
  }

  const clockTime = clockOf(text)
  if (clockTime === null) return null
  const { hh, mm } = clockTime

  const today = localDay(now, timeZone)
  let day = today
  if (onDay !== null) {
    const [y, m, d] = onDay.split('-').map(Number)
    day = { y: Number(y), m: Number(m) - 1, d: Number(d) }
  }
  let at = wallClock(day.y, day.m, day.d, hh, mm, timeZone)
  if (onDay === null && at.getTime() <= now.getTime()) {
    at = wallClock(day.y, day.m, day.d + 1, hh, mm, timeZone)
  }
  return at.toISOString()
}
