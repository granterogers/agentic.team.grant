/**
 * Did a failed `fetch` provably fail BEFORE any request bytes left the process?
 *
 * A write that failed before it was transmitted cannot have been accepted, so it is safe to retry with backoff. A
 * write that failed AFTER (a read timeout, a connection reset, a lost response) may have been accepted, and a retry can
 * put a second message in front of the person, so it stays indeterminate. When the evidence does not say, the answer is
 * "cannot tell", which callers treat as indeterminate.
 *
 * The evidence is the error's `code`, read through the `cause` chain (undici wraps the socket error in a
 * `TypeError: fetch failed`) and through an `AggregateError` (every address tried must have failed before connecting).
 * Only codes that are connect-phase by definition are listed; `ETIMEDOUT`, `ECONNRESET`, `EPIPE` and
 * `UND_ERR_SOCKET` can occur after the request was written and are deliberately NOT listed.
 */

const NOT_SENT_CODES: ReadonlySet<string> = new Set([
  // Name resolution: no socket was ever opened.
  'ENOTFOUND',
  'EAI_AGAIN',
  'EAI_FAIL',
  'EAI_NONAME',
  // The connect itself was refused or unroutable.
  'ECONNREFUSED',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ENETDOWN',
  'EADDRNOTAVAIL',
  // undici's connect phase.
  'UND_ERR_CONNECT_TIMEOUT',
  // The request URL or options were refused before any I/O.
  'ERR_INVALID_URL',
  'ERR_INVALID_ARG_TYPE',
  // TLS handshake failures: the request is written only after the handshake.
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'ERR_SSL_WRONG_VERSION_NUMBER',
  'ERR_SSL_PROTOCOL_ERROR',
  'EPROTO',
])

const codeOf = (value: unknown): string | null => {
  if (typeof value !== 'object' || value === null) return null
  const code = (value as { code?: unknown }).code
  return typeof code === 'string' ? code : null
}

const check = (value: unknown, depth: number): boolean => {
  if (depth > 6 || typeof value !== 'object' || value === null) return false
  const errors = (value as { errors?: unknown }).errors
  if (Array.isArray(errors) && errors.length > 0) {
    // Every address that was tried failed before connecting, or we cannot say.
    return errors.every((e) => check(e, depth + 1))
  }
  const code = codeOf(value)
  if (code !== null) return NOT_SENT_CODES.has(code)
  // `fetch failed` and friends carry the real reason one level down.
  return check((value as { cause?: unknown }).cause, depth + 1)
}

/** True only when the failure provably happened before the request was transmitted. */
export const failedBeforeSending = (error: unknown): boolean => check(error, 0)
