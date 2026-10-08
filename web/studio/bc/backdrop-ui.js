/*
  THE CANVAS BACKGROUND PICKER (#445), inside the existing "How this project looks" sheet.

  One field in that sheet, not a second settings system. Choosing a thumbnail PREVIEWS it on the real board straight away
  (the sheet steps aside so the canvas can be seen) and nothing is stored until Apply. Cancel, closing the sheet and choosing
  another sheet all put back what the project had. The choice is stored per project, per person, through the workspace
  document (layout.js), as a small reference.

  Everything shown comes from backdrop.entries(), so a new texture in the library appears here with no change to this file.

  A note on comments in this file: markup is built in template literals, which end at a backtick, so comments avoid them.
*/

import * as bd from './backdrop.js'
import * as grid from './layout.js'
import { esc } from './parts.js'

/* What is being previewed and not yet applied. `custom` holds a processed picture that is not stored until Apply. */
let pending = null
let said = ''
let busy = false

const MODES = [
  ['tile', 'Tile'],
  ['cover', 'Cover'],
  ['fit', 'Fit'],
  ['center', 'Centre'],
]
const boardOf = (slug) => document.querySelector(`[data-bc-board="${slug}"]`)

/** The choice currently in force for a project, filled out with defaults. */
const current = (slug) => {
  const b = grid.bgOf(slug)
  return b === null ? { id: 'default', ...bd.defaultsFor('default') } : b
}
const shown = (slug) => pending?.bg ?? current(slug)

/** Put back what the project had. Safe to call at any time, including when nothing is pending. */
export const cancel = (slug) => {
  const s = slug ?? pending?.slug
  if (pending !== null) {
    if (pending.url) URL.revokeObjectURL(pending.url)
    pending = null
  }
  said = ''
  if (s) bd.paint(boardOf(s), grid.bgOf(s), s)
  document.getElementById('viewer')?.classList.remove('bd-preview')
}

const thumb = (e, on) => {
  const label = `${e.name}${e.category && e.category !== 'default' ? `, ${e.category}` : ''}`
  let face = ''
  if (e.kind === 'solid')
    face = `<span class="bdface" style="background:${esc(e.color)}" aria-hidden="true"></span>`
  else if (e.kind === 'none') face = '<span class="bdface bdface--plain" aria-hidden="true"></span>'
  else if (e.kind === 'custom')
    face = `<img class="bdface" alt="" src="${esc(e.thumb)}" decoding="async">`
  else
    face = `<img class="bdface" alt="" loading="lazy" decoding="async" src="${esc(e.thumb)}" width="96" height="54">`
  return `<button type="button" class="bdthumb${on ? ' on' : ''}" role="radio" aria-checked="${on ? 'true' : 'false'}"
      data-bd-pick="${esc(e.id)}" aria-label="${esc(label)}" title="${esc(e.name)}">${face}<span class="bdname">${esc(e.name)}</span></button>`
}

