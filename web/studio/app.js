/*
  The M0 prototype.

  Static ES modules, no bundler, no framework — Option 2 of the integration
  assessment. What it is proving is not that a dashboard can be built, but that
  the interaction quality §14A demands is reachable without a framework. If it
  is not, that is evidence for React and this file becomes the specification.
*/

import { CREW, PROJECTS, WAITING, byId, crewBy, hydrate, source } from './data.js'
import { PALETTES, TEXTURES, appearance, apply, readTexture } from './appearance.js'
import * as canvasView from './canvas.js'
import * as chat from './chat.js'
import * as command from './command.js'
import * as config from './settings.js'
import { usageTab } from './usage.js'
import { MARKS } from './logos/marks.js'
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
  // Which Settings tab is open (#39).
  setting: 'team',
  view: 'portfolio', project: null, done: new Set(), label: null,
  // The project's sections (#30). Overview is the default: the specification
  // opens on Current Focus and Project Status, not on a file list.
  tab: 'overview',
  // Which of AI Team's four you are looking at.
  sub: 'board',
  // The item a chat message is about (#27), until it is sent or removed.
  attach: null,
  // The command bar (#40 idea 1): open, what is typed, which row is picked.
  cmd: { open: false, q: '', at: 0 },
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
/*
  A face, carrying its person's own hue (#40 idea 4).

  `--tone` is set inline from the agent's OKLCH angle and overrides the palette
  class, so every ring, tint and border derived from `--hue` downstream is that
  person's colour rather than one of six shared ones. One inline custom property
  is what makes an identity consistent across eight components without eight
  components knowing anything about agents.
*/
const face = (c, size = 28) =>
  `<span class="face ${c.hue} ${c.state}" style="--hue:oklch(0.62 0.14 ${c.tone ?? 150});--beat:${
    CREW.findIndex((x) => x.slug === c.slug)
  };width:${size}px;height:${size}px"
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
    <!--
      The separator only when there is something on both sides of it.

      Several real documents have no size worth printing — a Notion database
      container is twenty-four characters, so the API deliberately says nothing
      rather than "4 words" — and the caption rendered as "Notion ·" with a
      dangling middot. A trailing separator reads as data that failed to load.

      No backticks in this comment: template literal.
    -->
    <span class="t-meta" style="font-size:12px">${[d.origin, d.size]
      .filter((x) => String(x ?? '').trim() !== '')
      .map((x) => esc(x))
      .join(' · ')}</span>
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


/*
  The office, in one line (#40 idea 2).

  Grant asked for the whole product to feel like one thing. The clearest reason
  it did not was that the portfolio, a project and Settings each showed a
  different amount of life — Settings showed none at all, which is why it read
  as a separate application no matter how it was styled.

  So: a hairline strip carrying what the office is doing right now, on every
  screen. Three facts and no more, because a ribbon that grows into a dashboard
  is a dashboard nobody asked for:

    what is running    the pulse. Zero is a real state and says so.
    what is stuck      the only thing here that is ever urgent.
    what it costs      the £0 constraint, live, because the bad way to find
                       the edge of a free tier is an invoice.

  It is ambient. Nothing in it blinks for attention unless something is
  actually blocked, in which case it is the one thing that does.
*/

/*
  The command bar (#40 idea 1).

  Grant: *"easy to use, easy to expand."* Both, from one control. It is the
  fastest route to anything in the product, and anything added later becomes
  reachable through it without adding a button anywhere.

  The property that makes it worth building rather than a search box: it has no
  dead end. If what you typed matches nothing, the last row is still **Ask the
  team** carrying your words — because *"draft the follow-up for Priya"* matches
  no document and is a perfectly good thing to say. You never have to decide
  whether you are navigating or asking before you start typing.
*/

/*
  An empty section is a setup screen (#40 idea 7).

  Grant's frontend spec §31A: *"Treat avoidable requests for manual
  configuration as a design failure: first investigate whether the same outcome
  can be achieved through existing credentials, repository tooling, an API,
  CLI, SDK, connector or authorized browser session."*

  Applied to empty states, that rule says something specific. Every empty
  section in this app used to say a variant of "nothing here yet" — true, and
  useless, because it leaves the whole job with Grant. The office has eight
  people who can do most of these jobs. So an empty state offers TWO doors:

    the thing HE would do          add a document, add a person
    the thing the TEAM can do      go and find them

  and the team's door is first, because that is the one that is new information.
  He already knows he can add a document.

  A section with nothing in it and nothing the team could do about it — Activity
  on a brand-new project — gets prose and no buttons. Offering an action that
  cannot help is worse than offering none.
*/
function emptyState({ says, mine, ask }) {
  return `<div class="empty">
    <p class="t-lead" style="margin:0">${says}</p>
    <div class="emptydo">
      ${ask === undefined ? '' : `<button class="btn primary" data-ask-team="${esc(ask.say)}">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.9-.9L3 20.5l1.6-4.7A8.4 8.4 0 0 1 3.6 11 8.4 8.4 0 0 1 12 2.6a8.4 8.4 0 0 1 9 8.9z"/></svg>
        ${esc(ask.name)}</button>`}
      ${mine === undefined ? '' : `<button class="btn">${esc(mine)}</button>`}
    </div>
  </div>`
}


function commandBar() {
  if (!state.cmd.open) return ''
  const p = state.view === 'project' ? byId(state.project) : null
  const all = command.candidates({
    projects: PROJECTS,
    project: p,
    sections: SECTIONS,
    settings: config.TABS,
    crew: CREW,
    docsFor: allDocs,
  })
  const hits = command.search(state.cmd.q, all)
  const typed = state.cmd.q.trim()

  // Always last, always available. This is the whole idea.
  const rows = [
    ...hits,
    ...(typed === '' ? [] : [{
      kind: 'ask', id: 'ask', title: typed,
      hint: p === null ? 'Ask the team — pick a project first' : `Ask the team about ${p.name}`,
    }]),
  ]
  const at = Math.min(state.cmd.at, Math.max(rows.length - 1, 0))

  return `<div class="cmdwrap" data-cmd-wrap>
    <div class="cmdbar" role="dialog" aria-modal="true" aria-label="Command">
      <div class="cmdinput">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)"
          stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/></svg>
        <input data-cmd-input type="text" autocomplete="off" spellcheck="false"
               placeholder="Find anything, or tell the team what to do…"
               aria-label="Find anything, or tell the team what to do"
               value="${esc(state.cmd.q)}">
        <kbd>esc</kbd>
      </div>
      ${rows.length === 0 ? `<p class="cmdempty t-meta">Nothing matches. Keep typing and
        it becomes something to ask the team.</p>` : `
      <div class="cmdrows" role="listbox">
        ${rows.map((r, i) => `
          <button role="option" aria-selected="${i === at}" class="cmdrow ${
            i === at ? 'on' : ''} ${esc(r.hue ?? '')}" data-cmd-row="${i}">
            <span class="ckind">${esc(r.kind === 'ask' ? 'Ask' : command.KIND_NAME[r.kind] ?? '')}</span>
            <span class="ctitle">${esc(r.title)}</span>
            <span class="chint t-meta">${esc(r.hint ?? '')}</span>
            ${i === at ? '<kbd class="cgo">↵</kbd>' : ''}
          </button>`).join('')}
      </div>`}
    </div>
  </div>`
}

/** What pressing a row does. Kept out of the renderer so it can be read. */
function runCommand(row) {
  if (row === undefined) return
  if (row.kind === 'ask') {
    if (state.view !== 'project') return
    chat.send(state.project, row.title, null)
    state.tab = 'team'
    state.sub = 'chat'
    rememberTab(state.project, 'team')
    closeCmd()
    render()
    return
  }
  const go = row.go ?? {}
  closeCmd()
  if (go.settings !== undefined) {
    state.setting = go.settings
    settingsSheet()
    sheet($('#settings'), true)
    return
  }
  carry(null, null, () => {
    if (go.project !== undefined) state.project = go.project
    if (go.view !== undefined) state.view = go.view
    if (go.tab !== undefined) { state.tab = go.tab; rememberTab(state.project, go.tab) }
    if (go.sub !== undefined) state.sub = go.sub
    render()
  })
  if (go.doc !== undefined) {
    const b = $(`[data-doc="${go.doc}"]`)
    if (b !== null) b.click()
  }
  if (go.contact !== undefined) {
    const c = byId(state.project).contacts[go.contact]
    if (c !== undefined) openContact(c)
  }
}


/**
 * Resolve the highlighted index back to a row and run it.
 *
 * Rebuilt rather than stashed on state, because a list held on state is a list
 * that can disagree with the one on screen — and the disagreement only shows up
 * as the bar navigating somewhere you did not pick.
 */
function pickCommand(index) {
  const p = state.view === 'project' ? byId(state.project) : null
  const all = command.candidates({
    projects: PROJECTS, project: p, sections: SECTIONS,
    settings: config.TABS, crew: CREW, docsFor: allDocs,
  })
  const hits = command.search(state.cmd.q, all)
  const typed = state.cmd.q.trim()
  const rows = [
    ...hits,
    ...(typed === '' ? [] : [{ kind: 'ask', id: 'ask', title: typed }]),
  ]
  runCommand(rows[index])
}

const openCmd = () => { state.cmd = { open: true, q: '', at: 0 }; render(); $('[data-cmd-input]')?.focus() }
const closeCmd = () => { state.cmd = { open: false, q: '', at: 0 } }


function ribbon() {
  const running = PROJECTS.flatMap((p) => workspace.rows(p))
    .filter((r) => r.state === 'working' && r.blocked === undefined).length
  // Carry the project with each row, so "3 blocked" can take you to one.
  const stuck = PROJECTS.flatMap((p) => workspace.rows(p).map((r) => ({ ...r, slug: p.slug })))
    .filter((r) => r.blocked !== undefined)
  const waiting = PROJECTS.reduce((n, p) => n + workspace.split(p).waiting.length, 0)
  const busy = CREW.filter((c) => c.state === 'busy')

  return `<div class="ribbon ${stuck.length > 0 ? 'alert' : ''}">
    <span class="rb">
      <span class="pulse ${running > 0 ? 'live' : ''}"></span>
      <span class="t-label">${
        running === 0 ? 'Nothing running' : `${running} running`
      }</span>
    </span>
    ${busy.length === 0 ? '' : `<span class="rb faces">${busy.map((c) => face(c, 20)).join('')}</span>`}
    ${waiting === 0 ? '' : `<span class="rb"><span class="t-label warn">${waiting} waiting on you</span></span>`}
    <!--
      Straight to the blocked job, not merely to its project.

      This was dead in the most confusing way possible: the blocked job lives on
      the project Grant was already looking at, so pressing "1 blocked" set the
      project he was already on and re-rendered an identical page. It looked
      broken and was, in effect. The data-blocked attribute carries the project
      AND lands on AI Team, Active Jobs, which is the only screen that says what
      the blocker actually is.

      No backticks in this comment. It lives inside a template literal, and a
      backtick here ends the string — which is exactly how this file was left
      unparseable for one commit.
    -->
    ${stuck.length === 0 ? '' : `<button class="rb stuck" data-blocked="${esc(stuck[0].slug)}">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.01"/></svg>
      <span class="t-label">${stuck.length} blocked</span>
    </button>`}
    <!--
      Whether this is the office or the prototype (#68).

      It has to say. The studio spent a week rendering invented data and looking
      entirely convincing, and the whole reason the deployed page went a week
      without its design is that nobody could tell by looking which artefact
      they were judging. Shown only when it is NOT live: a badge that is always
      there is a badge nobody reads.

      No backticks in this comment. It is inside a template literal and one
      would end the string.
    -->
    ${source.live ? '' : `<span class="rb"><span class="t-meta mock">Prototype data${
      source.why ? ` — ${esc(source.why)}` : ''
    }</span></span>`}
    <span class="rb right">
      <span class="t-label">${esc(config.SPEND.month)} this month</span>
      <span class="t-meta">of ${esc(config.SPEND.target)}</span>
    </span>
  </div>`
}


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

    <!--
      The project selector, top left.

      Grant: *"the top left should be the project selector and it should be like
      a drop down menu that shows other projects. But once the project is
      selected, everything else on the screen is relevant to that project."*

      The rail used to list every project as a permanent nav item, with the
      current one's People hanging off it. Two things were wrong with that. It
      spent the most valuable space in the interface on a choice made once a
      day; and the People sub-item duplicated the Contacts tab, so the same list
      had two doors and neither was obviously the real one.

      A switcher says the same thing in one row: which project you are in, and
      that there are others. Everything below it belongs to that project, and
      everything belonging to that project is in its tabs — never in both.
    -->
    ${state.view === 'project' ? (() => {
      const p = byId(state.project)
      return `<div class="switcher">
        <button class="switch ${p.hue}" data-switch-open aria-haspopup="listbox"
                aria-expanded="false">
          <span class="dot"></span>
          <span class="sname">${esc(p.name)}</span>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M7 10l5 5 5-5"/></svg>
        </button>
        <div class="switchmenu" data-switch-menu hidden role="listbox">
          ${PROJECTS.map((x) => `
            <button role="option" aria-selected="${x.slug === p.slug}"
                    class="${x.hue} ${x.slug === p.slug ? 'on' : ''}" data-open="${x.slug}">
              <span class="dot"></span>
              <span>
                <b>${esc(x.name)}</b>
                <span class="t-meta">${x.docs} docs · ${x.total} tasks</span>
              </span>
            </button>`).join('')}
          <button class="allprojects" data-go="portfolio">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
              <path d="M4 5h6v6H4zM14 5h6v6h-6zM4 13h6v6H4zM14 13h6v6h-6z"/></svg>
            All projects
          </button>
        </div>
      </div>`
    })() : ''}

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
        Only the two GLOBAL places. A project's own sections live in its tabs
        and nowhere else — Grant: *"obviously, they don't duplicate things"*.
        The rail's project list and its People sub-item both said something the
        tabs already say, so both are gone.
      -->
      ${state.view === 'project' ? '' : PROJECTS.map((p) => `
        <button class="navitem proj ${p.hue}" data-open="${p.slug}"
                aria-current="false">
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
      <span class="lbl">Call the team</span>
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
        ? (p.contacts.length === 0
            ? emptyState({
                says: 'Nobody on this project yet.',
                ask: { name: 'Ask the team to find who it is about',
                       say: `Go through ${p.name}'s documents and messages and list the people it is actually about.` },
                mine: 'Add someone',
              })
            : `<div class="empty"><p class="t-lead" style="margin:0">Nobody here carries that
                label yet. Open someone and tick it.</p></div>`)
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

/*
  The time of day, in his zone.

  "Good morning, Grant" at nine in the evening is the first thing that tells a
  reader nothing on this page is really about them. Cheap to get right and one
  of the few places a product can feel like it is paying attention.
*/
function greeting() {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Europe/Athens' })
      .format(new Date()),
  )
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

/*
  Where things stand, counted rather than written.

  This line said "Three projects. One thing waiting on you, and the team
  finished nine things overnight" for a fortnight, and it was true of the mock
  and false of everything else — the first render against the real office showed
  it claiming three projects above four cards. A sentence that contradicts the
  page under it is worse than no sentence, because it teaches a reader to stop
  believing the ones that are true.

  Each clause is dropped when its count is zero rather than printed as "no
  projects" — the rule the morning briefing arrived at after telling him
  "nothing failed" every day for a month.
*/
function standing() {
  const parts = []
  const n = PROJECTS.length
  if (n > 0) parts.push(`${n} ${n === 1 ? 'project' : 'projects'}`)

  const waiting = PROJECTS.reduce((t, p) => t + workspace.split(p).waiting.length, 0)
  if (waiting > 0) parts.push(`${waiting} thing${waiting === 1 ? '' : 's'} waiting on you`)

  const open = PROJECTS.reduce(
    (t, p) => t + (p.tasks ?? []).filter((k) => k.state !== 'done').length,
    0,
  )
  if (open > 0) parts.push(`${open} task${open === 1 ? '' : 's'} still open`)

  const busy = CREW.filter((c) => c.state === 'busy').length
  if (busy > 0) parts.push(`${busy} of the team working now`)

  if (parts.length === 0) return 'Nothing is waiting on you, and nothing is running.'
  // Sentence case, and a full stop. "4 projects, 1 thing waiting on you." reads
  // as a status bar; the same words with a capital read as a person telling you.
  const said = parts.join(', ')
  return `${said.charAt(0).toUpperCase()}${said.slice(1)}.`
}

function portfolio() {
  return `<main class="main">
    <div class="head">
      <div>
        <h1 class="t-display">${esc(greeting())}, Grant</h1>
        <p class="t-lead" style="margin:var(--s2) 0 0">${esc(standing())}</p>
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
    return `<div class="tabbody">${emptyState({
      says: `The team has nothing in hand on ${esc(p.name)}, and has made nothing for it yet.`,
      ask: { name: 'Ask them to look at it',
             say: `Look over ${p.name} and tell me the three things most worth doing next.` },
      mine: 'Open the chat',
    })}</div>`
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
          : `<div class="woutfile" style="--hue:oklch(0.62 0.14 ${c.tone ?? 150})">
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
    return `<div class="msg theirs" style="--hue:oklch(0.62 0.14 ${c.tone ?? 150})">
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
    return `<article class="member ${c.hue} ${active ? '' : 'quiet'}"
             style="--hue:oklch(0.62 0.14 ${c.tone ?? 150})">
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
    return `<div class="tabbody">${emptyState({
      says: `Nobody is working on ${esc(p.name)} right now.`,
      ask: { name: 'Give them something',
             say: `What should the team pick up on ${p.name} first?` },
    })}</div>`
  }

  const job = (r) => {
    const c = crewBy(r.who)
    /*
      A job's leading edge is its OWNER's colour, not its state's. State is
      already said twice — by the group it sits in and by the blocker line — and
      colouring by state would overwrite the one signal that is not repeated
      anywhere else on the row. A blocked job keeps the warning treatment
      through `.blocked` instead.
    */
    return `<article class="job ${r.blocked !== undefined ? 'stuck' : ''}"
             style="--hue:oklch(0.62 0.14 ${c.tone ?? 150})">
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
    return `<div class="tabbody">${emptyState({
      says: `${esc(p.name)} stands on its own — nothing outside it feeds in. That is a fine
             state to be in.`,
      ask: { name: 'Ask the team to go looking',
             say: `Search Drive, Notion, NotebookLM and GitHub for anything to do with ${p.name}, and tell me what you find before connecting it.` },
      mine: 'Point it at something',
    })}</div>`
  }
  return `<div class="tabbody">
    <div class="tabhead">
      <p class="t-lead" style="margin:0">What ${esc(p.name)} reads from. The project
        is the source of truth; these are optional attachments to it.</p>
      <!--
        Adding one is a real action on the build page and a stub here, and the
        label says which. Grant: treat an avoidable request for manual
        configuration as a design failure — so the button names the thing it
        will ask for rather than opening an empty dialogue.
      -->
      <button class="btn" data-add-source>Connect a folder or page</button>
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
    return `<div class="tabbody">${emptyState({
      says: `Nothing to do on ${esc(p.name)} yet.`,
      ask: { name: 'Ask the team to work out what is needed',
             say: `Read everything on ${p.name} and propose the tasks it actually needs, with owners.` },
      mine: 'Add a task',
    })}</div>`
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
    return `<div class="tabbody">${emptyState({
      says: `Nothing in ${esc(p.name)} yet.`,
      ask: { name: 'Ask the team to gather what exists',
             say: `Find everything already written about ${p.name} — in Drive, Notion and NotebookLM — and bring it in.` },
      mine: 'Add a document',
    })}</div>`
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
    /*
      No action offered, deliberately. An empty history is not a thing an agent
      can fix, and a button that cannot help is worse than no button.
    */
    return `<div class="tabbody"><div class="empty">
      <p class="t-lead" style="margin:0">Nothing has happened on ${esc(p.name)} yet.
        This fills itself in.</p>
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
    /*
      `view-transition-name` pairs this panel with the full section of the same
      subject (#40 idea 6). Pressing Documents on Overview makes the Documents
      PANEL grow into the Documents SECTION rather than the page swapping —
      Grant's *"the item you touched is the item you land in"*, applied across
      the tab boundary where it was not applied before.

      The name has to be unique per document, which is why only the panels get
      it and the section claims the same name on the other side of the switch.
    */
    return `<section class="panel" data-panel="${spec.id}"
             style="view-transition-name:sec-${spec.id};
                    left:calc((100% - 40px)/3 * ${spec.x} + ${spec.x} * 20px);
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
    /*
      The true count, not the number of rows in hand.

      The API caps the document list at 24 because a hundred of them with their
      metadata is a slow first paint on a phone. The tab said 24 on a project
      with 41, which is the kind of wrong that costs trust in every other number
      on the page. `p.docs` is counted in SQL over the whole project.
    */
    documents: Math.max(p.docs ?? 0, allDocs(p).length),
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

  /*
    The section body claims the panel's transition name, so the browser pairs
    them and animates one into the other. `sec-documents` is a panel on
    Overview and the whole gallery in Documents; the browser does the rest.
  */
  const named = (id, html) => `<div style="view-transition-name:sec-${id}">${html}</div>`

  const body =
    state.tab === 'team' ? team
    : state.tab === 'documents' ? named('documents', documentsSection(p))
    : state.tab === 'tasks' ? named('tasks', tasksSection(p))
    : state.tab === 'contacts' ? named('contacts', peopleTab(p))
    : state.tab === 'sources' ? named('links', sources(p))
    : state.tab === 'activity' ? named('activity', activitySection(p))
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
        <!--
          Who has touched this project, each of them once.

          It was one disc per activity ROW, which was fine against a mock whose
          history was five different people and became thirteen identical
          Claires the moment it saw a real project. A row of the same face is
          not information, it is a rendering artefact that looks like one.

          No backticks in this comment: template literal.
        -->
        <div class="crew" style="margin:0">${[...new Set(p.activity.map((a) => a.who))]
          .slice(0, 6)
          .map((who) => face(crewBy(who)))
          .join('')}</div>
        <!--
          There is no "Talk to the team" button here.

          Grant: *"what's the point of having two 'talk to the team' buttons?"*
          There were two, and worse, they did different things under the same
          words — the rail's is the voice call, this one opened the text chat.
          Chat is one tap away in AI Team, so the header keeps only what the
          tabs cannot say: the project's own settings.
        -->
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

/*
  Team — the eight, and adding a ninth.

  Grant: *"one tab for the bot management where you add and remove bots
  dynamically, that's automatically done."* The database already supports this:
  `staff.permanent`, `staff.expires_at`, `staff.justification` and
  `staff.requested_for_job` exist precisely so an agent can be brought in for a
  piece of work and expire when it is done. What was missing was any way to see
  or do it.
*/
function teamTabSettings() {
  const card = (c) => `
    <article class="staffcard" data-lift data-edge data-tilt="3.2"
             style="--hue:oklch(0.62 0.14 ${c.tone ?? 150})">
      ${face(c, 46)}
      <div class="sbody">
        <b>${esc(c.name)}</b>
        <span class="t-label">${esc(c.role)}</span>
        <span class="t-meta">${esc(c.doing ?? 'Available')}</span>
      </div>
      <div class="sctl">
        <button class="btn" data-configure="${esc(c.slug)}">Configure</button>
      </div>
    </article>`

  return `<div class="setbody">
    <div class="tabhead">
      <p class="t-lead" style="margin:0">Eight permanent. Bring in a specialist for a
        piece of work and they leave when it is finished.</p>
      <button class="btn primary" data-hire>+ Bring someone in</button>
    </div>
    <div class="staffgrid">${CREW.map(card).join('')}</div>
    <p class="t-meta">A temporary agent carries a justification and an expiry, so the
      office never quietly grows. Removing one is reversible.</p>
  </div>`
}

/*
  Behaviour — how much the office does without asking.

  This is the frontend half of #15. The one that matters is the top one: a
  system that interrupts on everything is a system you stop reading, and one
  that interrupts on nothing is one you stop trusting.
*/
function behaviourTab() {
  const row = (b) => {
    if (b.kind === 'choice') {
      return `<article class="behave" data-lift data-tilt="1.6">
        <div class="bhead"><b>${esc(b.name)}</b></div>
        <div class="choices">
          ${b.options.map((o) => `
            <button class="choice ${b.value === o.id ? 'on' : ''}" data-choose="${esc(b.id)}:${esc(o.id)}">
              <b>${esc(o.name)}</b>
              <span class="t-meta">${esc(o.note)}</span>
            </button>`).join('')}
        </div>
      </article>`
    }
    if (b.kind === 'switch') {
      return `<article class="behave row" data-lift data-tilt="1.6">
        <div class="bhead">
          <b>${esc(b.name)}</b>
          <span class="t-meta">${esc(b.note)}</span>
        </div>
        <button class="toggle ${b.value ? 'on' : ''}" role="switch"
                aria-checked="${b.value}" data-toggle="${esc(b.id)}"
                aria-label="${esc(b.name)}"><span class="knob"></span></button>
      </article>`
    }
    return `<article class="behave row" data-lift data-tilt="1.6">
      <div class="bhead">
        <b>${esc(b.name)}</b>
        <span class="t-meta">${esc(b.note)}</span>
      </div>
      <span class="pillvalue">${esc(b.value)}</span>
    </article>`
  }
  return `<div class="setbody">
    <p class="t-lead" style="margin:0">What the team may do on its own, and when it
      should stop and ask you.</p>
    <div class="behaves">${config.BEHAVIOURS.map(row).join('')}</div>
  </div>`
}

/*
  Connections — every service, with its real mark.

  The marks are drawn on one 24×24 grid at one weight rather than downloaded,
  because eight official SVGs arrive at eight different optical sizes and a row
  of them reads as eight logos instead of one list. See logos/LICENCE.txt.

  A connection that is unwell says what to do about it in the same card. A
  settings page that reports a problem and leaves you to find the fix is a
  settings page that has told on itself and helped nobody.
*/
function connectionsTab() {
  const card = (c) => `
    <article class="service s-${c.state}" data-lift data-tilt="3.4"
             style="--tint:${esc(c.tint)}">
      <span class="mark">${c.svg}</span>
      <div class="svbody">
        <b>${esc(c.name)}</b>
        <span class="t-meta">${esc(c.used)}</span>
        <span class="t-meta from">${esc(c.detail)}</span>
      </div>
      <div class="svfoot">
        <span class="dotstate"></span>
        <span class="t-label">${esc(config.STATE_LABEL[c.state])}</span>
        <span class="t-meta">${esc(c.last)}</span>
        ${c.fix === undefined ? '' : `<button class="btn small">${esc(c.fix)}</button>`}
      </div>
    </article>`
  const list = config.services()
  const bad = list.filter((c) => c.state !== 'ok').length
  return `<div class="setbody">
    <div class="tabhead">
      <p class="t-lead" style="margin:0">${list.length} services. ${
        bad === 0 ? 'All of them well.' : `${bad} want looking at.`}</p>
      <button class="btn">+ Connect something</button>
    </div>
    <div class="servicegrid">${list.map(card).join('')}</div>
  </div>`
}

/** Channels — which surface reaches Grant, and when. */
function channelsTab() {
  return `<div class="setbody">
    <p class="t-lead" style="margin:0">How the office reaches you. Only the Chief of
      Staff sends; everyone else still does the work.</p>
    <div class="servicegrid">
      ${config.CHANNELS.map((c) => {
        const m = MARKS[c.key] ?? { svg: '', tint: 'currentColor' }
        return `<article class="service s-${c.state}" data-lift data-tilt="3.4"
                 style="--tint:${esc(m.tint)}">
          <span class="mark">${m.svg}</span>
          <div class="svbody">
            <b>${esc(c.name)}</b>
            <span class="t-meta">${esc(c.role)}</span>
            <span class="t-meta from">${esc(c.detail)}</span>
          </div>
          <div class="svfoot">
            <span class="dotstate"></span>
            <span class="t-label">${esc(config.STATE_LABEL[c.state])}</span>
          </div>
        </article>`
      }).join('')}
    </div>
  </div>`
}

/*
  Models and cost.

  The £0/month constraint is a hard one, so it is a live number rather than a
  note in a document. The warning is the useful part: the free tier has an edge
  and the only bad way to find it is an invoice.
*/


/*
  Appearance — one of six tabs now, not the whole of Settings.

  Its contents are unchanged. The swatches were always the right idea: nobody
  knows what "Clay" looks like from the word, and each one paints itself from
  its own palette's tokens so a new palette needs no code here.
*/
function appearanceTab() {
  const now = appearance()
  return `<div class="setbody">
      <p class="t-lead" style="margin:0 0 var(--s4)">Changes apply straight away and are
        remembered on this device.</p>

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
        setting. Every palette has both.</p>    </div>`
}


/*
  Settings, as a place rather than a sheet.

  Grant: *"I want to see these things properly arranged in a logical way. So
  like one tab for the bot management where you add and remove bots
  dynamically... where you can see all the various services that we're
  connected to. And I want to see it, you know, like the proper logos."*

  Six tabs in the order you need them: who is on the team, how much they do
  without asking, what they are plugged into, how they reach you, what it
  costs, and how it looks.
*/
function settingsSheet() {
  const v = $('#settings')
  const body =
    state.setting === 'behaviour' ? behaviourTab()
    : state.setting === 'connections' ? connectionsTab()
    : state.setting === 'channels' ? channelsTab()
    : state.setting === 'models' ? usageTab()
    : state.setting === 'appearance' ? appearanceTab()
    : teamTabSettings()

  v.innerHTML = `<div class="sheet wide settings">
    <div class="chead">
      <span style="flex:1;min-width:0">
        <h2 class="t-title" style="margin:0">The office</h2>
        <p class="t-meta" style="margin:4px 0 0">Everything about how this place
          runs, and what it is plugged into.</p>
      </span>
    </div>
    <div class="settabs" role="tablist" aria-label="Settings">
      ${config.TABS.map((t) => `<button role="tab" class="settab ${
        state.setting === t.id ? 'on' : ''
      }" aria-selected="${state.setting === t.id}" data-setting="${t.id}">${esc(t.name)}</button>`).join('')}
    </div>
    ${body}
  </div>
  <button class="close" aria-label="Close">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
  </button>`

  for (const b of v.querySelectorAll('[data-setting]')) {
    b.addEventListener('click', () => { state.setting = b.dataset.setting; settingsSheet(); sheet(v, true) })
  }
  for (const el of v.querySelectorAll('[data-lift]')) {
    tiltable(el, { max: Number(el.dataset.tilt ?? 3), scale: 1.006 })
  }
  wireAppearance(v)
}

/*
  The appearance controls, wired.

  Split out of the old sheet when Settings became six tabs. Each change applies
  immediately and redraws, so the tick moves under your finger rather than after
  a save — a settings panel with a Save button is a settings panel that makes
  you guess what a palette looks like before committing to it.
*/
function wireAppearance(v) {
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

  $('.close', v)?.addEventListener('click', () => { sheet(v, false) })
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
  root.innerHTML = commandBar() + ribbon() + rail() + (
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
  /*
    And anything marked `data-lift`, which is how a new card joins without
    editing either this array or the CSS (#38). `data-tilt` names the angle;
    3 degrees is right for most things and is the default.
  */
  for (const el of root.querySelectorAll('[data-lift]')) {
    tiltable(el, { max: Number(el.dataset.tilt ?? 3), scale: 1.006 })
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

  /*
    The project switcher.

    Closing on the next click anywhere is registered on `document` with
    `{ once: true }` AFTER a stopPropagation on the opening press, so the press
    that opens it is not also the click that closes it.
  */
  const swBtn = $('[data-switch-open]', root)
  const swMenu = $('[data-switch-menu]', root)
  if (swBtn !== null && swMenu !== null) {
    swBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      const open = swMenu.hidden
      swMenu.hidden = !open
      swBtn.setAttribute('aria-expanded', String(open))
      if (open) {
        document.addEventListener('click', () => {
          swMenu.hidden = true
          swBtn.setAttribute('aria-expanded', 'false')
        }, { once: true })
      }
    })
    swBtn.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { swMenu.hidden = true; swBtn.setAttribute('aria-expanded', 'false') }
    })
  }

  $('[data-rail]', root)?.addEventListener('click', () => {
    try { localStorage.setItem('studio.rail', railShut() ? 'open' : 'shut') } catch { /* fine */ }
    render()
  })
  /*
    Call the team.

    This was DEAD. It wrote to `.talkstate`, an element removed from the rail at
    some point since, so the most prominent control in the interface — the one
    Grant asked to be prominent — did nothing at all when pressed. Nothing
    caught it: it renders, it passes every layout check, and it photographs
    perfectly. `npm run verify:controls` found it by pressing it.

    The prototype still has no call to place, so the honest behaviour is to say
    so ON the button, where the press happened, rather than in a status line
    somewhere else that may or may not exist. It reverts after a moment so the
    rail does not stay stuck mid-sentence.
  */
  const call = $('[data-call]', root)
  call?.addEventListener('click', () => {
    if (call.classList.contains('ringing')) return
    const label = $('.lbl', call)
    const was = label?.textContent ?? 'Call the team'
    call.classList.add('ringing')
    if (label !== null) label.textContent = 'Calling Claire…'
    setTimeout(() => {
      call.classList.remove('ringing')
      if (label !== null) label.textContent = was
    }, 2400)
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
    The command bar's keyboard, and why it lives on `document`.

    A global shortcut has to work when focus is anywhere — including inside the
    chat composer — so the listener is on the document, added ONCE at start-up
    rather than per render. Attaching it in `render()` would add a duplicate on
    every paint, and by the tenth navigation one keypress would open the bar ten
    times.
  */
  const rowsNow = () => [...document.querySelectorAll('[data-cmd-row]')]
  for (const b of root.querySelectorAll('[data-cmd-row]')) {
    b.addEventListener('mousedown', (e) => {
      e.preventDefault()   // keep focus in the input so a click behaves like Enter
      pickCommand(Number(b.dataset.cmdRow))
    })
  }
  const input = $('[data-cmd-input]', root)
  if (input !== null) {
    // Caret to the end: re-rendering on each keystroke resets it otherwise.
    input.focus()
    input.setSelectionRange(input.value.length, input.value.length)
    input.addEventListener('input', () => {
      state.cmd.q = input.value
      state.cmd.at = 0
      render()
    })
    input.addEventListener('keydown', (e) => {
      const n = rowsNow().length
      if (e.key === 'Escape') { e.preventDefault(); closeCmd(); render(); return }
      if (e.key === 'ArrowDown') { e.preventDefault(); state.cmd.at = (state.cmd.at + 1) % Math.max(n, 1); render(); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); state.cmd.at = (state.cmd.at - 1 + n) % Math.max(n, 1); render(); return }
      if (e.key === 'Enter') { e.preventDefault(); pickCommand(state.cmd.at) }
    })
  }
  $('[data-cmd-wrap]', root)?.addEventListener('mousedown', (e) => {
    if (e.target === $('[data-cmd-wrap]', root)) { closeCmd(); render() }
  })

  /*
    An empty state's team button actually sends the request (#40 idea 7).

    It does not open the chat and leave Grant to type — that would be the same
    manual step §31A calls a design failure, dressed as a shortcut. The message
    is composed, sent, and he lands on the thread watching it happen.
  */
  for (const b of root.querySelectorAll('[data-ask-team]')) {
    b.addEventListener('click', () => {
      if (state.view !== 'project') return
      chat.send(state.project, b.dataset.askTeam, null)
      state.tab = 'team'
      state.sub = 'chat'
      rememberTab(state.project, 'team')
      render()
    })
  }

  // The ribbon's blocked count goes to the job itself (see ribbon()).
  for (const b of root.querySelectorAll('[data-blocked]')) {
    b.addEventListener('click', () => {
      carry(null, null, () => {
        state.project = b.dataset.blocked
        state.view = 'project'
        state.tab = 'team'
        state.sub = 'jobs'
        rememberTab(state.project, 'team')
        render()
      })
    })
  }

  /*
    Tabs, the talk action, the composer and the in-tray decisions.

    All four are wired here rather than in their renderers because a full
    re-render replaces every node — a listener attached inside a template
    function would be lost on the next paint and silently stop working, which is
    exactly how the deleted `everyone()` bug hid for two commits.
  */
  /*
    Section switching is a transition, not a swap (#40 idea 6).

    `carry` with no element still starts a view transition, so every element
    carrying a `view-transition-name` on both sides is animated between its two
    positions — the Documents panel on Overview becomes the Documents gallery.
    Anything unnamed cross-fades, which is the right default for the rest.
  */
  for (const b of root.querySelectorAll('[data-tab]')) {
    b.addEventListener('click', () => {
      carry(null, null, () => {
        state.tab = b.dataset.tab
        // "Talk to the team" is one press: AI Team AND its Chat view.
        if (b.dataset.sub !== undefined) state.sub = b.dataset.sub
        rememberTab(state.project, state.tab)
        render()
      })
    })
  }

  // AI Team's own four. A bare data-sub also means "go to AI Team", so the
  // empty states can send you to the chat from anywhere.
  for (const b of root.querySelectorAll('[data-sub]:not([data-tab])')) {
    b.addEventListener('click', () => {
      carry(null, null, () => {
        state.sub = b.dataset.sub
        state.tab = 'team'
        rememberTab(state.project, 'team')
        render()
      })
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
    /*
      #36 is not built. Saying so where the press happened beats writing to a
      status line — which is exactly how the call button came to be dead: it
      wrote to `.talkstate`, an element that no longer exists.
    */
    const btn = $('[data-project-settings]', root)
    if (btn !== null) {
      btn.classList.add('nope')
      setTimeout(() => { btn.classList.remove('nope') }, 1400)
    }
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

/*
  The global shortcut, registered ONCE.

  `render()` replaces every node in the shell, so a listener attached inside it
  is added again on every paint — by the tenth navigation one keypress would
  open the bar ten times. Anything global belongs here, outside the render.
*/
document.addEventListener('keydown', (e) => {
  const cmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k'
  if (cmdK) { e.preventDefault(); state.cmd.open ? (closeCmd(), render()) : openCmd(); return }
  // Escape closes whatever is open, outermost first.
  if (e.key === 'Escape' && state.cmd.open) { closeCmd(); render() }
})

apply()
clock()
render()

/*
  And then the real office, if it will have us (#68, ADR-0019).

  Rendered FIRST with whatever is in hand, then hydrated and rendered again.
  The other order — wait for the fetch, then paint — gives a blank screen for
  however long the network takes, and the whole argument for keeping the mock is
  that there is always something to look at.

  The token is the same one Team HQ uses. No new auth system: one bearer token,
  and the studio reads it from the same place rather than asking again.
*/
const API =
  window.HQ_API || 'https://baujwlzcziasnfhhkchg.supabase.co/functions/v1/hq-api'

async function live() {
  let token = ''
  try {
    token = localStorage.getItem('hq.token') ?? ''
  } catch {
    // Private browsing, or storage blocked. The mock stands.
  }
  if (token === '') {
    source.why = 'no token — showing the prototype'
    render()
    return
  }
  await hydrate(API, token)
  render()
}

live()
