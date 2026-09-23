/*
  Getting this browser signed in, without a credential passing through a person.

  ## The defect

  One bearer token is the whole of the authorisation in this office, and that
  is a hard constraint rather than a preference. The way it reached a browser
  was `npm run hq:token`, whose own message states the problem: "Access token —
  paste it once, per device." Grant never asked for that, and he met it as an
  interruption in front of Chat, Voice, Settings, appearance and every write:
  "Couldn't reach the office — browser's not signed in."

  ## What replaces it

  The browser asks. The office sends the ask to the Telegram chat it already
  knows is his — the same channel `hq:token` used — and he taps once. The
  browser collects the same token it would have been given to paste.

  Strictly less exposure, not more: nothing is rendered, nothing is in a chat
  log, nothing is in a clipboard, and a photograph of the sign-in screen is
  worth nothing to whoever takes it.

  ## Why there is a code on the screen

  The endpoint cannot authenticate the ask — there is nothing yet to present —
  so anybody who reaches the page can start one, and a request Grant did not
  start is an attempt to sign somebody else's browser in. The page shows a
  six-character code, the message carries the same one, and the message asks
  him to tap only if they match. The code is not a second secret. It is
  something to compare, which is its whole job.

  ## Nothing here decides anything

  `office.js`'s rule, and §5's: this translates. It does not judge whether a
  token is good — it stores what the office handed over and lets the next read
  be the authority, exactly as the paste flow did.
*/

import { token } from './office.js'

const API =
  window.HQ_API || 'https://baujwlzcziasnfhhkchg.supabase.co/functions/v1/hq-api'

/** The sign-in endpoint sits beside the gateway, whatever the gateway is. */
const ENDPOINT = window.HQ_SIGNIN || API.replace(/\/hq-api\/?$/, '/signin')

/** Something short and true about this browser, for the message he reads. */
export const askedFrom = () => {
  const ua = String(navigator.userAgent ?? '')
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'a browser'
  const where = /iPhone|iPad/.test(ua)
    ? 'an iPhone'
    : /Android/.test(ua)
      ? 'an Android phone'
      : /Mac OS X/.test(ua)
        ? 'a Mac'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'this device'
  return `${browser} on ${where}`
}

const post = async (body) => {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const parsed = await response.json().catch(() => ({}))
  return { status: response.status, body: parsed }
}

/**
 * Ask to be let in.
 *
 * Resolves with the code to put on the screen, or throws with a sentence a
 * person can act on. The thing that authorises never comes back here — it goes
 * to Telegram and nowhere else.
 */
export async function begin() {
  const { status, body } = await post({ action: 'begin', asked_from: askedFrom() })
  if (status === 429) {
    throw new Error(body.error ?? 'too many sign-in requests just now — wait a few minutes')
  }
  if (status === 403) {
    /*
      This page's origin is not on the endpoint's allowlist — a preview
      deployment, which gets its own hostname on every deploy and deliberately
      never goes on that list. Saying so plainly beats "forbidden", because the
      answer is different: use the stable address, or paste a token.
    */
    throw new Error('this address cannot sign in — open the office at its usual link')
  }
  if (status !== 200 || typeof body.request_id !== 'string') {
    throw new Error(body.error ?? 'the office could not start a sign-in')
  }
  return { requestId: body.request_id, code: String(body.code ?? ''), expiresAt: body.expires_at }
}

/**
 * Wait for the tap, then take the token.
 *
 * Polls, because the alternative is a socket held open for five minutes on a
 * free tier. `onWait` is called with each reason so the screen can stay honest
 * about which of "nobody has tapped yet" and "that expired" it is in.
 */
export async function settle(requestId, { onWait = () => {}, every = 2000, signal } = {}) {
  for (;;) {
    if (signal?.aborted === true) return { ok: false, reason: 'cancelled' }
    const { body } = await post({ action: 'claim', request_id: requestId })
    if (body.ok === true && typeof body.token === 'string' && body.token !== '') {
      /*
        Stored, and NOT validated here. A page that judged a credential would
        be a second place the rules live; the next read is the authority, and
        if the office refuses it `office.js` clears it — which is the behaviour
        that made every fake-token test in this repository invert the day the
        browser could finally reach the office.
      */
      if (!token.set(body.token)) {
        return { ok: false, reason: 'private' }
      }
      return { ok: true }
    }
    const reason = String(body.reason ?? 'unknown')
    if (reason === 'expired' || reason === 'spent' || reason === 'unknown') {
      return { ok: false, reason }
    }
    onWait(reason)
    await new Promise((resolve) => setTimeout(resolve, every))
  }
}

/** What to say for each way waiting can end. One place, so both pages agree. */
export const SAID = {
  expired: 'That request timed out. Ask again and tap the new link.',
  spent: 'That request was already used. Ask again.',
  unknown: 'The office has forgotten that request. Ask again.',
  private: 'This browser will not keep it — a private window cannot stay signed in.',
  cancelled: '',
}
