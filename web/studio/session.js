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
const BOUNDARY = { link: 'auth:link', refresh: 'auth:refresh', whoami: 'auth:whoami' }
const DEADLINE = { link: 20_000, refresh: 16_000, whoami: 16_000 }

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
  const raw = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : ''
  if (raw === '') return false
  const q = new URLSearchParams(raw)
  const access = q.get('access_token') ?? ''
  const refresh = q.get('refresh_token') ?? ''
  const failed = q.get('error_description') ?? q.get('error') ?? ''
  if (access === '' && failed === '') return false
  const clean = `${window.location.pathname}${window.location.search}`
  window.history.replaceState(null, '', clean)
  if (access === '') {
    landed.problem = failed.replace(/\+/g, ' ')
    return false
  }
  const seconds = Number(q.get('expires_in') ?? '3600')
  note('callback:adopt')
  write({
    access_token: access,
    refresh_token: refresh,
    expires_at: Date.now() + Math.max(60, seconds) * 1000,
  })
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
      if (body.ok !== true || typeof body.access_token !== 'string') {
        forget()
        return ''
      }
      write({
        access_token: body.access_token,
        refresh_token: body.refresh_token ?? s.refresh_token,
        expires_at: Date.now() + Math.max(60, Number(body.expires_in ?? 3600)) * 1000,
      })
      return body.access_token
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

/** Ask the office to email a link. It answers the same way for any address. */
export async function askForLink(email) {
  const { body } = await post({
    action: 'link',
    email,
    back: `${window.location.origin}${window.location.pathname}`,
  })
  if (body.error !== undefined) throw new Error(String(body.error))
  // A link that was not sent is not "check your email". The office says so with ok false and a sentence; say that.
  if (body.ok === false) {
    throw new Error(String(body.said ?? 'The link could not be sent just now. Try again shortly.'))
  }
  return String(body.said ?? 'Check your email for a link to sign in.')
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
