/*
  The M0 prototype.

  Static ES modules, no bundler, no framework — Option 2 of the integration
  assessment. What it is proving is not that a dashboard can be built, but that
  the interaction quality §14A demands is reachable without a framework. If it
  is not, that is evidence for React and this file becomes the specification.
*/

import { CREW, PROJECTS, WAITING, byId, crewBy } from './data.js'
import { coverSvg } from './cover.js'
import { SPRING, carry, pressable, spring } from './motion.js'

const $ = (sel, root = document) => root.querySelector(sel)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

const state = { view: 'portfolio', project: null, done: new Set() }

// --- pieces -----------------------------------------------------------------

const face = (c, size = 28) =>
  `<span class="face ${c.hue} ${c.state}" style="width:${size}px;height:${size}px"
         title="${esc(c.name)} — ${esc(c.doing ?? c.role)}">${esc(c.name[0])}</span>`

/*
  A document cover.

  Reference 9: the page IS the thumbnail. Until pdf.js renders a real page
  (Issue #10) this draws the shape of one — rules at the real proportions of the
  document's first page — so the LAYOUT is being tested against something the
  right size and weight, rather than against a grey box that will look nothing
  like the finished thing.
*/
const cover = (d) => {
  if (d.kind === 'audio') {
    return `<div class="page" style="background:var(--sunken);align-items:center;justify-content:center">
      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)"
           stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
        <path d="M3 12h2l2-5 3 11 3-14 3 12 2-4h3"/></svg></div>`
  }
  const rules = (d.lines ?? [80, 96, 88])
    .map((w, i) => `<div class="rule${i === 0 ? ' h' : ''}" style="width:${w}%"></div>`).join('')
  const badge = d.kind === 'made' ? 'made' : d.kind
  const label = d.kind === 'made' ? 'MADE' : d.kind.toUpperCase()
  return `<div class="page">${rules}<span class="kind ${badge}">${label}</span></div>`
}

const docCard = (d, i) => `
  <button class="doc" data-doc="${i}">
    ${cover(d)}
    <span style="font-weight:500;font-size:13px;line-height:1.35">${esc(d.title)}</span>
    <span class="t-meta" style="font-size:12px">${esc(d.origin)} · ${esc(d.size)}</span>
  </button>`

const taskRow = (t, i) => {
  const done = t.state === 'done' || state.done.has(i)
  const who = t.who ? crewBy(t.who) : null
  return `<button class="task ${done ? 'done' : ''}" data-task="${i}">
    <span class="box ${t.state === 'due' && !done ? 'due' : ''}">${
      done ? `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--on-accent)"
        stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>` : ''
    }</span>
    <span class="label">
      <span style="display:block;font-size:14px;font-weight:500">${esc(t.title)}</span>
      ${t.due ? `<span class="t-meta" style="color:var(--warn);font-weight:600">${esc(t.due)}</span>`
              : t.note ? `<span class="t-meta">${esc(t.note)}</span>` : ''}
    </span>
    ${who ? face(who, 22) : ''}
  </button>`
}

// --- views -------------------------------------------------------------------

function rail() {
  return `<aside class="rail">
    <div class="wordmark">
      <span class="glyph"><svg width="16" height="16" viewBox="0 0 24 24" fill="none"
        stroke="var(--on-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
        aria-hidden="true"><path d="M12 3l7 4v10l-7 4-7-4V7z"/><path d="M12 12l7-4M12 12v9M12 12L5 8"/></svg></span>
      <span>
        <span style="display:block;font:600 15px/1.15 var(--text)">Studio</span>
        <span class="t-meta" style="font-size:12px">Eight people, one queue</span>
      </span>
    </div>
    <nav class="navgroup">
      <button class="navitem" data-go="portfolio" aria-current="${state.view === 'portfolio'}">Projects</button>
      <button class="navitem" data-go="docs" aria-current="${state.view === 'docs'}">Documents</button>
      <button class="navitem" data-go="tasks" aria-current="${state.view === 'tasks'}">Tasks</button>
    </nav>
    <div>
      <div class="t-label" style="margin-bottom:10px">The team</div>
      <div class="crew">${CREW.map((c) => face(c)).join('')}</div>
    </div>
  </aside>`
}

