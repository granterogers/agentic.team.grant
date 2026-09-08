/**
 * Saying numbers and lists the way a person says them.
 *
 * Grant: *"I want messages in general from everyone to be more human and
 * easier to read."*
 *
 * Most of what made them robotic was small and mechanical. `5 event(s)` is the
 * clearest case: a programmer declining to think about a plural, and nobody has
 * ever said it out loud. The rest was density — every fact one clause after
 * another with no breathing room, and a full stop after a bold heading, which
 * is a report format rather than a message.
 *
 * These are the small mechanical parts, in one place, so a message reads the
 * same wherever in the codebase it was written.
 */

/** `1 event`, `5 events`. Never `5 event(s)`. */
export const count = (n: number, one: string, many: string): string =>
  `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`

/**
 * `nothing`, `Gmail`, `Gmail and Drive`, `Gmail, Drive and YouTube`.
 *
 * No Oxford comma, deliberately: the house voice is British, and "a, b, and c"
 * reads as somebody else's in a chat message.
 */
export const list = (items: readonly string[]): string => {
  if (items.length === 0) return 'nothing'
  if (items.length === 1) return String(items[0])
  return `${items.slice(0, -1).join(', ')} and ${String(items[items.length - 1])}`
}

/**
 * A number said the way it lands.
 *
 * `no messages` rather than `0 messages` — a nought makes a reader stop and
 * parse, and the sentence usually reads better without one.
 */
export const howMany = (n: number, one: string, many: string): string =>
  n === 0 ? `no ${many}` : count(n, one, many)
