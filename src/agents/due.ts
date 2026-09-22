/**
 * A deadline Grant typed, turned into a date — or refused (#253).
 *
 * `app.task_add` has taken `p_due_on` since it existed and the interpreter has
 * never filled it, so *"add a task to chase the roofing quote by Friday"*
 * produced a task called "chase the roofing quote by Friday" with `due_on`
 * null. The deadline was in front of him and was not data: it could not be
 * sorted on, filtered by, or shown as overdue.
 *
 * ## The invariant this is written under
 *
 * #249's, and it is why this is a resolver rather than a prompt: the semantic
 * layer may INFER, and may not INVENT a consequential parameter Grant did not
 * supply. **A task dated the wrong Friday is worse than a task with no date,
 * because the wrong date looks correct.** So every rule here is deterministic,
 * every ambiguous phrase is refused, and nothing reaches a model.
 *
 * ## Which Friday
 *
 * "by Friday" said on a Tuesday means this week's Friday; said on a Saturday
 * it means the next one. The rule is *the next occurrence of that weekday,
 * today included* — because "by Friday" said ON Friday means today, and a rule
 * that skipped to next week would move a deadline seven days by arithmetic.
 * "next Friday" is that plus a week, which is what the word next does.
 *
 * ## Which timezone
 *
 * Grant's, from `system_config.grant.timezone` (Europe/Athens), passed in
 * rather than read here — the same reason `localDate` takes one. "Which day is
 * this" is the single decision a UTC server gets wrong at exactly the hours he
 * is most likely to be typing.
 *
 * ## What it refuses, on purpose
 *
 * "soon", "later", "next week sometime", "when you can", "ASAP", "end of the
 * month-ish". Each of those is a real thing to say and none of them is a date.
 * Refusing leaves the words in the title, where he can read them, which is
 * exactly the state this Issue describes as a gap rather than a loss.
 */

/** Monday-first is not used here; JavaScript's own 0=Sunday is, throughout. */
const WEEKDAYS: Readonly<Record<string, number>> = {
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

const MONTHS: Readonly<Record<string, number>> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
}

/** Today, in a named timezone, as the three numbers a calendar has. */
const todayIn = (now: Date, timeZone: string): { y: number; m: number; d: number; dow: number } => {
  // en-CA gives ISO-shaped output, which is the only reason it is used — the
  // same trick `localDate` uses and for the same reason.
  const iso = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
  const [y, m, d] = iso.split('-').map(Number)
  /*
    The weekday of that LOCAL date, computed from the date itself rather than
    from `now.getDay()`. At 23:30 UTC in Athens it is already tomorrow, and a
    weekday read off the UTC instant would be yesterday's — which is the whole
    class of error this file exists to avoid, one level down.
  */
  const dow = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay()
  return { y: y ?? 1970, m: m ?? 1, d: d ?? 1, dow }
}

