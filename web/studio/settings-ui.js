/*
  The pieces Global Settings is built from.

  A settings page that draws everything with one component draws a switch and a database error the same way. These are
  the six things the page actually contains (see settings-ui.css), each with one function, so a tab reads as a list of
  intentions - "a setting, a fact, a connection" - rather than as markup. Pure string builders: nothing here touches the
  page, the network or the office. Wiring stays where it was, on the data-* attributes the callers pass in.

  Every builder escapes its text. A caller passes plain words, never HTML, except through `html`, which exists for the
  few places that need a composed control and says so by its name.
*/

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

/**
 * Text that is already HTML (a relative time, which must keep updating while the page is open), marked as such. A
 * plain string is always escaped; only a value made by this function is passed through.
 */
export const html = (s) => ({ html: String(s ?? '') })
const t = (x) => (x !== null && typeof x === 'object' && 'html' in x ? x.html : esc(x))

/** Attribute pairs from an object; false/undefined/null drop out, true is a bare attribute. */
export const attrs = (o = {}) =>
  Object.entries(o)
    .filter(([, v]) => v !== false && v !== undefined && v !== null)
    .map(([k, v]) => (v === true ? k : `${k}="${esc(v)}"`))
    .join(' ')

const P = (d) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${d}</svg>`

/** A small set of line icons. Names are the product's words, not the shapes'. */
export const ICONS = {
  team: P('<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19.5c.4-3.2 2.7-5 5.5-5s5.1 1.8 5.5 5"/><circle cx="17" cy="9" r="2.4"/><path d="M16.5 14.6c2.3.2 3.9 1.7 4.3 4.4"/>'),
  autonomy: P('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>'),
  requests: P('<path d="M4 13l2.4-7.2A2 2 0 0 1 8.3 4.4h7.4a2 2 0 0 1 1.9 1.4L20 13"/><path d="M4 13v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5h-5l-1.2 2.2h-3.6L9 13H4z"/>'),
  memory: P('<path d="M5 4.5h10.5A3.5 3.5 0 0 1 19 8v11.5H8.5A3.5 3.5 0 0 1 5 16V4.5z"/><path d="M5 16a3.5 3.5 0 0 1 3.5-3.5H19M9.5 8.5H15"/>'),
  services: P('<path d="M9 3v5M15 3v5"/><path d="M6.5 8h11v3.5a5.5 5.5 0 0 1-11 0V8z"/><path d="M12 17v4"/>'),
  messaging: P('<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 4v-4h0A1.5 1.5 0 0 1 4 14.5v-9z"/>'),
  appearance: P('<path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.8 1.8-1.7 0-.6-.3-1-.6-1.4-.3-.4-.5-.8-.5-1.3 0-.9.7-1.6 1.6-1.6H17a4 4 0 0 0 4-4C21 6.3 17 3 12 3z"/><circle cx="7.6" cy="11" r="1"/><circle cx="10.2" cy="7.2" r="1"/><circle cx="14.6" cy="7.2" r="1"/>'),
  system: P('<path d="M4 18a8 8 0 1 1 16 0"/><path d="M12 18l4-6"/><circle cx="12" cy="18" r="1.2"/>'),
  help: P('<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1.1.9-1.1 1.6"/><path d="M12 16.8h.01"/>'),
  back: P('<path d="M15 5l-7 7 7 7"/>'),
  chevron: P('<path d="M9 5l7 7-7 7"/>'),
  shield: P('<path d="M12 3l7 3v5.5c0 4.3-2.9 8-7 9.5-4.1-1.5-7-5.2-7-9.5V6l7-3z"/><path d="M9 12l2.2 2.2L15.5 10"/>'),
  info: P('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'),
}

export const icon = (name) => ICONS[name] ?? ''

/* ------------------------------------------------------------- the frame -- */

/**
 * The page frame: a bar (back, title, scope), a grouped navigation, and the content.
 * `groups` is [{ name, tabs: [{ id, name, icon, badge? }] }]; `current` is the open tab's id.
 * `pane` is 'index' or 'detail' and only matters on a phone, where they are two screens.
 */
export function frame({ groups, current, pane, tabTitle, lead, body, backLabel }) {
  const navItem = (t) => `<button type="button" class="stg-navitem" data-setting="${esc(t.id)}"
      aria-current="${t.id === current ? 'page' : 'false'}">
      <span class="stg-navicon">${icon(t.icon)}</span>
      <span class="stg-navlabel">${esc(t.name)}</span>
      ${t.badge ? `<span class="stg-navbadge" aria-label="${esc(String(t.badge))} waiting">${esc(String(t.badge))}</span>` : ''}
      <span class="stg-chevron">${icon('chevron')}</span>
    </button>`
  return `<div class="stg" data-pane="${esc(pane)}" data-more>
    <header class="stg-bar">
      <button type="button" class="stg-back" data-stg-back aria-label="${esc(backLabel)}">
        ${icon('back')}<span>${esc(backLabel)}</span>
      </button>
      <div class="stg-heading">
        <h1>Settings</h1>
        <p class="stg-scope">Applies to your whole Team HQ. For one project, open it and choose Project settings.</p>
      </div>
    </header>
    <div class="stg-body">
      <nav class="stg-nav" aria-label="Settings sections">
        ${groups
          .map(
            (g) => `<div class="stg-groupwrap">
          <h2 class="stg-grouplabel">${esc(g.name)}</h2>
          <div class="stg-group">${g.tabs.map(navItem).join('')}</div>
        </div>`,
          )
          .join('')}
      </nav>
      <main class="stg-main" id="stg-main" tabindex="-1">
        <div class="stg-col">
          <header class="stg-pagehead">
            <h2>${esc(tabTitle)}</h2>
            ${lead ? `<p>${esc(lead)}</p>` : ''}
          </header>
          ${body}
        </div>
      </main>
    </div>
  </div>`
}

/* ------------------------------------------------------------ the blocks -- */

/** A titled group of things. `body` is already HTML (usually a card). */
export const section = ({ title, note, count, action, body, danger = false, id }) =>
  `<section class="st-sec${danger ? ' danger' : ''}"${id ? ` id="${esc(id)}"` : ''}>
    ${
      title
        ? `<div class="st-sechead">
      <div><h3 class="st-sectitle">${esc(title)}</h3>${note ? `<p class="st-secnote">${esc(note)}</p>` : ''}</div>
      ${count !== undefined && count !== null ? `<span class="st-count">${esc(String(count))}</span>` : ''}
      ${action ?? ''}
    </div>`
        : ''
    }
    ${body}
  </section>`

/** The surface rows sit on. */
export const card = (rows, extra = '') => `<div class="st-card ${extra}">${rows.join('')}</div>`

/**
 * One row: words on the left, a control or value on the right.
 * `kind`: 'setting' (default), 'fact' (quiet value, no control), 'stack' (control under the words),
 * 'wide' (control under the words on a phone only). `said` adds the feedback line the writers fill in.
 */
export function row({ name, desc, control = '', status = '', kind = 'setting', said = false, wrap = false, attr = {} }) {
  const cls = kind === 'fact' ? ' fact' : kind === 'stack' ? ' stack' : kind === 'wide' ? ' wide' : ''
  return `<div class="st-row${cls}"${wrap ? ' data-saidwrap' : ''} ${attrs(attr)}>
    <div class="st-text">
      <p class="st-name">${esc(name)}${status}</p>
      ${desc ? `<p class="st-desc">${t(desc)}</p>` : ''}
      ${said ? '<span class="st-said" data-said role="status" aria-live="polite"></span>' : ''}
    </div>
    ${control === '' ? '' : `<div class="st-ctl">${control}</div>`}
  </div>`
}

/**
 * A switch that says what it is in words as well as in position. `on` is the current value.
 * `locked` draws the state as a fact instead, for things that cannot be changed here.
 */
export function toggle({ id, name, on, via, disabled = false, locked = false }) {
  const word = on ? 'On' : 'Off'
  if (locked) return `<span class="st-value">${word}</span>`
  return `<span class="st-switchwrap"><span class="st-switchword" aria-hidden="true">${word}</span>
    <button type="button" class="st-switch" role="switch" aria-checked="${on ? 'true' : 'false'}"
      aria-label="${esc(name)}" data-toggle="${esc(id)}" data-via="${esc(via ?? '')}" data-now="${on ? '1' : ''}"
      ${disabled ? 'disabled' : ''}></button></span>`
}

/** A status: dot (or a shape), colour AND words. `tone`: ok | warn | bad | off | plain. */
export const chip = (tone, text) => `<span class="st-chip ${esc(tone)}">${esc(text)}</span>`

/** A button. `tone`: '' | primary | quiet | danger. Extra attributes via `a`. */
export const button = ({ label, tone = '', a = {}, href }) =>
  href
    ? `<a class="st-btn ${tone}" href="${esc(href)}" target="_blank" rel="noopener" ${attrs(a)}>${esc(label)}</a>`
    : `<button type="button" class="st-btn ${tone}" ${attrs(a)}>${esc(label)}</button>`

/** An informational or cautionary note. `tone`: '' | policy | warn. */
export const note = ({ title, text, tone = '', ic = 'info' }) =>
  `<div class="st-note ${tone}">${icon(ic)}<div>${title ? `<b>${esc(title)}</b>` : ''}${esc(text)}</div></div>`

/** Words for a section that has nothing in it. Says what it would contain and when it fills. */
export const empty = (text) => `<p class="st-empty">${esc(text)}</p>`

/** Progressive disclosure for the technical half of a page. Closed by default. */
export const advanced = ({ title, hint, body, open = false }) =>
  `<details class="st-adv"${open ? ' open' : ''}>
    <summary><span>${esc(title)}</span>${hint ? `<small>${esc(hint)}</small>` : ''}</summary>
    <div class="st-advbody">${body}</div>
  </details>`

/**
 * A thing to decide or to read about: a title, a state, an argument, who and why, and what you can do.
 * `meta` is already-escaped inline HTML (a few spans); everything else is plain text.
 */
export const caseCard = ({ title, chips = '', body = '', note = '', meta = '', actions = '', quote = false }) =>
  `<article class="st-case${quote ? ' quote' : ''}" data-saidwrap>
    <div class="st-casehead"><h4 class="st-casetitle">${esc(title)}</h4>${chips}</div>
    ${body ? `<p class="st-casebody">${t(body)}</p>` : ''}
    ${note ? `<p class="st-casenote">${t(note)}</p>` : ''}
    <div class="st-casefoot">
      <div class="st-casemeta">${meta}</div>
      <span class="st-said" data-said role="status" aria-live="polite"></span>
      ${actions === '' ? '' : `<div class="st-caseact">${actions}</div>`}
    </div>
  </article>`

/** Small inline facts under a case, separated by a quiet dot. Plain text in, escaped HTML out. */
export const facts = (list) =>
  list
    .filter((x) => x !== '' && x !== null && x !== undefined && x !== false)
    .map((x) => `<span>${t(x)}</span>`)
    .join('')

/* ---------------------------------------------------------------- confirm -- */

/**
 * Ask before something that cannot be taken back, in the page's own voice rather than the browser's.
 * Resolves true or false. Escape and the backdrop cancel; focus goes to the safe choice first and comes back after.
 * `danger` makes the confirming button the red-outlined kind. Never rejects.
 */
/**
 * Take a dialog down without letting the SECOND tap of a double-tap through to whatever lies underneath it. The answer is
 * resolved at once by the caller; this only replaces the dialog with an invisible shield that swallows pointer events for a
 * moment, because a Confirm button sits over the page and the control beneath it may be another destructive one.
 */
function release(wrap) {
  wrap.replaceChildren()
  // its own class, so nothing that asks "is a dialog open" (.stg-confirm) sees a closed one
  wrap.className = 'stg-shield'
  setTimeout(() => wrap.remove(), 450)
}

export function confirmDialog({ title, body, confirmLabel = 'Continue', cancelLabel = 'Cancel', danger = false }) {
  if (typeof document === 'undefined') return Promise.resolve(false)
  return new Promise((resolve) => {
    const before = document.activeElement
    const wrap = document.createElement('div')
    wrap.className = 'stg-confirm'
    wrap.innerHTML = `<div class="stg-confirmbox" role="alertdialog" aria-modal="true" aria-labelledby="stg-c-t" aria-describedby="stg-c-b">
      <h2 id="stg-c-t">${esc(title)}</h2>
      <p id="stg-c-b">${esc(body)}</p>
      <div class="stg-confirmact">
        <button type="button" class="st-btn quiet" data-no>${esc(cancelLabel)}</button>
        <button type="button" class="st-btn ${danger ? 'danger' : 'primary'}" data-yes>${esc(confirmLabel)}</button>
      </div>
    </div>`
    const done = (v) => {
      document.removeEventListener('keydown', onKey, true)
      release(wrap)
      if (before instanceof HTMLElement && before.isConnected) before.focus()
      resolve(v)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        done(false)
      } else if (e.key === 'Tab') {
        const btns = [...wrap.querySelectorAll('button')]
        const at = btns.indexOf(document.activeElement)
        e.preventDefault()
        btns[(at + (e.shiftKey ? btns.length - 1 : 1)) % btns.length].focus()
      }
    }
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap) done(false)
    })
    wrap.querySelector('[data-no]').addEventListener('click', () => done(false))
    wrap.querySelector('[data-yes]').addEventListener('click', () => done(true))
    document.addEventListener('keydown', onKey, true)
    document.body.append(wrap)
    wrap.querySelector('[data-no]').focus()
  })
}

/**
 * Tell somebody something they have to read, in the page's own voice rather than the browser's alert: one button, Escape and
 * the backdrop close it, focus goes to that button first and comes back after. Resolves when it is closed; never rejects.
 * For a message that carries detail a toast would take away before it could be read (a part-finished batch, a refused undo).
 */
export function noticeDialog({ title, body, closeLabel = 'OK' }) {
  if (typeof document === 'undefined') return Promise.resolve()
  return new Promise((resolve) => {
    const before = document.activeElement
    const wrap = document.createElement('div')
    wrap.className = 'stg-confirm'
    wrap.innerHTML = `<div class="stg-confirmbox" role="alertdialog" aria-modal="true" aria-labelledby="stg-n-t" aria-describedby="stg-n-b">
      <h2 id="stg-n-t">${esc(title)}</h2>
      <p id="stg-n-b">${esc(body)}</p>
      <div class="stg-confirmact">
        <button type="button" class="st-btn primary" data-ok>${esc(closeLabel)}</button>
      </div>
    </div>`
    const done = () => {
      document.removeEventListener('keydown', onKey, true)
      release(wrap)
      if (before instanceof HTMLElement && before.isConnected) before.focus()
      resolve()
    }
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        done()
      } else if (e.key === 'Tab') {
        // one button: Tab stays on it
        e.preventDefault()
        wrap.querySelector('[data-ok]').focus()
      }
    }
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap) done()
    })
    wrap.querySelector('[data-ok]').addEventListener('click', done)
    document.addEventListener('keydown', onKey, true)
    document.body.append(wrap)
    wrap.querySelector('[data-ok]').focus()
  })
}

/**
 * Ask for a sentence (a reason) in the page's own voice. Resolves the trimmed text, or null for cancel or empty.
 */
export function askDialog({ title, body, label, placeholder = '', confirmLabel = 'Save', cancelLabel = 'Cancel' }) {
  if (typeof document === 'undefined') return Promise.resolve(null)
  return new Promise((resolve) => {
    const before = document.activeElement
    const wrap = document.createElement('div')
    wrap.className = 'stg-confirm'
    wrap.innerHTML = `<div class="stg-confirmbox" role="dialog" aria-modal="true" aria-labelledby="stg-c-t">
      <h2 id="stg-c-t">${esc(title)}</h2>
      ${body ? `<p>${esc(body)}</p>` : ''}
      <label class="st-field"><span>${esc(label)}</span>
        <input class="st-input" data-text placeholder="${esc(placeholder)}" autocomplete="off"></label>
      <div class="stg-confirmact">
        <button type="button" class="st-btn quiet" data-no>${esc(cancelLabel)}</button>
        <button type="button" class="st-btn primary" data-yes>${esc(confirmLabel)}</button>
      </div>
    </div>`
    const field = wrap.querySelector('[data-text]')
    const done = (v) => {
      document.removeEventListener('keydown', onKey, true)
      release(wrap)
      if (before instanceof HTMLElement && before.isConnected) before.focus()
      resolve(v)
    }
    const ok = () => {
      const t = field.value.trim()
      done(t === '' ? null : t)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        done(null)
      } else if (e.key === 'Enter' && document.activeElement === field) {
        e.preventDefault()
        ok()
      } else if (e.key === 'Tab') {
        const els = [field, ...wrap.querySelectorAll('button')]
        const at = els.indexOf(document.activeElement)
        e.preventDefault()
        els[(at + (e.shiftKey ? els.length - 1 : 1)) % els.length].focus()
      }
    }
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap) done(null)
    })
    wrap.querySelector('[data-no]').addEventListener('click', () => done(null))
    wrap.querySelector('[data-yes]').addEventListener('click', ok)
    document.addEventListener('keydown', onKey, true)
    document.body.append(wrap)
    field.focus()
  })
}

/* --------------------------------------------------------------- feedback -- */

let toastTimer = null

/**
 * A line that survives the page redrawing underneath it. The settings page redraws itself after every write, which
 * wipes any sentence the control said beside itself - so a saved setting was invisible. This one lives on the body.
 */
export function toast(text, tone = '') {
  if (typeof document === 'undefined') return
  let el = document.getElementById('stg-toast')
  if (el === null) {
    el = document.createElement('div')
    el.id = 'stg-toast'
    el.className = 'stg-toast'
    el.setAttribute('role', 'status')
    el.setAttribute('aria-live', 'polite')
    document.body.append(el)
  }
  el.textContent = text
  el.className = `stg-toast show${tone ? ` ${tone}` : ''}`
  if (toastTimer !== null) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    el.className = 'stg-toast'
  }, tone === 'warn' ? 6000 : 2800)
}
