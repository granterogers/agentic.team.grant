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
import * as chat from './chat.js'
import * as workspace from './workspace.js'
import * as panels from './panels.js'
import * as people from './people.js'
import { ambient, breathe, scatter, tiltable } from './alive.js'
import { coverSvg } from './cover.js'
import { pageSvg } from './page.js'
import { paint } from './pdf.js'
import { SPRING, carry, pressable, spring } from './motion.js'

const $ = (sel, root = document) => root.querySelector(sel)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

const state = {
  view: 'portfolio', project: null, done: new Set(), label: null,
  // The project's sections (#30). Overview is the default: the specification
  // opens on Current Focus and Project Status, not on a file list.
  tab: 'overview',
  // Which of AI Team's four you are looking at.
  sub: 'board',
  // The item a chat message is about (#27), until it is sent or removed.
  attach: null,
}

/*
  The sections of a project, from the verbatim specification.

  `docs/spec/project-dashboard-ia-2026-09-10.md` — Grant's own left-hand
  navigation: Overview · AI Team · Documents · Tasks · Contacts · Sources ·
  Activity, with Project Settings top-right.

  The first version of this was Board · Team · Chat · People, built against a
  reconstruction of that document while the original was unrecoverable. It was
  wrong in a way worth naming: it made Chat a peer of Documents. The hierarchy
  is the claim that *"the Agentic Team is a first-class part of each Project
  rather than a separate application"*, and a chat tab sitting beside a
  documents tab says the opposite — that it is a messaging feature bolted on.
  So Chat moves inside AI Team, where he put it.
*/
const SECTIONS = [
  { id: 'overview', name: 'Overview' },
  { id: 'team', name: 'AI Team' },
  { id: 'documents', name: 'Documents' },
  { id: 'tasks', name: 'Tasks' },
  { id: 'contacts', name: 'Contacts' },
  { id: 'sources', name: 'Sources' },
  { id: 'activity', name: 'Activity' },
]

/*
  AI Team's own four, also his:

      ├── Team Board      who is on this project
      ├── Team Chat       ask one / selected / everyone
      ├── Active Jobs     running · waiting-blocked · completed
      └── Agent Outputs   reports · research · plans · files → IMPORT

  Two levels, never three — *"minimal navigation depth"*.
*/
const TEAM_VIEWS = [
  { id: 'board', name: 'Team board' },
  { id: 'chat', name: 'Chat' },
  { id: 'jobs', name: 'Active jobs' },
  { id: 'outputs', name: 'Outputs' },
]

const tabFor = (slug) => {
  try { return JSON.parse(localStorage.getItem('studio.tab') ?? '{}')[slug] ?? 'overview' }
  catch { return 'overview' }
}
const rememberTab = (slug, tab) => {
  try {
    const all = JSON.parse(localStorage.getItem('studio.tab') ?? '{}')
    all[slug] = tab
    localStorage.setItem('studio.tab', JSON.stringify(all))
  } catch { /* not fatal */ }
}

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

/*
  "Talk to the team about this" (#27).

  Grant: *"each item (Docs, contacts, todo, etc) has a little button to 'talk to
  the team about this' and I can send a message that takes the item as context"*.

  One component, so a new item type gets it for nothing. Two details that are
  the whole point rather than polish:

  - It is a SIBLING of the card, not a child. The cards are `<button>`, and a
    button inside a button is invalid and behaves differently in every browser.
  - It carries `kind` and `id`, not a sentence. When this reaches the backend
    the job gets the id; a description would have to be parsed back.
*/
const talkBtn = (kind, id, title) => `
  <button class="talkabout" data-talk-kind="${esc(kind)}" data-talk-id="${esc(id)}"
          data-talk-title="${esc(title)}"
          title="Talk to the team about this" aria-label="Talk to the team about ${esc(title)}">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.9-.9L3 20.5l1.6-4.7A8.4 8.4 0 0 1 3.6 11 8.4 8.4 0 0 1 12 2.6a8.4 8.4 0 0 1 9 8.9z"/>
    </svg>
  </button>`

/** A card and its talk action, side by side rather than nested. */
const withTalk = (html, kind, id, title) =>
  `<span class="withtalk">${html}${talkBtn(kind, id, title)}</span>`

const docCard = (d, i) => withTalk(`
  <button class="doc" data-doc="${i}">
    ${cover(d)}
    <span style="font-weight:500;font-size:13px;line-height:1.35">${esc(d.title)}</span>
    <span class="t-meta" style="font-size:12px">${esc(d.origin)} · ${esc(d.size)}</span>
  </button>`, 'document', String(i), d.title)

