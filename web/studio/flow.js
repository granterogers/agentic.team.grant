/*
  A SIGN-IN THIS BROWSER STARTED, and the decision about a link that comes back (B-05, audit 6 October 2026).

  ## The defect

  `session.adopt()` stored whatever `#access_token=...&refresh_token=...` the address carried. Nothing tied the
  session to a sign-in THIS browser had asked for, so an attacker who signs in as themselves and sends a victim the
  resulting link signs the victim's browser into the ATTACKER's office (login CSRF / session fixation): what the victim
  then types, uploads and connects lands in the attacker's office.

  ## The binding

  When the browser asks for a link (`askForLink`) it mints a random single-use nonce, remembers it here with the
  flow kind, the address asked for and a deadline, and has the office send the person back to
  `<page>?flow=<nonce>`. A returning session is adopted only when `flow` names a pending, unexpired, unused flow of
  the right kind in THIS browser's storage; the flow is spent as it is used, so replaying the same link fails.

  The nonce is not a secret from the browser that holds it (it sits in the address of the page it is used on). What
  it proves is that THIS browser started a sign-in and that this return is the one it was waiting for. An attacker's
  link cannot carry a victim's nonce, because the victim's browser minted it and the attacker never sees it.

  ## A link opened somewhere else

  A link requested on one device and opened on another (a phone's mail app, a different browser) has no pending flow
  here. It is REFUSED, with a sentence saying so and what to do, rather than adopted behind a confirmation. The cases
  are indistinguishable from outside: the person who opens it on the wrong browser and the victim of a forwarded
  attacker link both arrive with a valid token and no flow, and a prompt naming the account ("Sign in as x@y?") would
  put the decision on the victim, who is exactly the person the attack persuades. The cost is one extra request for
  the honest cross-device case, which the sentence names. Storage is localStorage rather than sessionStorage because a
  mail client opens the link in a NEW tab of the same browser, which does not share sessionStorage.

  This file is pure (a storage object, a clock and random bytes are passed in) so it is tested without a window.
*/

export const FLOW_KEY = 'hq.signin.flow'
/** A magic link is good for an hour at the identity provider; a pending flow lives no longer. */
export const FLOW_TTL_MS = 60 * 60 * 1000
/** Several links may be in flight (a person asks again, an older email is still in the inbox). */
export const MAX_PENDING = 5
export const NONCE_RE = /^[a-z0-9]{24,64}$/
export const KIND_LINK = 'link'
/** A Google sign-in this browser started (#467). Same binding as a link; a different kind so the two never adopt each other. */
export const KIND_GOOGLE = 'google'
/** The sentence for a Google return the person cancelled. Mirrors src/auth/google-flow.ts (the page cannot import TypeScript). */
export const GOOGLE_CANCELLED =
  'You cancelled signing in with Google, so nothing was changed.'

export const OTHER_BROWSER =
  'This sign-in link was not requested from this browser, or it has already been used or has expired. ' +
  'Open it in the browser where you asked for it, or ask for a new link here.'
const GENERIC_FAILURE = 'That sign-in link did not work. Ask for a new one.'

