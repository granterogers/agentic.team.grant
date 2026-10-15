/*
  The signed-in person, and no office token anywhere near them.

  ## The correction this is written to

  Grant, 24 September:

    "He does not want an office-token interaction in the normal user
     experience AT ALL. The intended experience is: OPEN AGENTIC TEAM ->
     APPLICATION LOADS -> USER IS AUTHENTICATED -> USE APPLICATION. If an
     internal credential/token is required for secure communication with the
     office, that is an IMPLEMENTATION DETAIL."

  An earlier version of this file kept the office token and made the ceremony
  nicer — ask, tap in Telegram, collect a code. That was the wrong shape. It is
  gone.

  ## What a person has now

  Their own session, issued by this project's Supabase Auth, which has been
  sitting unused since the project was created. A magic link, once, and then
  nothing: the session refreshes itself, so opening the page is opening the
  page.

  The browser never holds a shared secret. What it holds is a short-lived token
  that is only good for this person, expires in an hour, and is refreshed
  against the office. The office verifies it with Supabase and checks its own
  list of the people it works for — two different questions, deliberately.

  ## The legacy key, and why it is still read

  `hq.token` is the office's bearer token, and browsers Grant already uses have
  one in storage. Removing the READ would sign him out of every device he owns
  the moment this shipped, which is a worse first morning than the ceremony
  being replaced. So it is still accepted if a session is absent, and nothing
  in the interface offers to put one there.

  ## Nothing here decides anything

  §5's rule for adapters applies to a page too: this translates. It does not
  judge whether a session is good — the office is the only thing that can say
  that, and `office.js` clears what the office refuses.
*/

import { HQ_API as API, SIGNIN as ENDPOINT } from './backend.js'
import { begin as beginFlow, decide, KIND_GOOGLE, KIND_LINK, kindOf, returnAddress } from './flow.js'
import { bounded, note, unreachable } from './net.js'

const KEY = 'hq.session'

/** What a session looks like once it is ours: two tokens and a deadline. */
const read = () => {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw === null || raw === '') return null
    const s = JSON.parse(raw)
    if (typeof s?.access_token !== 'string' || s.access_token === '') return null
    return s
  } catch {
    // Private window, blocked storage, or something that is not ours.
    return null
  }
}

const write = (s) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
    return true
  } catch {
    return false
  }
}

/*
  The epoch: moves when somebody signs out, so a response begun before that can be told from one begun after (#405).
*/
let epochNow = 0
export const epoch = () => epochNow
export const bump = () => {
  epochNow += 1
}

export const forget = () => {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* nothing to do */
  }
}

export const signedIn = () => read() !== null

/** The office's own address, for the one call a person with no office yet makes (bc/account.js). */
export const apiUrl = () => API

/*
  Every call here ends (net.js). The deadline is longer than the function's own twelve seconds towards Auth, so the
  answer that normally arrives is the function's, with a reason; the browser's deadline is the backstop for a function
  that does not answer at all. The names are the boundaries in the trace.
*/
const BOUNDARY = { link: 'auth:link', refresh: 'auth:refresh', whoami: 'auth:whoami', sample: 'auth:sample' }
const DEADLINE = { link: 20_000, refresh: 16_000, whoami: 16_000, sample: 20_000 }

const post = async (body, auth = '') => {
  const headers = { 'content-type': 'application/json' }
  if (auth !== '') headers.authorization = `Bearer ${auth}`
  const action = String(body.action ?? '')
  const response = await bounded(
    BOUNDARY[action] ?? 'auth:link',
    ENDPOINT,
    { method: 'POST', headers, body: JSON.stringify(body) },
    DEADLINE[action] ?? 20_000,
  )
  return { status: response.status, body: await response.json().catch(() => ({})) }
}

/*
  THE LINK COMING BACK.

  Supabase returns the session in the URL FRAGMENT, which never leaves the
  browser — it is not sent to the server and it is not in a referrer. Taking it
  out of the address bar immediately afterwards matters for a different reason:
  a URL with a token in it is a URL somebody pastes into a chat.

  `history.replaceState` rather than assigning `location.hash`, because
  assigning would add a history entry and put the token one Back press away.
*/
export const adopt = () => {
  /*
    A SESSION IS ADOPTED ONLY FOR A SIGN-IN THIS BROWSER STARTED (B-05, flow.js). The decision is pure and lives there;
    this applies it: store what it says to store, always take the fragment (and the nonce) out of the address, and
    keep any sentence for the person.
  */
  let flows
  try {
    flows = localStorage
  } catch {
    flows = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
  }
  // The return is judged as the kind of flow it names: a link, or a Google sign-in this browser started (#467).
  const asked = new URLSearchParams(window.location.search).get('flow') ?? ''
  const decided = decide({
    hash: window.location.hash,
    search: window.location.search,
    store: flows,
    now: Date.now(),
    kind: kindOf(flows, asked, Date.now()) ?? KIND_LINK,
  })
  if (!decided.touched) return false
  window.history.replaceState(null, '', `${window.location.pathname}${decided.search}`)
  if (decided.session === null) {
    landed.problem = decided.problem
    return false
  }
  note('callback:adopt')
  write(decided.session)
  return true
}