/*
  Every document the project actually has.

  Its own, plus the artifacts the team made that Grant has approved. Everything
  downstream — the shelf, the viewer, the counts — reads this rather than
  `p.documents`, so approving something in Team makes it appear here with no
  second code path.
*/
const allDocs = (p) => [
  ...p.documents,
  ...workspace.approved(p).map((r) => ({
    ...r.output, origin: `${crewBy(r.who).name} · ${r.delivered}`,
  })),
]

const taskRow = (t, i) => {
  const done = t.state === 'done' || state.done.has(i)
  const who = t.who ? crewBy(t.who) : null
  return withTalk(`<button class="task ${done ? 'done' : ''}" data-task="${i}">
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
  </button>`, 'task', String(i), t.title)
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
          <button class="navitem sub ${
            state.view === 'project' && state.tab === 'contacts' ? 'on' : ''
          }" data-people="${p.slug}">
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
  return withTalk(`<button class="contact ${c.hue}" data-contact="${i}">
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
  </button>`, 'contact', String(i), c.name)
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
    <div class="deskstage">
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

function peopleTab(p) {
  const defined = people.labels()
  const chosen = state.label
  const shown = chosen === null
    ? p.contacts
    : p.contacts.filter((c) => people.labelsOn(c.name).some((l) => l.id === chosen))

  return `<div class="tabbody">
    <div class="tabhead">
      <p class="t-lead" style="margin:0">Everyone on ${esc(p.name)}.
        Labels are yours — rename them, add your own, delete the ones you do not use.</p>
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
  </div>`
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

/*
  The contents of each panel.

  Split out of `dashboard()` so a panel is a thing that can be positioned,
  removed and re-added, rather than a section that happens to be in a fixed
  order. Each takes the project and returns its inside; the chrome — title,
  grip, controls — is the same for all of them.
*/
const PANEL = {
  modules: (p) => p.modules.length === 0
    ? `<p class="t-meta">No modules on this project.</p>`
    : `<div class="modgrid">${p.modules.map((m) => `
        <div class="module" style="--dot:${
          m.state === 'done' ? 'var(--good)' : m.state === 'doing' ? 'var(--warn)' : 'var(--ink-3)'
        }">
          <div class="t-label" style="color:${
            m.state === 'done' ? 'var(--good)' : m.state === 'doing' ? 'var(--warn)' : 'var(--ink-3)'
          }">${m.state === 'done' ? 'Done' : m.state === 'doing' ? 'In hand' : 'Not started'}</div>
          <div style="font-weight:600;font-size:14px;margin-top:5px;line-height:1.35">${esc(m.name)}</div>
          <div class="t-meta" style="margin-top:4px">${m.docs} docs · ${m.tasks} tasks</div>
          ${talkBtn('module', String(m.n), m.name)}
        </div>`).join('')}</div>`,

  /*
    The shelf, plus whatever Grant has approved out of the Team tab.

    This is the other half of the review gate (#28): an artifact the team made
    is nowhere near the project's documents until it is approved, and the moment
    it is, it is simply a document. Two shelves for "yours" and "approved" would
    put the in-tray back in the library.
  */
  documents: (p) => {
    const docs = allDocs(p)
    return docs.length === 0
      ? `<p class="t-meta">Nothing here yet. Drop a file, or ask the team to make one.</p>`
      : `<div class="shelf" data-shelf>${docs.map(docCard).join('')}</div>`
  },

  tasks: (p) => `<div class="tasks">${p.tasks.map(taskRow).join('')}</div>`,

  contacts: (p) => p.contacts.length === 0
    ? `<p class="t-meta">Nobody on this project yet.</p>`
    : `<div class="contacts">${p.contacts.map(contactCard).join('')}</div>`,

  activity: (p) => `<div class="tasks">${p.activity.map((a) => {
    const c = crewBy(a.who)
    return `<div class="task" style="cursor:default">${face(c, 22)}
      <span class="label t-meta" style="color:var(--ink)">
        <b style="font-weight:600">${esc(c.name)}</b> ${esc(a.verb)} ${esc(a.what)}
        <span style="color:var(--ink-3)"> · ${esc(a.when)}</span></span></div>`
  }).join('')}</div>`,

  links: (p) => `<div class="links" style="margin:0">
      ${p.connectors.length === 0
        ? '<span class="t-meta">Nothing yet — this project stands on its own.</span>'
        : p.connectors.map((c) => `<span class="link">${esc(c)}</span>`).join('')}
      <button class="link add">+ Connect something</button>
    </div>`,

  note: () => `<textarea class="notepad" placeholder="Anything you want to remember about
this project…" aria-label="Note"></textarea>`,
}