const iso = (y: number, m: number, d: number): string =>
  `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

/**
 * A calendar date that exists, or null.
 *
 * By ROUND TRIP, because `Date.parse('2026-02-31')` is a perfectly good number
 * — JavaScript rolls the extra days into March. The day that comes back must
 * be the day that went in. CLAUDE.md records a guard whose comment claimed it
 * rejected impossible days and did not.
 */
const realDate = (y: number, m: number, d: number): string | null => {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  const back = new Date(Date.UTC(y, m - 1, d))
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) {
    return null
  }
  return iso(y, m, d)
}

const addDays = (y: number, m: number, d: number, days: number): string => {
  const t = new Date(Date.UTC(y, m - 1, d))
  t.setUTCDate(t.getUTCDate() + days)
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate())
}

/**
 * Phrases that LOOK like a deadline and are not one.
 *
 * Checked before anything else, so "sometime next week" cannot be read as
 * "next week" and dated. The refusal is the feature: these are the phrases
 * where a resolver would have to guess, and #249's invariant says it may not.
 */
const VAGUE =
  /\b(?:soon|shortly|later|sometime|some\s+time|whenever|when\s+you\s+(?:can|get|have)|asap|as\s+soon\s+as|in\s+due\s+course|eventually|at\s+some\s+point|-?ish)\b/i

export interface Due {
  /** The date, as the office stores one. */
  readonly on: string
  /** The words it came from, so a confirmation can quote him rather than paraphrase. */
  readonly from: string
}

/**
 * The deadline in a sentence, or null when there is not one this can be sure
 * of.
 *
 * `now` and `timeZone` are arguments rather than reads, so the whole thing is
 * a pure function and a test can sit on a Tuesday for ever.
 */
export function dueOn(text: string, now: Date, timeZone = 'Europe/Athens'): Due | null {
  const said = String(text ?? '')
  if (said.trim() === '') return null
  if (VAGUE.test(said)) return null

  const t = todayIn(now, timeZone)

  // today / tomorrow / the day after tomorrow
  const plain = /\b(today|tonight|tomorrow|the\s+day\s+after\s+tomorrow)\b/i.exec(said)
  if (plain !== null) {
    const word = plain[1]?.toLowerCase() ?? ''
    const days = word.startsWith('the day after') ? 2 : word === 'tomorrow' ? 1 : 0
    return { on: addDays(t.y, t.m, t.d, days), from: plain[0] }
  }

  // in three days / in 2 weeks
  const relative = /\bin\s+(\d{1,3}|a|one|two|three|four|five|six|seven)\s+(day|week)s?\b/i.exec(
    said,
  )
  if (relative !== null) {
    const words: Readonly<Record<string, number>> = {
      a: 1,
      one: 1,
      two: 2,
      three: 3,
      four: 4,
      five: 5,
      six: 6,
      seven: 7,
    }
    const raw = (relative[1] ?? '').toLowerCase()
    const n = words[raw] ?? Number(raw)
    if (Number.isFinite(n) && n > 0 && n < 400) {
      const step = (relative[2] ?? '').toLowerCase().startsWith('week') ? 7 : 1
      return { on: addDays(t.y, t.m, t.d, n * step), from: relative[0] }
    }
  }

  // an explicit ISO date, which a connector or a form is likelier to produce
  const explicit = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(said)
  if (explicit !== null) {
    const on = realDate(Number(explicit[1]), Number(explicit[2]), Number(explicit[3]))
    if (on !== null) return { on, from: explicit[0] }
    return null
  }

  // "3 October", "October 3", "3rd of October", with an optional year
  const dayFirst = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]{3,9})\.?(?:\s+(\d{4}))?\b/i.exec(
    said,
  )
  const monthFirst = /\b([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/i.exec(said)
  for (const [dayRaw, monthRaw, yearRaw, whole] of [
    [dayFirst?.[1], dayFirst?.[2], dayFirst?.[3], dayFirst?.[0]],
    [monthFirst?.[2], monthFirst?.[1], monthFirst?.[3], monthFirst?.[0]],
  ] as [string | undefined, string | undefined, string | undefined, string | undefined][]) {
    if (dayRaw === undefined || monthRaw === undefined || whole === undefined) continue
    const month = MONTHS[monthRaw.toLowerCase()]
    if (month === undefined) continue
    const day = Number(dayRaw)
    const year = yearRaw === undefined ? undefined : Number(yearRaw)
    if (year !== undefined) {
      const on = realDate(year, month, day)
      return on === null ? null : { on, from: whole }
    }
    /*
      No year given, so the next occurrence: a date already past this year
      means next year. "3 October" said in November is next October, and
      reading it as five weeks ago would be an invented deadline in the past.
    */
    const thisYear = realDate(t.y, month, day)
    if (thisYear === null) return null
    const passed = thisYear < iso(t.y, t.m, t.d)
    const on = passed ? realDate(t.y + 1, month, day) : thisYear
    return on === null ? null : { on, from: whole }
  }

  /*
    "end of the week" / "end of the month" — both have an unambiguous answer,
    and both are checked BEFORE the weekday, because the first draft of the
    weekday pattern was `(mon|tue|...)[a-z]*` and matched the "mon" inside
    "month": "by the end of the month" came back as Monday the 21st. A
    trailing-wildcard alternation is a wildcard, and this is the second time
    this repository has been caught by a short word living inside a long one.
  */
  if (/\bend\s+of\s+(?:the\s+)?week\b/i.test(said)) {
    // Friday, because a working deadline is not Sunday.
    const ahead = (5 - t.dow + 7) % 7
    return { on: addDays(t.y, t.m, t.d, ahead), from: 'end of the week' }
  }
  if (/\bend\s+of\s+(?:the\s+)?month\b/i.test(said)) {
    const last = new Date(Date.UTC(t.y, t.m, 0)).getUTCDate()
    return { on: iso(t.y, t.m, last), from: 'end of the month' }
  }

  /*
    "by Friday", "on Monday", "next Tuesday".

    Every weekday spelt out, longest first, with a word boundary at BOTH ends,
    so no abbreviation can match the opening of a longer word.
  */
  const weekday =
    /\b(next\s+|this\s+)?(sunday|sun|monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat)\b/i.exec(
      said,
    )
  if (weekday !== null) {
    const target = WEEKDAYS[(weekday[2] ?? '').toLowerCase()]
    if (target !== undefined) {
      /*
        The next occurrence, TODAY INCLUDED. "by Friday" said on Friday means
        today; a rule that skipped to the next one would move a deadline seven
        days by arithmetic. "next Friday" is that plus a week, which is what
        the word does — and said ON a Friday it is seven days away, not
        fourteen, because today is already this Friday.
      */
      let ahead = (target - t.dow + 7) % 7
      if ((weekday[1] ?? '').toLowerCase().startsWith('next')) ahead += 7
      return { on: addDays(t.y, t.m, t.d, ahead), from: weekday[0] }
    }
  }

  return null
}

/**
 * Who a task was handed to, or null (#253).
 *
 * The roster is a closed set of eight, which is what makes this tractable
 * where `p_detail` and `p_milestone` are not: there is nothing to invent. A
 * name that is not one of the eight is not a near miss to be resolved, it is
 * somebody else, and `app.task_add` refuses an unknown slug with a sentence of
 * its own — so the failure mode here is a null, never a guess.
 *
 * ## Only the handing-over shapes
 *
 * "get Emma to chase it", "ask Marcus to look", "for Grace", "Emma to draft
 * the note". NOT "a task about Emma's report" and not "tell me what Emma
 * said" — a name in a sentence is not an assignment, and reading it as one
 * would put work on somebody because they were mentioned.
 *
 * The negative cases are in the tests beside the positive ones, because a
 * matcher this small is judged entirely by what it declines.
 */
const FIRST_NAMES: Readonly<Record<string, string>> = {
  claire: 'chief-of-staff',
  emma: 'research-director',
  tom: 'strategy-director',
  daniel: 'finance-director',
  marcus: 'operations-director',
  ruby: 'growth-director',
  oliver: 'communications-director',
  grace: 'quality-director',
}

const NAMES = Object.keys(FIRST_NAMES).join('|')

/** "get Emma to", "ask Marcus to", "have Tom", "tell Ruby to" — handing over. */
const HANDED = new RegExp(`\\b(?:get|have|ask|tell|put)\\s+(${NAMES})\\b`, 'i')
/** "for Emma", "assign it to Marcus", "Emma to chase the quote" — named owner. */
const OWNED = new RegExp(
  `\\b(?:for|to|assigned?\\s+to|owner:?|with)\\s+(${NAMES})\\b|\\b(${NAMES})\\s+to\\s+\\w+`,
  'i',
)

export function assignedTo(text: string): string | null {
  const said = String(text ?? '')
  if (said.trim() === '') return null
  const hit = HANDED.exec(said) ?? OWNED.exec(said)
  if (hit === null) return null
  const name = (hit[1] ?? hit[2] ?? '').toLowerCase()
  return FIRST_NAMES[name] ?? null
}

/**
 * The title with the deadline taken out of it — but only once the deadline is
 * a DATE.
 *
 * ## Why this lives here and not in `taskTitle`
 *
 * `tasks.ts` carried a comment saying the date was deliberately left in the
 * name because "nothing extracts it into a column". That stopped being true
 * when this file shipped, and the row proves it: on 22 September the office
 * created **"down for the printer quote, due Tuesday"** with
 * `due_on = 2026-09-22`. The deadline was in the column AND in the name.
 *
 * The first attempt at the fix subtracted the date inside `taskTitle`, which
 * would have broken the feature outright: the handler passes the TITLE to
 * `dueOn`, so a title with the date removed resolves to no date at all. The
 * words stay in the title precisely because the resolver reads them.
 *
 * ## The condition that makes it safe
 *
 * `instruction.ts` already records the argument against subtracting: it
 * "would have been a loss on every phrase the resolver declines". That is
 * true of an unconditional strip and not of this one. This takes out exactly
 * the words the resolver CONSUMED, and only when it resolved them — so a
 * phrase #253 refuses keeps every word Grant said, and one it accepts is not
 * said twice.
 *
 * Returns the title unchanged when removing the phrase would leave nothing:
 * a task called "" is worse than one called "by Friday".
 */
export const withoutTheDate = (title: string, due: Due | null): string => {
  if (due === null) return title
  const at = title.toLowerCase().lastIndexOf(due.from.toLowerCase())
  if (at === -1) return title
  const cut = title
    .slice(0, at)
    .replace(/[\s,;:-]*\b(?:due|by|before|on|for)\s*$/i, '')
    .replace(/[\s,;:-]+$/, '')
    .trim()
  return cut === '' ? title : cut
}
