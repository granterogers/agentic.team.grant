/**
 * Where a sign-in link may send a person back to (B-04, audit 6 October 2026).
 *
 * `signin` used to decide with `ALLOWED_ORIGINS.some((o) => back.startsWith(o))`. A prefix is not an origin:
 * `https://allowed.example.evil.com`, `https://allowed.example@evil.com` and `https://allowed.example:444` all begin
 * with `https://allowed.example`. The link is a credential and `redirect_to` decides who receives it, so the
 * decision is made here by parsing the address and comparing the ORIGIN for exact equality, and it is made without
 * relying on the identity provider's own redirect allow-list.
 *
 * This file is plain TypeScript with no Deno or DOM dependency so vitest drives the very code the function runs
 * (the deploy bundles it beside the entrypoint, scripts/deploy/lib/bundle.ts).
 *
 * ## What it accepts
 *
 * Only an address that, after parsing, has exactly the origin of one allowed entry, and whose raw text is made only
 * of the characters an ordinary page address needs. The result is REBUILT as `origin + path + query`, never the
 * caller's own string, and the fragment is dropped: the session arrives in the fragment, and a caller-chosen one
 * has no business there.
 *
 * ## What it refuses, and why each is cheap to refuse
 *
 *   - any character outside `A-Za-z0-9 - . _ ~ : / ? # = & , +`. That removes whitespace, control characters,
 *     backslashes, `@` (userinfo), `%` (encoded dots, slashes, at-signs and a percent-encoded host, which the URL
 *     parser DECODES), `;`, and every non-ASCII character (IDN and homoglyph hosts);
 *   - a scheme other than https, except http on a loopback host an allowed entry names itself;
 *   - an origin that is not exactly an allowed one (a trailing dot, a subdomain, a parent, another port);
 *   - a path with a `.` or `..` segment or an empty first segment (`//evil.com`);
 *   - anything longer than 2,048 characters.
 *
 * An allowed entry that is not itself a clean origin is dropped: a configuration mistake must not widen the list.
 * Any failure returns the fallback and never throws.
 */

const MAX_LENGTH = 2048
const PLAIN = /^[A-Za-z0-9\-._~:/?#=&,+]*$/
const LOOPBACK = new Set(['localhost', '127.0.0.1'])

/** One allowed entry as an exact origin, or null when it is not a clean origin (https, or http on loopback). */
export const normaliseAllowedOrigin = (entry: string): string | null => {
  const text = entry.trim()
  if (text === '' || !PLAIN.test(text)) return null
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return null
  }
  if (url.username !== '' || url.password !== '') return null
  if (url.search !== '' || url.hash !== '' || url.pathname !== '/') return null
  if (url.protocol === 'http:' && !LOOPBACK.has(url.hostname)) return null
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  return url.origin
}

/**
 * The address a link may return to: `back` rebuilt on an allowed origin, or `fallback`.
 *
 * `allowed` is the configured list as written (`SIGNIN_ALLOWED_ORIGIN` split on commas).
 */
export const safeRedirectTarget = (
  back: unknown,
  allowed: readonly string[],
  fallback: string,
): string => {
  if (typeof back !== 'string' || back === '' || back.length > MAX_LENGTH) return fallback
  if (!PLAIN.test(back)) return fallback
  const origins = new Set(
    allowed.map(normaliseAllowedOrigin).filter((o): o is string => o !== null),
  )
  let url: URL
  try {
    url = new URL(back)
  } catch {
    return fallback
  }
  if (url.username !== '' || url.password !== '') return fallback
  if (!origins.has(url.origin)) return fallback
  // The authority as written must be the host the parser kept: a literal `https://allowed.example` followed
  // by a path, query or fragment delimiter. (Everything that could make these differ is already outside PLAIN.)
  const raw = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^/?#]*)([^?#]*)/.exec(back)
  if (raw === null) return fallback
  const rawPath = raw[2] ?? ''
  if (rawPath.startsWith('//')) return fallback
  for (const segment of rawPath.split('/')) if (segment === '.' || segment === '..') return fallback
  if (url.pathname.startsWith('//')) return fallback
  return `${url.origin}${url.pathname}${url.search}`
}
