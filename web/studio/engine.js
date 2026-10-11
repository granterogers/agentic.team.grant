/*
  Which engine answers the next message (Hermes, M6).

  A person chooses, per message, whether the office's own team or Hermes answers. The choice is theirs and is never made
  for them: nothing here switches engines when a run fails, is cancelled or is unavailable (ADR-0072, HD-1). The default is
  the team, and an office that has not been given Hermes sees no control at all.

  What the page knows comes from ONE read, `engine_status`, which asks the office's own rule (is this office allowed, is the
  host up, is today's allowance spent). The choice itself is a convenience held in this browser, per project; it is not the
  record. The record is the engine the office stored on the message, which the thread reads back.

  No backticks in the comments of this file that end up inside a template literal elsewhere: nothing here is one.
*/

import { HQ_API } from './backend.js'
import * as session from './session.js'

const KEY = 'studio.engine'

let status = null

const stored = () => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return typeof v === 'object' && v !== null ? v : {}
  } catch {
    return {}
  }
}

/** The engine this project's next message goes to. Only ever 'team' or 'hermes'; anything else is the team. */
export const chosen = (slug) => (stored()[slug] === 'hermes' ? 'hermes' : 'team')

export const choose = (slug, engine) => {
  try {
    const all = stored()
    if (engine === 'hermes') all[slug] = 'hermes'
    else delete all[slug]
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    /* a private window: the choice lasts until the page is redrawn, and the default is the team */
  }
}

/** What the office said about Hermes, or null when it has not been asked or could not be read. */
export const current = () => status

/** Whether the choice is drawn at all: only for a signed-in person of an office that has been given Hermes. */
export const offered = () => status !== null && status.enabled === true && !session.isSample()

/**
 * Read the status. A failed read leaves what was known: it is neither "available" nor "unavailable", so it says neither.
 * `onChange` runs only when the answer differs from the last one, so a poll never causes a redraw by itself.
 */
export async function load(token, onChange) {
  if (!token || HQ_API === '' || session.isSample()) return null
  const began = session.epoch()
  try {
    const r = await fetch(`${HQ_API}?section=engine_status`, { headers: { Authorization: `Bearer ${token}` } })
    if (!r.ok) return status
    const body = await r.json()
    if (began !== session.epoch()) return status
    const h = body?.data?.hermes
    const next =
      typeof h === 'object' && h !== null
        ? {
            enabled: h.enabled === true,
            available: h.available === true,
            because: typeof h.because === 'string' ? h.because : '',
            runsToday: Number(h.runs_today ?? 0),
            dailyRuns: Number(h.daily_runs ?? 0),
            host: h.host ?? null,
          }
        : null
    const same = JSON.stringify(next) === JSON.stringify(status)
    status = next
    if (!same && typeof onChange === 'function') onChange()
    return status
  } catch {
    return status
  }
}

let askedFor = null

/** Ask once per sign-in, not once per redraw. A different token (a new sign-in) asks again. */
export const ensureLoaded = (token, onChange) => {
  if (!token || askedFor === token) return
  askedFor = token
  void load(token, onChange)
}

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

/**
 * The control, for one project. Empty when it is not offered.
 *
 * Hermes stays selectable when it is unavailable and says why beside the choice: refusing the selection would be the page
 * deciding for the person, and choosing it sends nothing to the team in its place. The office answers a message addressed to an
 * unavailable Hermes with the reason, and does not run it anywhere else.
 */
export const controlHtml = (slug) => {
  if (!offered()) return ''
  const now = chosen(slug)
  const unavailable = status.available !== true
  return `<div class="enginepick" data-enginepick>
    <label class="t-label" for="engine-${esc(slug)}">Answer with</label>
    <select id="engine-${esc(slug)}" data-engine="${esc(slug)}" aria-label="Which engine answers this message"${
      unavailable ? ' aria-describedby="engine-why-' + esc(slug) + '"' : ''
    }>
      <option value="team"${now === 'team' ? ' selected' : ''}>The team</option>
      <option value="hermes"${now === 'hermes' ? ' selected' : ''}>Hermes${unavailable ? ' (not available)' : ''}</option>
    </select>
    ${
      unavailable
        ? `<span class="t-meta enginewhy" id="engine-why-${esc(slug)}" role="status">${esc(
            status.because !== '' ? status.because : 'Hermes is not available right now.',
          )}</span>`
        : status.dailyRuns > 0
          ? `<span class="t-meta enginewhy">${esc(String(status.runsToday))} of ${esc(String(status.dailyRuns))} Hermes runs today</span>`
          : ''
    }
  </div>`
}

/** Wire every control under `root`. `after` runs once the choice is stored (a redraw of the composer, nothing else). */
export const wire = (root, after) => {
  for (const sel of root.querySelectorAll('[data-engine]')) {
    sel.addEventListener('change', () => {
      choose(sel.dataset.engine, sel.value)
      if (typeof after === 'function') after()
    })
  }
}