/*
  The team's in-tray (#28).

  A request and the artifact it produced are one row, because the question a
  produced file has to answer is *why does this exist* — and neither an activity
  feed (outputs without requests) nor a job queue (requests without outputs)
  answers it.

  Waiting first. Approving is what moves an artifact into the project; until
  then the project does not have it. That gate is the substance of Grant's word
  "coordinated" — the two columns are just how you see it.
*/
function teamTab(p) {
  const { all, waiting, working, settled } = workspace.split(p)
  const crewHere = [...new Set(all.map((r) => r.who))].map(crewBy)

  if (all.length === 0) {
    return `<div class="tabbody"><div class="empty">
      <p class="t-meta">The team has nothing in hand on ${esc(p.name)} and has made nothing
        for it yet. Ask for something in Chat, or press the talk button on any item.</p>
      <button class="btn primary" data-tab="chat">Open the chat</button>
    </div></div>`
  }

  const row = (r) => {
    const c = crewBy(r.who)
    const st = workspace.STATE[r.state] ?? workspace.STATE.working
    return `<article class="wrow ${st.hue}" data-row="${esc(r.id)}">
      <div class="wask">
        <span class="t-label">Asked · ${esc(r.asked)}</span>
        <p>${esc(r.ask)}</p>
        <span class="t-meta">${esc(r.from)}${
          r.context ? ` · about ${esc(r.context.title)}` : ''}</span>
      </div>
      <div class="warrow" aria-hidden="true">
        ${face(c, 30)}
        <svg width="34" height="10" viewBox="0 0 34 10" fill="none" stroke="var(--ink-3)"
             stroke-width="1.4" stroke-linecap="round"><path d="M1 5h28M25 1l4 4-4 4"/></svg>
      </div>
      <div class="wout">
        <span class="stage s-${esc(r.state)}">${esc(st.name)}</span>
        ${r.output === null || r.output === undefined
          ? `<p class="t-meta">${esc(c.name)} is on it. Nothing to look at yet.</p>`
          : `<div class="woutfile">
              <span class="wpage">${pageSvg(r.output.title, r.output.kind)}</span>
              <span>
                <b>${esc(r.output.title)}</b>
                <span class="t-meta">${esc(c.name)} · ${esc(r.delivered)} · ${esc(r.output.size)}</span>
                ${r.derived.length === 0 ? '' :
                  `<span class="t-meta from">From ${esc(r.derived.join(', '))}</span>`}
              </span>
            </div>`}
        <div class="wctl">
          ${r.state === 'review' ? `
            <button class="btn primary" data-decide="approve" data-row-id="${esc(r.id)}">Add to project</button>
            <button class="btn" data-decide="discard" data-row-id="${esc(r.id)}">Drop</button>` : ''}
          ${r.state === 'approved' || r.state === 'discarded'
            ? `<button class="btn" data-decide="reopen" data-row-id="${esc(r.id)}">Undo</button>` : ''}
          ${talkBtn('request', r.id, r.ask)}
        </div>
      </div>
    </article>`
  }

  const group = (name, note, rows2) => rows2.length === 0 ? '' : `
    <section class="wgroup">
      <h3 class="t-label">${esc(name)} <span class="n">${rows2.length}</span></h3>
      <p class="t-meta" style="margin:0 0 var(--s3)">${esc(note)}</p>
      ${rows2.map(row).join('')}
    </section>`

  return `<div class="tabbody">
    <div class="tabhead">
      <p class="t-lead" style="margin:0">What the team was asked, and what came back.
        Nothing they make joins ${esc(p.name)} until you say so.</p>
      <div class="crew" style="margin:0">${crewHere.map((c) => face(c)).join('')}</div>
    </div>
    ${group('Needs you', 'Finished, and waiting on your decision.', waiting)}
    ${group('In hand', 'Being worked on now.', working)}
    ${group('Settled', 'Already decided.', settled)}
  </div>`
}

/*
  The chat (#26).

  The same conversation as the call button, in the mode you use when you cannot
  talk or when you want a record. Per project, and it carries the attached item
  as a visible, removable chip — invisible context is context you cannot trust.

  The replies here are marked `pending`, and the UI says so, because the
  prototype has no team behind it. Faking a plausible answer would make the
  prototype prove something that is not true.
*/
function chatTab(p) {
  const messages = chat.thread(p.slug)
  const a = state.attach

  const bubble = (m) => {
    if (m.from === 'grant') {
      return `<div class="msg mine">
        ${m.context ? `<span class="ctxchip">${esc(m.context.title)}</span>` : ''}
        <p>${esc(m.text)}</p>
      </div>`
    }
    const c = crewBy(m.from)
    return `<div class="msg theirs">
      ${face(c, 30)}
      <div class="mbody">
        <span class="t-label">${esc(c.name)} · ${esc(c.role)}</span>
        <p>${esc(m.text)}</p>
        ${m.pending ? `<span class="t-meta pendmark">Prototype — no team behind this yet.
          Wired up, this becomes a job you can watch in Team.</span>` : ''}
      </div>
    </div>`
  }

  return `<div class="tabbody chatbody">
    <div class="thread" data-thread>
      ${messages.length === 0
        ? `<div class="empty">
            <p class="t-meta">Nothing said about ${esc(p.name)} yet. Ask for something, or
              press the talk button on any document, person or task to start with that
              already attached.</p>
          </div>`
        : messages.map(bubble).join('')}
    </div>
    <form class="composer" data-composer>
      ${a === null ? '' : `<div class="attached">
        <span class="t-label">About</span>
        <span class="ctxchip">${esc(a.title)}
          <button type="button" data-unattach aria-label="Remove ${esc(a.title)}">×</button>
        </span>
      </div>`}
      <div class="crow">
        <textarea data-say rows="1" placeholder="Ask the team, or tell them what to do…"
                  aria-label="Message the team"></textarea>
        <button class="btn primary" type="submit">Send</button>
      </div>
    </form>
  </div>`
}


