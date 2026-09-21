/*
  Universal Jump (§7 of basecamp_clone.md).

  Opened by clicking the centre shell control or by pressing Shift+J anywhere
  outside a text composition context. Filters projects, project tools, people
  and direct product destinations as you type; Shift+Enter promotes the query
  into full search; Escape closes and returns focus to whatever opened it.

  ## Why the candidate list is built once

  The renderer and the keyboard both need the same rows in the same order. Two
  assemblies is two lists that will disagree the day one of them gains a group,
  and the command bar in the default studio already carries a comment warning
  about exactly that. `candidates()` is the only place rows are made; the
  renderer draws what it returns and the keyboard indexes into the same array.

  ## Focus

  §7.1 and §11.2 require a trap, a labelled title, an explicit close and a
  restore. The trap is a Tab handler over the sheet's own focusables rather
  than an inert-attribute dance, because the sheet is a sibling of #root and
  the shell behind it is replaced on every paint.
*/

import { PROJECTS } from '../data.js'
import { esc } from './parts.js'

let ctx = null
let open = false
let query = ''
let picked = 0
let invoker = null
let rows = []

export const mount = (c) => {
  ctx = c
}
export const isOpen = () => open

const at = (p = '') => `/basecamp${p}`

/**
 * Everything Jump can reach, filtered by the query.
 *
 * Direct destinations first when the query is empty, because an empty Jump is
 * a navigator rather than a search box; once there is a query, relevance
 * decides and the groups keep their labels so a result is never ambiguous
 * about what kind of thing it is.
 */
const candidates = () => {
  const q = query.trim().toLowerCase()
  const out = []

  const push = (group, name, to, kind, hay) => {
    if (q !== '' && !String(hay ?? name).toLowerCase().includes(q)) return
    out.push({ group, name, to, kind })
  }

  for (const p of PROJECTS) push('Projects', p.name, at(`/p/${p.slug}`), 'Project', `${p.name} ${p.purpose ?? ''}`)

  /*
    Tools are offered for the project you are IN, not for all of them at once.
    Nine tools times a dozen projects is a list nobody can read, and the
    project you are looking at is overwhelmingly the one you mean.
  */
  const here = PROJECTS.find((p) => p.slug === ctx?.state?.project)
  if (here !== undefined) {
    for (const t of ctx.tools) {
      push(
        `In ${here.name}`,
        t.name,
        t.own ? at(`/p/${here.slug}/${t.id}`) : `/p/${here.slug}/${t.id}`,
        t.own ? 'Tool' : 'Opens current HQ',
        t.name,
      )
    }
  }

  for (const c of ctx.crew ?? []) push('People', c.name, at('/'), c.role ?? 'Person', `${c.name} ${c.role ?? ''}`)

  push('Go to', 'Home', at('/'), 'Place', 'home projects')
  push('Go to', 'My Tasks', at('/tasks'), 'Place', 'my tasks personal')
  push('Go to', 'Activity', at('/activity'), 'Place', 'activity recent')
  push('Go to', 'Current Team HQ', '/', 'Leaves this experience', 'default studio current hq')

  return out
}

