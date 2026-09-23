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

const API =
  window.HQ_API || 'https://baujwlzcziasnfhhkchg.supabase.co/functions/v1/hq-api'

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

/** Whether this session can change anything, as opposed to only read. */
export const canWrite = () => token.get() !== ''

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

export async function act(action, args = {}) {
  const r = await fetch(API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token.get()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action, args }),
  })
  const body = await r.json().catch(() => ({}))
  if (r.status === 401) {
    token.clear()
    throw new Error('That token was not accepted. Open Team HQ and sign in again.')
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
  const parts = [`section=${encodeURIComponent(section)}`]
  if (id !== undefined) parts.push(`id=${encodeURIComponent(id)}`)
  for (const [k, v] of Object.entries(extra ?? {})) {
    if (v !== undefined && v !== null && v !== '') {
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    }
  }
  const r = await fetch(`${API}?${parts.join('&')}`, {
    headers: { Authorization: `Bearer ${token.get()}` },
  })
  if (r.status === 401) {
    token.clear()
    throw new Error('That token was not accepted.')
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
    say(el, 'Read-only — no token in this browser.', 'warn')
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