/** Anything the redirect told us that the person needs to see. */
export const landed = { problem: '' }

/*
  THE TOKEN TO PRESENT, refreshed if it is about to be useless.

  A minute of margin, because a request that starts valid and arrives expired
  is indistinguishable from being signed out, and the page would clear a
  perfectly good session over it.
*/
let refreshing = null

export const presentable = async () => {
  const s = read()
  if (s === null) return ''
  if (s.expires_at > Date.now() + 60_000) return s.access_token
  if (s.refresh_token === undefined || s.refresh_token === '') {
    forget()
    return ''
  }
  /*
    ONE REFRESH AT A TIME. Several requests go out on a page load and each
    would otherwise start its own exchange — and a refresh token is single use,
    so the second exchange would fail and sign a working session out.
  */
  if (refreshing === null) {
    refreshing = (async () => {
      /*
        A deadline, a 5xx and an "unavailable" are not a refusal. The session stays where it is and the caller is told
        the service did not answer (an Unreachable error, with the boundary), because forgetting a session over an
        outage signs a person out for something that is not theirs. Only an answer that says the token is no good
        clears it.
      */
      const { status, body } = await post({ action: 'refresh', refresh_token: s.refresh_token })
      if (status >= 500 || body.reason === 'unavailable') throw unreachable('auth:refresh', 0)
      if (body.ok === true && typeof body.access_token === 'string') {
        write({
          access_token: body.access_token,
          refresh_token: body.refresh_token ?? s.refresh_token,
          expires_at: Date.now() + Math.max(60, Number(body.expires_in ?? 3600)) * 1000,
          // A visitor stays a visitor across a refresh; only signing out or in changes that.
          ...(s.sample === true ? { sample: true } : {}),
        })
        return body.access_token
      }
      /*
        ONLY AN EXPLICIT "EXPIRED" SIGNS A PERSON OUT. Anything else that is not a success (an answer in a shape this page
        does not know, a 4xx that is not about the token, a body that did not parse) is a service that did not say the
        token was bad, so the session stays and the person is told the service did not answer.
      */
      if (body.reason !== 'expired') throw unreachable('auth:refresh', 0)
      forget()
      return ''
    })().finally(() => {
      refreshing = null
    })
  }
  return await refreshing
}

/**
 * Synchronous, for the callers that cannot wait.
 *
 * `canWrite()` is asked while a template is being built, so it cannot await a
 * refresh. It answers from what is stored, which is the right answer: a
 * session that is about to expire is still a session, and the refresh happens
 * on the next request either way.
 */
export const heldToken = () => read()?.access_token ?? ''

/*
  THE SAMPLE OFFICE (0897). A visitor with no account is given a real session for a read-only guest of the public Sample
  Office, and this page remembers only that fact about it (`sample`), so it can say where the visitor is. What the session
  may do is decided by the office, never by this flag: a flag that is wrong changes a banner, not what is allowed.
*/
export const isSample = () => read()?.sample === true

/*
  The label on a visitor's own questions, so their conversation is theirs and nobody else's. Random, kept in this browser
  only, and cleared when they leave (signing out clears every key that is not a device preference). It is not a
  credential: the office checks its shape and uses it to separate threads, nothing more.
*/
const VISITOR_KEY = 'hq.visitor'
export const visitorId = () => {
  try {
    const have = localStorage.getItem(VISITOR_KEY) ?? ''
    if (/^[a-z0-9]{24,64}$/.test(have)) return have
    const bytes = crypto.getRandomValues(new Uint8Array(20))
    const made = Array.from(bytes, (b) => (b % 36).toString(36)).join('') + Date.now().toString(36)
    localStorage.setItem(VISITOR_KEY, made)
    return made
  } catch {
    // Storage blocked: a label that lasts for this page only is still a label.
    if (memoryVisitor === '') {
      memoryVisitor = Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => (b % 36).toString(36)).join('')
    }
    return memoryVisitor
  }
}
let memoryVisitor = ''

/** Open the Sample Office: no address, no link, no password. Resolves true once the session is held. */
export async function startSample() {
  const { status, body } = await post({ action: 'sample' })
  if (status >= 500 || body.reason === 'unavailable') throw unreachable('auth:sample', 0)
  if (body.ok !== true || typeof body.access_token !== 'string' || body.access_token === '') {
    throw new Error(String(body.said ?? 'The sample office is not open at the moment. You can still create your own office.'))
  }
  note('sample:start')
  write({
    access_token: body.access_token,
    refresh_token: body.refresh_token ?? '',
    expires_at: Date.now() + Math.max(60, Number(body.expires_in ?? 3600)) * 1000,
    sample: true,
  })
  return true
}

/*
  PASSWORD SIGN-IN (#466, A1). The office decides whether it is switched on; the page only asks. A sign-in that
  succeeds stores the same session a link sign-in does, so everything after it is unchanged. Every refusal is the
  sentence the office sent, and the office sends the same sentence for an unknown address and a wrong password.
*/