function attention() {
  return `<div class="attention">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--warn)"
      stroke-width="2" stroke-linecap="round" style="flex:none" aria-hidden="true">
      <circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.01"/></svg>
    <span style="flex:1;min-width:0">
      <span style="display:block;font-weight:500;font-size:14px">${esc(WAITING.what)}</span>
      <span class="t-meta">${esc(WAITING.who)}, ${esc(WAITING.when)}. ${esc(WAITING.note)}</span>
    </span>
    <button class="btn">Show me</button>
  </div>`
}

/*
  A project card.

  `lead` is the first project: art at a real size beside the words rather than
  above them, everything a step up the ramp. The difference is the composition
  saying which project matters before anything is read.
*/
function card(p, lead) {
  const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0
  return `<button class="project ${p.hue} ${lead ? 'lead' : ''}" data-open="${p.slug}">
    <span class="cover" style="view-transition-name:cover-${p.slug}">
      ${coverSvg(p.slug, { dense: lead })}
      <span class="chips">${p.connectors.map((c) => `<span class="chip">${esc(c)}</span>`).join('')}</span>
    </span>
    <span class="body">
      <span>
        <span class="${lead ? 't-title' : ''}" style="display:block;${
          lead ? '' : 'font:600 16px/1.25 var(--text);'
        }">${esc(p.name)}</span>
        <span class="${lead ? 't-lead' : 't-meta'}" style="display:block;margin-top:${lead ? '8px' : '4px'}">${
          esc(p.purpose)
        }</span>
      </span>
      ${p.total > 0 ? `<span class="bar">
        <span class="track"><span class="fill" style="width:${pct}%"></span></span>
        <span class="t-meta" style="font-size:12px">${p.done}/${p.total}</span>
      </span>` : ''}
      <span class="facts t-meta" style="font-size:12.5px">
        <span>${p.docs} ${p.docs === 1 ? 'doc' : 'docs'}</span>
        ${p.next ? `<span style="color:var(--warn);font-weight:500">${esc(p.next)}</span>` : ''}
      </span>
    </span>
  </button>`
}

function portfolio() {
  return `<main class="main">
    <div class="head">
      <div>
        <h1 class="t-display">Good morning, Grant</h1>
        <p class="t-lead" style="margin:var(--s2) 0 0">Three projects. One thing waiting on you,
          and the team finished nine things overnight.</p>
      </div>
      <button class="btn primary">Call Claire</button>
    </div>
    ${attention()}
    <div class="portfolio">
      ${card(PROJECTS[0], true)}
      <div class="rest">${PROJECTS.slice(1).map((p) => card(p, false)).join('')}</div>
    </div>
  </main>`
}

function dashboard() {
  const p = byId(state.project)
  return `<main class="main">
    <button class="btn" data-go="portfolio" style="margin-bottom:var(--s4)">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>
      Projects</button>
    <div class="hero ${p.hue}" style="view-transition-name:cover-${p.slug}">
      ${coverSvg(p.slug, { dense: true })}
      <span class="chips">${p.connectors.map((c) => `<span class="chip">${esc(c)}</span>`).join('')}</span>
    </div>
    <div class="head">
      <div>
        <h1 class="t-display" style="font-size:38px">${esc(p.name)}</h1>
        <p class="t-lead" style="margin:var(--s2) 0 0">${esc(p.purpose)}</p>
      </div>
      <div class="crew" style="margin:0">${p.activity.map((a) => face(crewBy(a.who))).join('')}</div>
    </div>
    <div class="spread">
      <div class="stack">
        ${p.modules.length > 0 ? `<section class="section">
          <header><h2 class="t-title">Modules</h2></header>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(196px,1fr));gap:var(--s3)">
            ${p.modules.map((m) => `<div style="background:var(--surface);border:1px solid var(--edge);
              border-radius:var(--r-card);padding:var(--s3) var(--s4);box-shadow:var(--lift-1)">
              <div class="t-label" style="color:${
                m.state === 'done' ? 'var(--good)' : m.state === 'doing' ? 'var(--warn)' : 'var(--ink-3)'
              }">${m.state === 'done' ? 'Done' : m.state === 'doing' ? 'In hand' : 'Not started'}</div>
              <div style="font-weight:600;font-size:14.5px;margin-top:6px;line-height:1.35">${esc(m.name)}</div>
              <div class="t-meta" style="margin-top:5px">${m.docs} docs · ${m.tasks} tasks</div>
            </div>`).join('')}
          </div>
        </section>` : ''}
        <section class="section">
          <header><h2 class="t-title">Documents</h2>
            <span class="t-meta">Yours, and what the team made</span></header>
          <div class="docgrid">${p.documents.map(docCard).join('')}</div>
        </section>
      </div>
      <div class="stack">
        <section class="section">
          <header><h2 class="t-title">Tasks</h2>
            <span class="t-meta">${p.tasks.filter((t) => t.state !== 'done').length} open</span></header>
          <div class="tasks">${p.tasks.map(taskRow).join('')}</div>
        </section>
        <section class="section">
          <header><h2 class="t-title">Lately</h2></header>
          <div class="tasks">
            ${p.activity.map((a) => {
              const c = crewBy(a.who)
              return `<div class="task" style="cursor:default">
                ${face(c, 22)}
                <span class="label t-meta" style="color:var(--ink)">
                  <b style="font-weight:600">${esc(c.name)}</b> ${esc(a.verb)} ${esc(a.what)}
                  <span style="color:var(--ink-3)"> · ${esc(a.when)}</span></span></div>`
            }).join('')}
          </div>
        </section>
      </div>
    </div>
  </main>`
}