/*
  Team board — who is on this project.

  The specification lists roles (Chief of Staff, Research, Development, QA), not
  the eight named staff this office actually has. The staff ARE those roles, so
  this shows the real people rather than inventing a second vocabulary — but it
  says what each is doing here, because a board that only lists names is the
  "eight identical dots" the portraits were introduced to replace.
*/
function teamBoard(p) {
  const here = new Set((p.requests ?? []).map((r) => r.who))
  for (const a of p.activity) here.add(a.who)
  const onIt = CREW.filter((c) => here.has(c.slug))
  const rest = CREW.filter((c) => !here.has(c.slug))

  const jobsFor = (slug) => (p.requests ?? []).filter((r) => r.who === slug)

  const memberCard = (c, active) => {
    const mine = jobsFor(c.slug)
    const open = mine.filter((r) => r.state === 'working' || r.state === 'review')
    return `<article class="member ${c.hue} ${active ? '' : 'quiet'}">
      ${face(c, 42)}
      <div class="mwho">
        <b>${esc(c.name)}</b>
        <span class="t-meta">${esc(c.role)}</span>
        <span class="t-meta from">${
          active
            ? open.length > 0
              ? `${open.length} open on this project`
              : `${mine.length} finished here`
            : 'Not working on this project'
        }</span>
      </div>
      ${talkBtn('agent', c.slug, c.name)}
    </article>`
  }

  return `<div class="tabbody">
    <div class="tabhead">
      <p class="t-lead" style="margin:0">Who is on ${esc(p.name)}. Press the
        talk button on anyone to give them something.</p>
    </div>
    <div class="members">${onIt.map((c) => memberCard(c, true)).join('')}</div>
    ${rest.length === 0 ? '' : `
      <h3 class="t-label" style="margin:var(--s3) 0 0">Available</h3>
      <div class="members">${rest.map((c) => memberCard(c, false)).join('')}</div>`}
  </div>`
}

/*
  Active jobs — running, waiting/blocked, completed.

  Waiting/blocked is the reason this section exists. The first version had two
  states, "in hand" and "needs you", and a job stuck on a missing credential
  read as in hand — which says the opposite of the truth about it. A blocked job
  states its blocker and offers the one action that clears it.
*/
function activeJobs(p) {
  const rows = workspace.rows(p)
  const running = rows.filter((r) => r.state === 'working' && r.blocked === undefined)
  const blocked = rows.filter((r) => r.blocked !== undefined)
  const done = rows.filter((r) => r.state !== 'working' && r.blocked === undefined)

  if (rows.length === 0) {
    return `<div class="tabbody"><div class="empty">
      <p class="t-meta">No jobs on ${esc(p.name)}. Ask for something in Chat, or
        press the talk button on any document, person or task.</p>
      <button class="btn primary" data-sub="chat">Open the chat</button>
    </div></div>`
  }

  const job = (r) => {
    const c = crewBy(r.who)
    return `<article class="job ${r.blocked !== undefined ? 'p-rust' : r.state === 'working' ? 'p-amber' : 'p-moss'}">
      ${face(c, 30)}
      <div class="jbody">
        <b>${esc(r.ask)}</b>
        <span class="t-meta">${esc(c.name)} · asked ${esc(r.asked)}${
          r.context ? ` · about ${esc(r.context.title)}` : ''}</span>
        ${r.blocked === undefined ? '' :
          `<span class="blocker">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="2" stroke-linecap="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.01"/></svg>
            ${esc(r.blocked)}</span>`}
      </div>
      ${r.blocked === undefined ? '' :
        `<button class="btn" data-unblock="${esc(r.id)}">${esc(r.unblock ?? 'Sort it out')}</button>`}
    </article>`
  }

  const group = (name, note, list) => list.length === 0 ? '' : `
    <section class="wgroup">
      <h3 class="t-label">${esc(name)} <span class="n">${list.length}</span></h3>
      <p class="t-meta" style="margin:0 0 var(--s3)">${esc(note)}</p>
      ${list.map(job).join('')}
    </section>`

  return `<div class="tabbody">
    ${group('Waiting on something', 'Stopped, and it will not start again on its own.', blocked)}
    ${group('Running', 'Being worked on now.', running)}
    ${group('Completed', 'Finished. What came back is under Outputs.', done)}
  </div>`
}

