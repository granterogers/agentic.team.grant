/*
  THE HOUSE STYLE: what a project's documents look like.

  Grant, 4 October 2026: a project can have a style profile - colours,
  typography, tone, audience, structure, reusable instructions - inherited from
  an office default and overridden per project, and a document the team makes
  inherits it. The storage, validation and inheritance are in the office
  (`style` section, `style_set` and `style_clear` actions); this is the form.

  Nothing here pretends to extract a style from a document: "save this report as
  the project's style" needs a reader the office does not have, so that button
  is not drawn. What a person types is what is stored, and each field says
  whether it is this project's own or the office's.

  Comments inside any template literal in this file use plain words.
*/

import { act, canWrite, read } from '../office.js'
import { esc } from './parts.js'

let dlg = null
const shut = () => {
  dlg?.remove()
  dlg = null
  document.removeEventListener('keydown', onKey, true)
}
const onKey = (e) => {
  if (e.key === 'Escape') {
    e.stopPropagation()
    shut()
  }
}

const SWATCH = { primary: 'Main colour', accent: 'Accent', ink: 'Text', paper: 'Page', wash: 'Tint', rule: 'Lines', muted: 'Quiet text' }
const hex = (v, d) => (/^#[0-9a-fA-F]{6}$/.test(String(v ?? '')) ? v : d)

const origin = (inh, key, scope) => {
  const from = inh?.[key]
  if (from === undefined) return ''
  return `<span class="bcstyfrom">${from === 'project' ? 'this project' : scope === 'project' ? 'inherited from the office' : 'office default'}</span>`
}

const form = (name, scope, data) => {
  const p = data.profile ?? {}
  const inh = data.inherited_from ?? {}
  const v = data.vocabulary ?? { fonts: ['Helvetica', 'Times'], palette: Object.keys(SWATCH), title_pages: ['standard', 'band'] }
  const pal = p.palette ?? {}
  const ty = p.typography ?? {}
  return `<h2 class="bcstyh">${esc(scope === 'project' ? `Document style for ${name}` : 'Document style for the whole office')}</h2>
    <p class="bcpmeta">${esc(scope === 'project' ? 'Anything left alone is inherited from the office default. The documents the team makes here use this.' : 'The default every project inherits unless it sets its own.')}</p>
    <div class="bcstygrid">
      ${v.palette
        .map(
          (k) => `<label class="bcstyfield"><span>${esc(SWATCH[k] ?? k)} ${origin(inh, `palette.${k}`, scope)}</span>
            <input type="color" name="pal.${esc(k)}" value="${esc(hex(pal[k], k === 'paper' ? '#ffffff' : k === 'ink' ? '#1c2428' : '#2f6f5e'))}" ${pal[k] === undefined ? 'data-unset="1"' : ''}></label>`,
        )
        .join('')}
    </div>
    <div class="bcstygrid">
      <label class="bcstyfield"><span>Headings ${origin(inh, 'typography.heading', scope)}</span>
        <select name="ty.heading">${v.fonts.map((f) => `<option${(ty.heading ?? 'Helvetica') === f ? ' selected' : ''}>${esc(f)}</option>`).join('')}</select></label>
      <label class="bcstyfield"><span>Body text ${origin(inh, 'typography.body', scope)}</span>
        <select name="ty.body">${v.fonts.map((f) => `<option${(ty.body ?? 'Helvetica') === f ? ' selected' : ''}>${esc(f)}</option>`).join('')}</select></label>
      <label class="bcstyfield"><span>Title page ${origin(inh, 'formatting.title_page', scope)}</span>
        <select name="fm.title_page">${v.title_pages.map((f) => `<option${(p.formatting?.title_page ?? 'standard') === f ? ' selected' : ''}>${esc(f)}</option>`).join('')}</select></label>
    </div>
    <label class="bcstyfield bcstywide"><span>Tone of voice ${origin(inh, 'tone', scope)}</span>
      <input name="tone" maxlength="200" value="${esc(p.tone ?? '')}" placeholder="Plain, warm, no jargon"></label>
    <label class="bcstyfield bcstywide"><span>Who it is for ${origin(inh, 'audience', scope)}</span>
      <input name="audience" maxlength="200" value="${esc(p.audience ?? '')}" placeholder="Prospective coaching clients"></label>
    <label class="bcstyfield bcstywide"><span>Standing instructions for documents ${origin(inh, 'instructions', scope)}</span>
      <textarea name="instructions" rows="3" maxlength="1500" placeholder="Lead with the conclusion. One idea per paragraph.">${esc(p.instructions ?? '')}</textarea></label>
    <p class="bcstyerr" role="alert" hidden></p>
    <div class="bcstyacts">
      ${scope === 'project' ? '<button type="button" class="bccal2btn" data-sty-clear>Use the office default</button>' : ''}
      <span class="bccal2sp"></span>
      <button type="button" class="bccal2btn" data-sty-close>Close</button>
      <button type="submit" class="bccal2btn bccal2btn--primary">Save style</button>
    </div>`
}

export const open = async (p) => {
  shut()
  dlg = document.createElement('div')
  dlg.className = 'bccal2dlg bcstydlg'
  dlg.setAttribute('role', 'dialog')
  dlg.setAttribute('aria-modal', 'true')
  dlg.setAttribute('aria-label', 'Document style')
  dlg.innerHTML = `<div class="bccal2back" data-sty-close></div><form class="bccal2form bcstyform" novalidate><p class="bcpmeta">Loading the style…</p></form>`
  document.body.append(dlg)
  document.addEventListener('keydown', onKey, true)
  for (const b of dlg.querySelectorAll('[data-sty-close]')) b.addEventListener('click', shut)
  const f = dlg.querySelector('form')
  if (!canWrite()) {
    f.innerHTML = `<h2 class="bcstyh">Document style</h2><p class="bcpmeta">Sign in to set the look of this project's documents. Prototype data is never saved.</p><div class="bcstyacts"><span class="bccal2sp"></span><button type="button" class="bccal2btn" data-sty-close>Close</button></div>`
    for (const b of f.querySelectorAll('[data-sty-close]')) b.addEventListener('click', shut)
    return
  }
  let scope = 'project'
  const load = async () => {
    let data
    try {
      data = await read('style', undefined, scope === 'project' ? { slug: p.slug } : {})
    } catch (e) {
      f.innerHTML = `<h2 class="bcstyh">Document style</h2><p class="bcpmeta">The office could not give the style (${esc(String(e?.message ?? e))}). It may not have been updated for styles yet.</p><div class="bcstyacts"><span class="bccal2sp"></span><button type="button" class="bccal2btn" data-sty-close>Close</button></div>`
      for (const b of f.querySelectorAll('[data-sty-close]')) b.addEventListener('click', shut)
      return
    }
    const tabs = `<div class="bccal2views bcstyscope" role="group" aria-label="Whose style">
      <button type="button" class="bccal2btn bccal2btn--seg${scope === 'project' ? ' is-on' : ''}" data-sty-scope="project" aria-pressed="${scope === 'project'}">This project</button>
      <button type="button" class="bccal2btn bccal2btn--seg${scope === 'office' ? ' is-on' : ''}" data-sty-scope="office" aria-pressed="${scope === 'office'}">All projects</button></div>`
    f.innerHTML = tabs + form(p.name, scope, data)
    for (const b of f.querySelectorAll('[data-sty-close]')) b.addEventListener('click', shut)
    for (const b of f.querySelectorAll('[data-sty-scope]')) {
      b.addEventListener('click', () => {
        scope = b.dataset.styScope
        void load()
      })
    }
    f.querySelector('[data-sty-clear]')?.addEventListener('click', async () => {
      try {
        await act('style_clear', { p_slug: p.slug })
        void load()
      } catch (e) {
        say(String(e?.message ?? e))
      }
    })
  }
  const say = (m) => {
    const el = f.querySelector('.bcstyerr')
    if (el === null) return
    el.textContent = m
    el.hidden = m === ''
  }
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault()
    const g = (n) => f.elements[n]?.value ?? ''
    const palette = {}
    for (const el of f.querySelectorAll('input[type=color]')) {
      /* A colour nobody touched stays unset, so it is inherited rather than frozen at a default. */
      if (el.dataset.unset === '1' && el.dataset.touched !== '1') continue
      palette[el.name.replace('pal.', '')] = el.value
    }
    const patch = {
      palette,
      typography: { heading: g('ty.heading'), body: g('ty.body') },
      formatting: { title_page: g('fm.title_page') },
      tone: g('tone').trim() === '' ? null : g('tone').trim(),
      audience: g('audience').trim() === '' ? null : g('audience').trim(),
      instructions: g('instructions').trim() === '' ? null : g('instructions').trim(),
    }
    try {
      await act('style_set', scope === 'project' ? { p_slug: p.slug, p_patch: patch } : { p_patch: patch })
      say('')
      shut()
    } catch (e) {
      say(String(e?.message ?? e))
    }
  })
  f.addEventListener('input', (ev) => {
    if (ev.target.type === 'color') ev.target.dataset.touched = '1'
  })
  await load()
}
