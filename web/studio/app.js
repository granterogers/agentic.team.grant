/*
  The M0 prototype.

  Static ES modules, no bundler, no framework — Option 2 of the integration
  assessment. What it is proving is not that a dashboard can be built, but that
  the interaction quality §14A demands is reachable without a framework. If it
  is not, that is evidence for React and this file becomes the specification.
*/

import { CREW, PROJECTS, WAITING, byId, crewBy, hydrate, source } from './data.js'
import { act, attempt, canWrite, read, say, sure } from './office.js'
import { PALETTES, TEXTURES, SCHEMES, appearance, apply, readTexture, toggleScheme, activeScheme } from './appearance.js'
import * as canvasView from './canvas.js'
import * as chat from './chat.js'
import * as command from './command.js'
import * as config from './settings.js'
import { wireCall, unwireCall, syncCallButtons, callIsLive } from './call.js'
import { hydrateUsage, usageTab } from './usage.js'
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
  // Which person's card is open in Settings. Null is the grid (#68).
  person: null,
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

/*
  Escape closes whatever is open (#88, #98).

  One listener on the document rather than one per sheet, for the same reason
  `sheet()` exists: five copies of the same behaviour drift the first time one
  of them changes.

  It is what makes the close button a convenience rather than the only way out
  — which is the actual complaint behind both of those issues. A panel you can
  only leave by finding one small target is a panel people get stuck in, and
  the studio has been shipping two of them.

  The call is deliberately NOT hung up here: closing the sheet leaves the call
  running (#101), and Escape is closing the sheet.
*/
if (typeof document !== 'undefined') {
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return
    for (const id of ['#viewer', '#settings']) {
      const el = $(id)
      if (el && !el.hidden) {
        if (id === '#viewer') unwireCall()
        sheet(el, false)
        syncCallButtons()
        return
      }
    }
  })
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
  return withTalk(`<button class="task ${done ? 'done' : ''}" data-task="${i}"${
    t.id ? ` data-task-id="${esc(t.id)}"` : ''}>
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
function emptyState({ says, mine, mineDo, ask }) {
  return `<div class="empty">
    <p class="t-lead" style="margin:0">${says}</p>
    <div class="emptydo">
      ${ask === undefined ? '' : `<button class="btn primary" data-ask-team="${esc(ask.say)}">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.9-.9L3 20.5l1.6-4.7A8.4 8.4 0 0 1 3.6 11 8.4 8.4 0 0 1 12 2.6a8.4 8.4 0 0 1 9 8.9z"/></svg>
        ${esc(ask.name)}</button>`}
      <!--
        The empty state's own action (#105).

        Every empty state in the product rendered this as a bare button with no
        attribute at all — Add a task, Add a document, Add someone, Add a
        source - so all of them did nothing. verify:wired could not see them
        either, because it compared attributes against source lookups and these
        had no attribute to compare.

        mineDo names what the press should do. Where it is absent the button
        is not drawn at all, which is the honest state for a section whose
        write path does not exist yet — Contacts has no table (#24).

        No backticks in this comment. Template literal.
      -->
      ${mine === undefined || mineDo === undefined ? '' :
        `<button class="btn" data-empty-do="${esc(mineDo)}">${esc(mine)}</button>`}
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


/*
  The ribbon is gone (#78).

  Grant: *"Remove the top status bar: Remove the Waiting on me / Nothing
  running strip."*

  It occupied a full-width strip at the top of every view to report, most of
  the time, that nothing was happening. A status line whose common case is "no
  news" trains you not to read it, and once you are not reading it the
  uncommon case does not reach you either.

  It was also where the "68 BLOCKED" bug lived: it keyed on state_reason, which
  is set on every dequeue, so it claimed sixty-eight blocked jobs against an
  office with none. Two fixes were needed. That the most prominent element on
  the page could be that wrong for that long is its own argument.

  The two things worth carrying went where they are actionable: waiting on me
  is on the project it concerns and in the morning briefing, which already
  reaches his phone, and running is in Lately, which is the record of what the
  office did.
*/

/*
  Seven sections, and AI Team's four inside it (#30).

  The counts on the section buttons are how Grant learns something is waiting
  without opening anything — which is the whole reason the specification puts
  an operational overview first rather than a file list.

  Top-level since #80, because the sections moved into the rail and the rail is
  rendered before the project body. It used to be computed inside `dashboard()`,
  which is the only place that needed it then.
*/
/*
  Every light/dark shortcut shows which way it will go (#87).

  Same reasoning as `syncCallButtons`: the button is rebuilt on every render and
  knows nothing, and two copies disagreeing about the theme is worse than one
  copy being wrong. A class on the button, and CSS picks the icon — swapping
  innerHTML on a button whose content is an SVG is how the call button once
  deleted its own microphone.
*/
function paintSchemeButtons() {
  const dark = activeScheme() === 'dark'
  for (const b of document.querySelectorAll('[data-scheme-toggle]')) {
    b.classList.toggle('is-dark', dark)
    const to = dark ? 'light' : 'dark'
    b.title = 'Switch to ' + to
    b.setAttribute('aria-label', 'Switch to ' + to)
  }
}

function sectionCounts(p) {
  const waiting = workspace.split(p).waiting.length
  const blocked = workspace.rows(p).filter((r) => r.blocked !== undefined).length
  const openTasks = p.tasks.filter((t, i) => t.state !== 'done' && !state.done.has(i)).length
  return {
    /*
      Two rawer numbers ride along, because AI Team's own sub-tabs need them
      separately and they are the same two counts. They are not section ids, so
      they never collide with a SECTIONS lookup.
    */
    waiting,
    blocked,
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
}

function rail() {
  const inProject = state.view === 'project'
  const p = inProject ? byId(state.project) : null
  const counts = inProject ? sectionCounts(p) : {}

  /*
    The toggle is a SIBLING of the rail, not a child of it (#76).

    Grant: *"Make the sidebar collapse fully and reclaim the space. Currently,
    only a small portion disappears."* It used to collapse from 220px to 74px,
    keeping an icon strip - a narrower rail rather than a hidden one.

    Collapsing the rail now hides it with opacity, and OPACITY ON AN ANCESTOR
    HIDES EVERY DESCENDANT no matter what the child's own opacity says. With
    the button inside, the way to reopen the sidebar disappeared along with the
    sidebar. Same family of trap as backdrop-filter breaking position:fixed:
    the parent decides things the child cannot override.
  */
  return `<button class="railtoggle" data-rail aria-label="Collapse the sidebar">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="1.9" stroke-linecap="round" aria-hidden="true">
        <path d="M14 6l-6 6 6 6"/></svg>
    </button>
    <aside class="rail">
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
      The dashboard project selector, top left, always.

      Grant: *"the top left should be the project selector and it should be like
      a drop down menu that shows other projects. But once the project is
      selected, everything else on the screen is relevant to that project."*
      And again on 11 September: *"Allow switching between projects directly
      from the sidebar."* (#79)

      It used to appear only while inside a project, so from the portfolio the
      only way in was the grid. Now it is the permanent anchor: which dashboard
      project you are in, and that there are others. Everything under it belongs
      to that project.

      A dashboard project is a row in public.projects. Not a notebook, not a
      Notion database, not a Drive folder — those are things it is attached to.
    -->
    <div class="switcher">
      <button class="switch ${inProject ? p.hue : ''}" data-switch-open aria-haspopup="listbox"
              aria-expanded="false">
        <span class="dot"></span>
        <span class="sname">${inProject ? esc(p.name) : 'All projects'}</span>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M7 10l5 5 5-5"/></svg>
      </button>
      <div class="switchmenu" data-switch-menu hidden role="listbox">
        ${PROJECTS.map((x) => `
          <button role="option" aria-selected="${inProject && x.slug === p.slug}"
                  class="${x.hue} ${inProject && x.slug === p.slug ? 'on' : ''}" data-open="${x.slug}">
            <span class="dot"></span>
            <span>
              <b>${esc(x.name)}</b>
              <span class="t-meta">${x.docs} docs · ${x.total} tasks</span>
            </span>
          </button>`).join('')}
        <!--
          The ONLY element carrying data-go=portfolio.

          There were two: this one and a nav item below. Grant asked for the
          nav item to go (#77), and the duplicate was also a real bug — the
          control audit resolved the hidden copy inside this menu and waited
          thirty seconds for something invisible to become clickable. The
          comment recording that is still in scripts/verify/controls.ts.
        -->
        <button class="allprojects" data-go="portfolio">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
            <path d="M4 5h6v6H4zM14 5h6v6h-6zM4 13h6v6H4zM14 13h6v6h-6z"/></svg>
          All projects
        </button>
      </div>
    </div>

    <!--
      The project sections, in the sidebar (#80).

      Grant: *"Move project sections into the left sidebar: Place Overview,
      Documents, Tasks, Contacts, and other project sections there."*

      They were a horizontal tab strip above the content. As sidebar entries
      under the picker the rail reads WHICH PROJECT, then WHERE IN IT, which is
      the shape four of his thirty items are circling.

      These stay data-tab so the wiring and the audits that drive them keep
      working, but they are navigation now, not a tablist: aria-current, not
      aria-selected, and no role=tab on a thing that is not in a tablist.
    -->
    <nav class="navgroup" aria-label="${inProject ? esc(p.name) : 'Projects'}">
      ${inProject
        ? SECTIONS.map((t) => `
          <button class="navitem sect ${state.tab === t.id ? 'on' : ''}" data-tab="${t.id}"
                  aria-current="${state.tab === t.id ? 'page' : 'false'}">
            <span>${esc(t.name)}</span>
            ${counts[t.id] > 0 ? `<span class="n">${counts[t.id]}</span>` : ''}
          </button>`).join('')
        : PROJECTS.map((x) => `
          <button class="navitem proj ${x.hue}" data-open="${x.slug}" aria-current="false">
            <span class="dot"></span>${esc(x.name)}
          </button>`).join('')}
    </nav>

    <!--
      Everything below here is pinned to the bottom by .railfoot.

      Grant: *"Move Lately near the bottom"* (#84) and *"Place Settings at the
      bottom left. Label the entry Settings rather than Appearance"* (#86).
      Appearance is one of six tabs inside Settings and has been since the
      settings sheet was built; the rail was still advertising the tab as if it
      were the whole thing, so five tabs were behind a door that did not
      mention them.

      "Working now" and the Desk entry are gone (#77) — presence for its own
      sake, and a view whose contents all found homes in the project sections.
    -->
    <div class="railfoot">
      <!--
        Grant: *"of course the talk to team button should be prominent"*. It is
        the one control he uses when he does not want to use the interface at
        all, so it is the only filled thing in the rail.
      -->
      <button class="callbtn" data-call>
        <span class="ring"></span>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <path d="M12 2a3 3 0 00-3 3v7a3 3 0 006 0V5a3 3 0 00-3-3z"/>
          <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v3"/></svg>
        <span class="lbl">Call the team</span>
      </button>

      <button class="navitem" data-go="lately" aria-current="${state.view === 'lately' ? 'page' : 'false'}">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>
        Lately
      </button>

      <button class="navitem settings-open" data-settings>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3.2"/>
          <path d="M12 2.5v2.2M12 19.3v2.2M21.5 12h-2.2M4.7 12H2.5M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6M18.7 18.7l-1.6-1.6M6.9 6.9L5.3 5.3"/>
        </svg>
        Settings
      </button>
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
    <!--
      It goes somewhere now (#105).

      This was the most prominent button on the home screen and it did nothing
      — and could not have, because the payload carried no reference to
      anything. Migration 0240 adds the project slug and the blocker id, and it
      lands on Active jobs, which is the only screen that says what the blocker
      actually IS rather than that there is one.

      No backticks in this comment. Template literal.
    -->
    ${WAITING.slug ? `<button class="btn" data-blocked="${esc(WAITING.slug)}">Show me</button>` : ''}
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
/*
  Lately — what the office did, and what is being built.

  Two of the six sections that only existed on the plain page, and they are the
  same shape: a reverse-chronological list answering "what has been going on".
  One page with two columns rather than two rail items, because the IA is two
  levels and never three, and because they are read together.

  Grant on the second column: *"I want to see what it is that you're doing... so
  that I can pop into the application and see what it is you're doing."* It is
  neither office work nor his work — it is a window on the person changing the
  thing — which is why it sits beside the office's history rather than in
  Settings.
*/
function lately() {
  const d = latest.lately
  const office = d?.office ?? []
  const build = d?.building ?? {}
  const steps = build.steps ?? []
  const t = d?.today ?? {}

  /*
    A summary line only where there is something to summarise.

    The morning briefing arrived at this after telling Grant "nothing failed"
    every day for a month: a section that announces its own emptiness teaches
    the reader to skip the region.
  */
  const bits = []
  if (Number(t.jobs_done) > 0) bits.push(`${t.jobs_done} finished`)
  if (Number(t.jobs_failed) > 0) bits.push(`${t.jobs_failed} failed`)
  if (Number(t.events) > 0) bits.push(`${t.events} things recorded`)

  return `<main class="main">
    <div class="head">
      <div>
        <h1 class="t-display">Lately</h1>
        <p class="t-lead" style="margin:var(--s2) 0 0">${
          bits.length === 0
            ? 'Nothing in the last day. The office is idle, which is not the same as broken.'
            : `In the last day: ${esc(bits.join(', '))}.`
        }</p>
      </div>
    </div>

    <div class="lately">
      <section class="latecol">
        <h2 class="t-title">The office</h2>
        <p class="t-meta">What the team did, and whether it can be undone.</p>
        ${
          office.length === 0
            ? '<p class="t-meta">Nothing recorded yet.</p>'
            : `<div class="tasks">${office
                .map(
                  (e) => `<div class="task" style="cursor:default">
              ${face(crewBy(e.who), 22)}
              <span class="label t-meta" style="color:var(--ink)">
                <b style="font-weight:600">${esc(crewBy(e.who).name ?? e.who)}</b>
                ${esc(e.verb)} ${esc(e.what)}${e.project ? ` on ${esc(e.project)}` : ''}
                <span style="color:var(--ink-3)"> · ${esc(e.when)}</span>
                ${e.why ? `<span class="latewhy">${esc(e.why)}</span>` : ''}
              </span>
            </div>`,
                )
                .join('')}</div>`
        }
      </section>

      <section class="latecol">
        <h2 class="t-title">What Claude is building</h2>
        ${
          build.now
            ? `<article class="nowcard">
                <span class="t-label">${esc(build.now.towards ?? 'in progress')}</span>
                <b>${esc(build.now.headline ?? '')}</b>
                <p class="t-meta">${esc(build.now.detail ?? '')}</p>
              </article>`
            : ''
        }
        ${
          steps.length === 0
            ? '<p class="t-meta">Nothing in the diary yet.</p>'
            : `<div class="steps">${steps
                .slice(0, 12)
                .map(
                  (st) => `<article class="stepcard">
              ${
                st.shot
                  ? `<a href="${esc(st.shot)}" target="_blank" rel="noopener">
                       <img src="${esc(st.shot)}" alt="${esc(st.what ?? 'a screenshot of the work')}" loading="lazy">
                     </a>`
                  : ''
              }
              <div class="stepbody">
                <b>${esc(st.what ?? '')}</b>
                ${st.produced ? `<span class="t-meta">${esc(st.produced)}</span>` : ''}
                <span class="t-meta from">${esc(st.when ?? st.finished ?? '')}</span>
              </div>
            </article>`,
                )
                .join('')}</div>`
        }
      </section>
    </div>
  </main>`
}

/*
  The call, as a sheet.

  Deliberately spare. There is one thing to do here and a page of controls
  around a microphone is a page that makes you look for the microphone. The
  typing box is a disclosure rather than a second equal option: it is the
  fallback for a quiet room, not a parallel interface.
*/
function callSheet() {
  return `<div class="sheet callsheet">
    <div class="chead">
      <span style="flex:1;min-width:0">
        <h2 class="t-title" style="margin:0">Talk to the team</h2>
        <p class="t-meta" style="margin:4px 0 0">Claire picks up. She knows what the
          office has been doing — ask her, tell her, interrupt her.</p>
      </span>
    </div>

    <div class="callstage">
      <!--
        The ids are the old page's, deliberately.

        verify:talk drives this by id — call, talkstate, askform, asktext,
        asksend, turns, typeinstead — and those are stable handles an audit
        already knows. Keeping them means the check follows the capability
        rather than being rewritten alongside it, which is how a retarget
        quietly loses an assertion.

        No backticks in this comment. Template literal.
      -->
      <button type="button" class="bigmic" id="call" data-call aria-label="Call Claire">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="1.9" stroke-linecap="round" aria-hidden="true">
          <path d="M12 2a3 3 0 00-3 3v7a3 3 0 006 0V5a3 3 0 00-3-3z"/>
          <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v3"/></svg>
      </button>
      <p class="t-lead" id="talkstate" data-callstate style="margin:0;text-align:center">Press to call
        Claire. The browser will ask for the microphone once.</p>
    </div>

    <details class="typeinstead" id="typeinstead">
      <summary>Type instead</summary>
      <form class="askform" id="askform" data-callform>
        <input id="asktext" data-calltext placeholder="Say it here"
               aria-label="What you want to say" autocomplete="off" enterkeyhint="send">
        <button class="btn primary" id="asksend" type="submit">Send</button>
      </form>
      <div class="turns" id="turns" data-callturns></div>
    </details>
  </div>
  <button class="close" aria-label="Close">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
  </button>`
}

/*
  The desk is gone (#77).

  Grant: *"Remove Working now icons, All projects, and the redundant Desk
  view."* Redundant is the right word — everything that lived on the pannable
  surface now has a home in a project section, so it was a second door to the
  same rooms.

  `canvas.js` and the drag springs it used are kept: the customizable project
  dashboard (#81) is the same interaction with a reason to exist.
*/

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

    ${canWrite() ? '<div class="tabhead"><span></span><button class="btn primary" data-empty-do="contact">Add someone</button></div>' : ''}
    ${addContactForm(p)}
    ${
      shown.length === 0
        ? (p.contacts.length === 0
            ? emptyState({
                says: 'Nobody on this project yet.',
                ask: { name: 'Ask the team to find who it is about',
                       say: `Go through ${p.name}'s documents and messages and list the people it is actually about.` },
                mine: 'Add someone',
                mineDo: 'contact',
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
      <!--
        A new dashboard project (#68).

        Grant: "Please don't assume I wish to create a new project — this is a
        large task and should always be confirmed." So it takes two steps by
        design: the button opens the field, and the field is what creates. And
        hq_create_project without p_force returns CANDIDATES rather than
        creating, which is the behaviour that stops a fifth notebook for one
        intention — the studio shows them and makes him choose.

        No backticks in this comment: template literal.
      -->
      ${canWrite() ? `<span class="newproj" data-saidwrap>
        <input data-new-name placeholder="Name a new project" aria-label="Name a new project">
        <input data-new-ref placeholder="…and a link to attach" aria-label="A link to attach">
        <button class="btn" data-new-project>Create</button>
        <span class="t-meta" data-said></span>
      </span>` : ''}
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
      <!--
        The project's own version of the same dead button (#92). It goes to the
        project's Sources tab, which is where attaching to THIS project happens
        and where a pasted Drive link is already recognised on its own (#62) —
        not to Settings, which is about the office's credentials rather than
        about this project.
      -->
      <button class="link add" data-tab="sources">+ Connect something</button>
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

  /*
    The way out, and it is the first thing in the panel (#97, #98).

    Grant: *"ensure users can reliably return from the conversation to
    Documents"* and *"Provide an obvious X that closes the conversation panel
    and returns to the document."*

    Obvious is the requirement and it is the one most easily failed. Not
    hover-revealed: `opacity: 0` hides pixels and not layout, and on a touch
    screen a hover-revealed control does not exist at all — that is #67, where
    eight agent names wrapped one character per line behind an invisible
    button. And 44px, because the moment `verify:ui` was pointed at the right
    payload it found a 68x24 target in this same area.

    Two controls rather than one, because they do different things and merging
    them would be the bug: the X leaves the conversation and goes back to what
    you were reading; the small x on the chip below detaches the document and
    keeps you here to write about something else.

    This is a JS block comment, not an HTML one — it sits outside the template
    literal, so it closes with a star-slash and not with an arrow. Getting that
    wrong left the comment unterminated and the file unparseable.
  */
  const backTo = a?.back?.tab
  const backName = SECTIONS.find((sx) => sx.id === backTo)?.name ?? 'the project'

  return `<div class="tabbody chatbody">
    ${a?.back === undefined ? '' : `<div class="backbar">
      <button class="btn quiet backbtn" data-back-out>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M15 6l-6 6 6 6"/></svg>
        Back to ${esc(backName)}
      </button>
      <span class="t-meta">Talking about ${esc(a.title)}</span>
      <button class="closeconv" data-back-out aria-label="Close this conversation and go back to ${esc(backName)}">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
    </div>`}
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
        A real action now, not a stub (#68).

        Grant: treat an avoidable request for manual configuration as a design
        failure. So it takes a link and works the rest out — hq_attach reads
        knowledge_connectors and delegates a Drive folder to the Drive path
        without being told which kind it is.

        No backticks in this comment: template literal.
      -->
      ${canWrite() ? `<span data-saidwrap class="addsource">
        <input data-src-ref placeholder="Paste a Notion, Drive or notebook link" aria-label="A link to connect">
        <button class="btn" data-add-source="${esc(p.slug)}">Connect</button>
        <span class="t-meta" data-said></span>
      </span>` : ''}
    </div>
    <!--
      "Not now" — the fifth option, and the only one that ends in no attachment.

      Without it the office keeps asking about a connector Grant has decided
      this project does not want, and there is no way to answer except by
      connecting something. §3 lists it as a real answer, so it is a real
      control: it records the decision and the asking stops.

      No backticks in this comment. Template literal.
    -->
    ${
      canWrite()
        ? `<div class="declines" data-saidwrap>
      <span class="t-meta">Not every project needs everything.</span>
      ${(config.CONNECTIONS ?? [])
        .filter((k) => !(p.connectors ?? []).includes(k.name))
        .slice(0, 4)
        .map(
          (k) => `<button class="btn small quiet" data-decline="${esc(p.slug)}"
             data-connector="${esc(k.key)}" data-name="${esc(k.name)}">
             ${esc(p.name)} does not need ${esc(k.name)}</button>`,
        )
        .join('')}
      <span class="t-meta" data-said></span>
    </div>`
        : ''
    }
    <div class="sourcegrid">${list.map((x) => `
      <article class="source ${x.kind === 'connector' ? 'live' : ''}" data-saidwrap>
        <span class="t-label">${x.kind === 'connector' ? 'Connector' : 'Reference'}</span>
        <b>${x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.name)}</a>`
                   : esc(x.name)}</b>
        <span class="t-meta">${esc(x.via ?? '')}${x.what ? ` · ${esc(x.what)}` : ''}</span>
        <span class="srcfoot">
          ${x.kind === 'connector'
            ? `<span class="stage s-${x.health === 'ok' ? 'approved' : 'review'}">${
                x.health !== 'ok' ? esc(x.problem ?? 'switched off')
                : x.last === 'never' ? 'Not read yet'
                : `Read ${esc(x.last)}`}</span>`
            : `<span class="t-meta">${esc(x.last)}</span>`}
          <!--
            Counted per CONNECTOR, not per attachment, because documents record
            which connector they came through and not which of its data sources.
            Three Notion databases on one project therefore all report the same
            number, and saying "29 documents" three times looks like a bug. The
            wording carries the caveat instead of the number pretending to be
            something it is not.

            No backticks in this comment: template literal.
          -->
          ${x.gave > 0 ? `<span class="t-meta">${x.gave} via ${esc(x.via ?? 'it')}</span>` : ''}
          <span class="t-meta" data-said></span>
          ${canWrite() && x.id
            ? `<button class="btn small quiet" data-detach="${esc(x.id)}"
                 data-name="${esc(x.name)}">Disconnect</button>`
            : ''}
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
/*
  Adding a task (#11).

  `public.tasks` had a good schema and zero rows, because nothing anywhere
  could write one. Migrations 0238 and 0239 gave it an RPC; this is the mouth.

  A title and a project are all that is required — a form that demands a date,
  an owner and a description before it will accept "chase the invoice" is a
  form people route around. Date and owner are there because they are what
  makes a task reach the diary (#94) and reach a person, and both are optional.

  No backticks in the HTML comments below. Template literal.
*/
/*
  Adding a contact (#24, #99).

  Grant: *"Open a standard Add Contact form with name, phone number, email,
  Instagram, and other relevant contact details."* Those four are here by name,
  with role, org, website and a kind beside them.

  Only the name is required. A form that demands nine fields before it will
  take "Ben, referrer" is a form people route around, and a half-filled contact
  is worth more than the one nobody entered.

  `kind` is a select because the canonical IA lists companies, collaborators
  and suppliers beside people, and a supplier with no surname is not a
  malformed person.
*/
function addContactForm(p) {
  if (!canWrite()) return ''
  return `<div class="taskform" data-contact-form hidden>
    <div class="hirerow">
      <label>Name
        <input data-c-name placeholder="Ben Hartley" autocomplete="off"></label>
      <label>What they are to this project
        <input data-c-role placeholder="Referrer" autocomplete="off"></label>
    </div>
    <div class="hirerow">
      <label>Email
        <input data-c-email type="email" placeholder="ben@hartleyco.com" autocomplete="off"></label>
      <label>Phone
        <input data-c-phone placeholder="+44 7700 900118" autocomplete="off"></label>
    </div>
    <div class="hirerow">
      <label>Instagram
        <input data-c-insta placeholder="@benhartley" autocomplete="off"></label>
      <label>Organisation
        <input data-c-org placeholder="Hartley and Co" autocomplete="off"></label>
    </div>
    <div class="hirerow">
      <label>Kind
        <select data-c-kind>
          <option value="person">A person</option>
          <option value="company">A company</option>
          <option value="collaborator">A collaborator</option>
          <option value="supplier">A supplier</option>
        </select>
      </label>
      <span class="hireact">
        <span class="t-meta" data-said></span>
        <button class="btn primary" data-c-go>Add them</button>
        <button class="btn quiet" data-c-cancel>Cancel</button>
      </span>
    </div>
  </div>`
}

function addTaskForm(p) {
  if (!canWrite()) return ''
  return `<div class="taskform" data-task-form hidden>
    <div class="hirerow">
      <label>What needs doing
        <input data-task-title placeholder="Draft the pricing note" autocomplete="off"></label>
      <label>Due
        <input type="date" data-task-due></label>
    </div>
    <div class="hirerow">
      <label>Who
        <select data-task-who>
          <option value="">Nobody yet</option>
          ${CREW.map((c) => `<option value="${esc(c.staffSlug ?? c.slug)}">${esc(c.name)} — ${esc(c.role)}</option>`).join('')}
        </select>
      </label>
      <span class="hireact">
        <span class="t-meta" data-said></span>
        <button class="btn primary" data-task-go>Add it</button>
        <button class="btn quiet" data-task-cancel>Cancel</button>
      </span>
    </div>
  </div>`
}

function tasksSection(p) {
  if (p.tasks.length === 0) {
    return `<div class="tabbody">${emptyState({
      says: `Nothing to do on ${esc(p.name)} yet.`,
      ask: { name: 'Ask the team to work out what is needed',
             say: `Read everything on ${p.name} and propose the tasks it actually needs, with owners.` },
      mine: 'Add a task',
      mineDo: 'task',
    })}${addTaskForm(p)}</div>`
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
      ${canWrite() ? '<button class="btn primary" data-empty-do="task">Add a task</button>' : ''}
    </div>
    ${addTaskForm(p)}
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
      mine: 'Bring documents in',
      mineDo: 'sources',
    })}</div>`
  }
  return `<div class="tabbody">
    <div class="tabhead">
      <p class="t-lead" style="margin:0">${docs.length} in ${esc(p.name)}.
        Anything the team made is here only because you approved it.</p>
      <!--
        Documents arrive through a connector, not through an upload here (#105).

        This was a bare button with no attribute, like the Tasks header. It
        goes to Sources, which is where attaching Drive or Notion actually puts
        documents in a project, and where a pasted Drive link is already
        recognised on its own.

        No backticks in this comment. Template literal.
      -->
      <button class="btn" data-empty-do="sources">Bring documents in</button>
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
  const counts = sectionCounts(p)

  const teamBody =
    state.sub === 'chat' ? chatTab(p)
    : state.sub === 'jobs' ? activeJobs(p)
    : state.sub === 'outputs' ? teamTab(p)
    : teamBoard(p)

  const teamCounts = {
    jobs: counts.blocked,
    outputs: counts.waiting,
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
    <div class="head">
      <div class="projhead">
        <!--
          The mark, beside the title rather than a 208px band above it (#82).
          It keeps the view-transition-name so the portfolio card's mark still
          grows and moves into this slot when you open the project.
        -->
        <span class="hero ${p.hue}" style="view-transition-name:cover-${p.slug}">
          ${coverSvg(p.slug, { dense: true, facts: p })}
        </span>
        <span style="min-width:0">
        <h1 class="t-display projname"${
          canWrite() ? ` contenteditable="plaintext-only" spellcheck="false" data-rename="${esc(p.slug)}"` : ''
        }>${esc(p.name)}</h1>
        <p class="t-lead" style="margin:var(--s2) 0 0">${esc(p.purpose)}</p>
        </span>
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
        <!--
          The light/dark shortcut (#87).

          A sun icon sat here and did nothing. It was the Project Settings
          placeholder for #36, which is not built, so it shook and apologised —
          but the icon it shook with was a SUN, in the top right, which is where
          every application on earth puts a theme switch. Grant read it as a
          broken dark-mode button and he read it correctly.

          So the sun does what a sun does. Project settings comes back with #36,
          with a gear on it.

          It says which way it will go rather than which way it is: the icon is
          a moon when pressing it makes things dark. A control labelled with its
          current state reads as a status light and gets pressed by accident.
        -->
        <button class="btn iconbtn" data-scheme-toggle title="Switch between light and dark"
                aria-label="Switch between light and dark">
          <svg class="i-sun" width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="4.2"/>
            <path d="M12 2.5v2.4M12 19.1v2.4M21.5 12h-2.4M4.9 12H2.5M18.7 5.3l-1.7 1.7M7 17l-1.7 1.7M18.7 18.7L17 17M7 7L5.3 5.3"/>
          </svg>
          <svg class="i-moon" width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
            aria-hidden="true">
            <path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z"/>
          </svg>
        </button>
      </div>
    </div>

    <!--
      The section strip lived here. It is in the rail now (#80), which is where
      Grant asked for it. The counts moved with it: sectionCounts is
      top-level for exactly that reason.

      No backticks in this comment. Template literal.
    -->

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
/*
  One person, opened.

  Configure was a dead button — the one whose reserved 90px made eight names
  wrap a character per line (#67). This is what it should always have opened.

  Expanded in place rather than in a second sheet. Settings is already a sheet,
  and a sheet inside a sheet is two Escape presses and a lost sense of where you
  are. The card becomes the editor and the rest of the grid stays put, so the
  answer to "who else is there" never leaves the screen.

  Grant: *"I want the staff members details to be editable on the front page —
  names, roles, but you know what kind of skills they have? I'd like to give
  them the ability to interact with other tools."* Both halves are here, and 0119
  is why they look different: expertise is a text field because it grants
  nothing, and a tool is a checkbox against a foreign key because it does.
*/
const LEVEL_NAMES = ['Reads only', 'Writes internally', 'Acts outside', 'Needs approval']

function personEditor(c) {
  const tools = c.tools ?? []
  const held = tools.filter((t) => t.granted).length
  const procs = c.procedures ?? []
  const spares = config.SPARE_BOTS ?? []

  const groups = [0, 1, 2, 3]
    .map((lvl) => {
      const rows = tools.filter((t) => t.level === lvl)
      if (rows.length === 0) return ''
      return `<div class="toolgroup">
        <span class="t-label">${esc(LEVEL_NAMES[lvl])}</span>
        ${rows
          .map(
            (t) => `<label class="toolrow${t.available ? '' : ' off'}"${
              t.available ? '' : ` title="${esc(t.unavailable_because ?? 'switched off for everyone')}"`
            }>
            <input type="checkbox" data-grant="${esc(t.tool)}" data-who="${esc(c.slug)}"
              ${t.granted ? 'checked' : ''}${t.available ? '' : ' disabled'}>
            <span>${esc(t.description ?? t.tool)}</span>
          </label>`,
          )
          .join('')}
      </div>`
    })
    .join('')

  const botOptions = [
    '<option value="">— none —</option>',
    ...(c.bot ? [`<option value="${esc(c.bot)}" selected>@${esc(c.bot)}</option>`] : []),
    ...spares.map((b) => `<option value="${esc(b.username)}">@${esc(b.username)} (spare)</option>`),
  ].join('')

  return `<article class="staffcard open" data-saidwrap
           style="--hue:oklch(0.62 0.14 ${c.tone ?? 150})">
    <div class="sopen">
      <div class="srow">
        ${face(c, 46)}
        <div class="sfields">
          <input class="nm" data-f="p_name" value="${esc(c.name)}" aria-label="First name">
          <input data-f="p_title" value="${esc(c.role ?? '')}" aria-label="Role">
        </div>
        <button class="btn small quiet" data-close-person>Done</button>
      </div>

      <label class="flab">What they do</label>
      <textarea data-f="p_remit" rows="2" aria-label="What they do">${esc(c.remit ?? '')}</textarea>

      <label class="flab">How they talk <span class="t-meta">— one line, in your words.</span></label>
      <input data-f="p_style" value="${esc(c.style ?? '')}" aria-label="How they talk">

      <!--
        Skills route work, and they grant nothing.

        0119 drew the line and it is worth repeating on the page: this is
        vocabulary the router matches against, so a word here decides who gets
        asked. The tools below are the other thing entirely.

        No backticks in this comment. Template literal.
      -->
      <label class="flab">Skills <span class="t-meta">— comma separated. This decides
        who gets the work: "how much should we charge" finds whoever owns
        <i>charge</i>. It grants no tools.</span></label>
      <input data-f="p_skills" value="${esc((c.expertise ?? []).join(', '))}"
             aria-label="Skills" placeholder="pricing, charge, budget, forecast">

      <div class="srow wrap">
        <label class="flab" style="margin:0">Bot</label>
        <select data-bot="${esc(c.slug)}" aria-label="Which bot speaks as ${esc(c.name)}">
          ${botOptions}
        </select>
        ${c.bot ? `<a class="t-meta" href="https://t.me/${esc(c.bot)}" target="_blank" rel="noopener">open chat</a>` : ''}
      </div>

      <details class="tools">
        <summary>Tools — ${held} of ${tools.length} allowed</summary>
        <div class="toolbody">
          ${groups}
          <p class="t-meta">Ticking saves at once. A greyed row is switched off for
            everyone by policy, and granting it here cannot turn it on.</p>
        </div>
      </details>

      ${procs.length === 0 ? '' : `<details class="tools">
        <summary>How they work — ${procs.length} procedure${procs.length === 1 ? '' : 's'}</summary>
        <div class="toolbody">
          ${procs
            .map(
              (pr) => `<div class="proc" data-saidwrap>
              <div class="procname">${esc(pr.name)}${
                pr.scope === 'global' ? ' <span class="t-meta">— whole team</span>' : ''
              }</div>
              <div class="proctext">${esc(pr.procedure)}</div>
              <div class="srow">
                <span class="t-meta">from ${esc(pr.authored_by)} · shown to ${pr.uses ?? 0} job${
                  (pr.uses ?? 0) === 1 ? '' : 's'
                }</span>
                <span class="t-meta" data-said></span>
                <button class="btn small quiet" data-retire-proc="${esc(pr.skill_id)}">Retire</button>
              </div>
            </div>`,
            )
            .join('')}
          <p class="t-meta">Written down by telling the team, in a message. Retiring is
            reversible — say it again and it comes back.</p>
        </div>
      </details>`}

      <div class="srow wrap">
        <button class="btn primary" data-save-person="${esc(c.slug)}">Save</button>
        ${c.slug === 'chief-of-staff' ? '' : `<button class="btn small quiet"
          data-retire-person="${esc(c.slug)}" data-to="${c.active === false ? 'true' : 'false'}"
          data-name="${esc(c.name)}">${c.active === false ? 'Bring back' : 'Retire'}</button>`}
        <span class="t-meta" data-said></span>
      </div>
    </div>
  </article>`
}

function teamTabSettings() {
  const card = (c) =>
    state.person === c.slug
      ? personEditor(c)
      : `
    <article class="staffcard${c.active === false ? ' retired' : ''}" data-lift data-edge data-tilt="3.2"
             style="--hue:oklch(0.62 0.14 ${c.tone ?? 150})">
      ${face(c, 46)}
      <div class="sbody">
        <b>${esc(c.name)}</b>
        <span class="t-label">${esc(c.role)}</span>
        <span class="t-meta">${esc(
          c.active === false ? 'Retired' : (c.doing ?? 'Available'),
        )}</span>
      </div>
      <div class="sctl">
        <button class="btn" data-configure="${esc(c.slug)}">Configure</button>
      </div>
    </article>`

  const people = config.staff()
  return `<div class="setbody">
    <div class="tabhead">
      <p class="t-lead" style="margin:0">${people.filter((c) => c.active !== false).length}
        permanent. Bring in a specialist for a piece of work and they leave when it
        is finished.</p>
      ${canWrite() ? '<button class="btn primary" data-hire>+ Bring someone in</button>' : ''}
    </div>
    <!--
      The form behind the last dead button in the product (#105, migrations
      0233 to 0235).

      It carried data-hire and nothing anywhere looked that attribute up. Found
      by cross-referencing every data attribute in the rendered DOM against
      every attribute any source file queries, which is now verify:wired,
      rather than by pressing things one at a time.

      Why and when are required fields rather than optional ones. A hire with
      no reason and no end is how an office quietly grows: eight becomes
      eleven, nobody remembers why three of them are there, and every prompt is
      a little more expensive forever. The RPC refuses both too, because the
      page is not the only possible caller.

      No backticks in this comment. Template literal.
    -->
    <div class="hireform" data-hire-form hidden>
      <div class="hirerow">
        <label>Name
          <input data-hire-name placeholder="Priya" autocomplete="off"></label>
        <label>Here to do
          <input data-hire-title placeholder="Pricing research" autocomplete="off"></label>
      </div>
      <label>Why they are needed
        <input data-hire-why placeholder="The pricing work needs someone who is not already on three projects"
               autocomplete="off">
        <span class="t-meta" style="font-variant-caps:normal;letter-spacing:0">At least
          30 characters — the database enforces it, and a reason nobody can read later
          is the same as no reason.</span></label>
      <div class="hirerow">
        <label>Until
          <input type="date" data-hire-until></label>
        <span class="hireact">
          <span class="t-meta" data-said></span>
          <button class="btn primary" data-hire-go>Bring them in</button>
          <button class="btn quiet" data-hire-cancel>Cancel</button>
        </span>
      </div>
    </div>
    <div class="staffgrid">${people.map(card).join('')}</div>
    <p class="t-meta">A temporary agent carries a justification and an expiry, so the
      office never quietly grows. Removing one is reversible — there is no delete,
      because outputs, routing decisions and deliveries all name a person and a
      roster that can lose a row is a history that stops explaining itself.</p>
  </div>`
}

/*
  Setting up — the checklist, and the one thing only Grant can do.

  §31: an avoidable request for manual configuration is a design failure, and
  the preference order is API, then CLI, then automated configuration, then a
  manual UI. So this page is deliberately SHORT: everything that could be
  automated already was, and what is left is the irreducible part — a Google
  consent screen that has to be clicked by the person whose account it is.

  Three states and not two. `off` is something switched off on purpose and must
  not be shown as a fault; that distinction is the difference between a
  checklist you trust and one you learn to ignore.
*/
function setupTab() {
  const d = config.SETUP ?? {}
  const services = d.services ?? []
  const google = d.google ?? {}
  const needs = Number(d.needs_you ?? 0)
  const lamp = { ready: 'ok', action: 'degraded', off: 'off' }

  return `<div class="setbody">
    <div class="tabhead">
      <p class="t-lead" style="margin:0">${
        needs === 0
          ? `${d.ready ?? services.length} of ${services.length} services are set up. Nothing needs you.`
          : `${needs} thing${needs === 1 ? '' : 's'} need${needs === 1 ? 's' : ''} you. Everything else is done.`
      }</p>
    </div>

    ${
      google.services
        ? `<article class="behave" data-lift data-tilt="1.4" data-saidwrap>
      <div class="bhead">
        <b>Google</b>
        <span class="t-meta">${
          google.ready
            ? 'Connected. Calendar and mail are readable; sending stays off by policy.'
            : 'Not connected. One consent screen, and only you can click it.'
        }</span>
        <span class="t-meta" data-said></span>
      </div>
      <div class="srow wrap">
        ${
          google.ready
            ? `<button class="btn small quiet" data-forget-google>Disconnect Google</button>`
            : `<a class="btn primary" href="${esc(GOOGLE_START)}" target="_blank" rel="noopener">Connect Google</a>`
        }
      </div>
      <!--
        The two credentials, before the consent screen can be reached.

        The secret is a password field and is cleared the moment it is saved: it
        goes straight to the Supabase Vault through the API and is never echoed,
        never logged, and never put anywhere this page can read it back. That is
        the established mechanism, and it is why there is a field here at all
        rather than a request to paste it somewhere.

        Shown only when Google is not connected — once it is, these are answered
        and a form that stays around invites re-entering a working credential.

        No backticks in this comment. Template literal.
      -->
      ${
        google.ready
          ? ''
          : `<div class="gsetup" data-saidwrap>
        <label class="flab">Client ID</label>
        <input data-g-id placeholder="…apps.googleusercontent.com" aria-label="Google client ID"
               value="${esc(google.client_id ?? '')}">
        <label class="flab">Client secret</label>
        <input data-g-secret type="password" autocomplete="off"
               placeholder="GOCSPX-…" aria-label="Google client secret">
        <div class="srow wrap">
          <button class="btn" data-save-google>Save credentials</button>
          <span class="t-meta" data-said></span>
        </div>
      </div>`
      }
      <div class="glist">${(google.services ?? [])
        .map(
          (g) => `<div class="grow">
          <span class="dotstate ${g.connected ? 's-ok' : 's-off'}"></span>
          <b>${esc(g.name)}</b>
          <span class="t-meta">${esc(g.does)}</span>
        </div>`,
        )
        .join('')}</div>
    </article>`
        : ''
    }

    <div class="servicegrid">${services
      .map(
        (x) => `<article class="service s-${lamp[x.state] ?? 'unchecked'}" data-lift data-tilt="2.6">
        <div class="svbody">
          <b>${esc(x.name)}</b>
          <span class="t-meta">${esc(x.what ?? x.does ?? '')}</span>
          ${x.detail ? `<span class="t-meta from">${esc(x.detail)}</span>` : ''}
        </div>
        <div class="svfoot">
          <span class="dotstate"></span>
          <span class="t-label">${esc(
            x.state === 'ready' ? 'Ready' : x.state === 'off' ? 'Switched off' : 'Needs you',
          )}</span>
          ${x.action ? `<span class="t-meta">${esc(x.action)}</span>` : ''}
        </div>
      </article>`,
      )
      .join('')}</div>
  </div>`
}

/*
  Help — what all this is.

  Written as prose rather than a list of features, because the question it
  answers is not "what can it do" but "what am I looking at". Short on purpose:
  a help page nobody finishes is a help page nobody read.
*/
function helpTab() {
  const bits = [
    [
      'What this is',
      'Eight colleagues who take work from one queue. You ask, they do it, and ' +
        'everything they produce lands somewhere you can see it. Claire routes ' +
        'the work and is the only one who messages you.',
    ],
    [
      'A dashboard project',
      'The source of truth, and it lives here. A Notion database, a notebook or ' +
        'a Drive folder is something a project is attached to — never the ' +
        'project itself. Everything eventually lives here and can be pulled ' +
        'in or pushed out.',
    ],
    [
      'How to ask for something',
      'Talk to the team, send Claire a voice note on Telegram, or type in the ' +
        'chat on any project. Same queue either way — the surface you use ' +
        'never changes what the office does.',
    ],
    [
      'Teaching them',
      'Tell them in a message. "From now on, always give me the URL" becomes a ' +
        'standing preference; "when you write a status update, lead with what ' +
        'changed" becomes a procedure, and shows up on that person\'s card here.',
    ],
    [
      'What it costs',
      'About nothing. Free tiers throughout, measured on the Usage tab rather ' +
        'than assumed, and every figure there says whether it was counted or ' +
        'estimated.',
    ],
    [
      'When something looks wrong',
      'Lately shows everything that happened and whether it can be undone. ' +
        'Setting up shows what is connected. If a number looks wrong, it ' +
        'probably is — say so, because a dashboard that lies once is one you ' +
        'stop believing.',
    ],
  ]
  return `<div class="setbody">
    <div class="helpgrid">${bits
      .map(
        ([h, b]) => `<article class="helpcard" data-lift data-tilt="1.6">
        <b>${esc(h)}</b>
        <p class="t-meta">${esc(b)}</p>
      </article>`,
      )
      .join('')}</div>
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
      return `<article class="behave" data-lift data-tilt="1.6" data-saidwrap>
        <div class="bhead"><b>${esc(b.name)}</b><span class="t-meta" data-said></span></div>
        <div class="choices">
          ${b.options.map((o) => `
            <button class="choice ${b.value === o.id ? 'on' : ''}"
                    data-choose="${esc(b.id)}:${esc(o.id)}" data-via="${esc(b.via ?? '')}"
                    ${b.settable === false || !canWrite() ? 'disabled' : ''}>
              <b>${esc(o.name)}</b>
              <span class="t-meta">${esc(o.note)}</span>
            </button>`).join('')}
        </div>
      </article>`
    }
    if (b.kind === 'switch') {
      /*
        Drawn as a control only when it IS one.

        `settable` comes from the same allow-list `hq_set_setting` enforces, so
        the page can never offer a switch the API will refuse. Two of these are
        deliberately fixed rather than unbuilt — "keep everything undoable" is
        what the ledger does, not a preference — and both say why instead of
        being silently omitted, because a missing row raises the question and
        a stated one answers it.

        No backticks in this comment: template literal.
      */
      return `<article class="behave row" data-lift data-tilt="1.6" data-saidwrap>
        <div class="bhead">
          <b>${esc(b.name)}</b>
          <span class="t-meta">${esc(b.note)}</span>
          <span class="t-meta" data-said></span>
        </div>
        ${b.settable === false || !canWrite()
          ? `<span class="pillvalue">${b.value ? 'On' : 'Off'}</span>`
          : `<button class="toggle ${b.value ? 'on' : ''}" role="switch"
                aria-checked="${b.value}" data-toggle="${esc(b.id)}"
                data-via="${esc(b.via ?? '')}" data-now="${b.value ? '1' : ''}"
                aria-label="${esc(b.name)}"><span class="knob"></span></button>`}
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
             style="--tint:${esc(c.tint ?? 'var(--edge)')}">
      <!--
        Nothing rather than the word "undefined".

        The marks table has a logo for the services with one, and Uploads and
        MCP are not companies — there is no mark to draw. Printing an absent one
        gave every card without a logo the literal text "undefined", wrapped
        across two lines where the icon should be.

        This comment originally spelled that table name in backticks, inside an
        HTML comment, inside a template literal — while itself saying not to.
        The file became unparseable and every capture failed with a syntax
        error. Fourth time; the rule is in CLAUDE.md and it is easy to type.

        No backticks in this comment: template literal.
      -->
      ${c.svg ? `<span class="mark">${c.svg}</span>` : ''}
      <div class="svbody">
        <b>${esc(c.name)}</b>
        <span class="t-meta">${esc(c.used)}</span>
        <!--
          Capped. connection_health.detail is a short state note for most
          services and four hundred characters of token scoping for GitHub, and
          one card four times the height of its neighbours is the grid falling
          over. The whole note is still in the database for whoever needs it.

          No backticks in this comment. Template literal.
        -->
        <span class="t-meta from">${esc(
          String(c.detail ?? '').length > 110
            ? `${String(c.detail).slice(0, 108).replace(/[\s,;.]+\S*$/, '')}…`
            : (c.detail ?? ''),
        )}</span>
      </div>
      <div class="svfoot">
        <span class="dotstate"></span>
        <span class="t-label">${esc(config.STATE_LABEL[c.state])}</span>
        <span class="t-meta">${esc(c.last)}</span>
        <!--
          The action, and it goes somewhere (#89, #90).

          There was a button here carrying the text of c.fix and NOTHING ELSE —
          no attribute, no handler. "Connect it" on the Zoom card and "Rotate
          it" on the GitHub card, both completely inert. A card that names the
          problem and offers a button that does not fix it is worse than a card
          that only names the problem.

          Not connected gets Connect, routed to the flow that already exists.
          Connected gets Disconnect where a disconnect actually exists — which
          today is the Google family, through forget_google. Everything else
          says where its credential lives instead of offering a button that
          would lie.

          No backticks in this comment. Template literal.
        -->
        <span class="t-meta" data-said></span>
        ${(() => {
          const route = config.routeFor(c.key)
          if (!config.isConnected(c.state)) {
            if (route.how === 'oauth') {
              return `<a class="btn small primary" href="${esc(GOOGLE_START)}"
                        target="_blank" rel="noopener">${esc(route.label)}</a>`
            }
            if (route.how === 'tab') {
              return `<button class="btn small primary" data-goto-setting="${esc(route.to)}"
                        >${esc(route.label)}</button>`
            }
            return `<span class="t-meta">${esc(route.why ?? route.label)}</span>`
          }
          return route.family === 'google' && canWrite()
            ? '<button class="btn small quiet" data-forget-google>Disconnect</button>'
            : route.how === 'tab'
              ? `<button class="btn small quiet" data-goto-setting="${esc(route.to)}"
                   >Manage</button>`
              : ''
        })()}
      </div>
    </article>`
  const list = config.services()
  /*
    Only what is actually wrong.

    `state !== 'ok'` counted `unchecked` and `attested` as problems and told
    Grant four of six services wanted looking at when none of them did. A
    dashboard that cries wolf on the summary line is one he stops reading before
    reaching the card that matters.
  */
  const bad = list.filter((c) => config.isWrong(c.state)).length
  return `<div class="setbody">
    <div class="tabhead">
      <p class="t-lead" style="margin:0">${list.length} services. ${
        bad === 0 ? 'All of them well.' : `${bad} want looking at.`}</p>
      <button class="btn" data-connect-open>+ Connect something</button>
    </div>
    <!--
      The picker (#92).

      This button had no attribute and no handler at all — the front door to
      every integration in the product, completely inert, in two places.

      It lists only what the office can actually reach, and every row leads to
      a real flow or says plainly that there is not one. A picker offering a
      service that cannot be connected is the same defect one level up.

      No backticks in this comment. Template literal.
    -->
    <div class="connectpick" data-connect-menu hidden>
      <p class="t-lead" style="margin:0 0 var(--s3)">What would you like the office to
        reach? Each of these goes to the real thing.</p>
      <div class="pickgrid">
        ${list.map((c) => {
          const route = config.routeFor(c.key)
          const on = config.isConnected(c.state)
          const body = `<span class="pickname">${c.svg ? `<span class="mark">${c.svg}</span>` : ''}
              <b>${esc(c.name)}</b></span>
            <span class="t-meta">${esc(on ? config.STATE_LABEL[c.state] : (route.why ?? route.label))}</span>`
          if (on) return `<div class="pick done">${body}</div>`
          if (route.how === 'oauth') {
            return `<a class="pick" href="${esc(GOOGLE_START)}" target="_blank"
                      rel="noopener">${body}</a>`
          }
          if (route.how === 'tab') {
            return `<button class="pick" data-goto-setting="${esc(route.to)}">${body}</button>`
          }
          return `<div class="pick off">${body}</div>`
        }).join('')}
      </div>
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
            <!--
          Capped. connection_health.detail is a short state note for most
          services and four hundred characters of token scoping for GitHub, and
          one card four times the height of its neighbours is the grid falling
          over. The whole note is still in the database for whoever needs it.

          No backticks in this comment. Template literal.
        -->
        <span class="t-meta from">${esc(
          String(c.detail ?? '').length > 110
            ? `${String(c.detail).slice(0, 108).replace(/[\s,;.]+\S*$/, '')}…`
            : (c.detail ?? ''),
        )}</span>
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

      <!--
        Light and dark (#87).

        The shortcut in the project header sets the same value this does, and
        both read it back from the same place, so the two can never disagree —
        which was the thing most likely to go wrong here: one control that works
        and one that lies.

        Three choices, not a switch. Following the system is the default and the
        honest answer for most people; a boolean forces a side and then the
        studio is the one application on the machine that does not go dark at
        sunset with everything else.
      -->
      <div class="setgroup">
        <span class="t-label">Light and dark</span>
        <div class="segmented" role="group" aria-label="Light and dark">
          ${SCHEMES.map((x) => `
            <button class="seg ${now.scheme === x.id ? 'on' : ''}" data-scheme-pick="${x.id}"
                    aria-pressed="${now.scheme === x.id}">${esc(x.name)}</button>`).join('')}
        </div>
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

    </div>`
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
    : state.setting === 'setup' ? setupTab()
    : state.setting === 'help' ? helpTab()
    : teamTabSettings()

  /*
    The close button lives in the dialog's own header (#88).

    Grant: *"Put the X in the top-right corner of the dialog's outer header,
    outside the content area."* It was a sibling of the sheet, positioned
    against the backdrop — so it floated in the corner of the SCREEN, detached
    from the thing it closes, and on a narrow window it was nowhere near it.

    The header is `position: sticky` inside the scrolling sheet rather than
    `position: fixed`. Fixed would have been wrong twice over: the sheet is the
    scroll container, and a fixed child of anything carrying backdrop-filter,
    filter, transform, perspective or will-change anchors to that element
    instead of the viewport — which is how a bottom navigation bar once
    rendered across the top of the page.
  */
  v.innerHTML = `<div class="sheet wide settings">
    <div class="chead sheethead">
      <span style="flex:1;min-width:0">
        <h2 class="t-title" style="margin:0">The office</h2>
        <p class="t-meta" style="margin:4px 0 0">Everything about how this place
          runs, and what it is plugged into.</p>
      </span>
      <button class="close inhead" aria-label="Close">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
    </div>
    <div class="settabs" role="tablist" aria-label="Settings">
      ${config.TABS.map((t) => `<button role="tab" class="settab ${
        state.setting === t.id ? 'on' : ''
      }" aria-selected="${state.setting === t.id}" data-setting="${t.id}">${esc(t.name)}</button>`).join('')}
    </div>
    ${body}
  </div>`

  for (const b of v.querySelectorAll('[data-setting]')) {
    b.addEventListener('click', () => { state.setting = b.dataset.setting; settingsSheet(); sheet(v, true) })
  }
  /*
    Take me to where that is set up (#89, #92).

    The same navigation as the tab strip, but from a card. The point of it is
    that a person pressing Connect on the Notion card should not then have to
    know that Notion's token lives in "Setting up" — §31 again.
  */
  /* Open and close the picker. */
  const pickMenu = $('[data-connect-menu]', v)
  $('[data-connect-open]', v)?.addEventListener('click', (e) => {
    e.stopPropagation()
    if (pickMenu) pickMenu.hidden = !pickMenu.hidden
  })
  for (const b of v.querySelectorAll('[data-goto-setting]')) {
    b.addEventListener('click', () => {
      state.setting = b.dataset.gotoSetting
      settingsSheet()
      sheet(v, true)
    })
  }
  for (const el of v.querySelectorAll('[data-lift]')) {
    tiltable(el, { max: Number(el.dataset.tilt ?? 3), scale: 1.006 })
  }

  /*
    Behaviour, for real (#68).

    Three different RPCs behind three switches that look identical, which is
    why each row carries `via` rather than the page holding a lookup: autonomy
    is `hq_autonomy_set`, the chief switch is `hq_routing_set` (its own RPC,
    because turning it off means eight bots may message Grant), and the rest are
    `hq_set_setting` against its allow-list. A page that decides which one to
    call is a second place the routing lives.
  */
  const afterWrite = async () => {
    await config.hydrateSettings(read)
    settingsSheet()
    sheet(v, true)
  }

  const applyBehaviour = async (el, via, value) => {
    const [kind, name] = String(via ?? '').split(':')
    const done = await attempt(el, 'Saving…', () => {
      if (kind === 'autonomy') return act('autonomy_set', { p_level: value })
      if (kind === 'routing') return act('routing_set', { p_what: name, p_value: value })
      if (kind === 'setting') return act('set_setting', { p_key: name, p_value: value })
      throw new Error('nothing behind that control yet')
    })
    if (done !== null) await afterWrite()
  }

  for (const b of v.querySelectorAll('[data-toggle]')) {
    b.addEventListener('click', () => {
      // The value it will become, not the one it shows.
      applyBehaviour(b, b.dataset.via, b.dataset.now === '1' ? 'false' : 'true')
    })
  }

  for (const b of v.querySelectorAll('[data-choose]')) {
    b.addEventListener('click', () => {
      const chosen = String(b.dataset.choose).split(':')[1]
      /*
        Confirmed when it widens what the office may do on its own.

        Narrowing needs no confirmation — nobody regrets being asked more often
        — and treating both the same is how a confirmation becomes noise.
      */
      const widening = chosen !== 'suggest'
      if (
        widening &&
        !sure(
          'Let the team act without asking first? Consequential actions still ' +
            'wait for you, and you can put this back at any time.',
        )
      ) {
        return
      }
      applyBehaviour(b, b.dataset.via, chosen)
    })
  }

  /*
    The team, editable (#68).

    Five actions behind one card: edit the person, grant a tool, assign a bot,
    retire a procedure, retire the person. Each is a separate RPC because each
    is a separate kind of change — 0119's argument that a text field and a
    foreign key must not share a mechanism, applied to the interface.
  */
  /*
    Bringing someone in (#105, migrations 0233 to 0235).

    `afterWrite()` rather than a local splice, like every other write in this
    file: the roster the page shows comes from the office, and a page that
    edits its own copy is a page that disagrees with the database the moment
    anything else writes.
  */
  const hireForm = $('[data-hire-form]', v)
  $('[data-hire]', v)?.addEventListener('click', () => {
    if (hireForm) hireForm.hidden = !hireForm.hidden
    $('[data-hire-name]', v)?.focus()
  })
  $('[data-hire-cancel]', v)?.addEventListener('click', () => {
    if (hireForm) hireForm.hidden = true
  })
  $('[data-hire-go]', v)?.addEventListener('click', async (e) => {
    const b = e.currentTarget
    const name = String($('[data-hire-name]', v)?.value ?? '').trim()
    const title = String($('[data-hire-title]', v)?.value ?? '').trim()
    const why = String($('[data-hire-why]', v)?.value ?? '').trim()
    const until = String($('[data-hire-until]', v)?.value ?? '').trim()
    /*
      Said here rather than sent and refused.

      The RPC checks all of these and returns a sentence, so this could just
      post and show the answer. It does not, because a round trip to be told
      the name box is empty is a round trip nobody needed, and the message
      reads better attached to the press than arriving after it.
    */
    if (name === '' || title === '') {
      say(b, 'A name, and what they are here to do.', 'warn')
      return
    }
    if (why === '') {
      say(b, 'Say why. A hire with no reason is how a team grows without anyone deciding to.', 'warn')
      return
    }
    /*
      Thirty, because `staff_temporary_is_justified` says thirty. Mirrored so
      the form fails once instead of twice, and the count is in the message
      because "say more" without saying how much more is a field edited blind.
    */
    if (why.length < 30) {
      say(b, `${why.length} characters — a temporary hire needs at least 30.`, 'warn')
      return
    }
    if (until === '') {
      say(b, 'Say when they go.', 'warn')
      return
    }
    const done = await attempt(
      b,
      'Bringing them in…',
      () => act('staff_hire', {
        p_name: name,
        p_title: title,
        p_justification: why,
        // End of that day rather than its first instant: a date input gives
        // midnight, and "until the 20th" means through the 20th.
        p_expires_at: new Date(`${until}T23:59:59`).toISOString(),
      }),
      `${name} is on the team until ${until}.`,
    )
    if (done) {
      if (hireForm) hireForm.hidden = true
      await afterWrite()
    }
  })

  for (const b of v.querySelectorAll('[data-configure]')) {
    b.addEventListener('click', () => {
      state.person = b.dataset.configure
      settingsSheet()
      sheet(v, true)
    })
  }
  for (const b of v.querySelectorAll('[data-close-person]')) {
    b.addEventListener('click', () => {
      state.person = null
      settingsSheet()
      sheet(v, true)
    })
  }

  for (const b of v.querySelectorAll('[data-save-person]')) {
    b.addEventListener('click', async () => {
      const card = b.closest('.staffcard')
      const field = (name) => card?.querySelector(`[data-f="${name}"]`)?.value ?? ''
      const done = await attempt(
        b,
        'Saving…',
        () =>
          act('staff_update', {
            p_slug: b.dataset.savePerson,
            p_name: field('p_name'),
            p_title: field('p_title'),
            p_remit: field('p_remit'),
            p_style: field('p_style'),
            /*
              An empty box means no skills, and that is a real instruction.

              Splitting on comma and dropping the blanks rather than sending the
              raw string: the RPC takes an array, and "pricing, , charge" with an
              empty element is a routing word that matches everything.
            */
            p_skills: field('p_skills')
              .split(',')
              .map((x) => x.trim())
              .filter((x) => x !== ''),
          }),
        (r) => {
          const lost = Number(r?.skills_removed ?? 0)
          return lost > 0
            ? `Saved — ${lost} skill${lost === 1 ? '' : 's'} removed.`
            : 'Saved.'
        },
      )
      if (done) await afterWrite()
    })
  }

  for (const box of v.querySelectorAll('[data-grant]')) {
    box.addEventListener('change', async () => {
      /*
        Optimistic and then corrected, rather than optimistic and hoped for.

        The RPC refuses a grant for a globally disabled tool, and a checkbox left
        ticked after a refusal is a lie about what somebody can do.
      */
      const done = await attempt(box, 'Saving…', () =>
        act('staff_tool_set', {
          p_slug: box.dataset.who,
          p_tool: box.dataset.grant,
          p_granted: box.checked,
        }),
      )
      if (done === null) box.checked = !box.checked
      else await afterWrite()
    })
  }

  for (const sel of v.querySelectorAll('[data-bot]')) {
    // What it held, so a change knows which bot to hand back.
    sel.dataset.was = sel.value
    sel.addEventListener('change', async () => {
      const done = await attempt(sel, 'Saving…', async () => {
        /*
          Free the previous bot first.

          The RPC refuses to give a person a second bot — one each, so "who is
          this from" always has an answer — and a bot cannot be deleted and a
          username is claimed for ever, so firing must hand it back rather than
          consume it.
        */
        if (sel.dataset.was) await act('bot_assign', { p_username: sel.dataset.was, p_staff_slug: null })
        if (sel.value) await act('bot_assign', { p_username: sel.value, p_staff_slug: sel.dataset.bot })
        return { ok: true }
      })
      if (done) await afterWrite()
    })
  }

  for (const b of v.querySelectorAll('[data-retire-proc]')) {
    b.addEventListener('click', async () => {
      if (!sure('Retire this procedure? The team stops being shown it. Saying it again brings it back.')) {
        return
      }
      const done = await attempt(b, 'Retiring…', () =>
        act('retire_skill', { p_skill_id: b.dataset.retireProc }),
      )
      if (done) await afterWrite()
    })
  }

  for (const b of v.querySelectorAll('[data-retire-person]')) {
    b.addEventListener('click', async () => {
      const bringingBack = b.dataset.to === 'true'
      if (
        !bringingBack &&
        !sure(
          `Retire ${b.dataset.name}? They stop taking work. Everything they have ` +
            'already done stays, and you can bring them back at any time.',
        )
      ) {
        return
      }
      const done = await attempt(
        b,
        bringingBack ? 'Bringing back…' : 'Retiring…',
        () => act('staff_retire', { p_slug: b.dataset.retirePerson, p_active: bringingBack }),
        bringingBack ? 'Back on the team.' : 'Retired.',
      )
      if (done) await afterWrite()
    })
  }

  for (const b of v.querySelectorAll('[data-save-google]')) {
    b.addEventListener('click', async () => {
      const wrap = b.closest('[data-saidwrap]')
      const id = String(wrap?.querySelector('[data-g-id]')?.value ?? '').trim()
      const secretBox = wrap?.querySelector('[data-g-secret]')
      const secret = String(secretBox?.value ?? '').trim()
      if (id === '' && secret === '') {
        say(b, 'Nothing to save.', 'warn')
        return
      }
      const done = await attempt(
        b,
        'Saving…',
        async () => {
          if (id !== '') await act('set_setting', { p_key: 'google.client_id', p_value: id })
          if (secret !== '') await act('set_google_secret', { p_secret: secret })
          return { ok: true }
        },
        'Saved. Now press Connect Google.',
      )
      /*
        Cleared whatever happened.

        On success it is in the vault and this copy is redundant; on failure the
        commonest cause is pasting the client ID into the secret box, and
        leaving a wrong credential sitting in a password field is how it gets
        submitted again. Either way it does not stay on the page.
      */
      if (secretBox) secretBox.value = ''
      if (done) await afterWrite()
    })
  }

  for (const b of v.querySelectorAll('[data-forget-google]')) {
    b.addEventListener('click', async () => {
      /*
        Confirmed, and the sentence says what it costs.

        Nothing is deleted — the mail and calendar the office already read stay
        in `documents` — but the team stops being able to see the diary, which
        is a real loss of capability and not a tidy-up.
      */
      if (
        !sure(
          'Disconnect Google? The team stops being able to read your calendar ' +
            'and mail. Everything already read stays. Reconnecting is one consent screen.',
        )
      ) {
        return
      }
      const done = await attempt(b, 'Disconnecting…', () => act('forget_google', {}), 'Disconnected.')
      if (done) await afterWrite()
    })
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
  /*
    The same value the header's shortcut sets (#87). One setting, two doors —
    which is the only way the two can be guaranteed not to contradict each
    other, and a page insisting it is light while it is plainly dark is the
    worst outcome available here.
  */
  for (const b of v.querySelectorAll('[data-scheme-pick]')) {
    b.addEventListener('click', () => {
      pick('scheme', b.dataset.schemePick)
      paintSchemeButtons()
    })
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
  root.innerHTML = commandBar() + rail() + (
    state.view === 'project' ? dashboard()
    : state.view === 'lately' ? lately()
    : portfolio())
  // The room takes its colour from whatever is in front of you.
  ambient(state.view === 'project' ? byId(state.project).hue : PROJECTS[0].hue)
  breathe(root)
  scatter(root)
  // The rail is rebuilt on every render, so the call button is a new element
  // each time and knows nothing. A live call must not be represented by a
  // button that looks idle (#101).
  syncCallButtons()
  paintSchemeButtons()

  for (const b of root.querySelectorAll('[data-go]')) {
    b.addEventListener('click', () => {
      carry(null, null, () => {
        state.view = b.dataset.go
        state.label = null
        render()
      })
      // After the transition, not inside it: a fetch in the middle of a view
      // transition holds the old frame on screen until it resolves.
      if (b.dataset.go === 'lately') void needLately()
    })
  }

  /*
    Sources: connect and disconnect, for real (#68).

    The first two write actions the studio has ever had, and they are the right
    two to start with — a project's sources are the thing Grant changes most
    and the thing #62 already built the server half of.

    `hq_attach` takes a link and works the rest out: it reads
    `knowledge_connectors` to recognise the kind and delegates a Drive folder to
    the Drive path. §31 — an avoidable request for manual configuration is a
    design failure, so this asks for the link and nothing else.
  */
  for (const b of root.querySelectorAll('[data-add-source]')) {
    b.addEventListener('click', async () => {
      const field = b.closest('[data-saidwrap]')?.querySelector('[data-src-ref]')
      const ref = String(field?.value ?? '').trim()
      if (ref === '') {
        field?.focus()
        return
      }
      const done = await attempt(b, 'Connecting…', () =>
        act('attach', { p_slug: b.dataset.addSource, p_ref: ref }),
      )
      if (done) {
        if (field) field.value = ''
        await refresh()
      }
    })
  }

  /*
    A new dashboard project, and only when he says so twice.

    `hq_create_project` without `p_force` returns CANDIDATES and creates
    nothing — 0153 built that deliberately, because three notebooks once existed
    for one intention. So the first press may come back with "did you mean one
    of these", and only a second, explicit press creates.
  */
  for (const b of root.querySelectorAll('[data-new-project]')) {
    b.addEventListener('click', async () => {
      const wrap = b.closest('[data-saidwrap]')
      const name = String(wrap?.querySelector('[data-new-name]')?.value ?? '').trim()
      const ref = String(wrap?.querySelector('[data-new-ref]')?.value ?? '').trim()
      if (name === '' || ref === '') {
        say(b, 'A project needs a name and something to read from.', 'warn')
        return
      }
      const force = b.dataset.force === name

      if (!force && !sure(`Create a dashboard project called "${name}"?`)) return

      const made = await attempt(
        b,
        force ? 'Creating…' : 'Checking…',
        () => act('create_project', { p_name: name, p_connector: 'auto', p_ref: ref,
                                      ...(force ? { p_force: true } : {}) }),
        (r) => (r?.candidates?.length ? '' : 'Created.'),
      )
      /*
        Candidates came back, so nothing was created.

        Saying "already exists" would be wrong — these are near matches, not the
        same thing — and creating anyway would be the assumption he asked twice
        not to make. So it names them and arms the button to mean "yes, a new
        one" on the next press.
      */
      if (made?.candidates?.length) {
        b.dataset.force = name
        b.textContent = 'Create anyway'
        say(
          b,
          `We already have ${made.candidates.map((c) => c.name).join(', ')}. ` +
            'Press again if you want a new one as well.',
          'warn',
        )
        return
      }
      if (made) {
        b.dataset.force = ''
        b.textContent = 'Create'
        await refresh()
      }
    })
  }

  /*
    Rename in place, on the title itself.

    An edit-in-place rather than a pencil and a dialogue: there are four
    projects and the name is one field. Committed on blur or Enter, and Escape
    puts it back — which matters because a contenteditable that cannot be
    abandoned is a trap.
  */
  for (const h of root.querySelectorAll('[data-rename]')) {
    const was = h.textContent
    const commit = async () => {
      const now = h.textContent.trim()
      if (now === was || now === '') {
        h.textContent = was
        return
      }
      const done = await attempt(
        h,
        'Renaming…',
        () => act('rename_project', { p_slug: h.dataset.rename, p_name: now }),
        'Renamed.',
      )
      if (done) await refresh()
      else h.textContent = was
    }
    h.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); h.blur() }
      if (e.key === 'Escape') { h.textContent = was; h.blur() }
    })
    h.addEventListener('blur', commit)
  }

  for (const b of root.querySelectorAll('[data-decline]')) {
    b.addEventListener('click', async () => {
      const done = await attempt(
        b,
        'Noting it…',
        () =>
          act('connection_choose', {
            p_slug: b.dataset.decline,
            p_connector: b.dataset.connector,
            p_choice: 'declined',
            p_reason: 'Decided from the dashboard.',
          }),
        `Noted — nothing will ask about ${b.dataset.name} on this project again.`,
      )
      if (done) await refresh()
    })
  }

  for (const b of root.querySelectorAll('[data-detach]')) {
    b.addEventListener('click', async () => {
      /*
        Confirmed, always. Grant: "You should always check before making any
        destructive action with me."

        Nothing is lost by disconnecting — ADR-0013 is explicit that the corpus
        a connector fed survives the connector being removed — and the sentence
        says so, because a confirmation that overstates the danger is one people
        learn to click through.
      */
      if (
        !sure(
          `Disconnect ${b.dataset.name}? The documents it already gave stay; ` +
            'nothing new comes in until it is connected again.',
        )
      ) {
        return
      }
      const done = await attempt(
        b,
        'Disconnecting…',
        () => act('detach', { p_attachment_id: b.dataset.detach }),
        'Disconnected.',
      )
      if (done) await refresh()
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

      /*
        And then persist it (#11).

        The tick was a Set in browser memory and nothing else: it survived
        until the next render and never reached the office. `state.done` still
        exists because it is what makes the tick instant — the write is a round
        trip and a checkbox that waits for one feels broken — but it is now the
        optimistic half of a real write rather than the whole of it.

        A failure puts the tick back where it was and says so, because a
        checkbox that silently reverts is worse than one that never moved.
      */
      const id = b.dataset.taskId
      if (id === undefined || !canWrite()) return
      /*
        `refresh()`, not `afterWrite()`.

        `afterWrite` is defined inside the settings wiring and re-renders the
        SETTINGS SHEET — calling it from the project page threw
        "afterWrite is not defined" in the first end-to-end run, which is
        exactly why that run existed. `refresh()` re-reads the studio payload
        and repaints the page, which is what a task write needs.
      */
      act('task_state', { p_task_id: id, p_state: check ? 'done' : 'todo' })
        .then(() => refresh())
        .catch((err) => {
          check ? state.done.delete(i) : state.done.add(i)
          b.classList.toggle('done')
          box.innerHTML = check ? '' : box.innerHTML
          say(b, String(err.message ?? err), 'warn')
        })
    })
  }

  /*
    The empty states' own actions, and the Tasks header (#105).

    Every one of these was a bare button with no attribute. `task` opens the
    add-task form; anything else is a section to go to — "Bring documents in"
    goes to Sources, where attaching a connector is what actually puts
    documents in a project.
  */
  for (const b of root.querySelectorAll('[data-empty-do]')) {
    b.addEventListener('click', () => {
      const what = b.dataset.emptyDo
      if (what === 'task' || what === 'contact') {
        const sel = what === 'task' ? '[data-task-form]' : '[data-contact-form]'
        const first = what === 'task' ? '[data-task-title]' : '[data-c-name]'
        const form = $(sel, root)
        if (form) {
          form.hidden = false
          $(first, root)?.focus()
        }
        return
      }
      state.tab = what
      rememberTab(state.project, what)
      render()
    })
  }

  $('[data-c-cancel]', root)?.addEventListener('click', () => {
    const form = $('[data-contact-form]', root)
    if (form) form.hidden = true
  })

  $('[data-c-go]', root)?.addEventListener('click', async (e) => {
    const b = e.currentTarget
    const val = (sel) => String($(sel, root)?.value ?? '').trim()
    const name = val('[data-c-name]')
    if (name === '') { say(b, 'A name, at least.', 'warn'); return }
    const done = await attempt(
      b,
      'Adding…',
      () => act('contact_add', {
        p_project: state.project,
        p_name: name,
        p_role: val('[data-c-role]') || null,
        p_org: val('[data-c-org]') || null,
        p_email: val('[data-c-email]') || null,
        p_phone: val('[data-c-phone]') || null,
        p_instagram: val('[data-c-insta]') || null,
        p_kind: val('[data-c-kind]') || 'person',
      }),
      `${name} is on ${byId(state.project).name}.`,
    )
    if (done) {
      const form = $('[data-contact-form]', root)
      if (form) form.hidden = true
      await refresh()
    }
  })

  $('[data-task-cancel]', root)?.addEventListener('click', () => {
    const form = $('[data-task-form]', root)
    if (form) form.hidden = true
  })

  $('[data-task-go]', root)?.addEventListener('click', async (e) => {
    const b = e.currentTarget
    const title = String($('[data-task-title]', root)?.value ?? '').trim()
    if (title === '') { say(b, 'Say what needs doing.', 'warn'); return }
    const due = String($('[data-task-due]', root)?.value ?? '').trim()
    const who = String($('[data-task-who]', root)?.value ?? '').trim()
    const done = await attempt(
      b,
      'Adding…',
      () => act('task_add', {
        p_project: state.project,
        p_title: title,
        p_due_on: due === '' ? null : due,
        p_assignee: who === '' ? null : who,
      }),
      'Added.',
    )
    if (done) {
      const form = $('[data-task-form]', root)
      if (form) form.hidden = true
      await refresh()
    }
  })

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
  /*
    Call the team, for real (#68).

    This was a stub that said "Calling Claire…" for two and a half seconds and
    did nothing — and before that it was genuinely dead, writing to an element
    that had been removed from the rail. It is the most prominent control in the
    interface, the one Grant asked to be prominent, and it is the last thing
    that kept the old page alive.

    Opened as a sheet rather than a route: a call is a thing you are doing
    while looking at something else, and navigating away from the project you
    were discussing to talk about it is exactly backwards.
  */
  /*
    Closing the sheet does not hang up (#101, #102).

    It used to be the only way a call ended, and it ended it by throwing away
    the reference rather than by stopping anything — the microphone stayed
    open with no interface attached to it. Now the call is a module-level
    singleton in `call.js`: the sheet attaches to it and detaches from it, and
    the only thing that stops a microphone is `endCall`.

    So the rail button opens the sheet whether or not a call is running, and
    the sheet's own microphone button is what starts and ends one. The rail
    button still shows the state, because `syncCallButtons` paints every
    element carrying `data-call`.
  */
  const call = $('[data-call]', root)
  call?.addEventListener('click', () => {
    const v = $('#viewer')
    v.innerHTML = callSheet()
    sheet(v, true)
    const shut = () => { unwireCall(); sheet(v, false); syncCallButtons() }
    $('.close', v)?.addEventListener('click', shut)
    v.addEventListener('click', (e) => { if (e.target === v) shut() })
    wireCall(v)
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

  /*
    The light/dark shortcut, for real (#87).

    Nothing re-renders: the theme is tokens on the root element, so flipping the
    attribute repaints the whole page without touching a single node. Which is
    also why it must not call `render()` — that would throw away an open menu
    and any text being typed, to change a colour.
  */
  for (const b of root.querySelectorAll('[data-scheme-toggle]')) {
    b.addEventListener('click', () => {
      toggleScheme()
      paintSchemeButtons()
    })
  }

  /*
    "Talk to the team about this" (#27).

    `stopPropagation`, because the button sits beside a card that opens the
    document viewer and a bare click would do both. The attachment is put on
    state, the tab switches, and the composer takes focus — the whole action is
    one press and then typing.
  */
  /*
    Leave the conversation and go back to what you were reading (#97, #98).

    One handler for both controls in the bar. `state.attach` is cleared with
    the navigation because the attachment IS the conversation-about-this-thing;
    leaving it set would mean the next message you typed from Documents was
    silently still about the document you had walked away from.
  */
  for (const b of root.querySelectorAll('[data-back-out]')) {
    b.addEventListener('click', () => {
      const back = state.attach?.back
      state.attach = null
      state.tab = back?.tab ?? 'documents'
      state.sub = back?.sub ?? 'board'
      render()
    })
  }

  for (const b of root.querySelectorAll('[data-talk-kind]')) {
    b.addEventListener('click', (e) => {
      e.stopPropagation()
      /*
        Where we came from travels with the attachment (#97).

        Getting back from a document conversation was "unreliable" because two
        different things were wrong. This is the second: arriving here called
        `rememberTab(project, 'team')`, which PERSISTS the tab. So opening a
        conversation about a document silently changed where that project opens
        for ever after — you would come back tomorrow and land in Chat, having
        never chosen it. A side action must not rewrite a deliberate choice, so
        the remembered tab is left alone and the return path is carried instead.
      */
      state.attach = {
        kind: b.dataset.talkKind,
        id: b.dataset.talkId,
        title: b.dataset.talkTitle,
        back: { tab: state.tab, sub: state.sub },
      }
      state.tab = 'team'
      state.sub = 'chat'
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

/*
  Opening a document shows the document (#95, #96).

  It used to draw `pageSvg(doc.title, doc.kind)` — a GENERATED ILLUSTRATION of
  a page, the same drawing the grid thumbnail uses, at a larger size. The text
  was never rendered anywhere, at any length. Grant's issue said "show complete
  documents" and the honest reading of that was that it truncated; it did not
  truncate, it never showed any.

  The illustration is still what you see while the text is on its way, and it
  is still what you get for a document the office cannot read back — an audio
  file, or a Notion database container that is a folder rather than a page.
  It is a good drawing. It was only ever the wrong thing to stop at.

  The fetch is per document and deliberate: `hq_studio` carries up to 24
  documents per project and cannot carry their text — the longest document in
  the office is 180,000 characters. Metadata in the grid, content on open, the
  same shape `needLately()` uses.
*/
function openDoc(doc, from) {
  const v = $('#viewer')
  const head = `<div class="t-label">${esc(doc.origin)}</div>
      <h2 class="t-title" style="margin:var(--s2) 0 var(--s3)">${esc(doc.title)}</h2>
      <p class="t-meta">${esc(doc.size)}</p>`
  v.innerHTML = `<div class="sheet docsheet">
      <div class="sheethead">
        <span style="flex:1;min-width:0">${head}</span>
        <button class="close inhead" aria-label="Close">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
      <div class="docbody" data-docbody>
        <div class="bigpage" data-bigpage>${pageSvg(doc.title, doc.kind)}</div>
      </div>
    </div>`
  if (doc.file) paint($('[data-bigpage]', v), doc.file, 760)
  const page = $('.page', from)
  const shut = () => carry('doc-open', page, () => { sheet(v, false) })
  carry('doc-open', page, () => { sheet(v, true) })
  $('.close', v).addEventListener('click', shut)
  v.addEventListener('click', (e) => { if (e.target === v) shut() })
  if (doc.id) void fillDoc(doc, $('[data-docbody]', v))
}

/*
  The text, once it arrives.

  Failure leaves the illustration in place and says so underneath, rather than
  emptying the sheet. A reader that goes blank on a network hiccup is worse
  than one that shows the drawing it already had.
*/
async function fillDoc(doc, host) {
  if (!host) return
  let full
  try {
    full = await read('document', doc.id)
  } catch (e) {
    host.insertAdjacentHTML('beforeend',
      `<p class="t-meta">Could not fetch this document — ${esc(String(e.message ?? e))}</p>`)
    return
  }
  if (!full || full.error) {
    host.insertAdjacentHTML('beforeend',
      `<p class="t-meta">${esc(full?.error ?? 'The office had nothing for this one.')}</p>`)
    return
  }

  /*
    A PDF goes to the browser's own reader, not to a reimplementation (#96).

    No bundler and no build step (ADR-0002, ADR-0011), so PDF.js is out; and a
    CDN copy is worse than out, because the build sandbox cannot reach external
    hosts and every capture would show an empty frame. An iframe on the file is
    free, needs nothing, and is genuinely good on a desktop.

    It is unreliable on iOS Safari, which is exactly why "Open in new tab" is
    not a nicety — on a phone it is frequently the only thing that works. So it
    is a real link to the real file, prominent, not tucked away.
  */
  const mime = String(full.mime_type ?? '')
  const isPdf = mime === 'application/pdf' || /\.pdf$/i.test(full.title ?? '')

  /*
    `full.url`, not `full.path`.

    The `files` bucket is private, so the storage path is useless to a browser.
    The edge function swaps it for a signed URL that lives ten minutes and
    drops the path from the response — the page gets something it can follow
    and learns nothing about how storage is laid out.
  */
  if (isPdf && full.url) {
    host.innerHTML = `<div class="pdfwrap"><iframe class="pdfframe" src="${esc(full.url)}"
        title="${esc(full.title)}"></iframe></div>
      <p class="docfoot"><a class="btn" href="${esc(full.url)}" target="_blank"
        rel="noopener">Open the PDF in a new tab</a></p>`
    return
  }

  /*
    Audio plays here rather than being described (#66 put one in the office).

    The one document in the office with a real file is a 940 KB audio overview,
    and until now opening it showed a drawing of a page.
  */
  if (mime.startsWith('audio/') && full.url) {
    host.innerHTML = `<audio class="docaudio" controls preload="none"
        src="${esc(full.url)}"></audio>
      <p class="docfoot t-meta">Audio. The office holds no transcript for this one.</p>`
    return
  }

  const text = String(full.content ?? '').trim()
  if (text === '') {
    host.insertAdjacentHTML('beforeend', `<p class="t-meta">${
      String(full.mime_type ?? '').startsWith('audio/')
        ? 'This one is audio, and the office could not produce a link for it.'
        : 'The office holds this document but has no text for it.'
    }</p>`)
    return
  }

  /*
    Paragraphs, escaped, not innerHTML of the content.

    Document text comes from Notion, Drive and the office's own agents. It is
    data, and putting it through innerHTML would let a document written by
    anything upstream execute in the studio. Split on blank lines, escape each
    piece — the whole document, no clamp, no max-height.
  */
  host.innerHTML = `<article class="doctext">${
    text.split(/\n{2,}/).map((para) => `<p>${esc(para).replace(/\n/g, '<br>')}</p>`).join('')
  }</article>${
    full.mirrored
      ? '<p class="docfoot t-meta">The office wrote this into a connector and read it back. It is not new material.</p>'
      : ''
  }`
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
// Same derivation the old page used: one base, and the OAuth start is a sibling
// function. Hardcoding a second URL is how the two drift on the day the project
// reference changes.
const GOOGLE_START = API.replace(/\/hq-api$/, '/google-oauth/start')

/*
  Re-read the office and repaint.

  After every write, rather than patching the state in place. Patching is faster
  and is how two things drift: the server decides what an attachment is called
  and whether it is enabled, and a page that guesses shows one thing while the
  database holds another. A round trip costs a moment and is always right.
*/
/*
  Payloads that belong to one screen rather than to the whole shell.

  The portfolio and every project come from one call, because the shell paints
  them all at once and a page that fetches per section feels broken while being
  correct. Lately is different: most visits never open it, and forty ledger rows
  and a dozen screenshots on every load is a cost paid by everyone for a page
  few of them want. So it is fetched when it is first asked for and kept.
*/
const latest = { lately: null }

async function needLately() {
  if (latest.lately !== null) return
  try {
    latest.lately = await read('lately')
  } catch {
    // Left null. The view says there is nothing rather than showing an error,
    // which on a history page is nearly the same sentence.
    latest.lately = { office: [], building: {}, today: {} }
  }
  render()
}

async function refresh() {
  // A write can add a ledger row, so the kept copy is now behind.
  latest.lately = null
  await Promise.all([
    hydrate(API, (() => {
      try {
        return localStorage.getItem('hq.token') ?? ''
      } catch {
        return ''
      }
    })()),
    // Both, together. Settings is a separate payload because it is a separate
    // screen and most visits never open it — but a write can change either, so
    // a refresh re-reads both rather than leaving one stale behind a tab.
    config.hydrateSettings(read),
    hydrateUsage(read),
  ])
  render()
}

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
  await Promise.all([hydrate(API, token), config.hydrateSettings(read), hydrateUsage(read)])
  render()
}

live()
