/**
 * What the office says back after it files a personal task or a reminder.
 *
 * Deep systems audit, 6 October 2026 (R1 / R3). The sentence is a claim about
 * what is stored, so it is composed here from the STORED facts and nothing
 * else: the date, the time and the zone the reminder is for, whether the time
 * was his or the office's default, and whether a repeat was kept, could not be
 * kept, or was refused. A sentence that promised a repeat the writer did not
 * record, or a time in a zone the office did not use, is the fabrication the
 * coherence gate exists to catch and is cheaper not to make.
 *
 * The three older shapes are unchanged, word for word, so nothing that matched
 * them stops matching.
 */

import { localClock } from './office-time.ts'

export interface ReminderFacts {
  readonly title: string
  /** ISO date the task is on, or null. */
  readonly due: string | null
  /** ISO instant the reminder is for, or null (no reminder). */
  readonly remindAt: string | null
  /** The time is the office's default because he named none. */
  readonly defaulted: boolean
  /** The default time had already gone today; the reminder is for now. */
  readonly immediate: boolean
  /** The repeat as said back ("every Monday"), when one was asked for and the office keeps it. */
  readonly repeatLabel: string | null
  /** True when the repeat is stored, false when storing it failed, null when none was asked for. */
  readonly repeatStored: boolean | null
  /** The words of a repeat that cannot be kept, when he asked for one. */
  readonly repeatUnsupported: string | null
  /** The office's zone, named in the sentence so a time is never ambiguous. */
  readonly timeZone: string
}

export function reminderSentence(f: ReminderFacts): string {
  const parts: string[] = []
  const on = f.due === null ? '' : ` for ${f.due}`
  const head =
    f.due === null
      ? `That is on your list — "${f.title}", no date on it yet.`
      : `That is on your list${on} — "${f.title}".`
  parts.push(head)
  if (f.remindAt !== null) {
    if (f.immediate) {
      parts.push(
        'You did not say a time, and nine o’clock has already passed today, so I will remind you ' +
          'at the next check, within about fifteen minutes.',
      )
    } else {
      const at = localClock(new Date(f.remindAt), f.timeZone)
      parts.push(`I will remind you around ${at} (${f.timeZone}).`)
      if (f.defaulted) parts.push('You did not say a time, so I used 09:00.')
    }
  }
  if (f.repeatLabel !== null) {
    if (f.repeatStored === true) {
      parts.push(
        `It repeats ${f.repeatLabel}. The next one is made when you tick this one off, ` +
          'so tick each one when it is done.',
      )
    } else {
      parts.push(
        `I could not record that it repeats ${f.repeatLabel}, so this is a one-off. ` +
          'Say it again and I will retry.',
      )
    }
  }
  if (f.repeatUnsupported !== null) {
    parts.push(
      `I did not record “${f.repeatUnsupported}” as a repeat, so this is a one-off: I can keep ` +
        'every day, every week, every other week or a named weekday.',
    )
  }
  return parts.join(' ')
}