/*
  Sources — what this project points at.

  Two kinds, and the distinction is the point: a CONNECTOR is authenticated and
  syncs, so it has health and a last-read time and can fail; a REFERENCE is a
  pointer and can only be right or stale. Showing them identically would make a
  broken Notion connection look like a bookmark.
*/
function sources(p) {
  const list = p.sources ?? []
  if (list.length === 0) {
    return `<div class="tabbody"><div class="empty">
      <p class="t-meta">${esc(p.name)} stands on its own — nothing outside it feeds in.
        That is a fine state to be in.</p>
      <button class="btn">Point it at something</button>
    </div></div>`
  }
  return `<div class="tabbody">
    <div class="tabhead">
      <p class="t-lead" style="margin:0">What ${esc(p.name)} reads from. The project
        is the source of truth; these are optional attachments to it.</p>
      <button class="btn">Add a source</button>
    </div>
    <div class="sourcegrid">${list.map((x) => `
      <article class="source ${x.kind === 'connector' ? 'live' : ''}">
        <span class="t-label">${x.kind === 'connector' ? 'Connector' : 'Reference'}</span>
        <b>${esc(x.name)}</b>
        <span class="t-meta">${esc(x.what)}</span>
        <span class="srcfoot">
          ${x.kind === 'connector'
            ? `<span class="stage s-${x.health === 'ok' ? 'approved' : 'review'}">${
                x.health === 'ok' ? `Read ${esc(x.last)}` : esc(x.problem)}</span>`
            : `<span class="t-meta">${esc(x.last)}</span>`}
          ${x.gave > 0 ? `<span class="t-meta">${x.gave} documents</span>` : ''}
        </span>
      </article>`).join('')}</div>
  </div>`
}

/*
  Tasks, in the states the specification names.

  To-do · In progress · Waiting/blocked · Completed, and who each is assigned
  to — *"assigned to human"* and *"assigned to agent"* are two of his branches,
  so the face on a row is doing real work rather than decorating it.
*/
function tasksSection(p) {
  if (p.tasks.length === 0) {
    return `<div class="tabbody"><div class="empty">
      <p class="t-meta">Nothing to do on ${esc(p.name)} yet.</p>
      <button class="btn primary" data-sub="chat">Ask the team to find some</button>
    </div></div>`
  }
  const at = (t, i) => t.state === 'done' || state.done.has(i) ? 'done'
    : t.blocked !== undefined ? 'blocked'
    : t.state === 'doing' ? 'doing' : 'todo'
  const rows = p.tasks.map((t, i) => ({ t, i, at: at(t, i) }))
  const group = (name, key, note) => {
    const list = rows.filter((r) => r.at === key)
    return list.length === 0 ? '' : `
      <section class="wgroup">
        <h3 class="t-label">${esc(name)} <span class="n">${list.length}</span></h3>
        ${note === '' ? '' : `<p class="t-meta" style="margin:0 0 var(--s3)">${esc(note)}</p>`}
        <div class="tasks">${list.map((r) => taskRow(r.t, r.i)).join('')}</div>
      </section>`
  }
  return `<div class="tabbody">
    <div class="tabhead">
      <p class="t-lead" style="margin:0">Everything open on ${esc(p.name)}, and who has it.</p>
      <button class="btn">Add a task</button>
    </div>
    ${group('Waiting or blocked', 'blocked', 'Cannot move until something else does.')}
    ${group('In progress', 'doing', '')}
    ${group('To do', 'todo', '')}
    ${group('Completed', 'done', '')}
  </div>`
}

/** The full document gallery, rather than a panel's worth of it. */
function documentsSection(p) {
  const docs = allDocs(p)
  if (docs.length === 0) {
    return `<div class="tabbody"><div class="empty">
      <p class="t-meta">Nothing in ${esc(p.name)} yet. Drop a file, or ask the team to make one.</p>
      <button class="btn primary" data-sub="chat">Ask the team</button>
    </div></div>`
  }
  return `<div class="tabbody">
    <div class="tabhead">
      <p class="t-lead" style="margin:0">${docs.length} in ${esc(p.name)}.
        Anything the team made is here only because you approved it.</p>
      <button class="btn">Add a document</button>
    </div>
    <div class="gallery">${docs.map(docCard).join('')}</div>
  </div>`
}

