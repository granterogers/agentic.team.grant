/**
 * The decisions behind password sign-in, as pure functions (issue #466, Workstream A1).
 *
 * Supabase Auth stores and checks the password. This file decides only the things the office owns: how strong a
 * password must be before it is sent, what an address looks like, what a successful answer from Auth becomes, and
 * whether the path is switched on at all. The sign-in function (supabase/functions/signin) calls these; the page calls
 * the function. Nothing here holds a secret or a hash.
 *
 * ## Enumeration
 *
 * Every refusal that could reveal whether an address has an account returns the same sentence, and so does the reset
 * and the sign-up. A sign-up for an address that exists answers the same way as one for a new address. A caller who
 * can tell the two apart has an address oracle, which this file refuses by construction: the sentences below are the
 * only ones an address-bearing request can produce.
 */

/** The shortest password accepted. Length is the strength rule that holds up; composition rules do not. */
export const PASSWORD_MIN_LENGTH = 12

/** Supabase Auth hashes with bcrypt, which reads at most 72 bytes. A longer password would be silently truncated. */
export const PASSWORD_MAX_BYTES = 72

export const SIGN_IN_REFUSED = 'Those details do not match an account. Check them and try again.'
export const SIGN_UP_SENT = 'If that address can be used, a confirmation link is on its way.'
export const RESET_SENT =
  'If that address has an account, a link to choose a new password is on its way.'
export const UNAVAILABLE = 'Sign-in is not reachable just now. Try again shortly.'
export const NOT_SWITCHED_ON = 'Signing in with a password is not switched on for this office.'

/** An address is accepted only if it has the shape of one. It is not checked against any list of accounts. */
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{2,63}$/

/** The trimmed, lower-cased address, or null when it does not look like one. */
export function normaliseEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase()
  return EMAIL.test(email) && email.length <= 254 ? email : null
}

/**
 * Why a password is not acceptable, in words a person can act on, or null when it is. The password must not contain
 * the address it goes with, which is the one composition check that is cheap and stops the most obvious guess.
 */
export function passwordProblem(password: string, email: string): string | null {
  if (password.trim() === '') return 'A password needs more than spaces.'
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `A password needs at least ${PASSWORD_MIN_LENGTH} characters.`
  }
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) {
    return `A password can be at most ${PASSWORD_MAX_BYTES} bytes, which is fewer characters if it has accents or emoji.`
  }
  const local = email.split('@')[0] ?? ''
  if (local.length >= 3 && password.toLowerCase().includes(local.toLowerCase())) {
    return 'A password should not contain your address.'
  }
  return null
}

export interface PasswordSession {
  readonly access_token: string
  readonly refresh_token: string
  /** Milliseconds since the epoch, the same field flow.js writes for a link sign-in. */
  readonly expires_at: number
}

/**
 * What Auth's token answer becomes. Refuses an answer that lacks a token or a lifetime, rather than storing a session
 * the page would then present and fail with. The lifetime has a floor and a ceiling so a malformed number cannot make a
 * session immortal or instantly expired.
 */
export function passwordSessionFrom(body: unknown, now: number): PasswordSession | null {
  const b = body as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown } | null
  if (typeof b?.access_token !== 'string' || b.access_token === '') return null
  if (typeof b.refresh_token !== 'string' || b.refresh_token === '') return null
  const seconds =
    typeof b.expires_in === 'number' && Number.isFinite(b.expires_in) ? b.expires_in : 3600
  const bounded = Math.min(Math.max(seconds, 60), 86_400)
  return {
    access_token: b.access_token,
    refresh_token: b.refresh_token,
    expires_at: now + bounded * 1000,
  }
}

/**
 * Whether the path is on. Off unless the deployment says so in words, so a missing or mistyped setting leaves the
 * password path closed rather than open.
 */
export function passwordSignInEnabled(setting: string | undefined): boolean {
  return setting === '1' || setting === 'true'
}
