/**
 * The sentences of a message, for the readers that have to act on ONE of them.
 *
 * A rule, a reminder and a question can share a message; each reader must decide from its own sentence, not from the
 * whole text and not from a fragment. The first version of this split on every full stop, so "Remind me to call
 * Dr. Smith tomorrow." became a task called "Call Dr" and "Acme Inc." ended a sentence (review R2-1). A full stop ends a
 * sentence only when what follows starts one (an upper-case letter, a quote or a bracket) and what precedes it is not an
 * abbreviation, an initial or a list number; `?` and `!` end one when whitespace follows. A URL and a decimal number are
 * never split: a stop with no whitespace after it ends nothing.
 */

const ABBREVIATION =
  /(?:^|[\s("'])(?:dr|mr|mrs|ms|mx|prof|st|jr|sr|inc|ltd|llc|co|corp|vs|etc|approx|no|fig|mt|dept|est|al)$/i

export const sentencesOf = (text: string): string[] => {
  const t = text.trim()
  if (t === '') return []
  const out: string[] = []
  let start = 0
  const stop = /([.!?]+)(?=\s)/g
  for (let m = stop.exec(t); m !== null; m = stop.exec(t)) {
    const end = m.index + m[0].length
    const before = t.slice(start, m.index)
    const after = t.slice(end).trimStart()
    if (m[0].startsWith('.')) {
      // A full stop ends a sentence only where a sentence plausibly begins.
      if (!/^["'“‘([]?[A-Z]/.test(after)) continue
      if (ABBREVIATION.test(before)) continue
      if (/(?:^|\s)[A-Z]$/.test(before)) continue // an initial: "J. Smith"
      if (/(?:^|\s)\d{1,3}$/.test(before)) continue // a list number: "1. call Kevin"
    }
    out.push(t.slice(start, end).trim())
    start = end
  }
  const rest = t.slice(start).trim()
  if (rest !== '') out.push(rest)
  return out
}