const readList = (store) => {
  try {
    const raw = store.getItem(FLOW_KEY)
    if (raw === null || raw === undefined || raw === '') return []
    const list = JSON.parse(raw)
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

const writeList = (store, list) => {
  try {
    if (list.length === 0) store.removeItem(FLOW_KEY)
    else store.setItem(FLOW_KEY, JSON.stringify(list))
    return true
  } catch {
    return false
  }
}

const wellFormed = (f, now) =>
  f !== null &&
  typeof f === 'object' &&
  typeof f.nonce === 'string' &&
  NONCE_RE.test(f.nonce) &&
  typeof f.kind === 'string' &&
  Number.isFinite(f.exp) &&
  f.exp > now

/** The flows that can still be used, oldest first. Anything malformed or expired is not one. */
export const pending = (store, now) => readList(store).filter((f) => wellFormed(f, now))

/** The kind of the pending flow with this nonce, or null when there is none. Decides which kind a return is judged as. */
export const kindOf = (store, nonce, now) => {
  if (typeof nonce !== 'string' || !NONCE_RE.test(nonce)) return null
  const f = pending(store, now).find((x) => x.nonce === nonce)
  return f === undefined ? null : f.kind
}

/** A fresh nonce from random bytes (crypto.getRandomValues in the page, a fixed array in a test). */
export const nonceFrom = (bytes) => Array.from(bytes, (b) => (b % 36).toString(36)).join('')

/**
 * Remember that this browser is asking for a sign-in. Returns the nonce, or '' when storage refused: a sign-in that
 * cannot be remembered cannot be recognised on its return, and the caller must say so rather than send a link that
 * will be refused.
 */
export const begin = (store, { kind = KIND_LINK, email = '' }, now, bytes) => {
  const nonce = nonceFrom(bytes)
  if (!NONCE_RE.test(nonce)) return ''
  const kept = pending(store, now).slice(-(MAX_PENDING - 1))
  kept.push({ nonce, kind, email: String(email).slice(0, 254), at: now, exp: now + FLOW_TTL_MS })
  return writeList(store, kept) ? nonce : ''
}

/** The return address to ask for: the page's own address with the nonce on it, and nothing else. */
export const returnAddress = (origin, pathname, nonce) =>
  nonce === '' ? `${origin}${pathname}` : `${origin}${pathname}?flow=${nonce}`

const consume = (store, nonce, now) =>
  writeList(
    store,
    pending(store, now).filter((f) => f.nonce !== nonce),
  )

/**
 * What to do with an address that may carry a returning sign-in.
 *
 * Returns
 *   { touched: false }                       nothing of ours is in the address: change nothing
 *   { touched: true, search, session|null, problem }
 *       `search` is the query string to leave in the address bar (the nonce removed), the fragment always goes;
 *       `session` is the session to store, or null; `problem` is a sentence for the person, or ''.
 *
 * The session is returned only when a pending flow of `kind` with exactly this nonce exists, has not expired and
 * has not been used, and it is spent here, so a second call with the same address returns no session.
 */
export const decide = ({ hash, search, store, now, kind = KIND_LINK }) => {
  const raw = typeof hash === 'string' && hash.startsWith('#') ? hash.slice(1) : ''
  if (raw === '') return { touched: false }
  const q = new URLSearchParams(raw)
  const access = q.get('access_token') ?? ''
  const refresh = q.get('refresh_token') ?? ''
  const failed = q.get('error_description') ?? q.get('error') ?? ''
  // Nothing in the fragment is a sign-in return (an unrelated anchor): leave the address alone.
  if (access === '' && refresh === '' && failed === '') return { touched: false }

  const params = new URLSearchParams(typeof search === 'string' ? search : '')
  const asked = params.get('flow') ?? ''
  params.delete('flow')
  const rest = params.toString()
  const clean = rest === '' ? '' : `?${rest}`

  // A return that names its flow must match it exactly. A return with NO flow in its address (the provider or the
  // sign-in service dropped it) is accepted only against the newest pending flow of this kind in THIS browser: the
  // owner chose that trade-off (single-person office; a forwarded link is still refused unless this browser asked
  // for one within the hour). A named flow that is wrong is always refused.
  const open = pending(store, now).filter((f) => f.kind === kind)
  const match =
    asked !== ''
      ? NONCE_RE.test(asked)
        ? open.find((f) => f.nonce === asked)
        : undefined
      : open[open.length - 1]

  if (match === undefined) {
    return { touched: true, search: clean, session: null, problem: OTHER_BROWSER }
  }
  // A flow this browser started, returning. It is spent whatever the outcome: a link is one use.
  consume(store, match.nonce, now)

  if (failed !== '') {
    // A token beside an error is not a success. A Google cancellation is named as one; every other provider error is
    // shown as the clipped words the provider sent, as before.
    const cancelled = kind === KIND_GOOGLE && q.get('error') === 'access_denied'
    return {
      touched: true,
      search: clean,
      session: null,
      problem: cancelled ? GOOGLE_CANCELLED : failed.replace(/\+/g, ' ').slice(0, 200),
    }
  }
  if (access === '') {
    return { touched: true, search: clean, session: null, problem: GENERIC_FAILURE }
  }
  const seconds = Number(q.get('expires_in') ?? '3600')
  return {
    touched: true,
    search: clean,
    problem: '',
    session: {
      access_token: access,
      refresh_token: refresh,
      expires_at: now + Math.max(60, Number.isFinite(seconds) ? seconds : 3600) * 1000,
      // A password reset's return (type=recovery): the person must choose a password before the session is used.
      recovery: q.get('type') === 'recovery',
      email: typeof match.email === 'string' ? match.email : '',
    },
  }
}
