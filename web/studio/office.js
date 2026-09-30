/*
  Talking to the office.

  Issue #68, ADR-0019. The studio was read-only: one fetch, for the whole
  payload, and every button that changed anything lived on the page it is
  replacing. This is the half that lets the old one be deleted.

  ## The same token, the same endpoint, and no new auth
  
  A hard constraint, not a preference: one bearer token, constant-time compared
  at `hq-api`. The studio reads it from `localStorage` under the key Team HQ
  already uses, so opening the studio after the old page needs no second
  sign-in and rotating the token still rotates it once.

  ## Every write reports what happened, in the same place the button is

  A studio-wide toast would be easier and is the wrong shape: a confirmation
  that appears in the corner while you are looking at a row makes you check
  whether it was your row. `say()` puts the sentence next to the control that
  caused it.

  ## Nothing here decides anything

  §5's rule for channel adapters applies just as well to a page: this
  translates. It does not validate, it does not decide whether an action is
  allowed, and it does not soften an error. The RPC is the authority and the
  page repeats what it said — a page that guesses at the rules is a second
  place the rules live.
*/

import { HQ_API as API, UNCONFIGURED } from './backend.js'
import * as session from './session.js'

/*
  THE OFFICE'S OWN KEY, AND WHY IT IS STILL READ HERE.

  `hq.token` is the bearer token `hq-api` compares in constant time. It is the
  right shape for the worker, the scripts and the MCP endpoint, and it is the
  WRONG shape for a person -- which is how it ended up on Grant's screen asking
  to be pasted. The interface no longer offers to put one here.

  The READ stays, and deliberately: browsers he already uses hold one, and
  deleting the read would sign him out of every device he owns the moment this
  shipped. A session beats it whenever there is one.
*/
const KEY = 'hq.token'

export const token = {
  get() {
    try {
      return localStorage.getItem(KEY) ?? ''
    } catch {
      // Private window, or storage blocked. Read-only is the honest state.
      return ''
    }
  },
  set(value) {
    try {
      localStorage.setItem(KEY, value)
      return true
    } catch {
      return false
    }
  },
  clear() {
    try {
      localStorage.removeItem(KEY)
    } catch {
      /* nothing to do */
    }
  },
}

/*
  WHAT THIS BROWSER CAN PRESENT, in order of preference.

  A person's own session first, then the legacy office key if one is lying
  about from before. Synchronous, because `canWrite()` is asked while a
  template is being built and cannot await a refresh -- a session that is about
  to expire is still a session, and the refresh happens on the next request.
*/
const held = () => {
  const mine = session.heldToken()
  return mine === '' ? token.get() : mine
}

/*
  And the asynchronous one, for an actual request: it refreshes a session that
  is nearly out rather than sending a token that will arrive expired.
*/
const toPresent = async () => {
  const mine = await session.presentable()
  return mine === '' ? token.get() : mine
}

/** Whether this browser can change anything, as opposed to only read. */
export const canWrite = () => held() !== ''

/*
  WHAT TO PRESENT, for the callers that take a credential as an argument.

  `chat` and the voice-note transcriber are handed one rather than reaching for
  it, which is right -- but the thing they were handed was `token.get()`, so a
  browser signed in as a PERSON would have handed them an empty string and the
  chat would have reported itself signed out on a page that plainly was not.
  One exported answer, so there is one idea of what this browser presents.
*/
export const presented = () => held()

/*
  The same answer, but refreshed first, for a caller that is about to make a
  request with it. `live()` and the hydrate path take a token as an ARGUMENT,
  so they cannot go through `act`/`read`, and they used to read the legacy key
  straight out of storage -- which meant a browser signed in as a PERSON was
  read as having nothing and drew the prototype without ever asking the office.
*/
export const presentedFresh = async () => await toPresent()

/**
 * Do something to the office.
 *
 * Throws with the server's own words. `hq-api` returns a result object that can
 * itself carry an `error` — an RPC refusing on its own terms, which is a
 * different thing from a transport failure and reads identically to a caller,
 * so both become an exception here and neither is swallowed.
 */
