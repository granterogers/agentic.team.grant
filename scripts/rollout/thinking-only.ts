/**
 * The MINIMAL emergency gateway change: the `thinking` section calls `cannot_think` instead of `office_health`, and nothing else.
 *
 * Grant, 6 October 2026: the emergency wave ships the thinking mapping only. The session single-flight (a change to credential and
 * session resolution) stays on the branch and goes out later, when Supabase is stable.
 *
 * Pure text transform, so a test can prove it changes exactly one line and contains no single-flight. The source it starts from is
 * the p4 tip (the line production's gateway was built from), not the working tree, so nothing else that has changed since can ride along.
 */
export const BEFORE = "  thinking: { fn: 'office_health', office: true },"
export const AFTER = "  thinking: { fn: 'cannot_think', office: true },"

export const thinkingOnly = (source: string): string => {
  const at = source.indexOf(BEFORE)
  if (at < 0 || source.indexOf(BEFORE, at + 1) >= 0)
    throw new Error(`expected exactly one occurrence of: ${BEFORE}`)
  return source.slice(0, at) + AFTER + source.slice(at + BEFORE.length)
}
