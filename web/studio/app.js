/*
  The M0 prototype.

  Static ES modules, no bundler, no framework — Option 2 of the integration
  assessment. What it is proving is not that a dashboard can be built, but that
  the interaction quality §14A demands is reachable without a framework. If it
  is not, that is evidence for React and this file becomes the specification.
*/

import { CREW, PROJECTS, WAITING, byId, crewBy } from './data.js'
import { ambient, breathe, scatter, tiltable } from './alive.js'
import { coverSvg } from './cover.js'
import { pageSvg } from './page.js'
import { SPRING, carry, pressable, spring } from './motion.js'

const $ = (sel, root = document) => root.querySelector(sel)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

const state = { view: 'portfolio', project: null, done: new Set() }

// --- pieces -----------------------------------------------------------------

/*
  A face, with the real portrait behind it.

  The initial stays as the fallback layer underneath: if the image is slow or
  gone the mark is still a mark, not an empty circle. `loading="lazy"` because
  eight portraits in a rail are not what the first paint is for.
*/
const face = (c, size = 28) =>
  `<span class="face ${c.hue} ${c.state}" style="width:${size}px;height:${size}px"
         title="${esc(c.name)} — ${esc(c.doing ?? c.role)}">${esc(c.name[0])}${
    c.face ? `<img src="${esc(c.face)}" alt="" loading="lazy">` : ''
  }</span>`

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
  const badge = `k-${d.kind === 'made' ? 'made' : d.kind}`
  const label = d.kind === 'made' ? 'MADE' : d.kind.toUpperCase()
  return `<div class="page">${pageSvg(d.title, d.kind)}<span class="kind ${badge}">${label}</span></div>`
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
        <span class="brandline">Eight people, one queue</span>
      </span>
    </div>
    <nav class="navgroup">
      <button class="navitem home" data-go="portfolio" aria-current="${state.view === 'portfolio'}">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
          <path d="M4 5h6v6H4zM14 5h6v6h-6zM4 13h6v6H4zM14 13h6v6h-6z"/></svg>
        All projects
      </button>
      <!--
        Projects are the top tier, and everything else hangs off one.

        Grant: *"project choice is the top tier.. and from each project flows
        tasks, documents, etc"*. The first version had Projects, Documents and
        Tasks as three peers in the rail, which said the opposite — that a
        document is a thing you browse globally and a project is one lens on it.
        Here the rail lists the actual projects, and Documents and Tasks exist
        only inside one.
      -->
      ${PROJECTS.map((p) => `
        <button class="navitem proj ${p.hue}" data-open="${p.slug}"
                aria-current="${state.view === 'project' && state.project === p.slug}">
          <span class="dot"></span>${esc(p.name)}
        </button>`).join('')}
    </nav>
    <!--
      The team, as people.

      Now that there are real portraits (#24 idea 4) the rail can say who is
      actually doing something rather than showing eight identical dots. Whoever
      is working gets a row with their face, their name and their work; everyone
      else collapses into a quiet strip underneath. That is presence being
      ambient — you see the shape of the office without reading it.
    -->
    <div class="team">
      <div class="t-label">Working now</div>
      ${CREW.filter((c) => c.state === 'busy').map((c) => `
        <div class="mate">
          ${face(c, 34)}
          <span class="what">
            <b>${esc(c.name)}</b>
            <span class="t-meta">${esc(c.doing ?? c.role)}</span>
          </span>
        </div>`).join('')}
      <div class="crew">${CREW.filter((c) => c.state !== 'busy').map((c) => face(c, 26)).join('')}
        <span class="t-meta rest-note">${
          CREW.filter((c) => c.state !== 'busy').length
        } more, quiet</span>
      </div>
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
/*
  A contact.

  Two questions get answered without opening anything: who is this and how do I
  reach them, and what happens next. Everything else — organisation, place,
  linked documents, the note — is there when it exists and takes no room when it
  does not, which is what stops a mostly-empty contact looking like a broken
  form.

  The initial-in-a-disc rather than a photo: these are Grant's clients, and this
  is a prototype on invented data. A real one takes a photo if there is one.
*/
function contactCard(c, i) {
  const stage = { active: 'Active', prospect: 'Prospect', dormant: 'Dormant' }[c.stage] ?? c.stage
  const bits = [c.org, c.where].filter((x) => x !== '' && x !== undefined)
  return `<button class="contact ${c.hue}" data-contact="${i}">
    <span class="disc">${esc(c.name[0])}</span>
    <span class="who">
      <span class="line1">
        <b>${esc(c.name)}</b>
        <span class="stage s-${esc(c.stage)}">${esc(stage)}</span>
      </span>
      <span class="t-meta">${esc(c.role)}${bits.length > 0 ? ` · ${esc(bits.join(' · '))}` : ''}</span>
      ${c.next ? `<span class="next">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
        ${esc(c.next)}${c.nextDue ? ` — ${esc(c.nextDue)}` : ''}</span>` : ''}
    </span>
    <span class="t-meta when">${esc(c.last)}</span>
  </button>`
}

function card(p, lead) {
  const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0
  return `<button class="project ${p.hue} ${lead ? 'lead' : ''}" data-open="${p.slug}">
    <span class="cover" style="view-transition-name:cover-${p.slug}">
      ${coverSvg(p.slug, { dense: lead, facts: p })}
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
        ${p.total > 0 ? `<span>${p.total} tasks</span>` : ''}
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
      ${coverSvg(p.slug, { dense: true, facts: p })}
    </div>
    <div class="head">
      <div>
        <h1 class="t-display" style="font-size:38px">${esc(p.name)}</h1>
        <p class="t-lead" style="margin:var(--s2) 0 0">${esc(p.purpose)}</p>
      </div>
      <div class="crew" style="margin:0">${p.activity.map((a) => face(crewBy(a.who))).join('')}</div>
    </div>
    <!--
      Where the connectors live now.

      Grant: *"the source of truth is our own internally defined projects.. with
      connections to notebook, notion, etc as optional"*. So they are not a
      badge on the cover as though the project belonged to Notion — they are a
      line under the project's own name saying what it is additionally joined
      up to, including when the answer is nothing.
    -->
    <div class="links">
      <span class="t-label">Also connected to</span>
      ${
        p.connectors.length === 0
          ? '<span class="t-meta">Nothing yet — this project stands on its own.</span>'
          : p.connectors.map((c) => `<span class="link">${esc(c)}</span>`).join('')
      }
      <button class="link add">+ Connect something</button>
    </div>
    <div class="spread">
      <div class="stack">
        ${p.modules.length > 0 ? `<section class="section">
          <header><h2 class="t-title">Modules</h2></header>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(196px,1fr));gap:var(--s3)">
            ${p.modules.map((m) => `<div class="module" style="--dot:${
              m.state === 'done' ? 'var(--good)' : m.state === 'doing' ? 'var(--warn)' : 'var(--ink-3)'
            }">
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
          <header>
            <h2 class="t-title">Contacts</h2>
            <span class="t-meta">${
              p.contacts.length === 0 ? 'none yet' : `${p.contacts.length} people`
            }</span>
          </header>
          ${
            p.contacts.length === 0
              ? `<div class="empty">
                   <p class="t-meta">Nobody on this project yet. Add the people it is
                     actually about — clients, prospects, whoever sent you something.</p>
                   <button class="btn">Add someone</button>
                 </div>`
              : `<div class="contacts">${p.contacts.map(contactCard).join('')}</div>
                 <button class="link add" style="justify-self:start">+ Add someone</button>`
          }
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
  // The room takes its colour from whatever is in front of you.
  ambient(state.view === 'project' ? byId(state.project).hue : PROJECTS[0].hue)
  breathe(root)
  scatter(root)

  for (const b of root.querySelectorAll('[data-go]')) {
    b.addEventListener('click', () => {
      carry(null, null, () => { state.view = b.dataset.go === 'portfolio' ? 'portfolio' : state.view; render() })
    })
  }

  // Project → dashboard. The cover art is the shared element: it grows and
  // moves to the hero slot, and the browser pairs them by view-transition-name.
  for (const b of root.querySelectorAll('[data-open]')) {
    if (!b.classList.contains('proj')) tiltable(b, { max: b.classList.contains('lead') ? 3.2 : 5 })
    b.addEventListener('click', () => {
      carry(null, null, () => { state.project = b.dataset.open; state.view = 'project'; render() })
    })
  }

  // Tasks complete optimistically: the row changes now, the network catches up.
  for (const m of root.querySelectorAll('.module')) tiltable(m, { max: 3, scale: 1.006 })

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

  for (const b of root.querySelectorAll('[data-contact]')) {
    b.addEventListener('click', () => openContact(byId(state.project).contacts[Number(b.dataset.contact)]))
  }

  for (const b of root.querySelectorAll('[data-doc]')) {
    tiltable($('.page', b), { max: 7, scale: 1.03 })
    b.addEventListener('click', () => openDoc(byId(state.project).documents[Number(b.dataset.doc)], b))
  }
}

/*
  Document card → viewer.

  The rendered page is the shared element and scales into place; the grid behind
  dims and does not move. Reference 4: the object you touched is the object you
  land in.
*/
/*
  The whole record, when you want it.

  A field with nothing in it is omitted rather than shown empty: "Phone —" tells
  you nothing that the absence of a phone row does not, and four of them make a
  contact look unfinished when it is simply a person whose number you do not
  have.
*/
function openContact(c) {
  const v = $('#viewer')
  const row = (label, value, href) =>
    value === '' || value === undefined
      ? ''
      : `<div class="field"><span class="t-label">${esc(label)}</span>${
          href ? `<a href="${esc(href)}${esc(value)}">${esc(value)}</a>` : `<span>${esc(value)}</span>`
        }</div>`

  v.innerHTML = `<div class="sheet ${c.hue}">
      <div class="chead">
        <span class="disc big">${esc(c.name[0])}</span>
        <span>
          <h2 class="t-title" style="margin:0">${esc(c.name)}</h2>
          <p class="t-meta" style="margin:4px 0 0">${esc(c.role)}${c.org ? ` · ${esc(c.org)}` : ''}</p>
        </span>
        <span class="stage s-${esc(c.stage)}">${esc(c.stage)}</span>
      </div>
      ${c.note ? `<p class="t-lead" style="margin:var(--s4) 0 0">${esc(c.note)}</p>` : ''}
      <div class="fields">
        ${row('Email', c.email, 'mailto:')}
        ${row('Phone', c.phone, 'tel:')}
        ${row('Where', c.where)}
        ${row('Last spoke', c.last)}
        ${row('Next', c.next ? `${c.next}${c.nextDue ? ` — ${c.nextDue}` : ''}` : '')}
      </div>
      ${
        c.docs.length === 0
          ? ''
          : `<div class="field" style="margin-top:var(--s4)">
               <span class="t-label">Documents</span>
               <span class="doclinks">${c.docs.map((d) => `<span class="link">${esc(d)}</span>`).join('')}</span>
             </div>`
      }
    </div>
    <button class="close" aria-label="Close">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
    </button>`
  carry(null, null, () => { v.hidden = false })
  $('.close', v).addEventListener('click', () => { v.hidden = true })
  v.addEventListener('click', (e) => { if (e.target === v) v.hidden = true })
}

function openDoc(doc, from) {
  const v = $('#viewer')
  v.innerHTML = `<div class="sheet">
      <div class="t-label">${esc(doc.origin)}</div>
      <h2 class="t-title" style="margin:var(--s2) 0 var(--s3)">${esc(doc.title)}</h2>
      <p class="t-meta">${esc(doc.size)}</p>
      <div class="bigpage">${pageSvg(doc.title, doc.kind)}</div>
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