/*
  What happens after any successful write (#118).

  A callback rather than an import, because the thing that wants to know is
  `undo.js` and `undo.js` calls `act` — importing it here would be a cycle. It
  is also the honest shape: this module talks to the office and does not know
  what the page does about it.

  One chokepoint matters more than it looks. Every write in the studio goes
  through `act`, so hooking it here means no button anywhere has to remember
  that undo exists, and the fifteenth action added next month gets it for free.
  A per-button opt-in would have been forgotten by the third one.
*/
let afterWrite = () => {}

/** Register what to do after any successful write. Replaces any previous. */
export function onWrite(fn) {
  afterWrite = typeof fn === 'function' ? fn : () => {}
}

/*
  NO OFFICE NAMED IS A STATE, AND IT IS NOT THE SAME AS ONE THAT WOULD NOT
  ANSWER.

  `backend.js` returns the empty string when nothing has told this deployment
  which office it belongs to (ADR-0048), and `fetch('')` is not an error -- it
  resolves against the page's own origin, fetches the HTML back, and fails as a
  JSON parse. So the page would report "the server returned nothing sensible"
  about a server it never called, which is the found-nothing shape on the one
  question the page can answer precisely.

  Both doors ask first, and say the step that is missing.
*/
const refuseUnconfigured = () => {
  if (API === '') throw new Error(UNCONFIGURED)
}

export async function act(action, args = {}) {
  refuseUnconfigured()
  const r = await fetch(API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await toPresent()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action, args }),
  })
  const body = await r.json().catch(() => ({}))
  if (r.status === 401) {
    /*
      Clear BOTH, because either could be the thing the office refused and a
      page left holding a credential nothing accepts reports every subsequent
      failure as something else.
    */
    session.forget()
    token.clear()
    throw new Error('You are not signed in any more. Sign in again to change anything.')
  }
  /*
    The office key is a machine and cannot decide, speak or connect as a person (#385). A browser that
    still holds only the old key gets this, and the credential is NOT cleared: it is genuine, it still
    reads, and the way forward is to sign in, not to be signed out.
  */
  if (r.status === 403 && body.error === 'person_required') {
    throw new Error(
      body.message ?? 'This needs you signed in. The office key cannot decide or speak as a person.',
    )
  }
  if (!r.ok) throw new Error(body.error ?? `The server returned ${r.status}`)
  if (body.result?.error) throw new Error(body.result.error)
  // Only on the way out, and only after both refusal checks: an action that was
  // refused changed nothing, and offering to take back nothing is a lie.
  try {
    afterWrite(action, body.result)
  } catch {
    // A page that cannot show its undo strip must not turn a successful write
    // into a failed one.
  }
  return body.result
}

/** Read one section, for the panes that want their own rather than the whole payload. */
export async function read(section, id, extra) {
  /*
    `id` is for the sections that take one — `document` (#95) was the first.

    Appended rather than made a separate function, because the auth, the 401
    handling and the unwrapping are identical and a second copy of those is a
    second place for them to drift.

    `extra` is for the ones that take something other than an id: `search`
    takes `q` and an optional `project` (#37). Passed as an object and encoded
    here rather than as a query string a caller builds, because a caller
    building one is a caller that will forget to encode a space — and the
    first thing anybody searches for has a space in it.
  */
  refuseUnconfigured()
  const parts = [`section=${encodeURIComponent(section)}`]
  if (id !== undefined) parts.push(`id=${encodeURIComponent(id)}`)
  for (const [k, v] of Object.entries(extra ?? {})) {
    if (v !== undefined && v !== null && v !== '') {
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    }
  }
  const r = await fetch(`${API}?${parts.join('&')}`, {
    headers: { Authorization: `Bearer ${await toPresent()}` },
  })
  if (r.status === 401) {
    session.forget()
    token.clear()
    throw new Error('You are not signed in any more.')
  }
  const answered = await r.json().catch(() => ({}))
  /*
    THE OFFICE'S OWN WORDS, when it gave any.

    `act` has always repeated what the RPC said and this threw `The server
    returned 502` over the top of it — so a section that failed for a reason a
    person could act on ("Google is not connected yet. Connect it in Settings")
    reached the page as a status code. Found by refusing a Drive listing three
    different ways and watching all three arrive identical.

    The status is still the fallback, because a gateway that fails without
    saying anything is a real state and "502" is better than silence.
  */
  if (!r.ok) {
    const said = typeof answered?.error === 'string' ? answered.error.trim() : ''
    throw new Error(said === '' ? `The server returned ${r.status}` : said)
  }
  return answered.data
}

