/**
 * What a transcript says, without the noise speech puts into it.
 *
 * Behavioural remediation, 24 September 2026 (ledger R27). Grant dictates,
 * and a voice note is text by the time the office reads it — so every
 * deterministic reader sees the disfluencies exactly as the transcriber wrote
 * them. Measured on this branch's readers:
 *
 *   "um so yeah can you er add a task to uh chase the the printers for
 *    friday no wait thursday"
 *      -> a project task titled "thursday": the date correction was read as
 *         withdrawing the whole request, and the personal reader titled it
 *         "Yeah can you er uh chase the the printers no wait"
 *
 *   "remind me to ring the the bank tomorrow actually no make it monday"
 *      -> due TOMORROW, the date he took back
 *
 * Three things, each closed and structural, none a rewrite of meaning:
 *
 *   1. fillers — um, uh, er, erm, hmm — which carry nothing;
 *   2. an immediate repetition of the same word ("the the"), which is a
 *      stutter or a transcriber's echo, never content;
 *   3. a DATE or TIME corrected in place — "friday no wait thursday", "at 3,
 *      sorry, 4" — keeps the correction and drops what it replaced. Only when
 *      both sides are the same kind of thing (two days, two times), so a
 *      change of mind about the WORK is left to the retraction reader, which
 *      is the one that knows about work.
 *
 * The model still reads the message; this decides what the deterministic
 * readers — titles, dates, reminders, call-offs — are given.
 */

const FILLERS = /(?:^|\s)(?:u+m+|u+h+|e+r+m*|a+h+|h+m+)(?=[\s,.!?]|$)[,]?/gi

const DAY = String.raw`(?:today|tonight|tomorrow|(?:next\s+|this\s+)?(?:mon|tues?|wednes?|thurs?|fri|satur|sun)day|next\s+week|the\s+\d{1,2}(?:st|nd|rd|th))`
const TIME = String.raw`(?:(?:at\s+)?(?:[01]?\d|2[0-3])(?:[:.][0-5]\d)?\s*(?:am|pm)?)`
// Repeatable: "actually no, make it" is three correcting words in a row.
const CORRECTING = String.raw`[\s,.;:—-]*(?:(?:no\s+wait|sorry|no|wait|i\s+mean|actually|or\s+rather|make\s+(?:it|that))[\s,.;:—-]+)+`

const DAY_FIXED = new RegExp(String.raw`\b${DAY}${CORRECTING}(${DAY})\b`, 'gi')
const TIME_FIXED = new RegExp(String.raw`\bat\s+${TIME}${CORRECTING}(${TIME})\b`, 'gi')

export function cleanDictation(text: string): string {
  let t = String(text ?? '')
  t = t.replace(FILLERS, ' ')
  // "the the", "to to": a word said twice in a row, case-insensitively.
  // Not "had had" or "that that", which are English.
  t = t.replace(/\b([a-z']+)(?:\s+\1\b)+/gi, (m, w: string) => (/^(?:had|that)$/i.test(w) ? m : w))
  t = t.replace(DAY_FIXED, (_m, kept: string) => kept)
  t = t.replace(TIME_FIXED, (_m, kept: string) => (/^at\s/i.test(kept) ? kept : `at ${kept}`))
  // Whitespace only. Punctuation is his (and the transcriber's): "the um... No
  // actually" keeps its ellipsis, which the retraction reader may read.
  return t
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,!?])/g, '$1')
    .trim()
}