/** What happened, most recent first. */
function activitySection(p) {
  if (p.activity.length === 0) {
    return `<div class="tabbody"><div class="empty">
      <p class="t-meta">Nothing has happened on ${esc(p.name)} yet.</p>
    </div></div>`
  }
  return `<div class="tabbody">
    <div class="tabhead">
      <p class="t-lead" style="margin:0">Who did what on ${esc(p.name)}, and what came of it.</p>
    </div>
    <div class="tasks">${PANEL.activity(p)}</div>
  </div>`
}


function dashboard() {
  const p = byId(state.project)
  const mine = panels.layout(p)
  const spare = panels.KINDS.filter((k) => !mine.some((m) => m.id === k.id))

  const chrome = (spec) => {
    const kind = panels.KINDS.find((k) => k.id === spec.id)
    if (!kind) return ''
    return `<section class="panel" data-panel="${spec.id}"
             style="left:calc((100% - 40px)/3 * ${spec.x} + ${spec.x} * 20px);
                    top:${spec.y}px;
                    width:calc((100% - 40px)/3 * ${spec.w} + ${(spec.w - 1) * 20}px);
                    height:${spec.h}px">
      <header data-grip>
        <h3 class="t-label">${esc(kind.name)}</h3>
        <span class="pctl">
          <button data-narrower aria-label="Narrower" title="Narrower">−</button>
          <button data-wider aria-label="Wider" title="Wider">+</button>
          <button data-drop-panel aria-label="Remove ${esc(kind.name)}" title="Remove">×</button>
        </span>
      </header>
      <div class="pbodywrap">${PANEL[spec.id]?.(p) ?? ''}</div>
    </section>`
  }

  const tallest = mine.reduce((m, s) => Math.max(m, s.y + s.h), 0)

  const board = `
    <!--
      Grant: *"this draggable area should be present within the project itself"*.
      Panels snap to a 24px grid AND to each other's edges, because "nicely
      arranged" means aligned and a bare grid does not guarantee that — two
      panels can both be on the grid and still be out of line with each other.
    -->
    <div class="tabbody">
      <div class="tabhead">
        <p class="t-lead" style="margin:0">Drag a panel by its title. Add what this
          project needs, drop what it does not.</p>
        <div class="headctl">
          ${spare.length === 0 ? '' : `<div class="addpanel">
            <button class="btn" data-add-open>+ Add panel</button>
            <div class="addmenu" data-add-menu hidden>
              ${spare.map((k) => `<button data-add="${k.id}">
                <b>${esc(k.name)}</b><span class="t-meta">${esc(k.note)}</span></button>`).join('')}
            </div>
          </div>`}
          <button class="btn" data-reset-panels title="Put the panels back">Reset</button>
        </div>
      </div>
      <div class="board" data-board style="height:${Math.max(tallest + 40, 520)}px">
        ${mine.map(chrome).join('')}
      </div>
    </div>`

  /*
    Seven sections, and AI Team's four inside it (#30).

    The counts on the section buttons are how Grant learns something is waiting
    without opening anything — which is the whole reason the specification puts
    an operational overview first rather than a file list.
  */
  const waiting = workspace.split(p).waiting.length
  const blocked = workspace.rows(p).filter((r) => r.blocked !== undefined).length
  const openTasks = p.tasks.filter((t, i) => t.state !== 'done' && !state.done.has(i)).length
  const counts = {
    team: waiting + blocked,
    documents: allDocs(p).length,
    tasks: openTasks,
    contacts: p.contacts.length,
    sources: (p.sources ?? []).length,
  }

  const teamBody =
    state.sub === 'chat' ? chatTab(p)
    : state.sub === 'jobs' ? activeJobs(p)
    : state.sub === 'outputs' ? teamTab(p)
    : teamBoard(p)

  const teamCounts = {
    jobs: blocked,
    outputs: waiting,
  }

  const team = `
    <div class="subnav" role="tablist" aria-label="AI Team">
      ${TEAM_VIEWS.map((v) => `<button role="tab" class="subtab ${state.sub === v.id ? 'on' : ''}"
          aria-selected="${state.sub === v.id}" data-sub="${v.id}">${esc(v.name)}${
            teamCounts[v.id] > 0 ? `<span class="n">${teamCounts[v.id]}</span>` : ''
          }</button>`).join('')}
    </div>
    ${teamBody}`

  const body =
    state.tab === 'team' ? team
    : state.tab === 'documents' ? documentsSection(p)
    : state.tab === 'tasks' ? tasksSection(p)
    : state.tab === 'contacts' ? peopleTab(p)
    : state.tab === 'sources' ? sources(p)
    : state.tab === 'activity' ? activitySection(p)
    : board

  return `<main class="main">
    <div class="hero ${p.hue}" style="view-transition-name:cover-${p.slug}">
      ${coverSvg(p.slug, { dense: true, facts: p })}
    </div>
    <div class="head">
      <div>
        <h1 class="t-display" style="font-size:38px">${esc(p.name)}</h1>
        <p class="t-lead" style="margin:var(--s2) 0 0">${esc(p.purpose)}</p>
      </div>
      <div class="headctl">
        <div class="crew" style="margin:0">${p.activity.map((a) => face(crewBy(a.who))).join('')}</div>
        <button class="btn primary" data-tab="team" data-sub="chat">Talk to the team</button>
        <!-- Project Settings, top-right, where the specification's sketch puts it. -->
        <button class="btn" data-project-settings title="Project settings"
                aria-label="Project settings">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3.2"/>
            <path d="M12 2.5v2.2M12 19.3v2.2M21.5 12h-2.2M4.7 12H2.5M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6M18.7 18.7l-1.6-1.6M6.9 6.9L5.3 5.3"/>
          </svg>
        </button>
      </div>
    </div>

    <div class="tabs" role="tablist" aria-label="${esc(p.name)}">
      ${SECTIONS.map((t) => `<button role="tab" class="tab ${state.tab === t.id ? 'on' : ''}"
          aria-selected="${state.tab === t.id}" data-tab="${t.id}">${esc(t.name)}${
            counts[t.id] > 0 ? `<span class="n">${counts[t.id]}</span>` : ''
          }</button>`).join('')}
    </div>

    ${body}
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
      carry(null, null, () => {
        state.project = b.dataset.open
        state.view = 'project'
        state.tab = tabFor(state.project)
        // An attachment belongs to the project you were in. Carrying it across
        // would put a Legacy document on a Wellness message.
        state.attach = null
        render()
      })
    })
  }

  /*
    Everything that lifts, tilts.

    One place, one list. The section work added five card types and none of them
    got this, so the team board and the in-tray sat flat in a product where
    every other card responds to the pointer — which reads as those screens
    being unfinished rather than as restraint.

    The angles are smaller than a project card's. A project card is an object
    you pick up; a job row is a line you read, and tilting it as far would turn
    a list into a fairground.
  */
  const TILT = [
    ['.module', { max: 3, scale: 1.006 }],
    ['.member', { max: 3.4, scale: 1.008 }],
    ['.job', { max: 2.2, scale: 1.004 }],
    ['.source', { max: 4, scale: 1.01 }],
    ['.wrow', { max: 1.8, scale: 1.003 }],
  ]
  for (const [sel, opts] of TILT) {
    for (const el of root.querySelectorAll(sel)) tiltable(el, opts)
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

  // The rail reaches People per project — which is now a tab on that project
  // rather than a view of its own, because People was never a separate place.
  for (const b of root.querySelectorAll('[data-people]')) {
    b.addEventListener('click', () => {
      carry(null, null, () => {
        state.project = b.dataset.people
        state.view = 'project'
        state.tab = 'contacts'
        state.label = null
        state.attach = null
        rememberTab(state.project, 'contacts')
        render()
      })
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
        carry(null, null, () => {
          state.project = card.dataset.card
          state.view = 'project'
          state.tab = tabFor(state.project)
          state.attach = null
          render()
        })
      })
    }
  }

  /*
    Tabs, the talk action, the composer and the in-tray decisions.

    All four are wired here rather than in their renderers because a full
    re-render replaces every node — a listener attached inside a template
    function would be lost on the next paint and silently stop working, which is
    exactly how the deleted `everyone()` bug hid for two commits.
  */
  for (const b of root.querySelectorAll('[data-tab]')) {
    b.addEventListener('click', () => {
      state.tab = b.dataset.tab
      // "Talk to the team" is one press: it selects AI Team AND its Chat view.
      if (b.dataset.sub !== undefined) state.sub = b.dataset.sub
      rememberTab(state.project, state.tab)
      render()
    })
  }

  // AI Team's own four. A bare data-sub also means "go to AI Team", so the
  // empty states can send you to the chat from anywhere.
  for (const b of root.querySelectorAll('[data-sub]:not([data-tab])')) {
    b.addEventListener('click', () => {
      state.sub = b.dataset.sub
      state.tab = 'team'
      rememberTab(state.project, 'team')
      render()
    })
  }

  /*
    A blocked job's one action.

    The prototype cannot actually clear a blocker, and pretending otherwise
    would be the lying button again — so it says what would happen and to whom.
  */
  for (const b of root.querySelectorAll('[data-unblock]')) {
    b.addEventListener('click', () => {
      const row = workspace.rows(byId(state.project)).find((r) => r.id === b.dataset.unblock)
      state.attach = row === undefined ? null
        : { kind: 'request', id: row.id, title: row.ask }
      state.tab = 'team'
      state.sub = 'chat'
      rememberTab(state.project, 'team')
      render()
      const say = $('[data-say]')
      if (say !== null && row !== undefined) {
        say.value = `This is blocked on: ${row.blocked}. Can you sort it?`
        say.focus()
      }
    })
  }

  $('[data-project-settings]', root)?.addEventListener('click', () => {
    // #36. Not built yet, and saying so beats a sheet with nothing in it.
    const s2 = $('.talkstate', root)
    if (s2 !== null) s2.textContent = 'Project settings — not built yet (#36)'
  })

  /*
    "Talk to the team about this" (#27).

    `stopPropagation`, because the button sits beside a card that opens the
    document viewer and a bare click would do both. The attachment is put on
    state, the tab switches, and the composer takes focus — the whole action is
    one press and then typing.
  */
  for (const b of root.querySelectorAll('[data-talk-kind]')) {
    b.addEventListener('click', (e) => {
      e.stopPropagation()
      state.attach = {
        kind: b.dataset.talkKind, id: b.dataset.talkId, title: b.dataset.talkTitle,
      }
      state.tab = 'team'
      state.sub = 'chat'
      rememberTab(state.project, 'team')
      render()
      $('[data-say]')?.focus()
    })
  }

  const composer = $('[data-composer]', root)
  if (composer) {
    const say = $('[data-say]', composer)
    const thread = $('[data-thread]', root)
    // A thread you have to scroll to read is a thread you do not read.
    if (thread) thread.scrollTop = thread.scrollHeight

    // Grow to fit, up to a point. A one-line box for a paragraph is a box that
    // hides what you wrote from you.
    const fit = () => {
      say.style.height = 'auto'
      say.style.height = `${Math.min(say.scrollHeight, 160)}px`
    }
    say?.addEventListener('input', fit)
    // Enter sends, Shift+Enter breaks the line — the convention everywhere else.
    say?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); composer.requestSubmit() }
    })

    composer.addEventListener('submit', (e) => {
      e.preventDefault()
      const text = say.value.trim()
      if (text === '') return
      chat.send(state.project, text, state.attach)
      state.attach = null
      render()
      const t = $('[data-thread]')
      if (t) t.scrollTop = t.scrollHeight
      $('[data-say]')?.focus()
    })

    $('[data-unattach]', composer)?.addEventListener('click', () => {
      state.attach = null
      render()
      $('[data-say]')?.focus()
    })
  }

  // The review gate. Approving is what moves an artifact into the project.
  for (const b of root.querySelectorAll('[data-decide]')) {
    b.addEventListener('click', () => {
      const verdict = b.dataset.decide
      workspace.decide(state.project, b.dataset.rowId,
        verdict === 'approve' ? 'approved' : verdict === 'discard' ? 'discarded' : null)
      render()
    })
  }

  const board = $('[data-board]', root)
  if (board) {
    const p = byId(state.project)
    const mine = panels.layout(p)
    panels.wire(board, p, mine, render)
    $('[data-add-open]', root)?.addEventListener('click', (e) => {
      e.stopPropagation()
      const menu = $('[data-add-menu]', root)
      if (menu) menu.hidden = !menu.hidden
    })
    for (const b of root.querySelectorAll('[data-add]')) {
      b.addEventListener('click', () => {
        const kind = panels.KINDS.find((k) => k.id === b.dataset.add)
        // A new panel lands at the bottom of the shortest column, which is
        // where a person would have put it.
        const y = mine.reduce((m, s2) => Math.max(m, s2.y + s2.h), 0) + 20
        panels.save(p.slug, [...mine, { id: kind.id, x: 0, y, w: kind.w, h: kind.h }])
        render()
      })
    }
    $('[data-reset-panels]', root)?.addEventListener('click', () => {
      panels.reset(p.slug)
      render()
    })
    document.addEventListener('click', () => {
      const menu = $('[data-add-menu]')
      if (menu) menu.hidden = true
    }, { once: true })
  }

  const shelf = $('[data-shelf]', root)
  if (shelf) {
    const step = () => (shelf.firstElementChild?.getBoundingClientRect().width ?? 200) + 20
    $('[data-shelf-back]', root)?.addEventListener('click', () =>
      shelf.scrollBy({ left: -step() * 2, behavior: 'smooth' }))
    $('[data-shelf-on]', root)?.addEventListener('click', () =>
      shelf.scrollBy({ left: step() * 2, behavior: 'smooth' }))
  }

  for (const b of root.querySelectorAll('[data-doc]')) {
    const docs = allDocs(byId(state.project))
    const doc = docs[Number(b.dataset.doc)]
    if (doc?.file) paint($('.page', b), doc.file, 320)
    tiltable($('.page', b), { max: 7, scale: 1.03 })
    b.addEventListener('click', () => openDoc(doc, b))
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
