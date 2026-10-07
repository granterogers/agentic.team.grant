/**
 * Canonical text and hashing for the frozen retention files. Pure: no filesystem, no network.
 *
 * The deletion tool accepts ONLY a proposal whose bytes hash to a value a person approved, so the bytes must be reproducible:
 * keys are sorted at every depth, indentation is fixed, and the text ends in one newline. The hash is of those exact bytes.
 */
import { createHash } from 'node:crypto'

export const sha256 = (text: string): string =>
  createHash('sha256').update(text, 'utf8').digest('hex')

const sortDeep = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(sortDeep)
  if (v !== null && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, x]) => [k, sortDeep(x)]),
    )
  }
  return v
}

/** The one serialisation every frozen file uses. */
export const canonicalText = (v: unknown): string => `${JSON.stringify(sortDeep(v), null, 2)}\n`
