/**
 * Slack request signature verification.
 *
 * This is the only thing standing between the events endpoint and anyone on the
 * internet who knows its URL, so it is its own module with its own tests.
 *
 * Slack signs `v0:{timestamp}:{raw body}` with HMAC-SHA256 under the app's
 * signing secret and sends the result as `X-Slack-Signature: v0=<hex>`, with
 * the timestamp in `X-Slack-Request-Timestamp`.
 *
 * Written against **Web Crypto**, deliberately. The Telegram webhook shipped
 * with `Buffer.from()` in its comparison: 31 unit tests passed under Node while
 * every authenticated request in production threw `Buffer is not defined`,
 * because `Buffer` is a Node global and not a Deno one. The lesson recorded
 * then was that code shared across runtimes must be written to the
 * intersection of them, and `crypto.subtle` is in that intersection.
 *
 * Three properties this file exists to guarantee:
 *
 *   1. The comparison is constant-time, and costs the same for a wrong
 *      signature of the right length as for one of the wrong length. The
 *      obvious `if (a.length !== b.length) return false` is a length oracle,
 *      and Node's `timingSafeEqual` throws on unequal lengths — which turns a
 *      hostile request into a 500 and leaks the same fact.
 *   2. The raw body is signed, not the parsed one. `JSON.stringify(JSON.parse(x))`
 *      is not `x`, so verifying a re-serialised body verifies a different
 *      string and fails for well-formed requests while appearing to work in
 *      tests that round-trip the same serialiser.
 *   3. An old timestamp is refused. Without a replay window, a captured
 *      request is valid forever.
 */

/** Slack's documented replay window. */
export const MAX_SKEW_SECONDS = 60 * 5

export type VerifyFailure =
  | 'missing_signature'
  | 'missing_timestamp'
  | 'malformed_timestamp'
  | 'stale_timestamp'
  | 'unsupported_version'
  | 'signature_mismatch'

export interface VerifyResult {
  readonly ok: boolean
  readonly reason: VerifyFailure | null
}

const OK: VerifyResult = { ok: true, reason: null }
const fail = (reason: VerifyFailure): VerifyResult => ({ ok: false, reason })

const encoder = new TextEncoder()

/**
 * Compare two ASCII strings in time independent of their contents.
 *
 * Length is folded into the result rather than short-circuiting on it: the loop
 * runs over the longer of the two, so a wrong-length signature costs the same
 * as a wrong-value one and neither reveals which it was.
 */
export const constantTimeEquals = (a: string, b: string): boolean => {
  const left = encoder.encode(a)
  const right = encoder.encode(b)
  const length = Math.max(left.length, right.length)
  let diff = left.length ^ right.length
  for (let i = 0; i < length; i += 1) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0)
  }
  return diff === 0
}

const hex = (bytes: ArrayBuffer): string =>
  Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

/** Compute the signature Slack should have sent for this request. */
export const computeSignature = async (
  signingSecret: string,
  timestamp: string,
  rawBody: string,
): Promise<string> => {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(signingSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(`v0:${timestamp}:${rawBody}`))
  return `v0=${hex(mac)}`
}

/**
 * Verify a request.
 *
 * @param rawBody The body **exactly as received**. Not a re-serialised object:
 *   see property 2 in the file comment.
 * @param nowSeconds Injected so the replay window is testable without waiting
 *   five minutes, and so a test cannot pass by accident of the clock.
 */
export const verifySlackRequest = async (
  signingSecret: string,
  headers: { signature: string | null; timestamp: string | null },
  rawBody: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<VerifyResult> => {
  if (headers.signature === null || headers.signature === '') return fail('missing_signature')
  if (headers.timestamp === null || headers.timestamp === '') return fail('missing_timestamp')

  // Slack versions its signature scheme. Refusing an unknown version is the
  // difference between "we do not support that yet" and silently accepting a
  // scheme whose properties we have not checked.
  if (!headers.signature.startsWith('v0=')) return fail('unsupported_version')

  // `Number()` on '' is 0 and on '12abc' is NaN — both must be refused, so the
  // check is on the digits rather than on the parse.
  if (!/^\d{1,12}$/.test(headers.timestamp)) return fail('malformed_timestamp')
  const timestamp = Number(headers.timestamp)

  // Absolute skew, not just "too old". A far-future timestamp is equally a sign
  // of something other than Slack on the other end.
  if (Math.abs(nowSeconds - timestamp) > MAX_SKEW_SECONDS) return fail('stale_timestamp')

  const expected = await computeSignature(signingSecret, headers.timestamp, rawBody)
  return constantTimeEquals(expected, headers.signature) ? OK : fail('signature_mismatch')
}
