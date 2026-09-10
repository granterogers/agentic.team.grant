/*
  The M0 prototype.

  Static ES modules, no bundler, no framework — Option 2 of the integration
  assessment. What it is proving is not that a dashboard can be built, but that
  the interaction quality §14A demands is reachable without a framework. If it
  is not, that is evidence for React and this file becomes the specification.
*/

import { CREW, PROJECTS, WAITING, byId, crewBy } from './data.js'
import { PALETTES, TEXTURES, appearance, apply, readTexture } from './appearance.js'
import * as canvasView from './canvas.js'
import * as people from './people.js'
import { ambient, breathe, scatter, tiltable } from './alive.js'
import { coverSvg } from './cover.js'
import { pageSvg } from './page.js'
import { paint } from './pdf.js'
import { SPRING, carry, pressable, spring } from './motion.js'

const $ = (sel, root = document) => root.querySelector(sel)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

const state = { view: 'portfolio', project: null, done: new Set(), label: null }

/*
  One place that knows whether something is open (#23 idea 6).

  Every sheet was toggling `hidden` on its own, so the defocus behind them
  would have had to be repeated five times and would have drifted the first
  time one of them changed. `behind` on the body is the single fact, and the
  CSS reads it.
*/
const sheet = (el, open) => {
  el.hidden = !open
  const anyOpen = !$('#viewer').hidden || !$('#settings').hidden
  document.body.classList.toggle('behind', anyOpen)
}

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
    <!--
      Grant: *"sidebars and such should be collapsible"*. Collapsed, the rail
      keeps every control and drops every word — icons, project dots and faces
      stay, so it is a narrower rail rather than a hidden one. The state is
      remembered, because a person who collapses a sidebar means it.
    -->
    <button class="railtoggle" data-rail aria-label="Collapse the sidebar">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="1.9" stroke-linecap="round" aria-hidden="true">
        <path d="M14 6l-6 6 6 6"/></svg>
    </button>
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
      <button class="navitem home" data-go="desk" aria-current="${state.view === 'desk'}">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
          <rect x="3" y="4" width="8" height="6" rx="1.5"/><rect x="13" y="7" width="8" height="5" rx="1.5"/>
          <rect x="5" y="13" width="9" height="7" rx="1.5"/></svg>
        Desk
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
        </button>
        ${state.project === p.slug && state.view !== 'portfolio' ? `
          <button class="navitem sub ${state.view === 'people' ? 'on' : ''}" data-people="${p.slug}">
            People<span class="n">${p.contacts.length}</span></button>` : ''}`).join('')}
    </nav>
    <!--
      The team, as people.

      Now that there are real portraits (#24 idea 4) the rail can say who is
      actually doing something rather than showing eight identical dots. Whoever
      is working gets a row with their face, their name and their work; everyone
      else collapses into a quiet strip underneath. That is presence being
      ambient — you see the shape of the office without reading it.
    -->
    <!--
      Grant: *"of course the talk to team button should be prominent"*. It was a
      secondary button in a page header, competing with New project. It is the
      one control he uses when he does not want to use the interface at all, so
      it lives in the rail, it is the only filled thing in it, and it survives
      the rail collapsing.
    -->
    <button class="callbtn" data-call>
      <span class="ring"></span>
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" aria-hidden="true">
        <path d="M12 2a3 3 0 00-3 3v7a3 3 0 006 0V5a3 3 0 00-3-3z"/>
        <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v3"/></svg>
      <span class="lbl">Talk to the team</span>
    </button>

    <button class="navitem settings-open" data-settings>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="3.2"/>
        <path d="M12 2.5v2.2M12 19.3v2.2M21.5 12h-2.2M4.7 12H2.5M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6M18.7 18.7l-1.6-1.6M6.9 6.9L5.3 5.3"/>
      </svg>
      Appearance
    </button>
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
      ${(() => {
        const on = people.labelsOn(c.name)
        return on.length === 0 ? '' :
          `<span class="tags">${on.map((l) =>
            `<span class="tag ${l.hue}">${esc(l.name)}</span>`).join('')}</span>`
      })()}
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

/*
  A project's people.

  Corrected: Grant, on the first version — *"remember people is a subset of each
  project.. not merged"*. I had built the union across every project, which
  quietly asserts that a person is a global record a project happens to
  reference. He is saying the opposite, and it matches the rest of the model:
  the project is the source of truth, and a contact belongs to one the way a
  document does.

  So this is the same view, scoped. It reads the project you are in, and the
  rail reaches it per project rather than once at the top.
*/
/*
  The desk (#23 idea 9).

  Projects on a pannable surface, positioned where Grant left them. Offered
  beside the portfolio rather than instead of it, because the claim that spatial
  memory beats a list might be false for three projects and obviously true for
  thirty — and the only way to find out is to have both.
*/
function desk() {
  const pos = canvasView.positions(PROJECTS)
  return `<main class="main deskmain">
    <div class="head">
      <div>
        <h1 class="t-display">Desk</h1>
        <p class="t-lead" style="margin:var(--s2) 0 0">Drag a project anywhere. It stays
          where you put it — nothing tidies itself, because a surface that rearranges
          is a surface you cannot remember.</p>
      </div>
      <button class="btn" data-go="portfolio">Back to the list</button>
    </div>
    <div class="stage">
      <div class="surface" data-surface>
        ${PROJECTS.map((p) => `
          <div class="deskcard ${p.hue}" data-card="${p.slug}"
               style="left:${pos[p.slug].x}px;top:${pos[p.slug].y}px">
            <span class="cover">${coverSvg(p.slug, { facts: p })}</span>
            <span class="body">
              <b>${esc(p.name)}</b>
              <span class="t-meta">${p.docs} docs · ${p.total} tasks</span>
            </span>
          </div>`).join('')}
      </div>
    </div>
  </main>`
}

function projectPeople() {
  const p = byId(state.project)
  const defined = people.labels()
  const chosen = state.label
  const shown = chosen === null
    ? p.contacts
    : p.contacts.filter((c) => people.labelsOn(c.name).some((l) => l.id === chosen))

  return `<main class="main">
    <button class="btn" data-open="${p.slug}" style="margin-bottom:var(--s4)">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>
      ${esc(p.name)}</button>
    <div class="head">
      <div>
        <h1 class="t-display">People</h1>
        <p class="t-lead" style="margin:var(--s2) 0 0">Everyone on ${esc(p.name)}.
          Labels are yours — rename them, add your own, delete the ones you do not use.</p>
      </div>
      <button class="btn" data-label-edit>Edit labels</button>
    </div>

    <div class="filters">
      <button class="pill ${chosen === null ? 'on' : ''}" data-filter="">All
        <span class="n">${p.contacts.length}</span></button>
      ${defined.map((l) => {
        const n = p.contacts.filter((c) => people.labelsOn(c.name).some((x) => x.id === l.id)).length
        return `<button class="pill ${l.hue} ${chosen === l.id ? 'on' : ''}" data-filter="${l.id}">
          <span class="swatchdot"></span>${esc(l.name)}<span class="n">${n}</span></button>`
      }).join('')}
    </div>

    ${
      shown.length === 0
        ? `<div class="empty"><p class="t-meta">${
            p.contacts.length === 0
              ? 'Nobody on this project yet. Add the people it is actually about.'
              : 'Nobody here carries that label yet. Open someone and tick it.'
          }</p><button class="btn">Add someone</button></div>`
        : `<div class="peoplegrid">${shown.map((c) => `
            <button class="pcard ${c.hue}" data-person="${esc(c.name)}">
              <span class="disc big">${esc(c.name[0])}</span>
              <span class="pbody">
                <b>${esc(c.name)}</b>
                <span class="t-meta">${esc(c.role)}${c.org ? ` · ${esc(c.org)}` : ''}</span>
                <span class="tags">${people.labelsOn(c.name).map((l) =>
                  `<span class="tag ${l.hue}">${esc(l.name)}</span>`).join('')}</span>
                ${c.next ? `<span class="t-meta from">Next: ${esc(c.next)}</span>` : ''}
              </span>
            </button>`).join('')}</div>`
    }
  </main>`
}

function portfolio() {
  return `<main class="main">
    <div class="head">
      <div>
        <h1 class="t-display">Good morning, Grant</h1>
        <p class="t-lead" style="margin:var(--s2) 0 0">Three projects. One thing waiting on you,
          and the team finished nine things overnight.</p>
      </div>
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
          <!--
            #23 idea 8. A shelf rather than a grid: you recognise documents by
            their covers, and a row you flick through suits that far better than
            a block you scan. Scroll-snap gives it detents, so it comes to rest
            on a document rather than between two.
          -->
          <div class="shelf" data-shelf>${p.documents.map(docCard).join('')}</div>
          <div class="shelfnav">
            <button class="shelfbtn" data-shelf-back aria-label="Earlier documents">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>
            </button>
            <button class="shelfbtn" data-shelf-on aria-label="More documents">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
            </button>
          </div>
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
            <button class="link" data-people="${p.slug}">${
              p.contacts.length === 0 ? 'none yet' : `all ${p.contacts.length}`
            }</button>
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