/** Whether this deployment offers a password. Any failure reads as "no", so the link path is never hidden by an outage. */
export async function passwordOffered() {
  try {
    const { body } = await post({ action: 'methods' })
    return body.password === true
  } catch {
    return false
  }
}

/** Sign in with an address and a password. Resolves when the session is held; throws the office's sentence otherwise. */
export async function passwordSignIn(email, password) {
  const { body } = await post({ action: 'password_sign_in', email, password })
  if (body.ok === true && body.session !== undefined && write(body.session)) return true
  throw new Error(String(body.said ?? 'Sign-in is not reachable just now. Try again shortly.'))
}

/**
 * Ask for a link to choose a new password. This browser remembers the request (the same binding a sign-in link uses), so
 * the link comes back here and is accepted; it answers the same way for any address.
 */
export async function passwordReset(email) {
  let nonce = ''
  try {
    nonce = beginFlow(localStorage, { email }, Date.now(), crypto.getRandomValues(new Uint8Array(24)))
  } catch {
    nonce = ''
  }
  if (nonce === '') throw new Error('This browser is blocking the storage sign-in needs. Allow site data for this page and try again.')
  const { body } = await post({
    action: 'password_reset',
    email,
    back: returnAddress(window.location.origin, window.location.pathname, nonce),
  })
  if (body.ok !== true) throw new Error(String(body.said ?? 'The reset could not be asked just now. Try again shortly.'))
  return String(body.said)
}

/** True when the session came from a password reset and no new password has been chosen yet. */
export const mustSetPassword = () => read()?.recovery === true

/** Save the new password for the reset session this browser holds. Resolves with the office's sentence. */
export async function setPassword(password) {
  const held = read()
  if (held === null || held.recovery !== true) throw new Error('That reset has ended. Ask for a new link and try again.')
  const { body } = await post({
    action: 'password_set',
    access_token: held.access_token,
    email: held.email ?? '',
    password,
  })
  if (body.ok !== true) throw new Error(String(body.said ?? 'The password could not be saved just now. Try again shortly.'))
  write({ ...held, recovery: false })
  return String(body.said)
}

/** Ask the office to email a link. It answers the same way for any address. */
export async function askForLink(email) {
  /*
    THIS BROWSER STARTS THE SIGN-IN, and remembers it (flow.js): the link will come back to `?flow=<nonce>` and is
    adopted here only for that nonce. If the browser will not remember it, say so now rather than send a link that
    this page would then refuse.
  */
  let nonce = ''
  try {
    nonce = beginFlow(localStorage, { email }, Date.now(), crypto.getRandomValues(new Uint8Array(24)))
  } catch {
    nonce = ''
  }
  if (nonce === '') {
    throw new Error('This browser is blocking the storage sign-in needs. Allow site data for this page and try again.')
  }
  const { body } = await post({
    action: 'link',
    email,
    back: returnAddress(window.location.origin, window.location.pathname, nonce),
  })
  if (body.error !== undefined) throw new Error(String(body.error))
  // A link that was not sent is not "check your email". The office says so with ok false and a sentence; say that.
  if (body.ok === false) {
    throw new Error(String(body.said ?? 'The link could not be sent just now. Try again shortly.'))
  }
  return String(body.said ?? 'Check your email for a link to sign in.')
}

/**
 * Whether this deployment offers Google (#467). Off unless the owner has switched it on; any failure reads as "no", so
 * the other ways in are never hidden by an outage.
 */
export async function googleOffered() {
  try {
    const { body } = await post({ action: 'methods' })
    return body.google === true
  } catch {
    return false
  }
}

/**
 * Start a Google sign-in. This browser remembers its flow (the same binding a link uses), the office gives back the
 * provider's address, and the browser is sent there. Throws the sentence the office sent when there is no address.
 */
export async function googleStart() {
  let nonce = ''
  try {
    nonce = beginFlow(localStorage, { kind: KIND_GOOGLE }, Date.now(), crypto.getRandomValues(new Uint8Array(24)))
  } catch {
    nonce = ''
  }
  if (nonce === '') {
    throw new Error('This browser is blocking the storage sign-in needs. Allow site data for this page and try again.')
  }
  const back = returnAddress(window.location.origin, window.location.pathname, nonce)
  const { body } = await post({ action: 'google_start', back, nonce })
  if (body.ok !== true || typeof body.url !== 'string') {
    throw new Error(String(body.said ?? 'Google sign-in is not reachable just now. Try again shortly.'))
  }
  window.location.assign(body.url)
  return true
}

/** Who the office thinks this is, for a page that wants to say so. */
export async function whoami() {
  // A page that wants to say who is signed in can do without it: no answer is no name, never an unhandled rejection.
  try {
    const token = await presentable()
    if (token === '') return ''
    const { body } = await post({ action: 'whoami' }, token)
    return body.ok === true ? String(body.email ?? '') : ''
  } catch {
    return ''
  }
}
