/**
 * One place that knows what a credential looks like.
 *
 * Written for the job trace (#115), which is the highest-volume text the office
 * will ever store and therefore the worst possible place to leak one. But the
 * reason it is a shared module rather than a third private helper is what was
 * found while writing it.
 *
 * ## There were already two, and they disagreed
 *
 * `src/providers/router.ts` redacted four families inline before writing a
 * provider error. `src/telegram/api.ts` redacted a bot token out of a URL path.
 * `migrations/0062` enforces a fifth vocabulary as a CHECK constraint on
 * `connection_health`. Three lists, none aware of the others, each missing what
 * the others had — the router did not know about `ntn_`, the constraint did not
 * know about `Bearer`, and nothing anywhere knew about a Google refresh token.
 *
 * A redaction list that lives in three places is a redaction list that is wrong
 * in at least two of them, and the failure is silent by construction: the thing
 * you find out is that a secret was stored, and you find it out late.
 *
 * ## Shapes, not values
 *
 * Nothing here is a secret and nothing here reads the vault. These are the
 * PREFIXES and STRUCTURES that credential formats use, which are public facts
 * about those formats — `sk-` is documented by OpenAI, `xoxb-` by Slack. That
 * is also why this file survives `npm run check:secrets`: there is nothing in
 * it to find.
 *
 * ## Deliberately over-eager
 *
 * Every pattern here would rather eat a harmless string than miss a live one.
 * The Authorization family redacts whatever follows the scheme, whatever it is;
 * the catch-all takes any 40-plus character run of credential-shaped
 * characters that contains a digit.
 * Over-redacting costs a slightly less readable trace. Under-redacting puts a
 * working credential in a table that Grant's dashboard renders.
 *
 * Grant's instruction is absolute and has no "unless it is inconvenient" in it:
 * *"Do not expose secret values in logs, commits, reports, test output or
 * chat."*
 */

/**
 * The families, each with the name of what it catches.
 *
 * Named rather than anonymous because a bare list of regexes is unmaintainable
 * and because `describe()` below reports which family fired, which is what
 * makes a redaction debuggable without printing the thing it redacted.
 */
const FAMILIES: readonly (readonly [string, RegExp])[] = [
  // Slack: xoxb-, xoxp-, xoxa-, xoxr-, xoxs-, xoxe-
  ['slack', /xox[abeprs]-[A-Za-z0-9-]{6,}/g],
  // OpenAI and the many keys that copied its shape, OpenRouter included.
  ['openai', /sk-(?:proj-|or-|ant-|live-)?[A-Za-z0-9_-]{12,}/g],
  // Supabase personal access tokens and service keys.
  ['supabase', /sbp_[A-Za-z0-9]{16,}/g],
  // Notion integration tokens: the modern ntn_ and the legacy secret_.
  ['notion', /(?:ntn_|secret_)[A-Za-z0-9]{16,}/g],
  // Google API keys, and OAuth refresh tokens, which start 1// and are long.
  ['google', /AIza[A-Za-z0-9_-]{20,}/g],
  ['google-oauth', /\b1\/\/[A-Za-z0-9_-]{20,}/g],
  // GitHub: ghp_, gho_, ghu_, ghs_, ghr_, and the fine-grained github_pat_.
  ['github', /\b(?:gh[posur]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g],
  // Telegram bot tokens, in a URL path or on their own.
  ['telegram', /\b\d{6,}:[A-Za-z0-9_-]{30,}/g],
  // A JWT, which is what a Supabase anon or service key is.
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g],
  // AWS and S3-compatible, which is how the Backblaze bucket is reached.
  ['aws', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  /*
    An Authorization header, whatever it carries.

    Last of the named families and first in effect for most leaks: a provider
    error usually carries the request that failed, and the request usually
    carries this.

    A LOOKBEHIND rather than a capture group, so the scheme survives and the
    line still reads as an Authorization header. The first version matched the
    scheme too and replaced the lot, which turned a legible failure into
    `Authorization: [redacted]` and lost the one word that says what kind of
    credential was being offered.
  */
  ['authorization', /(?<=\b(?:Bearer|Basic|Token)\s)[A-Za-z0-9._~+/=-]{8,}/gi],
  /*
    Anything else long enough to be a key.

    The catch-all, and the reason this is more than a list of prefixes: the
    families above cover what the office holds TODAY, and the next connector
    will have its own shape. A 40-character run of base64-ish characters with
    no spaces in it is not prose.

    Word-bounded at both ends and requiring a digit, so a long English word, a
    UUID (which has dashes at fixed offsets and is not secret) and a file path
    do not match. A sha256 hex digest DOES match, which is intended -- a hash of
    a credential is not a credential, but it is not something a trace needs
    either.
  */
  ['long-opaque', /\b(?=[A-Za-z0-9_+/=-]*\d)[A-Za-z0-9_+/=-]{40,}\b/g],
]

/** What a redaction leaves behind. Names the family, so a trace stays legible. */
const mark = (family: string): string => `[redacted:${family}]`

/**
 * The text, with anything credential-shaped taken out.
 *
 * Safe on any input including the empty string, and cheap on the overwhelmingly
 * common case where there is nothing to find: eleven regex passes over a short
 * string, no allocation unless something matches.
 */
export function redactSecrets(text: string): string {
  if (text === '') return text
  let out = text
  for (const [family, pattern] of FAMILIES) {
    // `lastIndex` is per-regex state on a /g pattern and these are module-level
    // constants, so a previous call could otherwise resume mid-string and miss
    // a match at the start. Reset rather than recompiling.
    pattern.lastIndex = 0
    out = out.replace(pattern, mark(family))
  }
  return out
}

/**
 * Which families fired, for a check that wants to say what it found.
 *
 * Returns names, never the matched text. A test that printed the secret it
 * caught in order to prove it caught it would be the exact failure this file
 * exists to prevent -- and test output is named in Grant's instruction.
 */
export function secretFamilies(text: string): string[] {
  const found: string[] = []
  for (const [family, pattern] of FAMILIES) {
    pattern.lastIndex = 0
    if (pattern.test(text)) found.push(family)
  }
  return found
}

/** True when there is anything credential-shaped in the text. */
export const carriesSecret = (text: string): boolean => secretFamilies(text).length > 0

/**
 * Redact anywhere inside a JSON-shaped value, keys and structure intact.
 *
 * The trace stores `detail` as jsonb and a naive `JSON.stringify` then redact
 * then parse would work until a redaction landed inside a key and produced
 * something that no longer parses. This walks instead: every string is
 * redacted, every key is left alone, and the shape is preserved so the thing
 * reading the trace still finds the fields it expects.
 */
export function redactDeep(value: unknown): unknown {
  if (typeof value === 'string') return redactSecrets(value)
  if (Array.isArray(value)) return value.map(redactDeep)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redactDeep(v)
    return out
  }
  return value
}