/*
  The appearance picker.

  Swatches rather than names: nobody knows what "Clay" looks like from the word,
  and a palette you can see is a palette you can choose in a second. Each swatch
  is drawn from the palette's own tokens by setting `data-palette` on itself, so
  a new palette appears in this list with no code here at all.
*/
function settingsSheet() {
  const now = appearance()
  const v = $('#settings')
  v.innerHTML = `<div class="sheet wide">
      <div class="chead">
        <span style="flex:1;min-width:0">
          <h2 class="t-title" style="margin:0">Appearance</h2>
          <p class="t-meta" style="margin:4px 0 0">Changes apply straight away and are
            remembered on this device.</p>
        </span>
      </div>

      <div class="setgroup">
        <span class="t-label">Palette</span>
        <div class="swatches">
          ${PALETTES.map((p) => `
            <button class="swatch ${now.palette === p.id ? 'on' : ''}"
                    data-palette-pick="${p.id}" data-palette="${p.id}">
              <!--
                A miniature of the actual interface, not three colour bars.
                Grant: *"your sample palettes and textures don't look like
                anything"* — and he was right: three chips tell you the hues
                exist, not what living in them is like. This is a ground, a
                card on it, two lines of type and the accent, at 1/8 scale.
              -->
              <span class="mini">
                <span class="mini-card">
                  <span class="mini-art"></span>
                  <span class="mini-l1"></span>
                  <span class="mini-l2"></span>
                </span>
                <span class="mini-btn"></span>
              </span>
              <b>${esc(p.name)}</b>
              <span class="t-meta">${esc(p.note)}</span>
            </button>`).join('')}
        </div>
      </div>

      <div class="setgroup">
        <span class="t-label">Texture</span>
        <div class="swatches">
          ${TEXTURES.map((t) => `
            <button class="swatch ${now.texture === t.id ? 'on' : ''}"
                    data-texture-pick="${t.id}">
              <span class="texpreview" data-texture="${t.id}"><i></i></span>
              <b>${esc(t.name)}</b>
              <span class="t-meta">${esc(t.note)}</span>
            </button>`).join('')}
        </div>
      </div>

      <div class="setgroup">
        <span class="t-label">Your own texture</span>
        <div class="ownrow">
          ${now.own ? `<button class="swatch ${now.texture === 'own' ? 'on' : ''}"
              data-texture-pick="own" style="max-width:180px">
              <span class="texpreview" style="background-image:url('${now.own}');
                    background-size:cover"></span>
              <b>${esc(now.ownName || 'Uploaded')}</b>
              <span class="t-meta">Yours</span>
            </button>` : ''}
          <label class="dropzone">
            <input type="file" accept="image/*" data-texture-file hidden>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
              <path d="M12 16V4M12 4L7 9M12 4l5 5"/><path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"/></svg>
            <span><b>Upload a texture</b>
              <span class="t-meta">Any image. It is shrunk and stored on this device.</span></span>
          </label>
          ${now.own ? '<button class="link add" data-texture-clear>Remove</button>' : ''}
        </div>
        <p class="t-meta" id="texerr" hidden></p>
      </div>

      <p class="t-meta" style="margin-top:var(--s4)">Light and dark follow your system
        setting. Every palette has both.</p>
    </div>
    <button class="close" aria-label="Close">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
    </button>`

  const pick = (key, value) => {
    apply({ ...appearance(), [key]: value })
    settingsSheet()          // redraw so the tick moves
    sheet(v, true)
  }
  for (const b of v.querySelectorAll('[data-palette-pick]')) {
    b.addEventListener('click', () => pick('palette', b.dataset.palettePick))
  }
  for (const b of v.querySelectorAll('[data-texture-pick]')) {
    b.addEventListener('click', () => pick('texture', b.dataset.texturePick))
  }
  const file = $('[data-texture-file]', v)
  file?.addEventListener('change', async () => {
    const chosen = file.files?.[0]
    if (!chosen) return
    const err = $('#texerr', v)
    err.hidden = true
    const out = await readTexture(chosen)
    if (out.error) { err.textContent = out.error; err.hidden = false; return }
    apply({ ...appearance(), texture: 'own', own: out.data, ownName: out.name })
    settingsSheet()
    sheet(v, true)
  })
  $('[data-texture-clear]', v)?.addEventListener('click', () => {
    apply({ ...appearance(), texture: 'plaster', own: null, ownName: '' })
    settingsSheet()
    sheet(v, true)
  })

  $('.close', v).addEventListener('click', () => { sheet(v, false) })
  v.addEventListener('click', (e) => { if (e.target === v) sheet(v, false) })
}

