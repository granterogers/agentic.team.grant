/**
 * The decisions behind "Sign in with Google" (#467, A2). Pure: no network, no database, no provider call.
 *
 * The owner creates the OAuth client in Google Cloud Console and configures Supabase Auth. Until then nothing here reaches
 * a provider. These rules are what the callback will enforce once it is wired, and each one is tested with fixtures:
 *
 *   - Redirects: a return address must be an absolute https origin on an allowlist, with no credentials, no protocol-relative
 *     form and no backslash. Anything else is refused, which closes open redirects.
 *   - State: every sign-in carries a signed, expiring token. A callback whose state is missing, forged, altered or expired is
 *     refused, which closes login CSRF and replay.
 *   - Cancellation: a provider error such as access_denied is a cancellation, reported as one, not as a failure.
 *   - Linking: a provider identity is never attached to an account because the email addresses match. The only links are an
 *     identity the account already holds, or a link to the account the person is signed into, and only while the identity
 *     belongs to nobody else. An unverified provider email never creates or links anything.
 *   - Flag: sign-in is off unless the flag is explicitly on, so the button can ship dark.
 *
 * Plain words in this file's comments; no backticks, because this file is read by the template check.
 */

export type RedirectVerdict = { ok: true } | { ok: false; reason: string }

/** A return address the sign-in may send the person back to. Relative paths only, on an allowlisted origin. */
export function redirectAllowed(
  target: string,
  allowedOrigins: readonly string[],
): RedirectVerdict {
  if (target.includes('\\')) return { ok: false, reason: 'backslash' }
  if (target.startsWith('//')) return { ok: false, reason: 'protocol-relative' }
  let url: URL
  try {
    url = new URL(target, 'https://placeholder.invalid')
  } catch {
    return { ok: false, reason: 'not a URL' }
  }
  if (url.origin === 'https://placeholder.invalid') {
    // A relative path is allowed, and only a path: nothing that carries a scheme or host.
    return target.startsWith('/') && !target.includes('@')
      ? { ok: true }
      : { ok: false, reason: 'relative path must start with /' }
  }
  if (url.username !== '' || url.password !== '')
    return { ok: false, reason: 'credentials in the address' }
  if (url.protocol !== 'https:') return { ok: false, reason: 'not https' }
  if (!allowedOrigins.includes(url.origin)) return { ok: false, reason: 'origin not allowlisted' }
  return { ok: true }
}

const enc = new TextEncoder()
const dec = new TextDecoder()

function b64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function fromB64url(text: string): Uint8Array {
  const padded = text
    .replaceAll('-', '+')
    .replaceAll('_', '/')
    .padEnd(Math.ceil(text.length / 4) * 4, '=')
  const raw = atob(padded)
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

// No explicit return type: CryptoKey is not in this project's libraries, and the inferred type is the one the calls need.
async function hmacKey(secret: Uint8Array) {
  return await globalThis.crypto.subtle.importKey(
    'raw',
    new Uint8Array(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

/** A signed state token: the payload and an HMAC over it. Expires after `ttlMs`. */
export async function createState(
  secret: Uint8Array,
  options: { nowMs: number; ttlMs: number; nonce: string; returnTo: string },
): Promise<string> {
  const payload = b64url(
    enc.encode(
      JSON.stringify({ n: options.nonce, r: options.returnTo, exp: options.nowMs + options.ttlMs }),
    ),
  )
  const mac = await globalThis.crypto.subtle.sign(
    'HMAC',
    await hmacKey(secret),
    enc.encode(payload),
  )
  return `${payload}.${b64url(new Uint8Array(mac))}`
}

export type StateVerdict =
  | { ok: true; nonce: string; returnTo: string }
  | { ok: false; reason: 'missing' | 'malformed' | 'bad signature' | 'expired' }

/** Check a state token. Constant-time for the signature: the verifier compares the whole MAC, never stops early. */
export async function verifyState(
  secret: Uint8Array,
  token: string | null,
  nowMs: number,
): Promise<StateVerdict> {
  if (!token) return { ok: false, reason: 'missing' }
  const parts = token.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'malformed' }
  const [payload, mac] = parts as [string, string]
  let macBytes: Uint8Array
  try {
    macBytes = fromB64url(mac)
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  const valid = await globalThis.crypto.subtle.verify(
    'HMAC',
    await hmacKey(secret),
    new Uint8Array(macBytes),
    enc.encode(payload),
  )
  if (!valid) return { ok: false, reason: 'bad signature' }
  let body: { n?: unknown; r?: unknown; exp?: unknown }
  try {
    body = JSON.parse(dec.decode(fromB64url(payload)))
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  if (typeof body.n !== 'string' || typeof body.r !== 'string' || typeof body.exp !== 'number') {
    return { ok: false, reason: 'malformed' }
  }
  if (nowMs >= body.exp) return { ok: false, reason: 'expired' }
  return { ok: true, nonce: body.n, returnTo: body.r }
}

export type CallbackOutcome =
  | { action: 'continue' }
  | { action: 'cancelled' }
  | { action: 'refused'; reason: string }

/** What a callback should do before any account is touched. */
export function callbackOutcome(input: {
  providerError: string | null
  hasCode: boolean
  state: StateVerdict
}): CallbackOutcome {
  if (input.providerError === 'access_denied') return { action: 'cancelled' }
  if (input.providerError !== null)
    return { action: 'refused', reason: 'the provider returned an error' }
  if (!input.state.ok) return { action: 'refused', reason: `state ${input.state.reason}` }
  if (!input.hasCode) return { action: 'refused', reason: 'no authorisation code' }
  return { action: 'continue' }
}

export interface LinkInput {
  providerEmailVerified: boolean
  /** The account this provider identity already belongs to, or null. Matched on the provider's subject, never on email. */
  identityOwner: string | null
  /** The account the person is signed into right now, or null. */
  signedInAs: string | null
  /** Whether an account already exists with this email (email is for display and for the person to recognise, not for linking). */
  emailAccountExists: boolean
}

export type LinkDecision =
  | { action: 'sign_in'; accountId: string }
  | { action: 'link_to_signed_in'; accountId: string }
  | { action: 'create_account' }
  | { action: 'refuse'; reason: string }

export function decideLink(input: LinkInput): LinkDecision {
  if (input.identityOwner !== null) {
    // The identity is already somebody's. It signs that person in, and cannot be attached to anyone else.
    if (input.signedInAs !== null && input.signedInAs !== input.identityOwner) {
      return { action: 'refuse', reason: 'this Google identity belongs to another account' }
    }
    return { action: 'sign_in', accountId: input.identityOwner }
  }
  if (!input.providerEmailVerified)
    return { action: 'refuse', reason: 'the Google email address is not verified' }
  if (input.signedInAs !== null) {
    // The person proved they own the account they are signed into, so linking the identity to it is theirs to ask for.
    return { action: 'link_to_signed_in', accountId: input.signedInAs }
  }
  if (input.emailAccountExists) {
    // Same email, but nobody has proved they own that account yet. Attaching Google here would hand the account to whoever
    // controls the Google mailbox. The person must sign in first, then link.
    return {
      action: 'refuse',
      reason:
        'an account with this email exists: sign in to it first, then link Google from its settings',
    }
  }
  return { action: 'create_account' }
}

/** Sign-in is off unless the flag is exactly on. A missing or malformed flag is off. */
export function googleSignInEnabled(flags: Record<string, unknown> | null | undefined): boolean {
  return flags?.['auth.google_sign_in'] === true
}