const draw = () => {
  const el = document.getElementById('bcjump')
  if (el === null) return
  rows = candidates()
  if (picked >= rows.length) picked = Math.max(0, rows.length - 1)

  let last = null
  const list = rows
    .map((r, i) => {
      const head = r.group === last ? '' : `<div class="bcjumpgroup">${esc(r.group)}</div>`
      last = r.group
      return `${head}<button type="button" class="bcjumprow" role="option" id="bcjr${String(i)}"
        aria-selected="${i === picked ? 'true' : 'false'}" data-bc-jumpi="${String(i)}">
        <span>${esc(r.name)}</span><span class="bckind">${esc(r.kind)}</span>
      </button>`
    })
    .join('')

  el.innerHTML = `<div class="bcjumphead">
      <label class="bclabel" for="bcjumpq" id="bcjumptitle">Jump to a project, tool or record</label>
      <input class="bcinput" id="bcjumpq" autocomplete="off" role="combobox"
        aria-expanded="true" aria-controls="bcjumplist" aria-autocomplete="list"
        ${rows.length > 0 ? `aria-activedescendant="bcjr${String(picked)}"` : ''}
        value="${esc(query)}" placeholder="Type to filter">
    </div>
    <div class="bcjumpresults" id="bcjumplist" role="listbox" aria-labelledby="bcjumptitle">
      ${
        rows.length === 0
          ? `<div class="bcjumpempty">Nothing matches that. Shift+Enter searches everything.</div>`
          : list
      }
    </div>`

  const box = el.querySelector('#bcjumpq')
  if (box !== null) {
    box.addEventListener('input', () => {
      query = box.value
      picked = 0
      draw()
    })
    box.focus()
    box.setSelectionRange(query.length, query.length)
  }
  for (const b of el.querySelectorAll('[data-bc-jumpi]')) {
    b.addEventListener('click', () => {
      choose(Number(b.dataset.bcJumpi))
    })
  }
  const sel = el.querySelector('[aria-selected="true"]')
  if (sel !== null) sel.scrollIntoView({ block: 'nearest' })
}

const choose = (i) => {
  const r = rows[i]
  if (r === undefined) return
  const to = r.to
  close()
  ctx.goAnywhere(to)
}

export const show = (from = null) => {
  if (open) return
  open = true
  query = ''
  picked = 0
  invoker = from ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)

  const scrim = document.createElement('div')
  scrim.className = 'bcscrim'
  scrim.id = 'bcscrim'
  scrim.addEventListener('click', close)

  const sheet = document.createElement('div')
  sheet.className = 'bcsheet'
  sheet.id = 'bcjump'
  sheet.setAttribute('role', 'dialog')
  sheet.setAttribute('aria-modal', 'true')
  sheet.setAttribute('aria-labelledby', 'bcjumptitle')

  document.body.append(scrim, sheet)
  draw()
}

export const close = () => {
  if (!open) return
  open = false
  document.getElementById('bcscrim')?.remove()
  document.getElementById('bcjump')?.remove()
  // §7.1: focus returns to the invoker. A sheet that drops focus on the body
  // sends a keyboard user back to the top of the document.
  if (invoker !== null && document.contains(invoker)) invoker.focus()
  invoker = null
}

/**
 * Whether a key event is happening inside text composition.
 *
 * §7.1 and §7.3: the shortcut must not fire while an editor has focus, or
 * typing a capital J into a message opens a dialog over what you are writing.
 * contentEditable is included because the rich-text editor is not an input.
 */
export const composing = (target) => {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select'
}

/** The keyboard map of §7.3, plus the global Shift+J of §7.1. */
export const onKey = (e) => {
  if (!open) {
    if (e.key === 'J' && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && !composing(e.target)) {
      e.preventDefault()
      show()
    }
    return
  }

  if (e.key === 'Escape') {
    e.preventDefault()
    close()
    return
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    picked = rows.length === 0 ? 0 : (picked + 1) % rows.length
    draw()
    return
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    picked = rows.length === 0 ? 0 : (picked - 1 + rows.length) % rows.length
    draw()
    return
  }
  if (e.key === 'Home') {
    e.preventDefault()
    picked = 0
    draw()
    return
  }
  if (e.key === 'End') {
    e.preventDefault()
    picked = Math.max(0, rows.length - 1)
    draw()
    return
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    // §7.3: Shift+Enter promotes the typed text into full search rather than
    // opening whatever happens to be selected.
    if (e.shiftKey) {
      const q = query
      close()
      ctx.fullSearch(q)
      return
    }
    choose(picked)
    return
  }
  if (e.key === 'Tab') {
    /*
      §11.2 focus trap. The sheet's focusables are the query box and the result
      rows; wrapping at both ends keeps Tab inside the dialog without making it
      unusable, which is what a naive preventDefault would do.
    */
    const sheet = document.getElementById('bcjump')
    if (sheet === null) return
    const focusable = [...sheet.querySelectorAll('input,button')].filter((n) => !n.disabled)
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }
}
