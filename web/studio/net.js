/*
  A request that ends, and says where it stopped.

  ## The defect this exists to close

  Grant, 5 October 2026: "My actual login attempt hung indefinitely."

  The page's sign-in path made five kinds of request with no deadline at all: the link request and the
  refresh exchange (session.js), every read and write to the office (office.js) and the first-office call
  (bc/account.js). A fetch with no deadline waits for the browser's own limit, which is minutes or never, and
  the boot sequence awaits the refresh BEFORE it asks for the studio payload, so an Auth service that is slow
  or stuck left the page on a blank, spinner-less screen. The studio payload itself had a ten second deadline
  (data.js) and so did the pulse; the path in front of them had none, which is why the outage rule "the page
  says the office did not answer" held for everything except the first thing a returning person does.

  Measured on the deployed project at 06:14 UTC the same morning: one call to the sign-in function took
  59,096 ms and answered 200, and a call to the Auth service behind it answered 500 after 22,448 ms. Nothing
  in the browser would have stopped waiting.

  ## What a bounded request does

  - It gives up after a stated time and throws an error whose name is Unreachable and whose message is a
    sentence a person can act on: which step, how long, that nothing was lost, what to do.
  - It never decides that a person is signed out. A deadline is not a refusal, so the callers keep the
    stored session and only a real 401 clears it.
  - It records where it stopped. Every call writes one entry to a short trace (window.__hqTrace, and the last
    twenty in session storage under hq.trace) with the boundary it crossed, how long it took and how it ended.
    A hang is then attributable to the exact boundary rather than to "login".

  ## The boundaries, in the order a returning person crosses them

    auth:refresh        the stored session is nearly out: exchange the refresh token (sign-in function, then Auth)
    auth:link           ask for an email link (sign-in function, then Auth)
    auth:whoami         ask who the office thinks this is
    callback:adopt      the redirect fragment becomes a stored session (instant, local, recorded for completeness)
    office:read:NAME    one section of the office (gateway, then the database)
    office:act:NAME     one change to the office
    office:create       the first-office call for a person who has a session and no office yet
    hydrate:studio      the studio payload that decides what is on screen (data.js)

  Plain words in every comment in this file: it is imported by modules whose markup lives inside template literals.
*/

const TRACE_KEY = 'hq.trace'
const KEEP = 20

/** One entry per request: where, how long, how it ended. */
export const trace = (globalThis.__hqTrace = globalThis.__hqTrace ?? [])

const remember = (entry) => {
  trace.push(entry)
  if (trace.length > 200) trace.splice(0, trace.length - 200)
  try {
    sessionStorage.setItem(TRACE_KEY, JSON.stringify(trace.slice(-KEEP)))
  } catch {
    // Private window or blocked storage: the in-memory trace is still there.
  }
}

/** The last boundary that did not answer, for a message that wants to name it. */
export const lastStall = () => {
  for (let i = trace.length - 1; i >= 0; i -= 1) {
    if (trace[i].outcome === 'timeout') return trace[i]
  }
  return null
}

/** The sentence for each boundary. Plain words, no addresses, no status codes. */
const WHAT = {
  'auth:refresh': 'The sign-in service',
  'auth:link': 'The sign-in service',
  'auth:whoami': 'The sign-in service',
  'office:create': 'Your office',
  'hydrate:studio': 'Your office',
}
const whoIs = (boundary) => WHAT[boundary] ?? 'Your office'

export const unreachable = (boundary, ms) => {
  const seconds = Math.round(ms / 1000)
  // A service that answered "unavailable" has no clock of ours to quote.
  const within = seconds > 0 ? ` in ${seconds} seconds` : ''
  // Asking for a link happens before anybody is signed in, so it must not claim a session; it says what is still possible.
  const after =
    boundary === 'auth:link'
      ? 'If an email arrives you can use it; if not, try again in a minute.'
      : 'Nothing was lost and you are still signed in. Try again in a minute.'
  const e = new Error(`${whoIs(boundary)} did not answer${within}. ${after} (stopped at ${boundary})`)
  e.name = 'Unreachable'
  e.boundary = boundary
  return e
}

/**
 * fetch with a deadline.
 *
 * `boundary` names the step for the trace and the message. `ms` is the deadline for the whole exchange up to the
 * response headers; the body is read by the caller afterwards, and a body that stalls is the caller's to bound.
 * A signal the caller already holds is honoured: aborting it still aborts the request, and is not reported as a
 * timeout.
 */
export async function bounded(boundary, url, init = {}, ms = 20_000) {
  const began = Date.now()
  const at = new Date(began).toISOString()
  const stop = AbortSignal.timeout(ms)
  const signal =
    init.signal !== undefined && typeof AbortSignal.any === 'function'
      ? AbortSignal.any([init.signal, stop])
      : stop
  try {
    const response = await fetch(url, { ...init, signal })
    remember({ boundary, at, ms: Date.now() - began, outcome: 'answered', status: response.status })
    return response
  } catch (error) {
    const timedOut = stop.aborted || (error instanceof Error && error.name === 'TimeoutError')
    remember({
      boundary,
      at,
      ms: Date.now() - began,
      outcome: timedOut ? 'timeout' : 'failed',
      status: 0,
    })
    if (timedOut) throw unreachable(boundary, ms)
    if (error instanceof Error && error.name === 'AbortError') throw error
    // A network failure (offline, refused, blocked): say so in the same plain words, with the same boundary.
    const e = new Error(
      `${whoIs(boundary)} could not be reached. Check your connection and try again. (stopped at ${boundary})`,
    )
    e.name = 'Unreachable'
    e.boundary = boundary
    throw e
  }
}

/** Record a step that is not a request (the redirect fragment becoming a session, for example). */
export const note = (boundary, outcome = 'answered') => {
  remember({ boundary, at: new Date().toISOString(), ms: 0, outcome, status: 0 })
}