/*
  The time of day, as one number (#23 idea 7).

  0 at the coolest part of the morning, 1 at the warmest part of the evening,
  and the CSS mixes two washes from it. One variable rather than six blocks of
  CSS, because "warmer as the day goes on" is a curve, not five states.

  Re-read every ten minutes. Nobody watches it change and that is the point:
  it should only ever be noticed as the app not feeling the same at 9pm as it
  did at 9am.
*/
function clock() {
  const set = () => {
    const h = new Date().getHours() + new Date().getMinutes() / 60
    // Coolest around 09:00, warmest around 20:00, wrapping through the night.
    const warm = 0.5 - 0.5 * Math.cos(((h - 9 + 24) % 24) / 24 * 2 * Math.PI)
    document.body.style.setProperty('--hour-warm', warm.toFixed(3))
  }
  set()
  setInterval(set, 600_000)
}

/** Remembered, because a person who collapses a sidebar means it. */
const railShut = () => {
  try { return localStorage.getItem('studio.rail') === 'shut' } catch { return false }
}

function render() {
  const root = $('#root')
  root.classList.toggle('shut', railShut())
  root.innerHTML = rail() + (
    state.view === 'project' ? dashboard()
    : state.view === 'desk' ? desk()
    : state.view === 'people' ? projectPeople()
    : portfolio())
  // The room takes its colour from whatever is in front of you.
  ambient(state.view === 'project' ? byId(state.project).hue : PROJECTS[0].hue)
  breathe(root)
  scatter(root)

  for (const b of root.querySelectorAll('[data-go]')) {
    b.addEventListener('click', () => {
      carry(null, null, () => { state.view = b.dataset.go; state.label = null; render() })
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

  for (const b of root.querySelectorAll('[data-people]')) {
    b.addEventListener('click', () => {
      carry(null, null, () => { state.project = b.dataset.people; state.view = 'people'; state.label = null; render() })
    })
  }

  $('[data-rail]', root)?.addEventListener('click', () => {
    try { localStorage.setItem('studio.rail', railShut() ? 'open' : 'shut') } catch { /* fine */ }
    render()
  })
  $('[data-call]', root)?.addEventListener('click', () => {
    // The prototype has no call; saying so is better than a dead button.
    const s = $('.talkstate', root)
    if (s) s.textContent = 'Calling Claire…'
  })

  for (const b of root.querySelectorAll('[data-settings]')) {
    b.addEventListener('click', () => { settingsSheet(); sheet($('#settings'), true) })
  }

  for (const b of root.querySelectorAll('[data-filter]')) {
    b.addEventListener('click', () => { state.label = b.dataset.filter || null; render() })
  }
  for (const b of root.querySelectorAll('[data-label-edit]')) {
    b.addEventListener('click', () => { labelEditor() })
  }
  for (const b of root.querySelectorAll('[data-person]')) {
    tiltable(b, { max: 4 })
    b.addEventListener('click', () => {
      const c = byId(state.project).contacts.find((x) => x.name === b.dataset.person)
      if (c) openContact(c)
    })
  }

  for (const b of root.querySelectorAll('[data-contact]')) {
    b.addEventListener('click', () => openContact(byId(state.project).contacts[Number(b.dataset.contact)]))
  }

  /*
    Real pages, over the drawn ones.

    The drawn page is already in the DOM, so the gallery is complete before any
    PDF is fetched; each real render lands on top when it is ready. Nothing
    jumps, nothing is empty, and a file that will not parse simply never
    replaces its drawing.
  */
  /*
    The shelf's buttons move by one card plus its gap, so a press lands on a
    document rather than an arbitrary 300px into the row. `scrollBy` with
    smooth behaviour inherits the platform's own easing, which is closer to
    right than anything hand-rolled.
  */
  const surface = $('[data-surface]', root)
  if (surface) {
    canvasView.wire(surface, canvasView.positions(PROJECTS), null)
    for (const card of surface.querySelectorAll('[data-card]')) {
      card.addEventListener('click', () => {
        if (card.classList.contains('lifted')) return
        carry(null, null, () => { state.project = card.dataset.card; state.view = 'project'; render() })
      })
    }
  }

  const shelf = $('[data-shelf]', root)
  if (shelf) {
    const step = () => (shelf.firstElementChild?.getBoundingClientRect().width ?? 200) + 20
    $('[data-shelf-back]', root)?.addEventListener('click', () =>
      shelf.scrollBy({ left: -step() * 2, behavior: 'smooth' }))
    $('[data-shelf-on]', root)?.addEventListener('click', () =>
      shelf.scrollBy({ left: step() * 2, behavior: 'smooth' }))
  }

  for (const [i, b] of [...root.querySelectorAll('[data-doc]')].entries()) {
    const doc = byId(state.project).documents[Number(b.dataset.doc)]
    if (doc?.file) paint($('.page', b), doc.file, 320)
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
      ${(() => {
        const extra = people.fieldsOn(c.name)
        return extra.length === 0 ? '' : `<div class="fields">${extra.map((f, i) =>
          `<div class="field">
             <span class="t-label">${esc(f.label)}</span>
             <span class="withx">${esc(f.value)}
               <button class="x" data-drop-field="${i}" aria-label="Remove ${esc(f.label)}">×</button>
             </span>
           </div>`).join('')}</div>`
      })()}

      <!--
        Adding a field.

        Grant: *"metadata fields should be dynamically added/removed on the UI
        anyway"*. Two inputs and a button rather than a modal, because the whole
        interaction is "this person has a Zoom handle and there is nowhere to
        put it" and anything heavier than typing it in place is in the way.
      -->
      <form class="addfield" data-add-field>
        <input name="label" placeholder="Field name" aria-label="Field name" maxlength="32">
        <input name="value" placeholder="Value" aria-label="Value" maxlength="120">
        <button class="btn" type="submit">Add field</button>
      </form>

      <div class="field" style="margin-top:var(--s4);align-items:flex-start">
        <span class="t-label">Labels</span>
        <span class="tagpick">
          ${people.labels().map((l) => {
            const on = people.labelsOn(c.name).some((x) => x.id === l.id)
            return `<button class="tag ${l.hue} ${on ? 'on' : 'off'}"
                     data-toggle-label="${l.id}">${esc(l.name)}</button>`
          }).join('')}
          <button class="tag add" data-label-edit>Edit labels</button>
        </span>
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
  carry(null, null, () => { sheet(v, true) })
  $('.close', v).addEventListener('click', () => { sheet(v, false) })
  v.addEventListener('click', (e) => { if (e.target === v) sheet(v, false) })

  for (const b of v.querySelectorAll('[data-toggle-label]')) {
    b.addEventListener('click', () => {
      people.toggleLabel(c.name, b.dataset.toggleLabel)
      openContact(c)            // redraw the sheet
      render()                  // and the rows behind it
      sheet($('#viewer'), true)
    })
  }
  for (const b of v.querySelectorAll('[data-drop-field]')) {
    b.addEventListener('click', () => {
      people.removeField(c.name, Number(b.dataset.dropField))
      openContact(c)
      sheet($('#viewer'), true)
    })
  }
  const form = $('[data-add-field]', v)
  form?.addEventListener('submit', (e) => {
    e.preventDefault()
    const label = form.label.value.trim()
    const value = form.value.value.trim()
    if (label === '') return
    people.addField(c.name, label, value)
    openContact(c)
    sheet($('#viewer'), true)
  })
  for (const b of v.querySelectorAll('[data-label-edit]')) {
    b.addEventListener('click', () => { labelEditor(() => { openContact(c); sheet($('#viewer'), true) }) })
  }
}

/*
  Defining the labels themselves.

  Grant: *"let me define those labels myself in the UI"*. Rename in place,
  delete, add — and deleting one takes it off everybody rather than leaving an
  id nothing resolves. Colour is picked from the same six project hues, so a
  label he invents looks like it belongs.
*/
function labelEditor(after) {
  const v = $('#settings')
  const draw = () => {
    v.innerHTML = `<div class="sheet">
        <h2 class="t-title" style="margin:0">Labels</h2>
        <p class="t-meta" style="margin:6px 0 var(--s4)">Yours to name. Deleting one removes
          it from everybody.</p>
        <div class="labellist">
          ${people.labels().map((l) => `
            <div class="labelrow ${l.hue}">
              <span class="swatchdot"></span>
              <input value="${esc(l.name)}" data-rename="${l.id}" aria-label="Label name" maxlength="24">
              <button class="x" data-remove="${l.id}" aria-label="Delete ${esc(l.name)}">×</button>
            </div>`).join('')}
        </div>
        <form class="addfield" data-add-label style="margin-top:var(--s4)">
          <input name="name" placeholder="New label" aria-label="New label" maxlength="24">
          <button class="btn primary" type="submit">Add</button>
        </form>
      </div>
      <button class="close" aria-label="Close">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>`

    for (const i of v.querySelectorAll('[data-rename]')) {
      i.addEventListener('change', () => { people.renameLabel(i.dataset.rename, i.value.trim() || 'Label') })
    }
    for (const b of v.querySelectorAll('[data-remove]')) {
      b.addEventListener('click', () => { people.removeLabel(b.dataset.remove); draw() })
    }
    const f = $('[data-add-label]', v)
    f?.addEventListener('submit', (e) => {
      e.preventDefault()
      const name = f.name.value.trim()
      if (name === '') return
      people.addLabel(name)
      draw()
    })
    $('.close', v).addEventListener('click', () => { sheet(v, false); render(); after?.() })
  }
  draw()
  sheet(v, true)
}

function openDoc(doc, from) {
  const v = $('#viewer')
  v.innerHTML = `<div class="sheet">
      <div class="t-label">${esc(doc.origin)}</div>
      <h2 class="t-title" style="margin:var(--s2) 0 var(--s3)">${esc(doc.title)}</h2>
      <p class="t-meta">${esc(doc.size)}</p>
      <div class="bigpage" data-bigpage>${pageSvg(doc.title, doc.kind)}</div>
    </div>
    <button class="close" aria-label="Close">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
    </button>`
  if (doc.file) paint($('[data-bigpage]', v), doc.file, 760)
  const page = $('.page', from)
  carry('doc-open', page, () => { sheet(v, true) })
  $('.close', v).addEventListener('click', () => carry('doc-open', page, () => { sheet(v, false) }))
  v.addEventListener('click', (e) => {
    if (e.target === v) carry('doc-open', page, () => { sheet(v, false) })
  })
}

apply()
clock()
render()