/** The picker as markup for the sheet. */
export const field = (p) => {
  const slug = p.slug
  const sel = shown(slug)
  const info = bd.customInfo(slug)
  const items = bd.entries()
  const tiles = items.map((e) => thumb(e, e.id === sel.id)).join('')
  const mine =
    pending?.custom || info !== null
      ? thumb(
          {
            id: 'custom',
            kind: 'custom',
            name: 'Your picture',
            category: 'custom',
            thumb: pending?.url ?? info?.url ?? '',
          },
          sel.id === 'custom',
        )
      : ''
  const e = bd.find(sel.id)
  const tileable = sel.id === 'custom' || e?.kind === 'texture'
  const modes = tileable
    ? `<span class="bdrow" role="radiogroup" aria-label="How the picture is laid out">${MODES.map(
        ([k, n]) =>
          `<button type="button" class="bdseg${sel.mode === k ? ' on' : ''}" role="radio" aria-checked="${
            sel.mode === k ? 'true' : 'false'
          }" data-bd-mode="${k}">${n}</button>`,
      ).join('')}</span>`
    : ''
  const range = (key, label, value, min, max, step, fmt) =>
    `<label class="bdrange"><span>${label}</span><input type="range" data-bd-range="${key}" min="${min}" max="${max}" step="${step}" value="${value}" aria-valuetext="${fmt(value)}"><output>${fmt(value)}</output></label>`
  const sliders = tileable
    ? `${sel.mode === 'tile' || sel.mode === 'center' ? range('scale', 'Scale', sel.scale, 0.5, 2, 0.05, (v) => `${String(Math.round(v * 100))}%`) : ''}
       ${range('intensity', 'Opacity', sel.intensity, 0.2, 1, 0.05, (v) => `${String(Math.round(v * 100))}%`)}
       ${range('tint', 'Shade', sel.tint, 0, 0.6, 0.05, (v) => `${String(Math.round(v * 100))}%`)}`
    : ''
  const dirty = pending !== null
  const sentence = said || boardOf(slug)?.getAttribute('data-bg-why') || ''
  return `<div class="field bdfield" data-bd data-bd-slug="${esc(slug)}" style="margin-top:var(--s4);align-items:flex-start">
    <span class="t-label">Canvas background</span>
    <span class="bdbody">
      <span class="bdgrid" role="radiogroup" aria-label="Canvas background">${tiles}${mine}</span>
      <span class="bdrow">
        <label class="btn bdupload${busy ? ' is-busy' : ''}">Upload background
          <input type="file" data-bd-file accept="image/jpeg,image/png,image/webp,image/avif" hidden>
        </label>
        ${info !== null ? '<button type="button" class="btn quiet" data-bd-remove>Remove my picture</button>' : ''}
        ${sel.id !== 'default' ? '<button type="button" class="btn quiet" data-bd-default>Restore the default</button>' : ''}
      </span>
      ${modes}
      <span class="bdsliders">${sliders}</span>
      <span class="bdrow bdactions${dirty || sentence !== '' || busy ? '' : ' bdactions--idle'}">
        <span class="t-meta bdsay" role="status" aria-live="polite" data-bd-say>${esc(sentence)}</span>
        <button type="button" class="btn quiet" data-bd-cancel${dirty ? '' : ' disabled'}>Cancel</button>
        <button type="button" class="btn primary" data-bd-apply${dirty ? '' : ' disabled'}>Apply</button>
      </span>
    </span>
  </div>`
}

const redraw = (root, p) => {
  const host = root.querySelector('[data-bd]')
  if (host === null) return
  const keep = document.activeElement?.getAttribute?.('data-bd-pick')
  host.outerHTML = field(p)
  wire(root, p)
  if (keep) root.querySelector(`[data-bd-pick="${keep}"]`)?.focus()
  document.getElementById('viewer')?.classList.toggle('bd-preview', pending !== null)
}

const preview = (p, bg) => {
  pending = { ...(pending ?? {}), slug: p.slug, bg: grid.cleanBg({ ...bg, at: 1 }) }
  if (pending.bg.id === 'custom' && pending.custom) previewCustom(p, pending.custom, pending.url)
  else bd.paint(boardOf(p.slug), pending.bg, p.slug)
}

/** Attach the picker's handlers. Called each time the sheet is drawn. */
export const wire = (root, p) => {
  const host = root.querySelector('[data-bd]')
  if (host === null) return
  const slug = p.slug
  const set = (patch) => preview(p, { ...shown(slug), ...patch })

  host.addEventListener('click', (ev) => {
    const t = ev.target instanceof Element ? ev.target : null
    if (t === null) return
    const pick = t.closest('[data-bd-pick]')
    if (pick !== null) {
      const id = pick.dataset.bdPick
      if (id === 'custom') {
        if (pending?.custom === undefined && bd.customInfo(slug) === null) return
        set({ id, ...bd.defaultsFor('custom'), ...(shown(slug).id === 'custom' ? shown(slug) : {}) })
      } else {
        set({ id, ...bd.defaultsFor(id) })
      }
      said = ''
      redraw(root, p)
      return
    }
    const mode = t.closest('[data-bd-mode]')
    if (mode !== null) {
      set({ mode: mode.dataset.bdMode })
      redraw(root, p)
      return
    }
    if (t.closest('[data-bd-default]') !== null) {
      set({ id: 'default', ...bd.defaultsFor('default') })
      redraw(root, p)
      return
    }
    if (t.closest('[data-bd-cancel]') !== null) {
      cancel(slug)
      redraw(root, p)
      return
    }
    if (t.closest('[data-bd-apply]') !== null) void apply(root, p)
    if (t.closest('[data-bd-remove]') !== null) void remove(root, p)
  })
  host.addEventListener('input', (ev) => {
    const r = ev.target instanceof Element ? ev.target.closest('[data-bd-range]') : null
    if (r === null) return
    set({ [r.dataset.bdRange]: Number(r.value) })
    const out = r.parentElement?.querySelector('output')
    if (out) out.textContent = `${String(Math.round(Number(r.value) * 100))}%`
    const apply = host.querySelector('[data-bd-apply]')
    const cancelBtn = host.querySelector('[data-bd-cancel]')
    apply?.removeAttribute('disabled')
    cancelBtn?.removeAttribute('disabled')
    host.querySelector('.bdactions')?.classList.remove('bdactions--idle')
    document.getElementById('viewer')?.classList.add('bd-preview')
  })
  host.querySelector('[data-bd-file]')?.addEventListener('change', (ev) => {
    const input = ev.target
    const file = input.files?.[0]
    input.value = ''
    if (file) void chosen(root, p, file)
  })
}

const chosen = async (root, p, file) => {
  busy = true
  said = 'Checking and optimising the picture…'
  redraw(root, p)
  try {
    const out = await bd.optimise(file)
    if (pending?.url) URL.revokeObjectURL(pending.url)
    const url = URL.createObjectURL(out.blob)
    /* Held in memory and shown as the preview; stored (and the project pointed at it) only on Apply. */
    pending = {
      slug: p.slug,
      custom: out,
      url,
      bg: grid.cleanBg({ id: 'custom', ...bd.defaultsFor('custom'), at: 1 }),
    }
    previewCustom(p, out, url)
    said = `${String(out.w)} x ${String(out.h)}, ${String(Math.round(out.blob.size / 1024))} KB. Preview shown; press Apply to keep it.`
  } catch (e) {
    said = e instanceof Error ? e.message : 'That picture could not be used.'
  } finally {
    busy = false
    redraw(root, p)
  }
}

/* A processed picture not yet stored: paint it from its object URL with its own size. */
const previewCustom = (p, out, url) => {
  const b = boardOf(p.slug)
  if (b === null) return
  const bg = pending.bg
  const w = Math.round(out.w * bg.scale)
  const h = Math.round(out.h * bg.scale)
  b.style.setProperty('--bc-bg-img', `url('${url}')`)
  b.style.setProperty('--bc-bg-tw', `${String(w)}px`)
  b.style.setProperty('--bc-bg-th', `${String(h)}px`)
  b.style.setProperty('--bc-bg-veilp', `${String(Math.round((1 - bg.intensity) * 100))}%`)
  b.style.setProperty('--bc-bg-shadep', `${String(Math.round(bg.tint * 100))}%`)
  b.setAttribute('data-bg', 'custom')
  b.setAttribute('data-bg-mode', bg.mode)
  b.setAttribute('data-bg-tone', out.tone)
}

const apply = async (root, p) => {
  if (pending === null) return
  const slug = p.slug
  try {
    if (pending.custom) {
      await bd.customPut(slug, pending.custom)
      grid.setBg(slug, pending.bg)
    } else {
      grid.setBg(slug, pending.bg)
    }
    if (pending.url) URL.revokeObjectURL(pending.url)
    pending = null
    said = 'Saved for this project.'
    bd.paint(boardOf(slug), grid.bgOf(slug), slug)
  } catch (e) {
    said = e instanceof Error ? e.message : 'That could not be saved.'
  }
  document.getElementById('viewer')?.classList.remove('bd-preview')
  redraw(root, p)
}

const remove = async (root, p) => {
  const slug = p.slug
  try {
    await bd.customDelete(slug)
    if (grid.bgOf(slug)?.id === 'custom') grid.setBg(slug, { id: 'default', ...bd.defaultsFor('default') })
    if (pending?.url) URL.revokeObjectURL(pending.url)
    pending = null
    said = 'Your picture was removed.'
    bd.paint(boardOf(slug), grid.bgOf(slug), slug)
  } catch (e) {
    said = e instanceof Error ? e.message : 'That could not be removed.'
  }
  document.getElementById('viewer')?.classList.remove('bd-preview')
  redraw(root, p)
}

/** Does the picker hold a choice that is not applied? (the sheet asks before it throws a preview away) */
export const dirty = () => pending !== null
