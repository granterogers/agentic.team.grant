/**
 * The Google sign-in flow's decisions (issue #467). Pure: no network, no database, no clock.
 *
 * The page asks the office to start Google sign-in. The office checks that the feature is switched on and that the
 * return address is allowed, and then gives back the provider's authorise address, asking the provider to send the
 * person back to the page with the same single-use flow nonce that a link sign-in uses (web/studio/flow.js). The page
 * adopts a session only for a flow it started, exactly as it does for a link, so Google does not add a second, weaker
 * way in.
 *
 * Until the owner creates the Google client and enables the provider in Supabase, the flag is off and nothing here is
 * reachable. Plain words in this file's comments; no backticks, because this file is read by the template check.
 */
import { redirectAllowed } from './google-policy.ts'

export const GOOGLE_OFF = 'Signing in with Google is not switched on for this office.'
export const GOOGLE_REFUSED =
  'Google did not finish the sign-in. Try again, or sign in another way.'
export const GOOGLE_CANCELLED = 'You cancelled signing in with Google, so nothing was changed.'

/** The flag is on only when its value is exactly the word true. Anything else, including an empty setting, is off. */
export function googleOffered(setting: string | undefined | null): boolean {
  return setting === 'true'
}

const NONCE = /^[a-z0-9]{24,64}$/

export type GoogleStart = { ok: true; url: string } | { ok: false; said: string }

/**
 * The address to send the person to, or the sentence for why there is none. Every refusal is decided before any URL is
 * built, so a refused request never produces a link.
 */
export function googleStartPlan(input: {
  switchedOn: boolean
  /** The provider's authorise base, an https origin. Supabase's project address in production. */
  authorizeBase: string
  /** The page the person returns to, with the flow nonce in its query. Checked against the allowlist. */
  back: string
  allowedOrigins: readonly string[]
  nonce: string
}): GoogleStart {
  if (!input.switchedOn) return { ok: false, said: GOOGLE_OFF }
  if (!NONCE.test(input.nonce)) return { ok: false, said: GOOGLE_REFUSED }
  const back = redirectAllowed(input.back, input.allowedOrigins)
  if (!back.ok) return { ok: false, said: GOOGLE_REFUSED }
  let base: URL
  try {
    base = new URL(input.authorizeBase)
  } catch {
    return { ok: false, said: GOOGLE_OFF }
  }
  if (base.protocol !== 'https:' || base.username !== '' || base.password !== '') {
    return { ok: false, said: GOOGLE_OFF }
  }
  const url = new URL('/auth/v1/authorize', base.origin)
  url.searchParams.set('provider', 'google')
  url.searchParams.set('redirect_to', input.back)
  return { ok: true, url: url.toString() }
}

/**
 * The sentence for a return that carries a provider error. A cancellation is named as one. Every other error becomes the
 * same plain sentence: the provider's own wording is not shown, because it can carry detail that does not belong on screen.
 */
export function googleReturnProblem(error: string): string {
  return error === 'access_denied' ? GOOGLE_CANCELLED : GOOGLE_REFUSED
}
