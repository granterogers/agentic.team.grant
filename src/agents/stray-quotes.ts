/**
 * An empty quotation at the start of an answer carries nothing.
 *
 * Behavioural remediation, 24 September 2026 (ledger R36). The primary model
 * opens roughly one answer in forty with a pair of empty quotes and then the
 * real text: `""   To give you the information in clear bullet points, I
 * need...`. Eighteen stored outputs since 22 September, every one a question
 * back to Grant, and every one delivered exactly as written, because nothing
 * between the model and the channel reads the first characters.
 *
 * Narrow on purpose: only an EMPTY pair (straight or curly, double or single)
 * at the very start or end is removed. A quotation with anything in it is his
 * words or somebody's, and is left alone.
 */
const EMPTY_PAIR = '(?:""|\'\'|\u201C\u201D|\u2018\u2019)'
const LEADING = new RegExp(String.raw`^\s*(?:${EMPTY_PAIR}\s*)+`)
const TRAILING = new RegExp(String.raw`(?:\s*${EMPTY_PAIR})+\s*$`)

export function withoutStrayQuotes(body: string): string {
  const text = String(body ?? '')
  const out = text.replace(LEADING, '').replace(TRAILING, '')
  // Never turn an answer into nothing: an answer that was only quotes stays.
  return out.trim() === '' ? text : out
}
