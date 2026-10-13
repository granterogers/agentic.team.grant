/*
  PROJECT SETTINGS, APPEARANCE (11 October 2026).

  Four per-project settings, stored on the project's background record (layout.js setLook, so they are kept, merged and synced
  exactly like the background choice, with no new store and no migration):

    - how a module's colour is used: the whole card, or only the title, icon and border;
    - the background grid dots' opacity;
    - the stone texture's strength (0 = none, 40% = what the page always had, 100% = plainly textured);
    - the minimised modules' face opacity (80% by default).

  The controls preview at once and save when released. The board is not on screen while Project settings is open, so the pane
  carries a small SAMPLE board that wears exactly the same CSS (the same module and canvas rules the real board uses) and the
  page's own texture changes live behind it. Comments here avoid backticks: this file is imported by a module whose templates
  are strings.
*/

import { esc } from './parts.js'
import * as bd from './backdrop.js'
import * as grid from './layout.js'

const pct = (v) => `${String(Math.round(v * 100))}%`

/** The four controls, with the project's current values. */
export const markup = (p) => {
  const look = grid.lookOf(p.slug)
  const row = (key, label, note, lo, hi) => `<div class="bcaprow">
      <label for="bcap-${key}">${label}</label>
      <output for="bcap-${key}" data-ap-out="${key}">${pct(look[key])}</output>
      <input id="bcap-${key}" type="range" data-ap-range="${key}" min="${String(lo * 100)}" max="${String(hi * 100)}" step="5"
        value="${String(Math.round(look[key] * 100))}" aria-valuetext="${pct(look[key])}">
      <p class="bcapnote">${note}</p>
    </div>`
  return `<div class="bcap" data-ap data-ap-slug="${esc(p.slug)}">
    <div>
      <h3>Module colour</h3>
      <p class="t-meta">Every module has its own colour. Choose where it is used.</p>
      <div class="bcapmodes" role="radiogroup" aria-label="Where a module's colour is used">
        <button type="button" class="bcapmode" role="radio" aria-checked="${look.modMode === 'card' ? 'true' : 'false'}" data-ap-mode="card">Entire card coloured</button>
        <button type="button" class="bcapmode" role="radio" aria-checked="${look.modMode === 'edge' ? 'true' : 'false'}" data-ap-mode="edge">Title and border coloured</button>
      </div>
    </div>
    ${row('mod', 'Minimised module background', 'How solid a minimised module\'s face is. 100% is opaque; lower lets the canvas show through. Default 92%.', 0.2, 1)}
    ${row('dots', 'Grid dot opacity', 'The dotted grid behind the modules. 0% hides it.', 0, 1)}
    ${row('tex', 'Background texture', 'The slate texture of the page. 0% is plain; 40% is the default; 100% is clearly pronounced.', 0, 1)}
    <div class="bcapsample" data-ap-sample data-modmode="${look.modMode === 'edge' ? 'edge' : 'card'}" style="${bd.lookStyle(grid.bgOf(p.slug)).join(';')}">
      <div style="display:contents">
        ${sample('Schedule', 'teal', '#3fb8a8', 'Today: two events', '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>')}
        ${sample('To-dos', 'sky', '#5aa9e6', '3 open, 1 late', '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8M13 12h8M13 18h8"/>')}
      </div>
    </div>
    <button type="button" class="btn quiet bcapreset" data-ap-reset>Reset appearance to the defaults</button>
  </div>`
}

const sample = (name, _id, hue, line, icon) =>
  `<section class="bcmod bcmod--tinted" style="--bc-tint:${hue}">
    <header class="bcmodhead"><h2 class="bcmodtitle"><svg class="bcmodicon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>${esc(name)}</h2></header>
    <div class="bcmodbody">${esc(line)}</div>
  </section>`

/** Wire the pane: a slider previews while it moves and saves when it is released; the mode and reset save at once. */
export const wire = (root, p) => {
  const host = root.querySelector('[data-ap]')
  if (host === null) return
  const sample = host.querySelector('[data-ap-sample]')
  const page = document.getElementById('root')
  /* What is being previewed, on top of what is stored. */
  let live = { ...grid.lookOf(p.slug) }

  const show = (look) => {
    live = { ...look }
    const rec = { dots: look.dots, tex: look.tex, mod: look.mod, modMode: look.modMode }
    for (const part of bd.lookStyle(rec)) {
      const i = part.indexOf(':')
      sample?.style.setProperty(part.slice(0, i), part.slice(i + 1))
    }
    sample?.setAttribute('data-modmode', look.modMode === 'edge' ? 'edge' : 'card')
    /* The page's own texture is live behind the pane, and the board (when it is drawn again) reads the saved record. */
    page?.style.setProperty('--bc-tex-op', String(look.tex))
    for (const k of ['dots', 'tex', 'mod']) {
      const out = host.querySelector(`[data-ap-out="${k}"]`)
      if (out !== null) out.textContent = pct(look[k])
      const input = host.querySelector(`[data-ap-range="${k}"]`)
      if (input !== null) {
        input.setAttribute('aria-valuetext', pct(look[k]))
        if (Number(input.value) !== Math.round(look[k] * 100)) input.value = String(Math.round(look[k] * 100))
      }
    }
    for (const b of host.querySelectorAll('[data-ap-mode]'))
      b.setAttribute('aria-checked', b.dataset.apMode === look.modMode ? 'true' : 'false')
  }
  const save = (patch) => {
    show(grid.setLook(p.slug, patch))
  }

  for (const input of host.querySelectorAll('[data-ap-range]')) {
    const key = input.dataset.apRange
    input.addEventListener('input', () => show({ ...live, [key]: Number(input.value) / 100 }))
    input.addEventListener('change', () => save({ [key]: Number(input.value) / 100 }))
  }
  for (const b of host.querySelectorAll('[data-ap-mode]')) {
    b.addEventListener('click', () => save({ modMode: b.dataset.apMode }))
  }
  host.querySelector('[data-ap-reset]')?.addEventListener('click', () => {
    save({ dots: grid.LOOK_DEFAULT.dots, tex: grid.LOOK_DEFAULT.tex, mod: grid.LOOK_DEFAULT.mod, modMode: 'card' })
  })
}