// --- render and wire ---------------------------------------------------------

function render() {
  const root = $('#root')
  root.innerHTML = rail() + (state.view === 'project' ? dashboard() : portfolio())

  for (const b of root.querySelectorAll('[data-go]')) {
    b.addEventListener('click', () => {
      carry(null, null, () => { state.view = b.dataset.go === 'portfolio' ? 'portfolio' : state.view; render() })
    })
  }

  // Project → dashboard. The cover art is the shared element: it grows and
  // moves to the hero slot, and the browser pairs them by view-transition-name.
  for (const b of root.querySelectorAll('[data-open]')) {
    pressable(b)
    b.addEventListener('click', () => {
      carry(null, null, () => { state.project = b.dataset.open; state.view = 'project'; render() })
    })
  }

  // Tasks complete optimistically: the row changes now, the network catches up.
  for (const b of root.querySelectorAll('[data-task]')) {
    b.addEventListener('click', () => {
      const i = Number(b.dataset.task)
      state.done.has(i) ? state.done.delete(i) : state.done.add(i)
      const box = $('.box', b)
      spring(box, { transform: 'scale(0.8)' }, { transform: 'scale(1)' }, SPRING.snap)
      b.classList.toggle('done')
      const check = state.done.has(i)
      if (check && !$('svg', box)) {
        box.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none"
          stroke="var(--on-accent)" stroke-width="3.4" stroke-linecap="round"
          stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>`
      } else if (!check) { box.innerHTML = '' }
    })
  }

  for (const b of root.querySelectorAll('[data-doc]')) {
    pressable(b)
    b.addEventListener('click', () => openDoc(byId(state.project).documents[Number(b.dataset.doc)], b))
  }
}

/*
  Document card → viewer.

  The rendered page is the shared element and scales into place; the grid behind
  dims and does not move. Reference 4: the object you touched is the object you
  land in.
*/
function openDoc(doc, from) {
  const v = $('#viewer')
  v.innerHTML = `<div class="sheet">
      <div class="t-label">${esc(doc.origin)}</div>
      <h2 class="t-title" style="margin:var(--s2) 0 var(--s3)">${esc(doc.title)}</h2>
      <p class="t-meta">${esc(doc.size)}</p>
      <div style="margin-top:var(--s4);display:grid;gap:var(--s2)">
        ${(doc.lines ?? [80, 96, 88, 92, 64, 88, 76]).map((w, i) =>
          `<div class="rule${i === 0 ? ' h' : ''}" style="width:${w}%;background:var(--sunken)"></div>`).join('')}
      </div>
    </div>
    <button class="close" aria-label="Close">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
    </button>`
  const page = $('.page', from)
  carry('doc-open', page, () => { v.hidden = false })
  $('.close', v).addEventListener('click', () => carry('doc-open', page, () => { v.hidden = true }))
  v.addEventListener('click', (e) => {
    if (e.target === v) carry('doc-open', page, () => { v.hidden = true })
  })
}

render()