/**
 * Say what happened, next to the thing that caused it.
 *
 * `el` is the control that was pressed. The sentence goes into the nearest
 * element marked `data-said`, or is created after the control if there is
 * none — so a new button gets feedback without anybody having to remember to
 * add a span for it.
 */
export function say(el, message, tone = '') {
  if (!el) return
  const holder =
    el.closest('[data-saidwrap]')?.querySelector('[data-said]') ??
    el.parentElement?.querySelector('[data-said]') ??
    (() => {
      const made = document.createElement('span')
      made.className = 't-meta'
      made.setAttribute('data-said', '')
      el.after(made)
      return made
    })()
  holder.textContent = message
  holder.className = `t-meta${tone === '' ? '' : ` ${tone}`}`
}

/**
 * Run a write with the button disabled and the outcome said out loud.
 *
 * The pattern every action in the old page arrived at independently, extracted
 * so the fifteenth one cannot forget a piece of it. Two things it does that are
 * easy to leave out and both bite: it re-enables the control on failure, and it
 * reports the server's sentence rather than a generic one — `hq_staff_update`
 * refuses a two-word first name and says why, and "Something went wrong" would
 * throw that away.
 */
export async function attempt(el, working, run, done = 'Saved.') {
  if (!canWrite()) {
    /*
      The wording changed with the sign-in. "No token in this browser" named an
      internal noun and offered nothing to do about it, which is the half of
      Grant's complaint that survived removing the paste: a refusal that does
      not say what would fix it reads as the office being broken.
    */
    say(el, 'Read-only — press Sign in at the top to change anything.', 'warn')
    return null
  }
  const was = el?.disabled ?? false
  if (el) el.disabled = true
  say(el, working)
  try {
    const result = await run()
    say(el, typeof done === 'function' ? done(result) : done)
    return result
  } catch (error) {
    say(el, error instanceof Error ? error.message : String(error), 'warn')
    return null
  } finally {
    if (el) el.disabled = was
  }
}

/**
 * What to say after answering one of the office's questions.
 *
 * `app.hq_answer_blocker` answers a question that is no longer open with
 * `{ ok: false, already: true, resolution }` rather than an error, because two
 * surfaces answering one question is ordinary: the question reaches his chat
 * as well as this page, and he can answer it there in a word. `attempt` says
 * its done-sentence for any result that did not throw, so both pages said
 * "Answered." to a press the office had not taken, sometimes about the
 * opposite of what he had actually said. Returns null when the press WAS
 * taken, so the caller keeps its own sentence (integration pass, 28 Sep).
 */
export function alreadyAnswered(result) {
  if (result?.already !== true) return null
  /* `already` means "no longer open", which is three different things. */
  if (result.state === 'withdrawn') return 'The team withdrew this question. Nothing was done.'
  if (result.state === 'expired') return 'This question expired before it was answered. Nothing was done.'
  const held = typeof result.resolution === 'string' ? result.resolution.trim() : ''
  return held === ''
    ? 'This was already answered elsewhere. Nothing more was done.'
    : `This was already answered elsewhere: “${held}”. Nothing more was done.`
}

/**
 * Confirm before anything destructive.
 *
 * Grant: *"You should always check before making any destructive action with
 * me."* and *"Please don't assume I wish to create a new project — this is a
 * large task and should always be confirmed."* Both are standing instructions,
 * so this is not a nicety and it is not per-button judgement: a caller that
 * changes or removes something asks first, through here, so the wording is
 * consistent and nobody has to decide what counts.
 */
export function sure(question) {
  return window.confirm(question)
}

/**
 * Ask for a sentence, where the RPC behind the button requires one.
 *
 * `app.decline_tool` refuses a decline with no reason — *"it is what makes it
 * worth revisiting in three months"* — and the first draft of the Governance
 * page's Decline button sent none, so the press returned an error and did
 * nothing. Caught by driving it, which is the only thing that catches it: an
 * offer may only promise what the press can perform.
 *
 * Returns the trimmed text, or null for cancel AND for an empty answer. Empty
 * is a cancel rather than a blank reason, because a blank reason is the thing
 * the RPC refuses and a caller should not have to know that.
 */
export function why(question, suggestion = '') {
  const said = window.prompt(question, suggestion)
  if (said === null) return null
  const text = said.trim()
  return text === '' ? null : text
}
